/**
 * Retrieve candidates from each configured source.
 *
 * Every source is processed on its own. A source that times out, changes its
 * markup, blocks the request or serves nonsense produces an error entry and
 * nothing else - the cycle continues with the sources that did respond, and the
 * board keeps the data it already has.
 */

import { readFile } from 'node:fs/promises';
import { sourceToken } from '../../config/sources.js';
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
    // True when the reader saw everything that source currently publishes, so
    // anything missing has genuinely been withdrawn rather than paged out.
    complete: false,
    error: null,
    validators: { etag: null, lastModified: null },
    fetchedAt: new Date().toISOString(),
    durationMs: 0,
  };

  try {
    // A hand-recorded source is read from disk; nothing is requested over the
    // network for it.
    if (source.kind === 'manual') {
      const candidates = await readCurated(source, options);
      logger?.info('source read from the curated file', {
        source: source.id,
        candidates: candidates.length,
      });
      // The file is the whole truth for this source: taking an entry out of it
      // is a deliberate act, so the alert comes down at the next update.
      return { ...base, ok: true, candidates, complete: true, durationMs: Date.now() - startedAt };
    }

    const response = await fetchText(requestUrl(source, options), { ...fetchOptions, validators });
    base.fetchedAt = response.fetchedAt;
    base.validators = { etag: response.etag, lastModified: response.lastModified };

    if (response.notModified) {
      logger?.info('source unchanged', { source: source.id });
      return { ...base, ok: true, notModified: true, durationMs: Date.now() - startedAt };
    }

    const candidates =
      source.kind === 'rss'
        ? readFeed(source, response)
        : source.kind === 'graph'
          ? readGraph(source, response)
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

/**
 * The address actually requested. For the Graph API the page token and the
 * field list are added here so the token never appears in the registry.
 */
function requestUrl(source, options = {}) {
  if (source.kind !== 'graph') return source.url;
  const token = sourceToken(source, options.env ?? process.env);
  if (!token) {
    throw Object.assign(new Error(`No access token in ${source.tokenEnv}`), { kind: 'config' });
  }
  const url = new URL(source.url);
  url.searchParams.set('fields', 'message,created_time,updated_time,permalink_url,id');
  url.searchParams.set('limit', '25');
  url.searchParams.set('access_token', token);
  return url.toString();
}

/**
 * Facebook Graph API posts. Only the fields above are requested: the message
 * text, when it was posted and the permalink. A post with no text is skipped -
 * an image with no caption cannot be verified as an announcement.
 */
function readGraph(source, response) {
  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw Object.assign(new Error('Graph API returned something other than JSON'), { kind: 'format' });
  }
  if (payload.error) {
    throw Object.assign(new Error(`Graph API: ${payload.error.message ?? 'request refused'}`), {
      kind: 'auth',
    });
  }
  const posts = Array.isArray(payload.data) ? payload.data : [];

  return posts.slice(0, MAX_ITEMS_PER_SOURCE).flatMap((post) => {
    const message = squish(cleanText(post.message ?? '', 4000));
    const link = safeUrl(post.permalink_url);
    if (!message || !link) return [];

    // A Facebook post has no headline, so the first sentence becomes the title
    // and the whole message stays available as the body. No words are changed.
    const title = firstSentence(message, 160);
    if (!title) return [];

    return [
      {
        sourceId: source.id,
        title,
        announcementUrl: link,
        summary: message,
        body: message,
        publishedRaw: post.created_time ?? null,
        publishedAt: parseDate(post.created_time ?? post.updated_time),
        guid: post.id ?? link,
        categories: [],
      },
    ];
  });
}

/**
 * Notices recorded by hand from an official page that may not be crawled.
 * The file is data, not code: a malformed entry is dropped and reported rather
 * than trusted.
 */
async function readCurated(source, options = {}) {
  const path = options.curatedPath ?? source.file ?? 'data/curated.json';
  let payload;
  try {
    payload = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw Object.assign(new Error(`Curated file unreadable: ${error.message}`), { kind: 'format' });
  }

  const entries = Array.isArray(payload) ? payload : (payload.announcements ?? []);
  return entries
    .filter((entry) => entry && entry.sourceId === source.id)
    .slice(0, MAX_ITEMS_PER_SOURCE)
    .flatMap((entry) => {
      const title = squish(cleanText(entry.title, 300));
      const link = safeUrl(entry.url ?? entry.announcementUrl);
      const text = squish(cleanText(entry.text ?? entry.summary ?? '', 4000));
      if (!title || !link || !text) return [];
      return [
        {
          sourceId: source.id,
          title,
          announcementUrl: link,
          summary: text,
          body: text,
          publishedRaw: entry.publishedAt ?? null,
          publishedAt: parseDate(entry.publishedAt),
          guid: entry.id ?? link,
          categories: [],
          transcribed: true,
        },
      ];
    });
}

/** The first sentence of a message, cut at a word boundary if it runs long. */
function firstSentence(text, maxLength) {
  const sentence = (text.match(/^[^.!?\n]{10,}?[.!?](\s|$)/) ?? [])[0]?.trim() ?? '';
  if (sentence && sentence.length <= maxLength) return sentence.replace(/[.!?]$/, '');
  const cut = text.slice(0, maxLength);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > 40 ? cut.slice(0, boundary) : cut).trim();
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
