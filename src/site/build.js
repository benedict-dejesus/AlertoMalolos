#!/usr/bin/env node
/**
 * Render the site from the board state.
 *
 * The whole board is rendered into static HTML at build time: a citizen on a
 * slow phone gets the announcements in the first response, with no scripting
 * required. JavaScript only adds filtering, in-place detail and local times.
 */

import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCES } from '../../config/sources.js';
import { SITE } from '../../config/site.js';
import { RunLogger } from '../lib/logger.js';
import { nowIso } from '../lib/time.js';
import { renderPage, siteStructuredData } from './layout.js';
import { renderAbout, renderDetail, renderHome, renderNotFound, renderSources } from './pages.js';
import { publicBoard } from '../pipeline/store.js';
import { readState, STATE_PATH } from '../pipeline/store.js';

const ASSETS_DIR = fileURLToPath(new URL('./assets', import.meta.url));
export const OUT_DIR = 'public';

/**
 * @param {object} [options]
 * @param {object} [options.state]   board state; read from disk when omitted
 * @param {string} [options.outDir]
 * @param {boolean}[options.preview] marks the build as sample data
 * @returns {Promise<{outDir:string, pages:number, announcements:number}>}
 */
export async function buildSite(options = {}) {
  const logger = options.logger ?? new RunLogger({ console: options.quiet !== true });
  const outDir = options.outDir ?? OUT_DIR;
  const state = options.state ?? (await readState(options.statePath ?? STATE_PATH, { logger }));
  const board = publicBoard(state);
  const now = options.now ?? nowIso();
  const preview = Boolean(options.preview);

  await mkdir(outDir, { recursive: true });
  await mkdir(join(outDir, 'a'), { recursive: true });
  await clearDetailPages(join(outDir, 'a'));

  await cp(ASSETS_DIR, join(outDir, 'assets'), { recursive: true });

  const common = { lastCheckedAt: state.lastCheckedAt, preview };
  const pages = [];

  pages.push([
    join(outDir, 'index.html'),
    renderPage({
      ...common,
      title: `${SITE.name} — ${SITE.tagline}`,
      description: SITE.description,
      canonical: 'index.html',
      current: 'index.html',
      head: siteStructuredData(),
      body: renderHome(board, { now }),
    }),
  ]);

  pages.push([
    join(outDir, 'about.html'),
    renderPage({
      ...common,
      title: `About — ${SITE.name}`,
      description: `How ${SITE.name} chooses announcements, where they come from, and who built it.`,
      canonical: 'about.html',
      current: 'about.html',
      body: renderAbout(),
    }),
  ]);

  pages.push([
    join(outDir, 'sources.html'),
    renderPage({
      ...common,
      title: `Official sources — ${SITE.name}`,
      description: `The official offices ${SITE.name} monitors for public announcements affecting Malolos.`,
      canonical: 'sources.html',
      current: 'sources.html',
      body: renderSources(SOURCES, state),
    }),
  ]);

  pages.push([
    join(outDir, '404.html'),
    renderPage({
      ...common,
      title: `Not found — ${SITE.name}`,
      description: 'That announcement is no longer on the board.',
      canonical: '404.html',
      current: '',
      body: renderNotFound(),
    }),
  ]);

  for (const record of board.announcements) {
    pages.push([
      join(outDir, 'a', `${record.id}.html`),
      renderPage({
        ...common,
        base: '../',
        title: `${record.title} — ${SITE.name}`,
        description: record.snippet || `${record.sourceName}: ${record.title}`,
        canonical: `a/${record.id}.html`,
        current: 'index.html',
        head: announcementStructuredData(record),
        body: renderDetail(record, { base: '../', now }),
      }),
    ]);
  }

  for (const [path, html] of pages) {
    await writeFile(path, html, 'utf8');
  }

  await writeFile(join(outDir, 'robots.txt'), robotsTxt(), 'utf8');
  await writeFile(join(outDir, 'sitemap.xml'), sitemap(board), 'utf8');
  await writeFile(join(outDir, '.nojekyll'), '', 'utf8');

  logger.info('site built', { outDir, pages: pages.length, announcements: board.announcements.length });
  return { outDir, pages: pages.length, announcements: board.announcements.length };
}

/** Detail pages are regenerated every build; stale ones must not linger. */
async function clearDetailPages(dir) {
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries.filter((name) => name.endsWith('.html')).map((name) => rm(join(dir, name), { force: true }))
  );
}

/**
 * Structured data describes a public announcement, not a news article: the
 * project is not a news publisher and should not be indexed as one.
 */
function announcementStructuredData(record) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SpecialAnnouncement',
    name: record.title,
    text: record.snippet || record.title,
    url: `${SITE.origin.replace(/\/$/, '')}/a/${record.id}.html`,
    datePosted: record.publishedAt ?? record.firstSeenAt,
    announcementLocation: {
      '@type': 'CivicStructure',
      name: 'City of Malolos',
      address: { '@type': 'PostalAddress', addressLocality: 'Malolos', addressRegion: 'Bulacan', addressCountry: 'PH' },
    },
    publisher: { '@type': 'Organization', name: record.sourceName, url: record.sourceHomepage },
    sameAs: record.announcementUrl,
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>\n`;
}

function robotsTxt() {
  return `User-agent: *
Allow: /
Sitemap: ${SITE.origin.replace(/\/$/, '')}/sitemap.xml
`;
}

function sitemap(board) {
  const origin = SITE.origin.replace(/\/$/, '');
  const urls = [
    { loc: `${origin}/index.html`, lastmod: board.lastCheckedAt },
    { loc: `${origin}/about.html`, lastmod: null },
    { loc: `${origin}/sources.html`, lastmod: null },
    ...board.announcements.map((record) => ({
      loc: `${origin}/a/${record.id}.html`,
      lastmod: record.updatedAt ?? record.firstSeenAt,
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) =>
      `  <url><loc>${url.loc}</loc>${url.lastmod ? `<lastmod>${new Date(url.lastmod).toISOString()}</lastmod>` : ''}</url>`
  )
  .join('\n')}
</urlset>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildSite();
  process.stdout.write(`Built ${result.pages} page(s) into ${result.outDir}/\n`);
}
