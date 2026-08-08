/**
 * Page bodies. Everything here is a pure function of the board data, so the
 * same board always renders the same markup - no randomness between builds.
 */

import { CATEGORIES } from '../../config/rules.js';
import { sourcesForPublicDisplay } from '../../config/sources.js';
import { AUTHOR, DISCLAIMER, EMPTY_STATE, SITE } from '../../config/site.js';
import { escapeHtml, escapeJson } from '../lib/sanitize.js';
import { formatManila, relativeTime } from '../lib/time.js';

export function categoryLabel(id) {
  return CATEGORIES[id]?.label ?? 'Public notice';
}

/**
 * One alert panel.
 *
 * The rank is real information - the board is ordered by how much each notice
 * affects residents - so it is shown as a numeral rather than hidden in the
 * sort order. Status is stated in words as well as colour.
 */
export function renderAlert(record, { base = '', index = 0 } = {}) {
  const detailHref = `${base}a/${encodeURIComponent(record.id)}.html`;

  const status = record.isEmergency
    ? { label: 'Emergency advisory', tone: 'emergency' }
    : record.isPriority
      ? { label: `Priority ${record.priorityRank}`, tone: 'priority' }
      : record.isNew
        ? { label: 'New', tone: 'new' }
        : { label: 'Active', tone: 'active' };

  const published = record.publishedAtIsKnown
    ? `<time datetime="${escapeHtml(record.publishedAt)}" data-relative="${escapeHtml(record.publishedAt)}">${escapeHtml(
        formatManila(record.publishedAt)
      )}</time>`
    : `<span class="alert__nodate">Time not stated by the source</span>`;

  return `<article class="alert alert--${escapeHtml(record.category)}${
    record.isEmergency ? ' alert--emergency' : ''
  }${record.isPriority ? ' alert--priority' : ''}"
  style="--i:${index}"
  data-id="${escapeHtml(record.id)}"
  data-category="${escapeHtml(record.category)}"
  data-emergency="${record.isEmergency ? 'true' : 'false'}"
  aria-labelledby="title-${escapeHtml(record.id)}">
  <span class="alert__spine" aria-hidden="true"></span>
  <span class="alert__sweep" aria-hidden="true"></span>
  <p class="alert__head">
    <span class="alert__rank" aria-hidden="true">${String(record.priorityRank ?? index + 1).padStart(2, '0')}</span>
    <span class="alert__category">${escapeHtml(categoryLabel(record.category))}</span>
    <span class="alert__status alert__status--${status.tone}">
      <span class="alert__status-dot" aria-hidden="true"></span>${escapeHtml(status.label)}
    </span>
    ${record.isUpdated ? '<span class="alert__badge">Updated</span>' : ''}
  </p>
  <h3 class="alert__title" id="title-${escapeHtml(record.id)}">
    <a class="alert__link" href="${escapeHtml(detailHref)}">${escapeHtml(record.title)}</a>
  </h3>
  ${record.snippet ? `<p class="alert__snippet">${escapeHtml(record.snippet)}</p>` : ''}
  <p class="alert__meta">
    <span class="alert__source">${escapeHtml(record.sourceName)}</span>
    <span class="alert__time">${published}</span>
  </p>
  <p class="alert__foot">
    <a class="alert__official" href="${escapeHtml(record.announcementUrl)}" target="_blank" rel="noopener noreferrer">
      Read official announcement<span class="alert__arrow" aria-hidden="true">→</span>
      <span class="visually-hidden">(opens the ${escapeHtml(record.sourceName)} website in a new tab)</span>
    </a>
  </p>
</article>`;
}

/** HOME - the monitor. */
export function renderHome(board, options = {}) {
  const announcements = board.announcements ?? [];
  const categoriesPresent = [...new Set(announcements.map((record) => record.category))];

  const filters =
    announcements.length > 3
      ? `<div class="filters" hidden data-filters>
    <div class="filters__chips" role="group" aria-label="Filter by kind of announcement">
      <button type="button" class="filter is-active" data-filter="all" aria-pressed="true">All <span class="filter__n">${announcements.length}</span></button>
      ${categoriesPresent
        .map((id) => {
          const count = announcements.filter((record) => record.category === id).length;
          return `<button type="button" class="filter filter--${escapeHtml(id)}" data-filter="${escapeHtml(
            id
          )}" aria-pressed="false">${escapeHtml(categoryLabel(id))} <span class="filter__n">${count}</span></button>`;
        })
        .join('\n      ')}
    </div>
  </div>`
      : '';

  const body = announcements.length
    ? `<div class="alerts" data-alerts>
