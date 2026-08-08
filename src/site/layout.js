/**
 * Page shell: head, header, footer.
 *
 * The interface is a monitor, not a page of prose: the name, the state of the
 * hourly cycle, a way between the three views, and then the alerts. Everything
 * that reaches the markup passes through escapeHtml first.
 */

import { AUTHOR, DISCLAIMER, NAV, SITE } from '../../config/site.js';
import { escapeHtml } from '../lib/sanitize.js';
import { formatManila } from '../lib/time.js';

/**
 * @param {object} page
 * @param {string} page.title      full <title>
 * @param {string} page.description meta description
 * @param {string} page.body       page markup
 * @param {string} page.current    nav item to mark as current
 * @param {string} [page.canonical] path relative to the site root
 * @param {boolean}[page.isHome]   the site name becomes the page heading
 * @param {string} [page.bodyClass]
 * @param {string} [page.head]     extra head markup (structured data)
 * @param {string} [page.base]     '' for root pages, '../' for detail pages
 * @param {string} [page.lastCheckedAt]
 * @param {boolean} [page.preview] marks a build made from sample data
 */
export function renderPage(page) {
  const base = page.base ?? '';
  const canonical = `${SITE.origin.replace(/\/$/, '')}/${(page.canonical ?? '').replace(/^\//, '')}`;

  return `<!DOCTYPE html>
<html lang="en-PH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<meta name="author" content="${escapeHtml(AUTHOR.name)}">
<meta name="theme-color" content="#090D13">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="icon" href="${base}assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${base}assets/icon.svg">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(SITE.name)}">
<meta property="og:title" content="${escapeHtml(page.title)}">
<meta property="og:description" content="${escapeHtml(page.description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(`${SITE.origin.replace(/\/$/, '')}/assets/social-card.png`)}">
<meta property="og:image:alt" content="${escapeHtml(`${SITE.name} - ${SITE.tagline}`)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="${base}assets/fonts/plex-condensed-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${base}assets/fonts/plex-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${base}assets/board.css">
<script>document.documentElement.classList.add('has-js')</script>
${page.head ?? ''}</head>
<body class="${escapeHtml(page.bodyClass ?? '')}">
<a class="skip-link" href="#main">Skip to the announcements</a>
${page.preview ? previewBanner() : ''}
${header(page, base)}
<main id="main" tabindex="-1">
${page.body}
</main>
${footer(base)}
<script src="${base}assets/board.js" defer></script>
${page.foot ?? ''}</body>
</html>
`;
}

function previewBanner() {
  return `<p class="preview-banner" role="status">Preview build. The alerts below are sample data, not live announcements.</p>\n`;
}

/**
 * The console head. The sweep shows how far through the hourly cycle the board
 * is; its width is set from real times, never from a decorative loop.
 */
function header(page, base) {
  const wordmark = `<a class="wordmark" href="${base}index.html">
        <span class="wordmark__a">Alerto</span><span class="wordmark__b">Malolos</span>
      </a>`;

  const cycle = page.lastCheckedAt
    ? `<div class="cycle" data-cycle data-last-checked="${escapeHtml(page.lastCheckedAt)}" data-interval="${SITE.updateIntervalMinutes}">
      <p class="cycle__row">
        <span class="cycle__label">Checked</span>
        <span class="cycle__value" data-cycle-checked>${escapeHtml(
          formatManila(page.lastCheckedAt, { dateStyle: undefined, timeStyle: 'short' })
        )}</span>
        <span class="cycle__spacer"></span>
        <span class="cycle__label cycle__label--next">Next check</span>
        <span class="cycle__value" data-cycle-next>in under an hour</span>
      </p>
      <span class="cycle__track" aria-hidden="true"><span class="cycle__fill" data-cycle-fill></span></span>
    </div>`
    : '';

  return `<header class="topbar">
  <div class="topbar__inner">
    <div class="topbar__brand">
      <span class="beacon" aria-hidden="true"><span class="beacon__core"></span></span>
      ${page.isHome ? `<h1 class="brand">${wordmark}</h1>` : `<p class="brand">${wordmark}</p>`}
    </div>
    <p class="topbar__tagline">${escapeHtml(SITE.tagline)}</p>
    ${cycle}
    <nav class="tabs" aria-label="Sections">
      ${NAV.map(
        (item) =>
          `<a class="tab" href="${base}${item.href}"${
            page.current === item.href ? ' aria-current="page"' : ''
          }>${escapeHtml(item.label)}</a>`
      ).join('\n      ')}
    </nav>
  </div>
</header>`;
}

/** One line: who made it, and what it is not. The rest is on the About page. */
function footer(base) {
  return `<footer class="footer">
  <p class="footer__credit"><strong>${escapeHtml(SITE.name)}</strong> — a civic project by ${escapeHtml(AUTHOR.name)}</p>
  <p class="footer__note">${escapeHtml(DISCLAIMER.short)} <a href="${base}about.html">About</a> · <a href="${base}sources.html">Sources</a></p>
</footer>`;
}

/** JSON-LD describing the project. Kept minimal and honest. */
export function siteStructuredData() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    url: SITE.origin,
    description: SITE.description,
    inLanguage: 'en-PH',
    author: { '@type': 'Person', name: AUTHOR.name },
    publisher: { '@type': 'Person', name: AUTHOR.name },
    about: {
      '@type': 'City',
      name: 'Malolos',
      address: { '@type': 'PostalAddress', addressRegion: 'Bulacan', addressCountry: 'PH' },
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>\n`;
}
