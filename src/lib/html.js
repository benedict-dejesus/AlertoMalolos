/**
 * A deliberately small, tolerant HTML reader.
 *
 * It supports the only selector shapes the source registry needs - tag names,
 * `.class`, `#id`, `tag.class`, and comma-separated lists - and it never throws
 * on malformed markup. Sources change their HTML without warning, so the goal
 * is to return nothing rather than to return nonsense.
 */

import { stripTags, decodeEntities } from './sanitize.js';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

/** Parse "div.card, article#main" into matcher descriptors. */
function parseSelector(selector) {
  return String(selector ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const tag = part.match(/^[a-zA-Z][\w-]*/)?.[0]?.toLowerCase() ?? null;
      const classes = [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1].toLowerCase());
      const id = part.match(/#([\w-]+)/)?.[1]?.toLowerCase() ?? null;
      return { tag, classes, id };
    });
}

function attributesOf(tagText) {
  const attributes = {};
  const body = tagText.replace(/^<[a-zA-Z][\w-]*/, '').replace(/\/?>$/, '');
  for (const match of body.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[3] ?? match[4] ?? match[5] ?? '');
  }
  for (const match of body.matchAll(/(?:^|\s)([\w:-]+)(?=\s|$)/g)) {
    if (!(match[1].toLowerCase() in attributes)) attributes[match[1].toLowerCase()] = '';
  }
  return attributes;
}

function matches(descriptor, tag, attributes) {
  if (descriptor.tag && descriptor.tag !== tag) return false;
  if (descriptor.id && (attributes.id ?? '').toLowerCase() !== descriptor.id) return false;
  if (descriptor.classes.length) {
    const classList = (attributes.class ?? '').toLowerCase().split(/\s+/);
    if (!descriptor.classes.every((cls) => classList.includes(cls))) return false;
  }
  return true;
}

/**
 * Find the elements matching `selector`.
 * @returns {{tag:string, attributes:Record<string,string>, html:string, outerHtml:string}[]}
 */
export function selectAll(html, selector, { limit = 200 } = {}) {
  const source = String(html ?? '');
  const descriptors = parseSelector(selector);
  if (!descriptors.length) return [];

  const results = [];
  const openTag = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let match;

  while ((match = openTag.exec(source)) !== null && results.length < limit) {
    const tag = match[1].toLowerCase();
    const attributes = attributesOf(match[0]);
    if (!descriptors.some((descriptor) => matches(descriptor, tag, attributes))) continue;
    if (match[3] === '/' || VOID_ELEMENTS.has(tag)) {
      results.push({ tag, attributes, html: '', outerHtml: match[0] });
      continue;
    }

    const start = openTag.lastIndex;
    const end = findClosingIndex(source, tag, start);
    if (end === -1) continue;
    results.push({
      tag,
      attributes,
      html: source.slice(start, end),
      outerHtml: source.slice(match.index, end + tag.length + 3),
    });
    // Skip past this element so nested matches of the same selector are not
    // reported twice; sibling elements are still found.
    openTag.lastIndex = end;
  }
  return results;
}

export function selectFirst(html, selector) {
  return selectAll(html, selector, { limit: 1 })[0] ?? null;
}

/** Index of the closing tag that balances the element opened before `from`. */
function findClosingIndex(source, tag, from) {
  const pattern = new RegExp(`<(/?)${tag}\\b((?:"[^"]*"|'[^']*'|[^>"'])*?)(/?)>`, 'gi');
  pattern.lastIndex = from;
  let depth = 1;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1] === '/') {
      depth -= 1;
      if (depth === 0) return match.index;
    } else if (match[3] !== '/') {
      depth += 1;
    }
  }
  return -1;
}

/** Plain text of the first element matching `selector`, or ''. */
export function textOf(html, selector) {
  const node = selectFirst(html, selector);
  return node ? stripTags(node.html) : '';
}

/** First href found under `selector`, resolved against `baseUrl` by the caller. */
export function hrefOf(html, selector = 'a') {
  for (const node of selectAll(html, selector, { limit: 10 })) {
    if (node.attributes.href) return node.attributes.href;
    const nested = selectFirst(node.html, 'a');
    if (nested?.attributes.href) return nested.attributes.href;
  }
  const anchor = selectFirst(html, 'a');
  return anchor?.attributes.href ?? null;
}

/** Machine-readable datetime from a <time> element, else its text. */
export function timeOf(html, selector = 'time') {
  const node = selectFirst(html, selector);
  if (!node) return '';
  return node.attributes.datetime || node.attributes.content || stripTags(node.html);
}

/** Content of a <meta> tag by name or property. */
export function metaContent(html, key) {
  for (const node of selectAll(html, 'meta', { limit: 400 })) {
    const attributes = node.attributes;
    if (
      (attributes.property ?? '').toLowerCase() === key.toLowerCase() ||
      (attributes.name ?? '').toLowerCase() === key.toLowerCase()
    ) {
      return attributes.content ?? '';
    }
  }
  // <meta> is a void element, so scan the raw markup too.
  const pattern = new RegExp(`<meta[^>]*(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, 'i');
  const tag = String(html).match(pattern)?.[0];
  return tag ? attributesOf(tag).content ?? '' : '';
}

export { stripTags };