${announcements.map((record, index) => renderAlert(record, { index })).join('\n')}
</div>
<p class="alerts__count" data-count><span class="alerts__count-n">${announcements.length}</span> active announcement${
        announcements.length === 1 ? '' : 's'
      }</p>`
    : renderEmptyState();

  return `<section class="monitor">
  ${filters}
  <div class="monitor__screen" role="region" aria-label="Active public announcements for Malolos">
${body}
  </div>
</section>
${
  announcements.length
    ? `<script type="application/json" id="board-data">${escapeJson(board)}</script>\n${renderDialog()}`
    : ''
}`;
}

function renderEmptyState() {
  return `<div class="empty">
  <span class="empty__radar" aria-hidden="true"><span class="empty__ring"></span><span class="empty__ring"></span><span class="empty__dot"></span></span>
  <h2 class="empty__title">${escapeHtml(EMPTY_STATE.title)}</h2>
  <p class="empty__body">${escapeHtml(EMPTY_STATE.body)}</p>
</div>`;
}

/** The expanded view, used by the dialog. Detail pages work without it. */
function renderDialog() {
  return `<dialog class="sheet" id="detail-dialog" aria-labelledby="detail-dialog-title">
  <article class="detail detail--dialog">
    <button type="button" class="sheet__close" data-close-dialog aria-label="Close announcement">
      <span aria-hidden="true">✕</span>
    </button>
    <div data-dialog-content></div>
  </article>
</dialog>`;
}

/** ANNOUNCEMENT DETAIL - a real page, so it works with no JavaScript. */
export function renderDetail(record, options = {}) {
  const base = options.base ?? '../';
  const published = record.publishedAtIsKnown
    ? `<time datetime="${escapeHtml(record.publishedAt)}">${escapeHtml(formatManila(record.publishedAt))}</time> <span class="detail__ago">(${escapeHtml(
        relativeTime(record.publishedAt, options.now ? new Date(options.now).getTime() : Date.now())
      )})</span>`
    : 'Not stated by the source';

  const alsoReported = (record.alsoReportedBy ?? []).filter((entry) => entry.url).length
    ? `<div class="detail__row">
      <dt>Also published by</dt>
      <dd><ul class="detail__sources">${record.alsoReportedBy
        .filter((entry) => entry.url)
        .map(
          (entry) =>
            `<li><a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
              entry.sourceName ?? 'Official source'
            )}<span aria-hidden="true"> →</span></a></li>`
        )
        .join('')}</ul></dd>
    </div>`
    : '';

  const status = record.isEmergency
    ? 'Emergency advisory'
    : record.isPriority
      ? `Priority notice (${record.priorityRank} of 3)`
      : record.isNew
        ? 'Recently posted'
        : 'Active';

  return `<article class="detail detail--${escapeHtml(record.category)}${record.isEmergency ? ' detail--emergency' : ''}">
  <p class="detail__back"><a href="${base}index.html"><span aria-hidden="true">←</span> Back to the board</a></p>
  ${record.isEmergency ? '<p class="detail__banner">Emergency advisory</p>' : ''}
  <p class="detail__flags">
    <span class="chip chip--${escapeHtml(record.category)}">${escapeHtml(categoryLabel(record.category))}</span>
    ${record.isUpdated ? '<span class="chip chip--updated">Updated since first posted</span>' : ''}
  </p>
  <h1 class="detail__title">${escapeHtml(record.title)}</h1>
  ${record.snippet ? `<blockquote class="detail__snippet"><p>${escapeHtml(record.snippet)}</p><cite>From the announcement published by ${escapeHtml(record.sourceName)}</cite></blockquote>` : ''}
  ${
    record.isTranscribed
      ? `<p class="detail__provenance">This notice was recorded from the official post by hand, because that page cannot be read automatically. Open the original post for the exact wording.</p>`
      : ''
  }
  <p class="detail__cta">
    <a class="button" href="${escapeHtml(record.announcementUrl)}" target="_blank" rel="noopener noreferrer">
      Read official announcement<span aria-hidden="true"> →</span>
      <span class="visually-hidden">(opens ${escapeHtml(record.sourceName)} in a new tab)</span>
    </a>
  </p>
  <dl class="detail__facts">
    <div class="detail__row"><dt>Source</dt><dd>${escapeHtml(record.sourceName)}${
      record.sourceType ? ` <span class="detail__sourcetype">${escapeHtml(record.sourceType)}</span>` : ''
    }</dd></div>
    <div class="detail__row"><dt>Published</dt><dd>${published}</dd></div>
    <div class="detail__row"><dt>Status on this board</dt><dd>${escapeHtml(status)}</dd></div>
    <div class="detail__row"><dt>First posted here</dt><dd>${escapeHtml(formatManila(record.firstSeenAt))}</dd></div>
    ${alsoReported}
  </dl>
  <p class="detail__note">${escapeHtml(DISCLAIMER.full[2])}</p>
