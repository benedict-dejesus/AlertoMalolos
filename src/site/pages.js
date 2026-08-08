/**
 * Page bodies. Everything here is a pure function of the board data, so the
 * same board always renders the same markup - no randomness between builds.
 */

import { CATEGORIES } from '../../config/rules.js';
import { sourcesForPublicDisplay } from '../../config/sources.js';
import { AUTHOR, DISCLAIMER, EMPTY_STATE, SITE } from '../../config/site.js';
import { escapeHtml, escapeJson } from '../lib/sanitize.js';
import { hashUnit } from '../lib/text.js';
import { formatManila, relativeTime } from '../lib/time.js';

const PIN_COLOURS = ['var(--pin-red)', 'var(--pin-blue)', 'var(--pin-brass)', 'var(--pin-slate)'];

export function categoryLabel(id) {
  return CATEGORIES[id]?.label ?? 'Public notice';
}

/** A post-it, or - for emergencies - a printed notice sheet. */
export function renderNote(record, { base = '', index = 0 } = {}) {
  const rotation = (hashUnit(record.id, 'rotate') * 2.6 - 1.3).toFixed(2);
  const lift = (hashUnit(record.id, 'lift') * 5).toFixed(1);
  const pin = PIN_COLOURS[Math.floor(hashUnit(record.id, 'pin') * PIN_COLOURS.length) % PIN_COLOURS.length];
  const detailHref = `${base}a/${encodeURIComponent(record.id)}.html`;

  const flags = [];
  if (record.isEmergency) flags.push('<span class="flag flag--emergency">Emergency advisory</span>');
  if (record.isPriority) flags.push(`<span class="flag flag--priority">Priority ${record.priorityRank}</span>`);
  if (record.isNew && !record.isPriority) flags.push('<span class="flag flag--new">New</span>');
  if (record.isUpdated) flags.push('<span class="flag flag--updated">Updated</span>');

  const published = record.publishedAtIsKnown
    ? `<time datetime="${escapeHtml(record.publishedAt)}" data-relative="${escapeHtml(record.publishedAt)}">${escapeHtml(
        formatManila(record.publishedAt)
      )}</time>`
    : `<span class="note__nodate">Publication time not stated by the source</span>`;

  return `<article class="note note--${escapeHtml(record.displayState)}${record.isEmergency ? ' note--emergency' : ''}"
  style="--rot:${rotation}deg;--lift:${lift}px;--pin-colour:${pin}"
  data-id="${escapeHtml(record.id)}"
  data-category="${escapeHtml(record.category)}"
  data-emergency="${record.isEmergency ? 'true' : 'false'}"
  aria-labelledby="title-${escapeHtml(record.id)}">
  <span class="note__pin" aria-hidden="true"></span>
  ${flags.length ? `<p class="note__flags">${flags.join('')}</p>` : ''}
  <h3 class="note__title" id="title-${escapeHtml(record.id)}">
    <a class="note__link" href="${escapeHtml(detailHref)}">${escapeHtml(record.title)}</a>
  </h3>
  ${record.snippet ? `<p class="note__snippet">${escapeHtml(record.snippet)}</p>` : ''}
  <p class="note__attribution">
    <span class="note__source">${escapeHtml(record.sourceName)}</span>
    <span class="note__published">${published}</span>
  </p>
  <p class="note__foot">
    <span class="chip chip--${escapeHtml(record.category)}">${escapeHtml(categoryLabel(record.category))}</span>
    <a class="note__official" href="${escapeHtml(record.announcementUrl)}" target="_blank" rel="noopener noreferrer">
      Read official announcement<span class="note__external" aria-hidden="true">↗</span>
      <span class="visually-hidden">(opens the ${escapeHtml(record.sourceName)} website in a new tab)</span>
    </a>
  </p>
</article>`;
}

