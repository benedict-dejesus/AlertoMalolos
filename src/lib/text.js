import { createHash } from 'node:crypto';

/** Collapse whitespace and trim. */
export function squish(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Lowercase, strip accents and punctuation. Everything that matches rules or
 * compares text works on this form so "Sto. Niño" and "Sto Nino" agree.
 */
export function normalize(value) {
  return squish(
    String(value ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[‘’“”]/g, "'")
      .replace(/[^a-z0-9'.,:;()/\- ]+/g, ' ')
  );
}

/** Normalized form with punctuation removed, for title comparison. */
export function normalizeTitle(value) {
  return normalize(value).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'of',
  'on', 'or', 'the', 'to', 'with', 'ang', 'ng', 'sa', 'mga', 'na', 'ay', 'para',
]);

export function tokens(value) {
  return normalizeTitle(value)
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** Jaccard overlap of significant words, 0-1. */
export function tokenSimilarity(a, b) {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Character trigram similarity, 0-1. Catches reworded but identical notices. */
export function trigramSimilarity(a, b) {
  const grams = (value) => {
    const text = ` ${normalizeTitle(value)} `;
    const set = new Set();
    for (let i = 0; i < text.length - 2; i += 1) set.add(text.slice(i, i + 3));
    return set;
  };
  const left = grams(a);
  const right = grams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Combined similarity used by duplicate detection. */
export function textSimilarity(a, b) {
  return Math.max(tokenSimilarity(a, b), trigramSimilarity(a, b) * 0.95);
}

export function sha1(value) {
  return createHash('sha1').update(String(value)).digest('hex');
}

/** Stable content fingerprint: same notice text always yields the same hash. */
export function contentHash(parts) {
  return sha1(parts.map((part) => normalizeTitle(part ?? '')).join('|')).slice(0, 16);
}

/** Readable, stable identifier for a record and its detail page filename. */
export function makeId(sourceId, canonicalKey) {
  return `${sourceId}-${sha1(canonicalKey).slice(0, 10)}`;
}

export function slugify(value, max = 60) {
  return normalizeTitle(value).replace(/\s+/g, '-').slice(0, max).replace(/-+$/, '');
}

export function anyMatch(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

export function countMatches(patterns, text) {
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

export function firstMatch(patterns, text) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/**
 * Cut source text down to a display snippet without altering its wording.
 * Only whole sentences (or a whole trailing clause) are kept, and the ellipsis
 * marks that text was removed.
 */
export function makeSnippet(text, maxChars) {
  const clean = squish(text);
  if (!clean) return '';
  if (clean.length <= maxChars) return clean;

  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean];
  let out = '';
  for (const sentence of sentences) {
    const next = (out + sentence).trimEnd();
    if (next.length > maxChars) break;
    out = `${next} `;
  }
  out = out.trim();

  if (out.length < Math.min(maxChars * 0.4, 80)) {
    // One long sentence: cut at a word boundary instead of mid-word.
    const cut = clean.slice(0, maxChars);
    out = cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\-–]$/, '');
    return `${out}…`;
  }
  return out.length < clean.length ? `${out} …` : out;
}

/** Deterministic 0-1 value from a string. Kept for deterministic per-record variation. */
export function hashUnit(value, salt = '') {
  const digest = sha1(`${salt}:${value}`);
  return parseInt(digest.slice(0, 8), 16) / 0xffffffff;
}
