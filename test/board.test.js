/**
 * Board behaviour: lifecycle, ranking, duplicates and the twenty post-it limit.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BOARD_LIMITS } from '../config/rules.js';
import { SOURCES, sourceById } from '../config/sources.js';
import { assess } from '../src/pipeline/assess.js';
import { emptyState, enforceLimit, mergeBoard, topThree } from '../src/pipeline/board.js';
import { compare } from '../src/pipeline/dedupe.js';
import { QUALIFYING, candidate, fillerCandidates, isoAgo } from './fixtures/candidates.js';

const NOW = '2026-08-08T01:00:00.000Z';
const lookup = (id) => sourceById(id, SOURCES);

function accept(candidates, now = NOW) {
  const records = [];
  for (const item of candidates) {
    const verdict = assess(item, lookup(item.sourceId), { now, sources: SOURCES });
    if (verdict.ok) records.push(verdict.record);
  }
  return records;
}

function build(candidates, { state = emptyState(), now = NOW } = {}) {
  return mergeBoard({ state, incoming: accept(candidates, now), now, sourceLookup: lookup });
}

describe('board size', () => {
  it('shows a single announcement', () => {
    const { state } = build([QUALIFYING[0]]);
    assert.equal(state.board.length, 1);
    assert.equal(state.board[0].isPriority, true);
    assert.equal(state.board[0].priorityRank, 1);
  });

  it('marks exactly three priority notices when there are more than three', () => {
    const { state } = build(QUALIFYING);
    assert.ok(state.board.length > 3);
    assert.equal(topThree(state.board).length, 3);
    assert.deepEqual(
      state.board.filter((record) => record.isPriority).map((record) => record.priorityRank),
      [1, 2, 3]
    );
  });

  it('holds twenty', () => {
    const { state } = build(fillerCandidates(20));
    assert.equal(state.board.length, 20);
  });

  it('never holds twenty-one', () => {
    const { state, changes } = build(fillerCandidates(25));
    assert.equal(state.board.length, BOARD_LIMITS.maxPostIts);
    assert.equal(changes.evicted.length, 5);
  });

  it('takes the least important notice down when a new one arrives at a full board', () => {
    const first = build(fillerCandidates(20));
    assert.equal(first.state.board.length, 20);

    const second = build([QUALIFYING[1]], { state: first.state, now: NOW });
    assert.equal(second.state.board.length, 20);
    assert.ok(
      second.state.board.some((record) => record.title === QUALIFYING[1].title),
      'the flood advisory should be on the board'
    );
    assert.equal(second.changes.evicted.length, 1);
  });

  it('keeps an older important advisory over a newer trivial one', () => {
    const importantOlder = accept([QUALIFYING[1]], NOW)[0];
    const trivialNewer = accept(
      [
        candidate({
          title: 'Public notice on the new office hours of the city assessor',
          announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/hours',
          summary:
            'Please be advised that the Office of the City Assessor of the City of Malolos will observe new operating hours starting next week.',
          publishedAt: isoAgo(0.1),
          guid: 'hours',
        }),
      ],
      NOW
    )[0];

    const { kept, evicted } = enforceLimit(
      [importantOlder, trivialNewer].map((record, index) => ({ ...record, priorityRank: index + 1 })),
      1
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, importantOlder.id);
    assert.equal(evicted[0].id, trivialNewer.id);
  });

  it('protects an emergency from eviction', () => {
    const emergency = accept([QUALIFYING[1]], NOW)[0];
    assert.equal(emergency.isEmergency, true);
    const filler = accept(fillerCandidates(3), NOW);
    const { kept } = enforceLimit([...filler, emergency], 1);
    assert.equal(kept[0].id, emergency.id);
  });
});

describe('duplicates', () => {
  const original = candidate({
    sourceId: 'malolos-city-website',
    title: 'Suspension of classes in all levels in the City of Malolos on August 9, 2026',
    announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/class-suspension',
    summary:
      'Classes in all levels in the City of Malolos are suspended tomorrow, August 9, 2026 due to heavy rainfall. All residents are advised to stay indoors.',
    guid: 'city-suspension',
  });

  const reposted = candidate({
    sourceId: 'bulacan-province',
    title: 'Suspension of classes in all levels in the City of Malolos on August 9, 2026',
    announcementUrl: 'https://bulacan.gov.ph/class-suspension-malolos',
    summary:
      'Classes in all levels in the City of Malolos are suspended tomorrow, August 9, 2026 due to heavy rainfall. All residents are advised to stay indoors.',
    guid: 'province-repost',
  });

  it('shows the same announcement once', () => {
    const { state, changes } = build([original, reposted]);
    assert.equal(state.board.length, 1);
    assert.equal(changes.duplicates.length, 1);
  });

  it('credits the more authoritative source and keeps the other as corroboration', () => {
    const { state } = build([reposted, original]);
    assert.equal(state.board[0].sourceId, 'malolos-city-website');
    assert.deepEqual(
      state.board[0].alsoReportedBy.map((entry) => entry.sourceId),
      ['bulacan-province']
    );
  });

  it('does not merge notices about different barangays', () => {
    const mojon = accept([QUALIFYING[2]], NOW)[0];
    const other = accept(
      [
        candidate({
          title: 'Water service interruption in Barangay Bulihan, City of Malolos',
          announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/water-bulihan',
          summary:
            'Please be advised that there will be a water service interruption in Barangay Bulihan, City of Malolos on August 9, 2026 from 9:00 AM to 5:00 PM due to scheduled maintenance.',
          guid: 'water-bulihan',
        }),
      ],
      NOW
    )[0];
    const result = compare(mojon, other);
    assert.equal(result.isDuplicate, false, 'different barangays must stay separate');
  });

  it('recognises the same page under a tracking URL', () => {
    const withTracking = candidate({
      ...original,
      announcementUrl: `${original.announcementUrl}?utm_source=facebook&fbclid=abc`,
      guid: 'tracking-variant',
    });
    const { state } = build([original, withTracking]);
    assert.equal(state.board.length, 1);
  });
});

describe('updates and expiry', () => {
  it('updates an existing post-it in place when the source revises it', () => {
    const first = build([QUALIFYING[0]]);
    const revised = {
      ...QUALIFYING[0],
      summary: `${QUALIFYING[0].summary} Government work in the city is also suspended.`,
    };
    const second = build([revised], { state: first.state });

    assert.equal(second.state.board.length, 1);
    assert.equal(second.state.board[0].id, first.state.board[0].id);
    assert.equal(second.state.board[0].revisions, 1);
    assert.equal(second.state.board[0].status, 'updated');
    assert.equal(second.changes.updated.length, 1);
  });

  it('takes an expired announcement down', () => {
    const first = build([QUALIFYING[0]]);
    assert.equal(first.state.board.length, 1);

    const later = '2026-08-11T01:00:00.000Z';
    const { state, changes } = mergeBoard({ state: first.state, incoming: [], now: later, sourceLookup: lookup });
    assert.equal(state.board.length, 0);
    assert.equal(changes.expired.length, 1);
  });

  it('does not re-post an expired announcement that has not changed', () => {
    // The road closure has a long life, so it is retired here by hand to model
    // a source that still lists a notice the board has already taken down.
    const first = build([QUALIFYING[3]]);
    const forced = {
      ...first.state,
      board: [{ ...first.state.board[0], expiresAt: '2026-08-08T00:00:00.000Z' }],
    };
    const expired = mergeBoard({ state: forced, incoming: [], now: NOW, sourceLookup: lookup });
    assert.equal(expired.state.board.length, 0);

    const again = build([QUALIFYING[3]], { state: expired.state, now: NOW });
    assert.equal(again.state.board.length, 0);
    assert.equal(again.changes.skippedRetired.length, 1);
  });

  it('does re-post a retired announcement when the source changes it', () => {
    const first = build([QUALIFYING[3]]);
    const forced = {
      ...first.state,
      board: [{ ...first.state.board[0], expiresAt: '2026-08-08T00:00:00.000Z' }],
    };
    const expired = mergeBoard({ state: forced, incoming: [], now: NOW, sourceLookup: lookup });
    const revised = {
      ...QUALIFYING[3],
      summary: `${QUALIFYING[3].summary} The closure has been extended to the full width of the road.`,
    };
    const again = build([revised], { state: expired.state, now: NOW });
    assert.equal(again.state.board.length, 1);
  });

  it('keeps an "until further notice" road closure active for days', () => {
    const first = build([QUALIFYING[3]]);
    const threeDaysLater = '2026-08-11T01:00:00.000Z';
    const { state } = mergeBoard({
      state: first.state,
      incoming: [],
      now: threeDaysLater,
      sourceLookup: lookup,
    });
    assert.equal(state.board.length, 1);
  });
});

describe('idempotency', () => {
  it('produces the same board when the same cycle runs twice', () => {
    const first = build(QUALIFYING);
    const second = build(QUALIFYING, { state: first.state });

    assert.equal(second.state.board.length, first.state.board.length);
    assert.deepEqual(
      second.state.board.map((record) => record.id),
      first.state.board.map((record) => record.id)
    );
    assert.equal(second.changes.added.length, 0);
    assert.equal(second.changes.updated.length, 0);
    assert.equal(second.state.lastUpdatedAt, first.state.lastUpdatedAt);
  });

  it('does not mutate the previous state', () => {
    const first = build([QUALIFYING[0]]);
    const snapshot = JSON.stringify(first.state);
    build(QUALIFYING, { state: first.state });
    assert.equal(JSON.stringify(first.state), snapshot);
  });

  it('assigns the same identifier to the same announcement every time', () => {
    const a = accept([QUALIFYING[0]])[0];
    const b = accept([QUALIFYING[0]])[0];
    assert.equal(a.id, b.id);
    assert.equal(a.contentHash, b.contentHash);
  });
});

describe('display state', () => {
  it('gives the top three the priority treatment and the rest a quieter one', () => {
    const { state } = build(QUALIFYING);
    const states = state.board.map((record) => record.displayState);
    assert.deepEqual(states.slice(0, 3), ['priority', 'priority', 'priority']);
    assert.ok(states.slice(3).every((value) => value === 'recent' || value === 'archive'));
  });

  it('moves a notice to the archive look once it is more than a day old', () => {
    const first = build(QUALIFYING);
    const nextDay = '2026-08-09T05:00:00.000Z';
    const { state } = mergeBoard({ state: first.state, incoming: [], now: nextDay, sourceLookup: lookup });
    assert.ok(
      state.board.some((record) => record.displayState === 'archive'),
      'older notices should take the archive paper'
    );
  });

  it('does not change a notice colour between two runs at the same moment', () => {
    const first = build(QUALIFYING);
    const second = build(QUALIFYING, { state: first.state });
    assert.deepEqual(
      second.state.board.map((record) => record.displayState),
      first.state.board.map((record) => record.displayState)
    );
  });
});
