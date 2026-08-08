/**
 * Duplicate detection.
 *
 * The same advisory is routinely posted by a city office, a provincial page and
 * a national agency on the same day. The board shows it once, credited to the
 * most authoritative source that carries it, with the others recorded as
 * corroborating publishers.
 */

import { MALOLOS_BARANGAYS, THRESHOLDS } from '../../config/rules.js';
import { sourceAuthority } from '../../config/sources.js';
import { normalizeTitle, textSimilarity } from '../lib/text.js';
import { hoursBetween } from '../lib/time.js';

/**
 * Barangays named in a notice. Two water interruption advisories worded almost
 * identically are different announcements when they name different barangays,
 * so places are compared before wording.
 */
export function placesIn(record) {
  const text = normalizeTitle(`${record?.title ?? ''} ${record?.snippet ?? ''} ${record?.sourceExcerpt ?? ''}`);
  return new Set(MALOLOS_BARANGAYS.filter((name) => text.includes(name)));
}

function namesDifferentPlaces(a, b) {
  const left = placesIn(a);
  const right = placesIn(b);
  if (!left.size || !right.size) return false;
  for (const place of left) if (right.has(place)) return false;
  return true;
}

/**
 * Signals compared, in order of confidence:
 *  1. identical canonical URL          - certainly the same page
 *  2. identical content hash           - identical title and summary text
 *  3. same category + same day + same place + high text similarity
 *
 * @returns {{ isDuplicate: boolean, signal: string|null, similarity: number }}
 */
export function compare(a, b) {
  if (!a || !b) return { isDuplicate: false, signal: null, similarity: 0 };

  if (a.canonicalUrl && b.canonicalUrl && a.canonicalUrl === b.canonicalUrl) {
    return { isDuplicate: true, signal: 'canonical-url', similarity: 1 };
  }
  if (a.contentHash && a.contentHash === b.contentHash) {
    return { isDuplicate: true, signal: 'content-hash', similarity: 1 };
  }

  const similarity = Math.max(
    textSimilarity(a.title, b.title),
    textSimilarity(`${a.title} ${a.snippet ?? ''}`, `${b.title} ${b.snippet ?? ''}`) * 0.9
  );

  // Same wording, different barangays: two separate notices, both needed.
  if (namesDifferentPlaces(a, b)) {
    return { isDuplicate: false, signal: 'different-places', similarity };
  }

  const withinWindow =
    !a.publishedAt || !b.publishedAt
      ? true
      : Math.abs(hoursBetween(a.publishedAt, b.publishedAt)) <= THRESHOLDS.duplicateWindowHours;

  if (!withinWindow) return { isDuplicate: false, signal: null, similarity };

  if (similarity >= THRESHOLDS.duplicateSimilarity) {
    return { isDuplicate: true, signal: 'text-similarity', similarity };
  }

  // Corroborating signals let a lower similarity still count: two offices
  // announcing the same suspension for the same day rarely use the same words.
  const sameCategory = a.category && a.category === b.category;
  const sameDay =
    a.publishedAt && b.publishedAt && Math.abs(hoursBetween(a.publishedAt, b.publishedAt)) <= 36;
  const samePlace = (a.relevanceBasis ?? '') === (b.relevanceBasis ?? '');
  const sameEffectiveDate =
    a.expiresAt && b.expiresAt && Math.abs(hoursBetween(a.expiresAt, b.expiresAt)) <= 12;

  if (sameCategory && sameDay && (samePlace || sameEffectiveDate) && similarity >= 0.5) {
    return { isDuplicate: true, signal: 'category-date-similarity', similarity };
  }
  return { isDuplicate: false, signal: null, similarity };
}

/** The record that should own the alert: highest authority, then best score. */
export function preferred(a, b, sourceLookup) {
  const authorityA = sourceAuthority(sourceLookup(a.sourceId));
  const authorityB = sourceAuthority(sourceLookup(b.sourceId));
  if (authorityA !== authorityB) return authorityA > authorityB ? a : b;
  if ((a.totalScore ?? 0) !== (b.totalScore ?? 0)) return (a.totalScore ?? 0) > (b.totalScore ?? 0) ? a : b;
  // Same authority and score: the earlier publication is the original.
  const timeA = new Date(a.publishedAt ?? a.firstSeenAt ?? 0).getTime();
  const timeB = new Date(b.publishedAt ?? b.firstSeenAt ?? 0).getTime();
  return timeA <= timeB ? a : b;
}

/** Merge the loser into the winner: keep one alert, remember both publishers. */
export function mergeInto(winner, loser) {
  const alsoReportedBy = [...(winner.alsoReportedBy ?? [])];
  const seen = new Set([winner.sourceId, ...alsoReportedBy.map((entry) => entry.sourceId)]);

  for (const entry of [{ sourceId: loser.sourceId, sourceName: loser.sourceName, url: loser.announcementUrl }, ...(loser.alsoReportedBy ?? [])]) {
    if (entry.sourceId && !seen.has(entry.sourceId)) {
      alsoReportedBy.push(entry);
      seen.add(entry.sourceId);
    }
  }

  return {
    ...winner,
    alsoReportedBy,
    // Keep the earliest publication and the latest sighting.
    publishedAt: earliest(winner.publishedAt, loser.publishedAt) ?? winner.publishedAt,
    firstSeenAt: earliest(winner.firstSeenAt, loser.firstSeenAt) ?? winner.firstSeenAt,
    lastSeenAt: latest(winner.lastSeenAt, loser.lastSeenAt) ?? winner.lastSeenAt,
    expiresAt: latest(winner.expiresAt, loser.expiresAt) ?? winner.expiresAt,
  };
}

/**
 * Collapse a list of candidates to unique announcements.
 * @returns {{ unique: object[], duplicates: {kept:string, dropped:string, signal:string}[] }}
 */
export function dedupe(records, sourceLookup) {
  const unique = [];
  const duplicates = [];

  for (const record of records) {
    let merged = false;
    for (let index = 0; index < unique.length; index += 1) {
      const result = compare(unique[index], record);
      if (!result.isDuplicate) continue;
      const winner = preferred(unique[index], record, sourceLookup);
      const loser = winner === unique[index] ? record : unique[index];
      unique[index] = mergeInto(winner, loser);
      duplicates.push({ kept: unique[index].id, dropped: loser.id, signal: result.signal });
      merged = true;
      break;
    }
    if (!merged) unique.push(record);
  }
  return { unique, duplicates };
}

function earliest(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

function latest(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
