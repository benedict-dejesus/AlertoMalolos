/**
 * RSS 2.0 and Atom reader.
 *
 * Written by hand rather than pulled from a dependency: feeds from government
 * sites are frequently malformed, and the only behaviour we want on malformed
 * input is "return the entries that did parse, drop the rest".
 */

import { decodeEntities, stripTags } from './sanitize.js';

const CDATA = /^<!\[CDATA\[([\s\S]*?)\]\]>$/;

function unwrap(value) {
  const trimmed = String(value ?? '').trim();
  const cdata = trimmed.match(CDATA);
  return cdata ? cdata[1].trim() : decodeEntities(trimmed);
}

/** Inner text of the first `<tag>` inside `xml`, ignoring namespaces. */
function tagText(xml, name) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${name}(\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i');
  const match = xml.match(pattern);
  return match ? unwrap(match[2]) : '';
}

/** All matches of `<tag ...>` including self-closing, with attributes. */
function tagNodes(xml, name) {
  const pattern = new RegExp(
    `<(?:[\\w-]+:)?${name}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`,
    'gi'
  );
  return [...xml.matchAll(pattern)].map((match) => ({
    attributes: parseAttributes(match[1] ?? ''),
    text: unwrap(match[2] ?? ''),
  }));
}

function parseAttributes(text) {
  const attributes = {};
  for (const match of text.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/**
 * Parse a feed document.
 * @returns {{ kind: 'rss'|'atom'|null, title: string, entries: FeedEntry[] }}
 * @typedef {{title:string, link:string|null, summary:string, content:string,
 *   published:string|null, updated:string|null, guid:string|null,
 *   categories:string[]}} FeedEntry
 */
export function parseFeed(xml) {
  const text = String(xml ?? '');
  if (!text.trim()) return { kind: null, title: '', entries: [] };

  const isAtom = /<feed[\s>]/i.test(text) && /<entry[\s>]/i.test(text);
  const itemPattern = isAtom
    ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi
    : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;

  const channelTitle = tagText(text.split(isAtom ? /<entry[\s>]/i : /<item[\s>]/i)[0] ?? '', 'title');
  const entries = [];

  for (const match of text.matchAll(itemPattern)) {
    const block = match[1];
    try {
      const entry = isAtom ? parseAtomEntry(block) : parseRssItem(block);
      if (entry.title || entry.link) entries.push(entry);
    } catch {
      // A single malformed entry never invalidates the rest of the feed.
    }
  }

  return { kind: isAtom ? 'atom' : entries.length || /<rss[\s>]/i.test(text) ? 'rss' : null, title: channelTitle, entries };
}

function parseRssItem(block) {
  const link =
    tagText(block, 'link') ||
    tagNodes(block, 'link').find((node) => node.attributes.href)?.attributes.href ||
    tagText(block, 'guid');
  const content = tagText(block, 'encoded') || tagText(block, 'description');
  return {
    title: stripTags(tagText(block, 'title')),
    link: link || null,
    summary: stripTags(tagText(block, 'description')),
    content: stripTags(content),
    published: tagText(block, 'pubDate') || tagText(block, 'date') || null,
    updated: tagText(block, 'updated') || null,
    guid: tagText(block, 'guid') || null,
    categories: tagNodes(block, 'category').map((node) => stripTags(node.text)).filter(Boolean),
  };
}

function parseAtomEntry(block) {
  const links = tagNodes(block, 'link');
  const alternate =
    links.find((node) => node.attributes.rel === 'alternate' && node.attributes.href) ??
    links.find((node) => node.attributes.href);
  return {
    title: stripTags(tagText(block, 'title')),
    link: alternate?.attributes.href ?? null,
    summary: stripTags(tagText(block, 'summary')),
    content: stripTags(tagText(block, 'content') || tagText(block, 'summary')),
    published: tagText(block, 'published') || tagText(block, 'updated') || null,
    updated: tagText(block, 'updated') || null,
    guid: tagText(block, 'id') || null,
    categories: tagNodes(block, 'category')
      .map((node) => node.attributes.term || stripTags(node.text))
      .filter(Boolean),
  };
}

/** True when the payload looks like a feed rather than an error page. */
export function looksLikeFeed(body, contentType = '') {
  if (/xml|rss|atom/i.test(contentType)) return true;
  return /<(rss|feed)[\s>]/i.test(String(body).slice(0, 2000));
}
