/**
 * Retrieve candidates from each configured source.
 *
 * Every source is processed on its own. A source that times out, changes its
 * markup, blocks the request or serves nonsense produces an error entry and
 * nothing else - the cycle continues with the sources that did respond, and the
 * board keeps the data it already has.
 */

import { looksLikeFeed, parseFeed } from '../lib/feed.js';
import { hrefOf, selectAll, textOf, timeOf } from '../lib/html.js';
import { fetchText } from '../lib/http.js';
import { cleanText, safeUrl, stripTags } from '../lib/sanitize.js';
import { squish } from '../lib/text.js';
import { parseDate } from '../lib/time.js';

const MAX_ITEMS_PER_SOURCE = 40;

/**
 * @returns {Promise<{
 *   sourceId: string, ok: boolean, notModified: boolean, candidates: object[],
 *   error: {kind:string, message:string, status:number|null}|null,
 *   validators: {etag:string|null, lastModified:string|null},
 *   fetchedAt: string, durationMs: number
 * }>}
 */
export async function retrieveSource(source, options = {}) {
  const { validators = {}, logger, fetchOptions = {} } = options;
  const startedAt = Date.now();
  const base = {
    sourceId: source.id,
    ok: false,
    notModified: false,
    candidates: [],
    error: null,
    validators: { etag: null, lastModified: null },
    fetchedAt: new Date().toISOString(),
    durationMs: 0,
  };

  try {
    const response = await fetchText(source.url, { ...fetchOptions, validators });
    base.fetchedAt = response.fetchedAt;
    base.validators = { etag: response.etag, lastModified: response.lastModified };

    if (response.notModified) {
      logger?.info('source unchanged', { source: source.id });
      return { ...base, ok: true, notModified: true, durationMs: Date.now() - startedAt };
    }

    const candidates =
      source.kind === 'rss'
        ? readFeed(source, response)
        : readListing(source, response);

    logger?.info('source retrieved', {
      source: source.id,
      status: response.status,
      candidates: candidates.length,
    });
    return { ...base, ok: true, candidates, durationMs: Date.now() - startedAt };
  } catch (error) {
    logger?.warn('source failed', {
      source: source.id,
      kind: error.kind ?? 'error',
      status: error.status ?? null,
      message: error.message,
    });
    return {
      ...base,
      error: { kind: error.kind ?? 'error', message: error.message, status: error.status ?? null },
      durationMs: Date.now() - startedAt,
    };
  }
}

function readFeed(source, response) {
  if (!looksLikeFeed(response.body, response.contentType)) {
    throw Object.assign(new Error('Response is not a feed'), { kind: 'format' });
  }
  const feed = parseFeed(response.body);
  return feed.entries.slice(0, MAX_ITEMS_PER_SOURCE).flatMap((entry) => {
    const link = safeUrl(entry.link, response.finalUrl);
    const title = squish(cleanText(entry.title, 300));
    if (!title || !link) return [];
    return [
      {
        sourceId: source.id,
        title,
        announcementUrl: link,
        summary: squish(cleanText(entry.summary, 1200)),
        body: squish(cleanText(entry.content, 4000)),
        publishedRaw: entry.published ?? entry.updated ?? null,
        publishedAt: parseDate(entry.published ?? entry.updated),
        guid: entry.guid ?? link,
        categories: entry.categories ?? [],
      },
    ];
  });
}

function readListing(source, response) {
  const selectors = source.list ?? {};
  const blocks = selectAll(response.body, selectors.item ?? 'article', { limit: MAX_ITEMS_PER_SOURCE });
  if (!blocks.length && !source.allowEmpty) {
    throw Object.assign(new Error(`No items matched "${selectors.item ?? 'article'}"`), {
      kind: 'format',
    });
  }

  const items = blocks.flatMap((block) => {
    const title = squish(cleanText(textOf(block.html, selectors.title ?? 'h1, h2, h3') || block.attributes.title, 300));
    const href = hrefOf(block.html, selectors.link ?? 'a');
    const link = safeUrl(href, response.finalUrl);
    if (!title || !link) return [];

    const rawDate = timeOf(block.html, selectors.date ?? 'time');
    const summary = squish(cleanText(textOf(block.html, selectors.summary ?? 'p'), 1200));

    return [
      {
        sourceId: source.id,
        title,
        announcementUrl: link,
        summary,
        body: squish(stripTags(block.html)).slice(0, 4000),
        publishedRaw: rawDate || null,
        publishedAt: parseDate(rawDate),
        guid: link,
        categories: [],
      },
    ];
  });

  // The page loaded and the container selector still matches, but nothing
  // inside it looks like a linked notice any more - usually a redesign.
  if (blocks.length && !items.length && !source.allowEmpty) {
    throw Object.assign(
      new Error(`Matched ${blocks.length} block(s) but none contained a title and link`),
      { kind: 'format' }
    );
  }
  return items;
}

/**
 * Retrieve every enabled source. Failures are isolated per source.
 * @returns {Promise<{results: object[], candidates: object[]}>}
 */
export async function discoverAll(sources, options = {}) {
  const { sourceState = {}, logger, fetchOptions } = options;
  const results = await Promise.all(
    sources.map((source) =>
      retrieveSource(source, {
        logger,
        fetchOptions,
        validators: {
          etag: sourceState[source.id]?.etag ?? undefined,
          lastModified: sourceState[source.id]?.lastModified ?? undefined,
        },
      })
    )
  );
  return { results, candidates: results.flatMap((result) => result.candidates) };
}
