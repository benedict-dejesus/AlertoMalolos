/**
 * Is this candidate a civic announcement, and what kind?
 *
 * The classifier answers with a decision and a reason. Reasons are written into
 * the run log so a maintainer can see exactly why anything was kept or dropped.
 * When the answer is unclear, the answer is "reject".
 */

import {
  ANNOUNCEMENT_SIGNALS,
  CATEGORIES,
  CATEGORY_ORDER,
  DISQUALIFIER_OVERRIDES,
  NEWS_DISQUALIFIERS,
  THRESHOLDS,
} from '../../config/rules.js';
import { anyMatch, countMatches, firstMatch, normalize } from '../lib/text.js';

/**
 * Press releases from provincial offices routinely open with a dateline such as
 * "CITY OF MALOLOS - ...", because Malolos is the provincial capital. A dateline
 * is where a story was written, not who an announcement affects, so it is held
 * apart from the text used for local-relevance matching.
 */
const DATELINE = /^\s*[A-ZÑ][A-ZÑ\s.,'-]{3,40}?\s*[-–—]{1,2}\s+/;

export function splitDateline(text) {
  const raw = String(text ?? '');
  const match = raw.match(DATELINE);
  if (!match) return { dateline: '', body: raw };
  return { dateline: match[0], body: raw.slice(match[0].length) };
}

/** The text the rules run against: title first, then summary and body. */
export function candidateText(candidate) {
  const { body } = splitDateline(candidate.summary || candidate.body || '');
  return normalize([candidate.title, body, candidate.body ?? ''].filter(Boolean).join('. '));
}

/**
 * @returns {{
 *   isAnnouncement: boolean, reason: string, category: string|null,
 *   isEmergency: boolean, signalCount: number, matchedSignal: string|null
 * }}
 */
export function classify(candidate) {
  const text = candidateText(candidate);
  const title = normalize(candidate.title ?? '');

  if (title.length < THRESHOLDS.minTitleLength) {
    return reject('title-too-short', text);
  }
  if (title.length > THRESHOLDS.maxTitleLength) {
    return reject('title-too-long', text);
  }

  const category = detectCategory(text);
  const isEmergency = category === 'emergency' || hasEmergencySignal(text);
  const signalCount = countMatches(ANNOUNCEMENT_SIGNALS, text) + (category ? 2 : 0);

  // Ordinary news, publicity and commentary are rejected outright, unless the
  // same text also carries an emergency or suspension instruction.
  const disqualifier = firstMatch(NEWS_DISQUALIFIERS, text);
  if (disqualifier && !anyMatch(DISQUALIFIER_OVERRIDES, text)) {
    return {
      isAnnouncement: false,
      reason: 'reads-as-news',
      detail: disqualifier,
      category,
      isEmergency: false,
      signalCount,
      matchedSignal: null,
    };
  }

  if (!category && signalCount === 0) {
    return reject('no-announcement-signal', text);
  }

  // An advisory word on its own ("public notice") is not enough. Something in
  // the text has to say what is actually happening to people.
  if (!category && signalCount < 2) {
    return reject('signal-too-weak', text);
  }

  return {
    isAnnouncement: true,
    reason: category ? `category:${category}` : 'announcement-signal',
    category: category ?? 'services',
    isEmergency,
    signalCount,
    matchedSignal: firstMatch(ANNOUNCEMENT_SIGNALS, text),
  };
}

function reject(reason, text) {
  return {
    isAnnouncement: false,
    reason,
    category: detectCategory(text),
    isEmergency: false,
    signalCount: 0,
    matchedSignal: null,
  };
}

/** First matching category in priority order, or null. */
export function detectCategory(text) {
  for (const id of CATEGORY_ORDER) {
    if (anyMatch(CATEGORIES[id].patterns, text)) return id;
  }
  return null;
}

/** All categories the text touches, most important first. */
export function detectCategories(text) {
  return CATEGORY_ORDER.filter((id) => anyMatch(CATEGORIES[id].patterns, text));
}

function hasEmergencySignal(text) {
  if (anyMatch(CATEGORIES.emergency.patterns, text)) return true;
  // A named wind signal or a red rainfall warning is an emergency even when the
  // bulletin is filed under weather.
  return /\bsignal no\.? ?[2-5]\b/.test(text) || /\bred (rainfall )?warning\b/.test(text);
}
