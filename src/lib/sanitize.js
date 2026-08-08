/**
 * Nothing retrieved from an external source is ever rendered as markup.
 * Text is escaped, URLs are validated, and anything that fails validation is
 * dropped rather than repaired.
 */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for insertion into HTML body or attribute context. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

const LINE_SEPARATORS = new RegExp('[\\u2028\\u2029]', 'g');

/** Escape a value for embedding inside a <script type="application/json"> block. */
export function escapeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPARATORS, (char) => `\\u${char.codePointAt(0).toString(16)}`);
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Return an absolute http(s) URL or null. Rejects javascript:, data:, mailto:
 * and anything unparseable, so a malicious source cannot inject a link target.
 */
export function safeUrl(value, base) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw || /^\s*javascript:/i.test(raw)) return null;
  let url;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (!url.hostname || url.hostname.length > 253) return null;
  url.hash = '';
  return url.toString();
}

/** Hostname of a URL without the www prefix, or null. */
export function hostOf(value) {
  const url = safeUrl(value);
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Canonical form of a URL for duplicate detection: lowercase host, no tracking
 * parameters, no trailing slash, no fragment.
 */
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|ref$|source$|share|_ga)/i;

export function canonicalUrl(value) {
  const safe = safeUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.protocol = 'https:';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\?$/, '');
}

/**
 * Strip every tag from retrieved markup and decode entities. Script and style
 * bodies are removed outright so their contents never surface as text.
 */
export function stripTags(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–',
  mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', deg: '°', eacute: 'é', ntilde: 'ñ', Ntilde: 'Ñ',
  bull: '•', laquo: '«', raquo: '»', middot: '·', times: '×',
  trade: '™', copy: '©', reg: '®',
};

export function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+\d?);/gi, (match, name) => NAMED_ENTITIES[name] ?? match);
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]', 'g');

/**
 * Clamp text taken from a source: strip control characters, cap the length and
 * refuse anything that still looks like markup after stripping.
 */
export function cleanText(value, maxLength = 4000) {
  const text = stripTags(value).replace(CONTROL_CHARS, '').trim();
  if (/<\s*(script|iframe|object|embed)/i.test(text)) return '';
  return text.slice(0, maxLength);
}