/** HOME - the corkboard. */
export function renderHome(board, options = {}) {
  const announcements = board.announcements ?? [];
  const categoriesPresent = [...new Set(announcements.map((record) => record.category))];

  const filters = announcements.length > 3
    ? `<div class="filters" hidden data-filters>
    <span class="filters__label" id="filter-label">Show</span>
    <div class="filters__chips" role="group" aria-labelledby="filter-label">
      <button type="button" class="filter is-active" data-filter="all" aria-pressed="true">All (${announcements.length})</button>
      ${categoriesPresent
        .map((id) => {
          const count = announcements.filter((record) => record.category === id).length;
          return `<button type="button" class="filter" data-filter="${escapeHtml(id)}" aria-pressed="false">${escapeHtml(
            categoryLabel(id)
          )} (${count})</button>`;
        })
        .join('\n      ')}
    </div>
  </div>`
    : '';

  const boardBody = announcements.length
    ? `<div class="board__notes" data-notes>
${announcements.map((record, index) => renderNote(record, { index })).join('\n')}
</div>
<p class="board__count" data-count>Showing ${announcements.length} active announcement${
        announcements.length === 1 ? '' : 's'
      }. The board holds up to 20.</p>`
    : renderEmptyState();

  const priorityNote = announcements.length
    ? `<p class="board__lede">The three notices at the top are what matters most right now. Everything below is still active.</p>`
    : '';

  return `<section class="board-section">
  <div class="board-head">
    <h1 class="board-head__title">Announcement board</h1>
    ${priorityNote}
  </div>
  ${filters}
  <div class="board" role="region" aria-label="Active public announcements for Malolos">
    <div class="board__surface">
${boardBody}
    </div>
  </div>
</section>
${renderHowItWorksStrip()}
${
  announcements.length
    ? `<script type="application/json" id="board-data">${escapeJson(board)}</script>\n${renderDialog()}`
    : ''
}`;
}

function renderEmptyState() {
  return `<div class="empty">
  <span class="empty__pin" aria-hidden="true"></span>
  <h2 class="empty__title">${escapeHtml(EMPTY_STATE.title)}</h2>
  <p class="empty__body">${escapeHtml(EMPTY_STATE.body)}</p>
  <p class="empty__meta">Nothing is posted unless an official source publishes something that affects Malolos.</p>
</div>`;
}

function renderHowItWorksStrip() {
  return `<section class="strip" aria-labelledby="strip-heading">
  <h2 class="strip__heading" id="strip-heading">How this board works</h2>
  <div class="strip__grid">
    <div class="strip__item">
      <h3>Official sources only</h3>
      <p>Notices come from the city government, the provincial government and national agencies. Nothing is taken from unofficial pages.</p>
    </div>
    <div class="strip__item">
      <h3>Advisories, not news</h3>
      <p>Only announcements that change what you should do today are posted: suspensions, closures, interruptions, warnings and deadlines.</p>
    </div>
    <div class="strip__item">
      <h3>The source is the authority</h3>
      <p>Each notice shows its publisher and links to the original. Confirm anything urgent with that source.</p>
    </div>
  </div>
  <p class="strip__credit">${escapeHtml(AUTHOR.short)}</p>
</section>`;
}

/** The expanded view, used by the dialog. Detail pages work without it. */
function renderDialog() {
  return `<dialog class="detail-dialog" id="detail-dialog" aria-labelledby="detail-dialog-title">
  <article class="detail detail--dialog">
    <button type="button" class="detail__close" data-close-dialog aria-label="Close announcement">×</button>
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
            )}<span aria-hidden="true"> ↗</span></a></li>`
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

  return `<article class="detail">
  <p class="detail__back"><a href="${base}index.html">Back to the board</a></p>
  ${record.isEmergency ? '<p class="detail__banner">Emergency advisory</p>' : ''}
  <p class="detail__flags">
    <span class="chip chip--${escapeHtml(record.category)}">${escapeHtml(categoryLabel(record.category))}</span>
    ${record.isUpdated ? '<span class="flag flag--updated">Updated since first posted</span>' : ''}
  </p>
  <h1 class="detail__title">${escapeHtml(record.title)}</h1>
  ${record.snippet ? `<blockquote class="detail__snippet"><p>${escapeHtml(record.snippet)}</p><cite>From the announcement published by ${escapeHtml(record.sourceName)}</cite></blockquote>` : ''}
  <p class="detail__cta">
    <a class="button" href="${escapeHtml(record.announcementUrl)}" target="_blank" rel="noopener noreferrer">
      Read official announcement<span aria-hidden="true"> ↗</span>
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
  <p>Every post-it carries the name of the office that issued the notice and a link to the original. The wording shown here is taken from the source and shortened; it is never rewritten, reinterpreted or made to sound more urgent than the original. If the two ever differ, the official announcement is correct.</p>

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
export function renderSources(sources, state = {}) {
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
          )}<span aria-hidden="true"> ↗</span></a></p>
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
