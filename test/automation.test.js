/**
 * Automation: retrieval, failure isolation, and a full cycle run twice.
 * No network is used - every response is supplied by a stub.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseFeed } from '../src/lib/feed.js';
import { silentLogger } from '../src/lib/logger.js';
import { fetchText } from '../src/lib/http.js';
import { discoverAll, retrieveSource } from '../src/pipeline/discover.js';
import { readState, writeState } from '../src/pipeline/store.js';
import { runUpdate } from '../src/pipeline/update.js';

const NOW = '2026-08-08T01:00:00.000Z';

/** Minimal Response stand-in. */
function reply(body, { status = 200, contentType = 'application/rss+xml', headers = {} } = {}) {
  const store = new Map(Object.entries({ 'content-type': contentType, ...headers }));
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://example.gov.ph/feed',
    headers: { get: (key) => store.get(key.toLowerCase()) ?? null },
    text: async () => body,
    body: null,
  };
}

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>City Government of Malolos</title>
<item>
  <title>Suspension of classes in all levels in the City of Malolos on August 9, 2026</title>
  <link>https://www.cityofmalolos.gov.ph/announcements/class-suspension</link>
  <description>Classes in all levels in the City of Malolos are suspended tomorrow, August 9, 2026 due to heavy rainfall. All residents are advised to stay indoors.</description>
  <pubDate>Fri, 07 Aug 2026 22:00:00 +0800</pubDate>
</item>
<item>
  <title>PHOTO RELEASE - CITY HALL EMPLOYEES RECEIVE AWARDS</title>
  <link>https://www.cityofmalolos.gov.ph/news/awards</link>
  <description>City hall employees were awarded during a ceremony held this morning.</description>
  <pubDate>Fri, 07 Aug 2026 21:00:00 +0800</pubDate>
