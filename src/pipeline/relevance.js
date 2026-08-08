/**
 * Scoring: does this materially affect Malolos, how much does it matter, and
 * how urgent is it? Ranking is citizen impact x urgency x relevance x freshness,
 * never publication time on its own.
 */

import {
  BULACAN_TERMS,
  CATEGORIES,
  DEFAULT_TTL_HOURS,
  MALOLOS_BARANGAYS,
  MALOLOS_TERMS,
  NATIONAL_TERMS,
  REGIONAL_TERMS,
  RELEVANCE_SCORES,
  SCALE_SIGNALS,
  SCORE_WEIGHTS,
  URGENCY_SIGNALS,
} from '../../config/rules.js';
import { sourceAuthority } from '../../config/sources.js';
import { anyMatch, countMatches, normalize } from '../lib/text.js';
import { hoursBetween } from '../lib/time.js';
import { splitDateline } from './classify.js';

const BARANGAY_PATTERNS = MALOLOS_BARANGAYS.map(
  (name) => new RegExp(`\\b(barangay|brgy\\.?|bgy\\.?)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
);

/**
 * Geographic relevance, 0-100, with the reason it was awarded.
 * @returns {{score:number, basis:string, matched:string|null}}
 */
export function scoreRelevance(candidate, source) {
  const title = normalize(candidate.title ?? '');
  const { dateline, body } = splitDateline(candidate.summary || candidate.body || '');
  const bodyText = normalize(body);
  const datelineText = normalize(dateline);
  const text = `${title}. ${bodyText}`;

  if (anyMatch(MALOLOS_TERMS, text) || anyMatch(BARANGAY_PATTERNS, text)) {
    const basis = anyMatch(MALOLOS_TERMS, title) ? 'malolos-in-title' : 'malolos-in-text';
    return {
      score: anyMatch(BARANGAY_PATTERNS, text) ? RELEVANCE_SCORES.barangayNamed : RELEVANCE_SCORES.malolosNamed,
      basis,
      matched: 'malolos',
    };
  }

  // Malolos named only in a press-release dateline: that is where the release
  // was written, not evidence that Malolos residents are affected.
  const datelineOnly = anyMatch(MALOLOS_TERMS, datelineText);

  if (anyMatch(BULACAN_TERMS, text)) {
    return {
      score: RELEVANCE_SCORES.bulacanNamed,
      basis: datelineOnly ? 'bulacan-named-dateline-ignored' : 'bulacan-named',
      matched: 'bulacan',
    };
  }
  if (anyMatch(REGIONAL_TERMS, text)) {
    return { score: RELEVANCE_SCORES.regionalNamed, basis: 'central-luzon-named', matched: 'region-iii' };
  }
  if (anyMatch(NATIONAL_TERMS, text)) {
    return { score: RELEVANCE_SCORES.nationalNamed, basis: 'nationwide', matched: 'national' };
  }
  // A source that only ever publishes about Malolos carries its own relevance.
  if (source?.scope === 'malolos') {
    return { score: RELEVANCE_SCORES.malolosNamed - 8, basis: 'source-is-malolos-only', matched: 'source-scope' };
  }
  if (source?.scope === 'bulacan') {
    return { score: RELEVANCE_SCORES.bulacanNamed - 20, basis: 'source-is-provincial', matched: 'source-scope' };
  }
  return { score: RELEVANCE_SCORES.none, basis: 'no-local-link', matched: null };
}

/** Civic importance, 0-100. */
export function scoreImportance(candidate, classification, source) {
  const text = normalize(`${candidate.title ?? ''}. ${candidate.summary ?? ''} ${candidate.body ?? ''}`);
  const category = CATEGORIES[classification.category] ?? null;

  let score = category ? category.weight : 50;
  score += Math.min(10, countMatches(SCALE_SIGNALS, text) * 5);
  if (classification.isEmergency) score = Math.max(score, 92);
  if (sourceAuthority(source) >= 92) score += 4;
  else if (sourceAuthority(source) >= 78) score += 2;
  return clamp(score);
}

/** How much the timing matters right now, 0-100. */
export function scoreUrgency(candidate, classification, now = new Date().toISOString()) {
  const text = normalize(`${candidate.title ?? ''}. ${candidate.summary ?? ''} ${candidate.body ?? ''}`);
  let score = 20 + Math.min(36, countMatches(URGENCY_SIGNALS, text) * 12);

  if (candidate.expiresAt) {
    const hoursLeft = hoursBetween(now, candidate.expiresAt);
    if (hoursLeft <= 0) score -= 40;
    else if (hoursLeft <= 24) score += 34;
    else if (hoursLeft <= 72) score += 20;
    else if (hoursLeft <= 24 * 7) score += 8;
  }
  if (classification.isEmergency) score += 22;
  if (classification.category === 'suspension') score += 14;
  return clamp(score);
}

/** Decay with age, scaled to how long this kind of notice stays useful. */
export function scoreFreshness(publishedAt, category, now = new Date().toISOString()) {
  if (!publishedAt) return 45;
  const ageHours = Math.max(0, hoursBetween(publishedAt, now));
  const ttl = CATEGORIES[category]?.ttlHours ?? DEFAULT_TTL_HOURS;
  return clamp(Math.round(100 * Math.exp(-ageHours / Math.max(6, ttl * 0.6))));
}

/**
 * Final ranking score, 0-100.
 * @returns {{total:number, importance:number, relevance:number, urgency:number, freshness:number}}
 */
export function scoreCandidate(candidate, classification, source, now = new Date().toISOString()) {
  const relevance = scoreRelevance(candidate, source);
  const importance = scoreImportance(candidate, classification, source);
  const urgency = scoreUrgency(candidate, classification, now);
  const freshness = scoreFreshness(candidate.publishedAt, classification.category, now);

  let total =
    importance * SCORE_WEIGHTS.importance +
    relevance.score * SCORE_WEIGHTS.relevance +
    urgency * SCORE_WEIGHTS.urgency +
    freshness * SCORE_WEIGHTS.freshness;

  // An active emergency outranks routine notices even as it ages, but the score
  // still comes from the source's own wording - nothing is escalated for us.
  if (classification.isEmergency) total += 8;

  return {
    total: clamp(Math.round(total)),
    importance,
    relevance: relevance.score,
    relevanceBasis: relevance.basis,
    urgency,
    freshness,
  };
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
