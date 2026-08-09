/**
 * Content rules: what gets on the board and what does not.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SOURCES, sourceById, sourcesForPublicDisplay } from '../config/sources.js';
import { SNIPPET } from '../config/rules.js';
import { assess, buildSnippet, linkBelongsToSource } from '../src/pipeline/assess.js';
import { classify, splitDateline } from '../src/pipeline/classify.js';
import { scoreRelevance } from '../src/pipeline/relevance.js';
import { NON_QUALIFYING, QUALIFYING, candidate, isoAgo } from './fixtures/candidates.js';

const NOW = '2026-08-08T01:00:00.000Z'; // 09:00 in Manila
const assessNow = (input) => assess(input, sourceById(input.sourceId, SOURCES), { now: NOW, sources: SOURCES });

describe('source credibility', () => {
  it('accepts an announcement from an official source', () => {
    const verdict = assessNow(QUALIFYING[0]);
    assert.equal(verdict.ok, true, verdict.reason);
    assert.equal(verdict.record.sourceName, 'City Government of Malolos');
    assert.equal(verdict.record.sourceTier, 1);
  });

  it('rejects a publisher that is not in the registry', () => {
    const verdict = assessNow(
      candidate({ sourceId: 'random-facebook-page', announcementUrl: 'https://example.com/x' })
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'source-not-trusted');
  });

  it('rejects a link that leaves the official domain', () => {
    const verdict = assessNow(
      candidate({
        title: 'Suspension of classes in the City of Malolos tomorrow',
        announcementUrl: 'https://malicious.example.net/phish',
        summary: 'Classes in all levels in the City of Malolos are suspended tomorrow. All residents are advised.',
      })
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'link-host-mismatch');
  });

  it('allows a government link on another gov.ph domain', () => {
    assert.equal(
      linkBelongsToSource('https://depedbulacan.gov.ph/advisory', sourceById('deped-central')),
      true
    );
    assert.equal(linkBelongsToSource('https://news.example.com/story', sourceById('deped-central')), false);
  });

  it('rejects an announcement with no usable link', () => {
    const verdict = assessNow(candidate({ announcementUrl: 'javascript:alert(1)' }));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'unusable-link');
  });
});

describe('the provincial disaster office', () => {
  it('is registered at the provincial tier, by feed and by hand', () => {
    const feed = sourceById('bulacan-pdrrmo', SOURCES);
    const manual = sourceById('bulacan-pdrrmo-facebook', SOURCES);
    for (const source of [feed, manual]) {
      assert.equal(source.tier, 3);
      assert.equal(source.scope, 'bulacan');
      assert.equal(source.enabled, true);
    }
    assert.equal(feed.kind, 'rss');
    assert.equal(manual.kind, 'manual');
  });

  it('accepts a dam release advisory that names Bulacan', () => {
    const verdict = assessNow(
      candidate({
        sourceId: 'bulacan-pdrrmo',
        title: 'Advisory: Angat Dam water release beginning August 9, 2026',
        announcementUrl: 'https://pdrrmo.bulacan.gov.ph/news/angat-dam-water-release',
        summary:
          'Please be advised that Angat Dam will release water beginning August 9, 2026. Residents of low-lying barangays along the rivers of Bulacan are advised to evacuate to higher ground and to monitor official advisories.',
        guid: 'pdrrmo-angat-release-aug-9',
      })
    );
    assert.equal(verdict.ok, true, verdict.reason);
    assert.equal(verdict.record.sourceName, 'Bulacan PDRRMO');
    assert.equal(verdict.record.sourceTier, 3);
  });

  it('pins a hand-recorded notice to the office’s own Facebook page', () => {
    const manual = sourceById('bulacan-pdrrmo-facebook', SOURCES);
    assert.equal(linkBelongsToSource('https://www.facebook.com/BulacanPDRRMO/posts/123', manual), true);
    assert.equal(linkBelongsToSource('https://www.facebook.com/SomeOtherPage/posts/1', manual), false);
    assert.equal(linkBelongsToSource('https://facebook.com.evil.example/BulacanPDRRMO', manual), false);
  });

  it('shows the office once on the public sources page', () => {
    const names = sourcesForPublicDisplay(SOURCES).flatMap((group) =>
      group.sources.map((source) => source.name)
    );
    assert.equal(names.filter((name) => name === 'Bulacan PDRRMO').length, 1);
  });
});

describe('announcement versus news', () => {
  for (const entry of NON_QUALIFYING) {
    it(`rejects: ${entry.reason}`, () => {
      const verdict = assessNow(entry.candidate);
      assert.equal(verdict.ok, false, `expected a rejection, got ${JSON.stringify(verdict).slice(0, 200)}`);
    });
  }

  for (const item of QUALIFYING) {
    it(`accepts: ${item.title.slice(0, 60)}`, () => {
      const verdict = assessNow(item);
      assert.equal(verdict.ok, true, `rejected as ${verdict.reason} (${verdict.detail ?? ''})`);
    });
  }

  it('keeps an emergency advisory even when it also reads as news', () => {
    const result = classify({
      title: 'Evacuation advisory as flooding worsens; awarding ceremony cancelled',
      summary: 'Residents of low-lying barangays are advised to evacuate. The awarding ceremony was cancelled due to the flooding.',
    });
    assert.equal(result.isAnnouncement, true);
    assert.equal(result.isEmergency, true);
  });

  it('treats a bare advisory word as too weak on its own', () => {
    const result = classify({
      title: 'Advisory No. 145, s. 2026 - Geology Summit of a student society',
      summary: 'The Department issues this advisory regarding a summit organised by a student society.',
    });
    assert.equal(result.isAnnouncement, false);
  });
});

describe('local relevance', () => {
  it('scores a Malolos announcement highest', () => {
    const result = scoreRelevance(
      { title: 'Class suspension in the City of Malolos', summary: '' },
      sourceById('malolos-city-website')
    );
    assert.equal(result.score, 100);
  });

  it('recognises a Malolos barangay', () => {
    const result = scoreRelevance(
      { title: 'Water interruption advisory', summary: 'Barangay Mojon will have no water supply.' },
      sourceById('bulacan-province')
    );
    assert.ok(result.score >= 96, `expected a barangay match, got ${result.score}`);
  });

  it('does not treat a press-release dateline as local relevance', () => {
    const { dateline, body } = splitDateline('CITY OF MALOLOS - The provincial board approved the plan.');
    assert.match(dateline, /CITY OF MALOLOS/);
    assert.match(body, /^The provincial board/);

    const result = scoreRelevance(
      {
        title: 'Provincial board approves the annual investment programme',
        summary: 'CITY OF MALOLOS - The Sangguniang Panlalawigan approved the programme.',
      },
      sourceById('bulacan-province')
    );
    assert.notEqual(result.basis, 'malolos-in-text');
  });

  it('rejects a national notice that never mentions anywhere near Malolos', () => {
    const verdict = assessNow(
      candidate({
        sourceId: 'dpwh-advisories',
        title: 'Road closure advisory for the Cebu south coastal road',
        announcementUrl: 'https://www.dpwh.gov.ph/dpwh/node/1',
        summary: 'A road closure will be implemented along the Cebu south coastal road for bridge repair.',
      })
    );
    assert.equal(verdict.ok, false);
    assert.ok(['not-locally-relevant', 'needs-explicit-local-mention'].includes(verdict.reason), verdict.reason);
  });
});

describe('snippets preserve the source wording', () => {
  it('never invents text and stays within the display limit', () => {
    const source = QUALIFYING[0];
    const snippet = buildSnippet(source);
    assert.ok(snippet.length <= SNIPPET.maxChars + 2, `snippet was ${snippet.length} characters`);
    const withoutEllipsis = snippet.replace(/\s*…$/, '').trim();
    assert.ok(
      source.summary.includes(withoutEllipsis),
      'every character of the snippet must come from the source text'
    );
  });

  it('cuts at a sentence boundary when it can', () => {
    const snippet = buildSnippet({
      summary:
        'Classes are suspended tomorrow, August 9, 2026. Government work is also suspended. Residents are advised to stay indoors and to monitor official advisories for further updates from the city government.',
    });
    assert.ok(snippet.startsWith('Classes are suspended tomorrow, August 9, 2026.'));
    assert.ok(!/\bResidents are advised to stay indoors and to monitor official advisories for further\b/.test(snippet));
  });

  it('drops a fragment too short to mean anything', () => {
    assert.equal(buildSnippet({ summary: 'Read more' }), '');
  });

  it('does not change dates, times or numbers', () => {
    const verdict = assessNow(QUALIFYING[2]);
    assert.equal(verdict.ok, true);
    for (const fact of ['9:00 AM', '5:00 PM', 'August 9, 2026', 'Mojon']) {
      assert.ok(
        verdict.record.sourceExcerpt.includes(fact),
        `the retained source text lost "${fact}"`
      );
    }
  });
});

describe('the original announcement stays reachable', () => {
  it('records the exact source URL', () => {
    const verdict = assessNow(QUALIFYING[0]);
    assert.equal(verdict.record.announcementUrl, QUALIFYING[0].announcementUrl);
    assert.match(verdict.record.announcementUrl, /^https:\/\//);
  });

  it('marks a missing publication time instead of inventing one', () => {
    const verdict = assessNow(candidate({ publishedAt: null, guid: 'no-date' }));
    assert.equal(verdict.ok, true, verdict.reason);
    assert.equal(verdict.record.publishedAt, null);
    assert.equal(verdict.record.publishedAtIsKnown, false);
  });
});

describe('freshness affects ranking, not eligibility', () => {
  it('ranks an active suspension above a newer minor notice', () => {
    const suspension = assessNow(QUALIFYING[0]);
    const minor = assessNow(
      candidate({
        title: 'Public notice on the new office hours of the city assessor',
        announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/office-hours',
        summary:
          'Please be advised that the Office of the City Assessor of the City of Malolos will observe new operating hours starting next week.',
        publishedAt: isoAgo(0.2),
        guid: 'office-hours',
      })
    );
    assert.equal(suspension.ok, true);
    assert.equal(minor.ok, true);
    assert.ok(
      suspension.record.totalScore > minor.record.totalScore,
      `suspension ${suspension.record.totalScore} should outrank office hours ${minor.record.totalScore}`
    );
  });
});
