/**
 * Rendering: escaping, the empty state, and what must never reach the public
 * HTML.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SOURCES, sourceById } from '../config/sources.js';
import { silentLogger } from '../src/lib/logger.js';
import { assess } from '../src/pipeline/assess.js';
import { emptyState, mergeBoard } from '../src/pipeline/board.js';
import { publicBoard, publicRecord } from '../src/pipeline/store.js';
import { buildSite } from '../src/site/build.js';
import { renderAlert, renderDetail, renderHome } from '../src/site/pages.js';
import { QUALIFYING, candidate } from './fixtures/candidates.js';

const NOW = '2026-08-08T01:00:00.000Z';

function boardFrom(candidates, now = NOW) {
  const incoming = [];
  for (const item of candidates) {
    const verdict = assess(item, sourceById(item.sourceId, SOURCES), { now, sources: SOURCES });
    if (verdict.ok) incoming.push(verdict.record);
  }
  const { state } = mergeBoard({ state: emptyState(), incoming, now });
  return { state, board: publicBoard(state) };
}

async function buildInto(state, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'alerto-site-'));
  const result = await buildSite({ state, outDir: dir, now: NOW, logger: silentLogger(), ...extra });
  return { dir, result };
}

describe('escaping and safety', () => {
  it('escapes markup that arrives inside an announcement', () => {
    const hostile = candidate({
      title: 'Advisory: <script>alert("xss")</script> water interruption in Malolos',
      summary:
        'Please be advised that a water service interruption will affect the City of Malolos. <img src=x onerror="alert(1)"> All residents are advised to store water.',
      announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/hostile',
      guid: 'hostile',
    });
    const verdict = assess(hostile, sourceById('malolos-city-website'), { now: NOW, sources: SOURCES });
    assert.equal(verdict.ok, true, verdict.reason);

    const html = renderAlert(publicRecord({ ...verdict.record, isPriority: true, priorityRank: 1 }));
    assert.ok(!html.includes('<script>'), 'a script tag must never survive into the page');
    assert.ok(!html.includes('onerror='), 'an event handler must never survive into the page');
    assert.ok(html.includes('&lt;script&gt;') || !html.includes('script'), 'the text must be escaped');
  });

  it('keeps hostile content out of the embedded board data', () => {
    const { board } = boardFrom([
      candidate({
        title: 'Water interruption advisory for the City of Malolos </script><script>alert(1)</script>',
        announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/x',
        guid: 'script-title',
      }),
    ]);
    const html = renderHome(board);
    const embedded = html.split('<script type="application/json" id="board-data">')[1].split('</script>')[0];
    assert.ok(!embedded.includes('</script>'), 'the JSON block must not be closable from data');
  });

  it('opens source links safely in a new tab', () => {
    const { board } = boardFrom([QUALIFYING[0]]);
    const html = renderAlert(board.announcements[0]);
    assert.ok(html.includes('rel="noopener noreferrer"'));
    assert.ok(html.includes('target="_blank"'));
  });
});

describe('what reaches the public page', () => {
  it('does not publish internal scores or hashes', () => {
    const { state } = boardFrom(QUALIFYING);
    const record = publicRecord(state.board[0]);
    for (const field of [
      'importanceScore', 'relevanceScore', 'urgencyScore', 'freshnessScore', 'totalScore',
      'contentHash', 'expiresAt', 'expiryBasis', 'relevanceBasis', 'sourceAuthority', 'sourceTier',
    ]) {
      assert.equal(record[field], undefined, `${field} must stay internal`);
    }
  });

  it('does not mention how the site is built', async () => {
    const { state } = boardFrom(QUALIFYING);
    const { dir } = await buildInto(state);
    for (const page of ['index.html', 'about.html', 'sources.html']) {
      const html = await readFile(join(dir, page), 'utf8');
      // Only the words a visitor actually reads: markup, attributes and the
      // hosting URL in <head> are not part of the public message.
      const visible = html
        .replace(/<head[\s\S]*?<\/head>/i, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .toLowerCase();
      for (const term of ['github', 'workflow', 'scraper', 'scraping', ' rss ', ' api ', 'repository', 'cron job', 'claude', 'chatgpt', 'javascript']) {
        assert.ok(!visible.includes(term), `${page} should not mention "${term.trim()}"`);
      }
    }
    await rm(dir, { recursive: true, force: true });
  });
});

describe('the board page', () => {
  it('shows the empty state when nothing qualifies', async () => {
    const { dir } = await buildInto(emptyState());
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    assert.ok(html.includes('No major announcements right now.'));
    assert.ok(html.includes('monitoring official sources'));
    assert.ok(!html.includes('class="alert '), 'no alert panels should be rendered');
    await rm(dir, { recursive: true, force: true });
  });

  it('renders every announcement with its source and a link to the original', async () => {
    const { state } = boardFrom(QUALIFYING);
    const { dir } = await buildInto(state);
    const html = await readFile(join(dir, 'index.html'), 'utf8');

    for (const record of state.board) {
      assert.ok(html.includes(record.announcementUrl), `missing the source link for ${record.id}`);
      assert.ok(html.includes(record.sourceName), `missing the source name for ${record.id}`);
    }
    const panels = html.match(/class="alert alert--/g) ?? [];
    assert.equal(panels.length, state.board.length);
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a detail page for every alert and clears stale ones', async () => {
    const many = boardFrom(QUALIFYING);
    const { dir } = await buildInto(many.state);
    let pages = (await readdir(join(dir, 'a'))).filter((name) => name.endsWith('.html'));
    assert.equal(pages.length, many.state.board.length);

    const fewer = boardFrom([QUALIFYING[0]]);
    await buildSite({ state: fewer.state, outDir: dir, now: NOW, logger: silentLogger() });
    pages = (await readdir(join(dir, 'a'))).filter((name) => name.endsWith('.html'));
    assert.equal(pages.length, 1, 'detail pages for removed notices must not linger');
    await rm(dir, { recursive: true, force: true });
  });

  it('shows the time of the last check', async () => {
    const { state } = boardFrom(QUALIFYING);
    const { dir } = await buildInto({ ...state, lastCheckedAt: NOW });
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    assert.ok(html.includes(`data-last-checked="${NOW}"`));
    assert.ok(html.includes('>Checked<'), 'the last check must be labelled');
    assert.ok(/cycle__value[^>]*>\d/.test(html), 'the last check must show a time');
    await rm(dir, { recursive: true, force: true });
  });

  it('credits Benedict de Jesus in several places', async () => {
    const { state } = boardFrom(QUALIFYING);
    const { dir } = await buildInto(state);
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    const mentions = html.split('Benedict de Jesus').length - 1;
    assert.ok(mentions >= 3, `expected the author credit in several places, found ${mentions}`);
    await rm(dir, { recursive: true, force: true });
  });

  it('states that it is not the official city website', async () => {
    const { dir } = await buildInto(emptyState());
    for (const page of ['index.html', 'about.html', 'sources.html']) {
      const html = (await readFile(join(dir, page), 'utf8')).toLowerCase();
      assert.ok(
        html.includes('not the official website of the city government of malolos'),
        `${page} must carry the disclaimer`
      );
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the board free of explanatory copy', async () => {
    const { state } = boardFrom(QUALIFYING);
    const { dir } = await buildInto(state);
    const html = await readFile(join(dir, 'index.html'), 'utf8');

    for (const phrase of [
      'How this board works',
      'Official sources only',
      'Advisories, not news',
      'The source is the authority',
      'is an independent civic information project',
      'was designed and built by',
    ]) {
      assert.ok(!html.includes(phrase), `the board should not explain itself: "${phrase}"`);
    }

    // The About page is where that belongs, and it is one tap away.
    const about = await readFile(join(dir, 'about.html'), 'utf8');
    assert.ok(about.includes('is an independent civic information project'));
    assert.ok(html.includes('about.html'));
    await rm(dir, { recursive: true, force: true });
  });

  it('leads with the board rather than with prose', async () => {
    const { state } = boardFrom(QUALIFYING);
    const { dir } = await buildInto(state);
    const html = await readFile(join(dir, 'index.html'), 'utf8');

    const body = html.split('<body')[1];
    const firstAlert = body.indexOf('class="alert alert--');
    const paragraphs = (body.slice(0, firstAlert).match(/<p[\s>]/g) ?? []).length;
    assert.ok(paragraphs <= 4, `${paragraphs} paragraphs before the first alert is too many`);
    await rm(dir, { recursive: true, force: true });
  });

  it('renders the same markup twice for the same board', async () => {
    const { state } = boardFrom(QUALIFYING);
    const first = await buildInto(state);
    const second = await buildInto(state);
    assert.equal(
      await readFile(join(first.dir, 'index.html'), 'utf8'),
      await readFile(join(second.dir, 'index.html'), 'utf8')
    );
    await rm(first.dir, { recursive: true, force: true });
    await rm(second.dir, { recursive: true, force: true });
  });
});

describe('the detail page', () => {
  it('lists the other official sources carrying the same announcement', () => {
    const record = publicRecord({
      ...boardFrom([QUALIFYING[0]]).state.board[0],
      alsoReportedBy: [
        { sourceId: 'bulacan-province', sourceName: 'Provincial Government of Bulacan', url: 'https://bulacan.gov.ph/same-notice' },
      ],
    });
    const html = renderDetail(record, { now: NOW });
    assert.ok(html.includes('Also published by'));
    assert.ok(html.includes('https://bulacan.gov.ph/same-notice'));
    assert.ok(html.includes('Provincial Government of Bulacan'));
  });

  it('says so plainly when the source gave no publication time', () => {
    const record = publicRecord({
      ...boardFrom([QUALIFYING[0]]).state.board[0],
      publishedAt: null,
      publishedAtIsKnown: false,
    });
    const html = renderDetail(record, { now: NOW });
    assert.ok(html.includes('Not stated by the source'));
  });
});

describe('accessibility basics', () => {
  it('provides landmarks, a skip link and a single first-level heading', async () => {
    const { state } = boardFrom(QUALIFYING);
    const { dir } = await buildInto(state);
    const html = await readFile(join(dir, 'index.html'), 'utf8');

    assert.ok(html.includes('class="skip-link"'));
    assert.ok(html.includes('<main id="main"'));
    assert.ok(html.includes('<header class="topbar">'));
    assert.ok(html.includes('<footer class="footer">'));
    assert.ok(html.includes('aria-label="Active public announcements for Malolos"'));
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
    await rm(dir, { recursive: true, force: true });
  });

  it('labels urgency in words as well as colour', () => {
    const { board } = boardFrom(QUALIFYING);
    const emergency = board.announcements.find((record) => record.isEmergency);
    assert.ok(emergency, 'the fixtures should contain an emergency advisory');
    const html = renderAlert(emergency);
    assert.ok(html.includes('Emergency advisory'), 'an emergency must say so in text');
    assert.ok(html.includes('data-emergency="true"'));
  });

  it('describes where an external link goes', () => {
    const { board } = boardFrom([QUALIFYING[0]]);
    const html = renderAlert(board.announcements[0]);
    assert.ok(html.includes('opens the City Government of Malolos website in a new tab'));
  });
});

describe('site files', () => {
  it('writes the supporting files a static host needs', async () => {
    const { state } = boardFrom(QUALIFYING);
    const { dir } = await buildInto(state);
    const files = await readdir(dir);
    for (const name of ['index.html', 'about.html', 'sources.html', '404.html', 'robots.txt', 'sitemap.xml', 'assets']) {
      assert.ok(files.includes(name), `missing ${name}`);
    }
    const assets = await readdir(join(dir, 'assets'));
    assert.ok(assets.includes('board.css'));
    assert.ok(assets.includes('board.js'));
    assert.ok(assets.includes('icon.svg'));
    await rm(dir, { recursive: true, force: true });
  });

  it('marks a preview build as sample data', async () => {
    const { state } = boardFrom(QUALIFYING);
    const { dir } = await buildInto(state, { preview: true });
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    assert.ok(html.includes('sample data, not live announcements'));
    await rm(dir, { recursive: true, force: true });
  });
});