</item>
</channel></rss>`;

const FEED_SOURCE = {
  id: 'malolos-city-website',
  name: 'City Government of Malolos',
  tier: 1,
  scope: 'malolos',
  kind: 'rss',
  homepage: 'https://www.cityofmalolos.gov.ph/',
  url: 'https://www.cityofmalolos.gov.ph/feed/',
  enabled: true,
};

const TEST_SOURCES = [FEED_SOURCE];
const noSleep = () => Promise.resolve();

describe('retrieval', () => {
  it('reads a well-formed feed', async () => {
    const result = await retrieveSource(FEED_SOURCE, {
      fetchOptions: { fetchImpl: async () => reply(FEED), sleepImpl: noSleep },
    });
    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates[0].sourceId, 'malolos-city-website');
  });

  it('reports a source that is unavailable, without throwing', async () => {
    const result = await retrieveSource(FEED_SOURCE, {
      fetchOptions: { fetchImpl: async () => reply('nope', { status: 503 }), sleepImpl: noSleep, retries: 1 },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.status, 503);
    assert.deepEqual(result.candidates, []);
  });

  it('reports a source that blocks automated requests', async () => {
    const result = await retrieveSource(FEED_SOURCE, {
      fetchOptions: { fetchImpl: async () => reply('forbidden', { status: 403 }), sleepImpl: noSleep },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.status, 403);
  });

  it('reports a timeout', async () => {
    const result = await retrieveSource(FEED_SOURCE, {
      fetchOptions: {
        fetchImpl: async () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        },
        sleepImpl: noSleep,
        retries: 1,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'timeout');
  });

  it('retries a transient failure and then succeeds', async () => {
    let calls = 0;
    const result = await retrieveSource(FEED_SOURCE, {
      fetchOptions: {
        sleepImpl: noSleep,
        fetchImpl: async () => {
          calls += 1;
          return calls === 1 ? reply('busy', { status: 503 }) : reply(FEED);
        },
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
  });

  it('rejects a page that is not a feed at all', async () => {
    const result = await retrieveSource(FEED_SOURCE, {
      fetchOptions: {
        fetchImpl: async () => reply('<html><body>Under maintenance</body></html>', { contentType: 'text/html' }),
        sleepImpl: noSleep,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'format');
  });

  it('keeps the readable entries of a partly malformed feed', () => {
    const broken = `<rss><channel>
      <item><title>Water service interruption in Barangay Mojon</title><link>https://www.cityofmalolos.gov.ph/a</link></item>
      <item><title>Broken entry<link>oops</item>
      <item><title>Road closure along MacArthur Highway</title><link>https://www.cityofmalolos.gov.ph/b</link></item>
    </channel></rss>`;
    const feed = parseFeed(broken);
    assert.ok(feed.entries.length >= 2, `expected the readable entries, got ${feed.entries.length}`);
  });

  it('handles an empty document without throwing', () => {
    assert.deepEqual(parseFeed('').entries, []);
    assert.deepEqual(parseFeed(null).entries, []);
  });

  it('honours a not-modified response', async () => {
    const result = await retrieveSource(FEED_SOURCE, {
      validators: { etag: 'W/"abc"' },
      fetchOptions: { fetchImpl: async () => reply('', { status: 304 }), sleepImpl: noSleep },
    });
    assert.equal(result.ok, true);
    assert.equal(result.notModified, true);
  });

  it('caps an oversized response', async () => {
    const huge = 'x'.repeat(5000);
    const response = await fetchText('https://example.gov.ph/feed', {
      fetchImpl: async () => reply(huge, { contentType: 'text/html' }),
      maxBytes: 100,
      sleepImpl: noSleep,
    });
    assert.equal(response.body.length, 100);
  });

  it('isolates one failing source from the others', async () => {
    const sources = [FEED_SOURCE, { ...FEED_SOURCE, id: 'bulacan-province', url: 'https://bulacan.gov.ph/feed/' }];
    const { results, candidates } = await discoverAll(sources, {
      fetchOptions: {
        sleepImpl: noSleep,
        fetchImpl: async (url) =>
          url.includes('bulacan') ? reply('down', { status: 500 }) : reply(FEED),
      },
    });
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok).length, 1);
    assert.equal(candidates.length, 2);
  });
});

describe('a full update cycle', async () => {
  async function withTempState(run) {
    const dir = await mkdtemp(join(tmpdir(), 'alerto-'));
    const statePath = join(dir, 'state.json');
    try {
      return await run(statePath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('posts the announcement and skips the news item', async () => {
    await withTempState(async (statePath) => {
      const { state, changes } = await runUpdate({
        sources: TEST_SOURCES,
        statePath,
        now: NOW,
        logger: silentLogger(),
        fetchOptions: { fetchImpl: async () => reply(FEED), sleepImpl: noSleep },
      });
      assert.equal(state.board.length, 1);
      assert.equal(changes.added.length, 1);
      assert.match(state.board[0].title, /Suspension of classes/);
      assert.equal(state.lastCheckedAt, NOW);
    });
  });

  it('changes nothing when it runs again', async () => {
    await withTempState(async (statePath) => {
      const options = {
        sources: TEST_SOURCES,
        statePath,
        now: NOW,
        logger: silentLogger(),
        fetchOptions: { fetchImpl: async () => reply(FEED), sleepImpl: noSleep },
      };
      const first = await runUpdate(options);
      const second = await runUpdate({ ...options, now: '2026-08-08T02:00:00.000Z' });

      assert.equal(second.state.board.length, 1);
      assert.equal(second.changes.added.length, 0);
      assert.equal(second.changes.updated.length, 0);
      assert.equal(second.state.board[0].id, first.state.board[0].id);
    });
  });

  it('keeps the board when every source fails', async () => {
    await withTempState(async (statePath) => {
      const good = await runUpdate({
        sources: TEST_SOURCES,
        statePath,
        now: NOW,
        logger: silentLogger(),
        fetchOptions: { fetchImpl: async () => reply(FEED), sleepImpl: noSleep },
      });
      assert.equal(good.state.board.length, 1);

      const outage = await runUpdate({
        sources: TEST_SOURCES,
        statePath,
        now: '2026-08-08T02:00:00.000Z',
        logger: silentLogger(),
        fetchOptions: {
          fetchImpl: async () => {
            throw new Error('network unreachable');
          },
          sleepImpl: noSleep,
          retries: 0,
        },
      });
      assert.equal(outage.state.board.length, 1, 'an outage must not empty the board');
      assert.equal(outage.state.sources['malolos-city-website'].consecutiveFailures, 1);
    });
  });

  it('survives a source that starts serving garbage', async () => {
    await withTempState(async (statePath) => {
      await runUpdate({
        sources: TEST_SOURCES,
        statePath,
        now: NOW,
        logger: silentLogger(),
        fetchOptions: { fetchImpl: async () => reply(FEED), sleepImpl: noSleep },
      });
      const garbled = await runUpdate({
        sources: TEST_SOURCES,
        statePath,
        now: '2026-08-08T02:00:00.000Z',
        logger: silentLogger(),
        fetchOptions: {
          fetchImpl: async () => reply('<<<not xml at all>>>', { contentType: 'text/plain' }),
          sleepImpl: noSleep,
        },
      });
      assert.equal(garbled.state.board.length, 1);
    });
  });

  it('records why each source succeeded or failed', async () => {
    await withTempState(async (statePath) => {
      const logger = silentLogger();
      const { summary } = await runUpdate({
        sources: TEST_SOURCES,
        statePath,
        now: NOW,
        logger,
        fetchOptions: { fetchImpl: async () => reply(FEED), sleepImpl: noSleep },
      });
      assert.equal(summary.sources.length, 1);
      assert.equal(summary.sources[0].ok, true);
      assert.equal(summary.counters['candidate.discovered'], 2);
      assert.equal(summary.counters['candidate.accepted'], 1);
      assert.equal(summary.counters['rejected.reads-as-news'], 1);
      assert.ok(logger.entries.some((entry) => entry.message === 'candidate rejected'));
    });
  });

  it('writes nothing during a dry run', async () => {
    await withTempState(async (statePath) => {
      await runUpdate({
        sources: TEST_SOURCES,
        statePath,
        dryRun: true,
        now: NOW,
        logger: silentLogger(),
        fetchOptions: { fetchImpl: async () => reply(FEED), sleepImpl: noSleep },
      });
      await assert.rejects(() => readFile(statePath, 'utf8'));
    });
  });
});

describe('state file handling', () => {
  it('starts a fresh board when there is no state file', async () => {
    const state = await readState(join(tmpdir(), `missing-${Date.now()}.json`), { logger: silentLogger() });
    assert.deepEqual(state.board, []);
  });

  it('keeps a copy of an unreadable state file instead of overwriting it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alerto-corrupt-'));
    const path = join(dir, 'state.json');
    await writeFile(path, '{ this is not json', 'utf8');
    const state = await readState(path, { logger: silentLogger() });
    assert.deepEqual(state.board, []);
    const original = await readFile(path, 'utf8');
    assert.equal(original, '{ this is not json', 'the unreadable file must be left alone');
    await rm(dir, { recursive: true, force: true });
  });

  it('writes state atomically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alerto-write-'));
    const path = join(dir, 'state.json');
    await writeState({ version: 1, board: [], retired: [], sources: {} }, path);
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(parsed.board, []);
    await rm(dir, { recursive: true, force: true });
  });
});
