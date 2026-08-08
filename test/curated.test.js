/**
 * The City Information Office routes: notices recorded by hand, and the
 * Graph API path that replaces them once a page token exists.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SOURCES, activeSources, sourceById, sourcesForPublicDisplay, sourceToken } from '../config/sources.js';
import { assess, linkBelongsToSource } from '../src/pipeline/assess.js';
import { emptyState, mergeBoard } from '../src/pipeline/board.js';
import { retrieveSource } from '../src/pipeline/discover.js';
import { publicRecord } from '../src/pipeline/store.js';
import { renderDetail } from '../src/site/pages.js';

const NOW = '2026-08-08T01:00:00.000Z';
const MANUAL = sourceById('malolos-cio-facebook', SOURCES);
const GRAPH = sourceById('malolos-cio-graph', SOURCES);

const NOTICE =
  'PAALALA SA PUBLIKO: Suspendido ang klase sa lahat ng antas sa lahat ng pampubliko at pribadong paaralan sa Lungsod ng Malolos bukas, August 9, 2026, dahil sa patuloy na malakas na pag-ulan. Pinapayuhan ang lahat ng residente na manatili sa loob ng bahay.';

async function withCuratedFile(entries, run) {
  const dir = await mkdtemp(join(tmpdir(), 'alerto-curated-'));
  const path = join(dir, 'curated.json');
  await writeFile(path, JSON.stringify({ announcements: entries }, null, 2), 'utf8');
  try {
    return await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function reply(body, { status = 200, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://graph.facebook.com/v21.0/MalolosCIOPage/posts',
    headers: { get: (key) => (key.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
    body: null,
  };
}

describe('the registry entry', () => {
  it('registers the information office at the top tier', () => {
    assert.equal(MANUAL.tier, 1);
    assert.equal(MANUAL.scope, 'malolos');
    assert.equal(MANUAL.kind, 'manual');
  });

  it('never crawls the Facebook page', () => {
    for (const source of SOURCES) {
      if (source.kind === 'rss' || source.kind === 'html') {
        assert.ok(
          !/facebook\.com/i.test(source.url),
          `${source.id} must not fetch a Facebook page automatically`
        );
      }
    }
  });

  it('leaves the Graph route switched off until a token is configured', () => {
    const withoutToken = activeSources(SOURCES, {});
    assert.ok(!withoutToken.some((source) => source.id === 'malolos-cio-graph'));

    const withToken = activeSources(SOURCES, { MALOLOS_CIO_PAGE_TOKEN: 'a-token' });
    assert.ok(withToken.some((source) => source.id === 'malolos-cio-graph'));
    assert.equal(sourceToken(GRAPH, { MALOLOS_CIO_PAGE_TOKEN: ' a-token ' }), 'a-token');
  });

  it('shows the office once on the public sources page', () => {
    const groups = sourcesForPublicDisplay(SOURCES);
    const names = groups.flatMap((group) => group.sources.map((source) => source.name));
    assert.equal(names.filter((name) => name === 'Malolos City Information Office').length, 1);
  });
});

describe('link verification', () => {
  it('accepts a post on the office page', () => {
    assert.equal(
      linkBelongsToSource('https://www.facebook.com/MalolosCIOPage/posts/1234567890', MANUAL),
      true
    );
  });

  it('refuses another page on the same site', () => {
    assert.equal(linkBelongsToSource('https://www.facebook.com/SomeOtherPage/posts/1', MANUAL), false);
  });

  it('refuses a look-alike domain', () => {
    assert.equal(linkBelongsToSource('https://facebook.com.evil.example/MalolosCIOPage', MANUAL), false);
  });
});

describe('notices recorded by hand', () => {
  const entry = {
    id: 'cio-1',
    sourceId: 'malolos-cio-facebook',
    title: 'Suspension of classes in all levels on August 9, 2026',
    url: 'https://www.facebook.com/MalolosCIOPage/posts/1234567890',
    text: NOTICE,
    publishedAt: '2026-08-08T11:30:00.000Z',
  };

  it('reads the curated file without touching the network', async () => {
    await withCuratedFile([entry], async (curatedPath) => {
      const result = await retrieveSource(MANUAL, {
        curatedPath,
        fetchOptions: {
          fetchImpl: () => {
            throw new Error('the network must not be used for a curated source');
          },
        },
      });
      assert.equal(result.ok, true);
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0].transcribed, true);
    });
  });

  it('puts a recorded notice through the same rules', async () => {
    await withCuratedFile([entry], async (curatedPath) => {
      const { candidates } = await retrieveSource(MANUAL, { curatedPath });
      const verdict = assess(candidates[0], MANUAL, { now: NOW, sources: SOURCES });
      assert.equal(verdict.ok, true, verdict.reason);
      assert.equal(verdict.record.category, 'suspension');
      assert.equal(verdict.record.sourceTier, 1);
      assert.equal(verdict.record.isTranscribed, true);
    });
  });

  it('rejects a recorded post that is really a greeting', async () => {
    await withCuratedFile(
      [
        {
          ...entry,
          id: 'cio-2',
          title: 'Congratulations to our outstanding barangay officials',
          url: 'https://www.facebook.com/MalolosCIOPage/posts/222',
          text: 'Binabati ng Lungsod ng Malolos ang mga natatanging barangay officials na ginawaran ngayong araw. Congratulations to all of them.',
        },
      ],
      async (curatedPath) => {
        const { candidates } = await retrieveSource(MANUAL, { curatedPath });
        const verdict = assess(candidates[0], MANUAL, { now: NOW, sources: SOURCES });
        assert.equal(verdict.ok, false);
        assert.equal(verdict.reason, 'reads-as-news');
      }
    );
  });

  it('drops an entry with a missing link or text rather than guessing', async () => {
    await withCuratedFile(
      [
        { ...entry, id: 'cio-3', url: '' },
        { ...entry, id: 'cio-4', text: '' },
        { ...entry, id: 'cio-5', sourceId: 'some-other-source' },
      ],
      async (curatedPath) => {
        const { candidates } = await retrieveSource(MANUAL, { curatedPath });
        assert.equal(candidates.length, 0);
      }
    );
  });

  it('treats a missing curated file as an empty board, not a failure', async () => {
    const result = await retrieveSource(MANUAL, { curatedPath: join(tmpdir(), `absent-${Date.now()}.json`) });
    assert.equal(result.ok, true);
    assert.deepEqual(result.candidates, []);
  });

  it('reports a broken curated file instead of ignoring it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alerto-broken-'));
    const path = join(dir, 'curated.json');
    await writeFile(path, '{ not json', 'utf8');
    const result = await retrieveSource(MANUAL, { curatedPath: path });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'format');
    await rm(dir, { recursive: true, force: true });
  });

  it('tells the reader when a notice was recorded by hand', async () => {
    await withCuratedFile([entry], async (curatedPath) => {
      const { candidates } = await retrieveSource(MANUAL, { curatedPath });
      const verdict = assess(candidates[0], MANUAL, { now: NOW, sources: SOURCES });
      const html = renderDetail(publicRecord({ ...verdict.record, firstSeenAt: NOW }), { now: NOW });
      assert.ok(html.includes('recorded from the official post by hand'));
      assert.ok(html.includes('https://www.facebook.com/MalolosCIOPage/posts/1234567890'));
    });
  });
});

describe('taking a recorded notice back', () => {
  const entry = {
    id: 'cio-1',
    sourceId: 'malolos-cio-facebook',
    title: 'Suspension of classes in all levels on August 9, 2026',
    url: 'https://www.facebook.com/MalolosCIOPage/posts/1234567890',
    text: NOTICE,
    publishedAt: '2026-08-08T11:30:00.000Z',
  };

  async function boardWithNotice(curatedPath) {
    const { candidates } = await retrieveSource(MANUAL, { curatedPath });
    const incoming = candidates
      .map((candidate) => assess(candidate, MANUAL, { now: NOW, sources: SOURCES }))
      .filter((verdict) => verdict.ok)
      .map((verdict) => verdict.record);
    return mergeBoard({
      state: emptyState(),
      incoming,
      now: NOW,
      completeSources: new Map([['malolos-cio-facebook', new Set(incoming.map((r) => r.id))]]),
    });
  }

  it('takes the post-it down when the entry is removed from the file', async () => {
    const posted = await withCuratedFile([entry], boardWithNotice);
    assert.equal(posted.state.board.length, 1);

    // The next cycle finds the file empty: the notice was deliberately removed.
    const { state, changes } = mergeBoard({
      state: posted.state,
      incoming: [],
      now: NOW,
      completeSources: new Map([['malolos-cio-facebook', new Set()]]),
    });
    assert.equal(state.board.length, 0);
    assert.equal(changes.withdrawn.length, 1);
    assert.equal(changes.expired.length, 0, 'this is a withdrawal, not an expiry');
  });

  it('leaves other sources alone', async () => {
    const posted = await withCuratedFile([entry], boardWithNotice);
    const foreign = {
      ...posted.state.board[0],
      id: 'bulacan-province-abc123',
      sourceId: 'bulacan-province',
      alsoReportedBy: [],
    };
    const { state } = mergeBoard({
      state: { ...posted.state, board: [...posted.state.board, foreign] },
      incoming: [],
      now: NOW,
      completeSources: new Map([['malolos-cio-facebook', new Set()]]),
    });
    assert.deepEqual(
      state.board.map((record) => record.sourceId),
      ['bulacan-province']
    );
  });

  it('keeps a notice another office is still carrying', async () => {
    const posted = await withCuratedFile([entry], boardWithNotice);
    const corroborated = {
      ...posted.state.board[0],
      alsoReportedBy: [{ sourceId: 'bulacan-province', sourceName: 'Provincial Government of Bulacan', url: 'https://bulacan.gov.ph/x' }],
    };
    const { state, changes } = mergeBoard({
      state: { ...posted.state, board: [corroborated] },
      incoming: [],
      now: NOW,
      completeSources: new Map([['malolos-cio-facebook', new Set()]]),
    });
    assert.equal(state.board.length, 1);
    assert.equal(changes.withdrawn.length, 0);
  });

  it('does not withdraw anything when a feed simply pages an item out', async () => {
    const posted = await withCuratedFile([entry], boardWithNotice);
    // No source reported a complete set this cycle.
    const { state, changes } = mergeBoard({ state: posted.state, incoming: [], now: NOW });
    assert.equal(state.board.length, 1);
    assert.equal(changes.withdrawn.length, 0);
  });
});

describe('the Graph API route', () => {
  const payload = JSON.stringify({
    data: [
      {
        id: '123_456',
        message: NOTICE,
        created_time: '2026-08-08T19:30:00+0800',
        permalink_url: 'https://www.facebook.com/MalolosCIOPage/posts/1234567890',
      },
      {
        id: '123_789',
        created_time: '2026-08-08T18:00:00+0800',
        permalink_url: 'https://www.facebook.com/MalolosCIOPage/posts/999',
      },
    ],
  });

  it('reads posts and skips one with no text', async () => {
    const result = await retrieveSource(GRAPH, {
      env: { MALOLOS_CIO_PAGE_TOKEN: 'a-token' },
      fetchOptions: { fetchImpl: async () => reply(payload), sleepImpl: () => Promise.resolve() },
    });
    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].summary, NOTICE);
    assert.match(result.candidates[0].title, /^PAALALA SA PUBLIKO/);
  });

  it('sends the token as a parameter and asks only for the fields it needs', async () => {
    let requested = '';
    await retrieveSource(GRAPH, {
      env: { MALOLOS_CIO_PAGE_TOKEN: 'secret-token' },
      fetchOptions: {
        fetchImpl: async (url) => {
          requested = url;
          return reply(payload);
        },
        sleepImpl: () => Promise.resolve(),
      },
    });
    assert.ok(requested.includes('access_token=secret-token'));
    assert.ok(requested.includes('permalink_url'));
    assert.ok(!requested.includes('comments'));
  });

  it('reports a refused token clearly', async () => {
    const result = await retrieveSource(GRAPH, {
      env: { MALOLOS_CIO_PAGE_TOKEN: 'expired' },
      fetchOptions: {
        fetchImpl: async () => reply(JSON.stringify({ error: { message: 'Session has expired' } })),
        sleepImpl: () => Promise.resolve(),
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'auth');
    assert.match(result.error.message, /Session has expired/);
  });

  it('reports a missing token as a configuration problem', async () => {
    const result = await retrieveSource(GRAPH, {
      env: {},
      fetchOptions: { fetchImpl: async () => reply(payload), sleepImpl: () => Promise.resolve() },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'config');
  });
});
