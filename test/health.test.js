/**
 * Source health: the board survives a source being down, so something else has
 * to notice that it is down. These cover the verdict, not the reporting.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SOURCES, activeSources } from '../config/sources.js';
import { brokenIn, healthOf, report } from '../src/lib/health.js';

const ok = { lastSuccessAt: '2026-08-09T03:00:00.000Z', consecutiveFailures: 0 };

describe('the verdict on one source', () => {
  it('is healthy when the last run retrieved it', () => {
    assert.equal(healthOf(ok).status, 'healthy');
  });

  it('is stale while it is failing but under the limit', () => {
    assert.equal(healthOf({ ...ok, consecutiveFailures: 2 }, { maxFailures: 3 }).status, 'stale');
  });

  it('is broken once it has failed for the whole limit', () => {
    assert.equal(healthOf({ ...ok, consecutiveFailures: 3 }, { maxFailures: 3 }).status, 'broken');
  });

  // The failure this exists for: a source pointing at a domain that does not
  // resolve looks calm for as many runs as the limit allows, and a wrong URL is
  // not a transient outage. It is broken on the first run, not the third.
  it('is broken immediately when it has never once been retrieved', () => {
    const verdict = healthOf({ consecutiveFailures: 1, lastSuccessAt: null }, { maxFailures: 3 });
    assert.equal(verdict.status, 'broken');
    assert.match(verdict.detail, /never retrieved/);
  });

  it('says nothing has run yet rather than calling it broken', () => {
    assert.equal(healthOf(undefined).status, 'unknown');
  });
});

describe('the report', () => {
  const sources = [
    { id: 'a', name: 'A', tier: 4, kind: 'rss' },
    { id: 'b', name: 'B', tier: 1, kind: 'rss' },
    { id: 'c', name: 'C', tier: 2, kind: 'rss' },
  ];

  it('puts the worst first, then the highest authority', () => {
    const rows = report(sources, {
      a: { ...ok, consecutiveFailures: 9, lastSuccessAt: null },
      b: ok,
      c: { ...ok, consecutiveFailures: 1 },
    });
    assert.deepEqual(rows.map((row) => row.id), ['a', 'c', 'b']);
    assert.deepEqual(brokenIn(rows).map((row) => row.id), ['a']);
  });

  it('is quiet when every source is healthy', () => {
    const rows = report(sources, { a: ok, b: ok, c: ok });
    assert.equal(brokenIn(rows).length, 0);
  });
});

describe('what the hourly run judges', () => {
  it('never judges a source that is switched off or waiting for a token', () => {
    const judged = activeSources(SOURCES, {}).map((source) => source.id);
    const off = SOURCES.filter((source) => source.enabled === false).map((source) => source.id);
    for (const id of off) assert.ok(!judged.includes(id), `${id} is switched off and must not be judged`);
    assert.ok(!judged.includes('malolos-cio-graph'));
    assert.ok(!judged.includes('bulacan-pdrrmo-graph'));
  });

  it('gives every switched-off source a reason a reader can see', () => {
    for (const source of SOURCES) {
      if (source.enabled === false) {
        assert.ok(source.disabledReason, `${source.id} is off with no disabledReason`);
      }
    }
  });

  // A source's own site is the only place its announcements may come from, so a
  // registry URL that does not even belong to the publisher is a credibility
  // bug, not just a retrieval one.
  it('points every automated source at its own homepage', () => {
    for (const source of SOURCES) {
      if (source.kind !== 'rss' && source.kind !== 'html') continue;
      const host = new URL(source.url).host.replace(/^www\./, '');
      const homepage = new URL(source.homepage).host.replace(/^www\./, '');
      assert.ok(
        host === homepage || host.endsWith(`.${homepage}`) || homepage.endsWith(`.${host}`),
        `${source.id}: ${host} is not ${homepage}`
      );
    }
  });
});