</article>`;
}

/** ABOUT */
export function renderAbout() {
  return `<article class="prose">
  <h1>About ${escapeHtml(SITE.name)}</h1>
  <p class="prose__lede">${escapeHtml(SITE.description)}</p>

  <h2>Why it exists</h2>
  <p>Announcements that affect Malolos are scattered across several official websites and pages. When classes are suspended or water is cut off, you should not have to check six places to find out. This board collects the notices that are active right now and puts them in one place, with a link back to the office that issued each one.</p>

  <h2>What gets posted</h2>
  <p>Only announcements that change what a resident should do or expect. That includes class and work suspensions, road closures and traffic advisories, water and power interruptions, flood and severe weather warnings, health advisories, evacuation information, and deadlines or service changes that materially affect residents.</p>
  <p>Ordinary news does not get posted. Neither do press releases, ceremonies, awards, campaign material, opinion pieces or crime reports, unless an official public safety advisory was issued with them. When it is unclear whether something qualifies, it is left off. A quiet board is more useful than a noisy one.</p>

  <h2>How announcements are chosen</h2>
  <p>Each notice is checked against the same questions: is the publisher an official source, does it materially affect Malolos, is it still in force, is it already on the board, and is it an announcement rather than a story. Items that pass are ranked by how much they affect residents, how urgent they are, how directly they concern Malolos, and how recent they are - in that order, not by publication time alone. The three highest are shown as priority notices.</p>
  <p>The board holds a maximum of 20 notices. When a new one arrives and the board is full, the least important notice comes down. An active advisory is never removed just because something newer was published.</p>

  <h2>Why the original source matters</h2>
  <p>Every alert carries the name of the office that issued the notice and a link to the original. The wording shown here is taken from the source and shortened; it is never rewritten, reinterpreted or made to sound more urgent than the original. If the two ever differ, the official announcement is correct.</p>

  <h2>How often it is checked</h2>
  <p>Official sources are checked every hour. The time of the last check is shown at the top of the board. This is not a live feed, and it is not a substitute for emergency services.</p>

  <h2>Who made this</h2>
  <p>${escapeHtml(AUTHOR.long)} It is not funded by, affiliated with, or endorsed by any government office.</p>
  <p class="prose__credit">${escapeHtml(AUTHOR.name)} · ${escapeHtml(AUTHOR.role)}</p>

  <h2>Important</h2>
  ${DISCLAIMER.full.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n  ')}
  <p>In an emergency, contact the Malolos City Disaster Risk Reduction and Management Office or the national emergency hotline 911 directly.</p>
</article>`;
}

/** SOURCES */
export function renderSources(sources) {
  const groups = sourcesForPublicDisplay(sources);
  return `<article class="prose">
  <h1>Where the announcements come from</h1>
  <p class="prose__lede">${escapeHtml(SITE.name)} only posts notices published by these official offices. Each notice on the board names its source and links to the original.</p>

  ${groups
    .map(
      (group) => `<section class="sources__group">
    <h2>${escapeHtml(group.label)}</h2>
    <ul class="sources__list">
      ${group.sources
        .map(
          (source) => `<li class="source${source.enabled === false ? ' source--paused' : ''}">
        <p class="source__name">${escapeHtml(source.name)}</p>
        <p class="source__desc">${escapeHtml(source.publicDescription ?? '')}</p>
        <p class="source__link"><a href="${escapeHtml(source.homepage)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
            (source.homepage ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')
          )}<span aria-hidden="true"> →</span></a></p>
        ${source.enabled === false ? '<p class="source__status">Not being checked at the moment</p>' : ''}
      </li>`
        )
        .join('\n      ')}
    </ul>
  </section>`
    )
    .join('\n  ')}

  <h2>What is not used</h2>
  <p>Unofficial pages, news websites, community groups and forwarded messages are not used as sources, however widely they are shared. If an advisory cannot be traced to the office that issued it, it does not go on the board.</p>
  <p>If an official source is missing from this list and should be included, that is a gap worth fixing - the list is maintained by hand and kept deliberately short.</p>
  <p class="prose__credit">${escapeHtml(AUTHOR.short)}</p>
</article>`;
}

/** 404 */
export function renderNotFound() {
  return `<article class="prose prose--center">
  <h1>That notice is not on the board</h1>
  <p>Announcements come down when they expire or when the board is full, so this page may have been removed.</p>
  <p><a class="button" href="index.html">Go to the board</a></p>
</article>`;
}
