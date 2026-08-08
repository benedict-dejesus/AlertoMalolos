/**
 * Page shell: head, masthead, navigation, footer.
 * Every value that reaches the markup passes through escapeHtml first.
 */

import { AUTHOR, DISCLAIMER, NAV, SITE } from '../../config/site.js';
import { escapeHtml } from '../lib/sanitize.js';
import { formatManila } from '../lib/time.js';

/**
 * @param {object} page
 * @param {string} page.title      full <title>
 * @param {string} page.heading    page name for the document outline
 * @param {string} page.description meta description
 * @param {string} page.body       page markup
 * @param {string} page.current    nav item to mark as current
 * @param {string} [page.canonical] path relative to the site root
 * @param {string} [page.bodyClass]
 * @param {string} [page.head]     extra head markup (structured data)
 * @param {string} [page.foot]     extra markup before </body>
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
<meta name="theme-color" content="#2E2019">
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
${page.head ?? ''}</head>
<body class="${escapeHtml(page.bodyClass ?? '')}">
<a class="skip-link" href="#main">Skip to the announcements</a>
${page.preview ? previewBanner() : ''}
${masthead(page, base)}
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
  return `<p class="preview-banner" role="status">Preview build. The notices below are sample data, not live announcements.</p>\n`;
}

/**
 * The masthead is the board's sign, not an introduction: name, when it was last
 * checked, and the way to the two other pages. Anything that explains the
 * project belongs on the About page, one tap away.
 */
function masthead(page, base) {
  const checked = page.lastCheckedAt
    ? `<p class="status" data-last-checked="${escapeHtml(page.lastCheckedAt)}">
      <span class="status__dot" aria-hidden="true"></span>
      <span class="status__text">Checked ${escapeHtml(formatManila(page.lastCheckedAt, { dateStyle: undefined, timeStyle: 'short' }))}</span>
    </p>`
    : '';

  // On the board itself the site name is the page's heading. On the other
  // pages it is a link back, and those pages carry their own heading.
  const wordmark = `<a class="wordmark" href="${base}index.html">
      <span class="wordmark__alerto">Alerto</span><span class="wordmark__malolos">Malolos</span>
    </a>`;

  return `<header class="masthead">
  <div class="masthead__inner">
    ${page.isHome ? `<h1 class="masthead__name">${wordmark}</h1>` : `<p class="masthead__name">${wordmark}</p>`}
    <p class="masthead__tagline">${escapeHtml(SITE.tagline)}</p>
    ${checked}
    <nav class="nav" aria-label="Sections">
      <ul>
        ${NAV.map(
          (item) =>
            `<li><a href="${base}${item.href}"${
              page.current === item.href ? ' aria-current="page"' : ''
            }>${escapeHtml(item.label)}</a></li>`
        ).join('\n        ')}
      </ul>
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
    about: { '@type': 'City', name: 'Malolos', address: { '@type': 'PostalAddress', addressRegion: 'Bulacan', addressCountry: 'PH' } },
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>\n`;
}
