/**
 * When does an announcement stop being useful?
 *
 * Expiry is an internal lifecycle decision, never shown to citizens as a claim
 * about the announcement itself. It only controls how long an alert stays on
 * the board. When the text gives an explicit end, that end is used; otherwise a
 * conservative default for the category applies.
 */

import { CATEGORIES, DEFAULT_TTL_HOURS } from '../../config/rules.js';
import { normalize } from '../lib/text.js';
import { addHours, manilaEndOfDay, manilaParts, manilaDate, parseClock } from '../lib/time.js';

const MONTHS =
  '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';

/**
 * @returns {{expiresAt: string, basis: string}}
 */
export function inferExpiry(candidate, category, publishedAt) {
  const reference = publishedAt ?? candidate.discoveredAt ?? new Date().toISOString();
  const text = normalize(`${candidate.title ?? ''}. ${candidate.summary ?? ''} ${candidate.body ?? ''}`);
  const ttlHours = CATEGORIES[category]?.ttlHours ?? DEFAULT_TTL_HOURS;

  // "until further notice" - stays until an official update replaces it, but
  // never forever: the board re-checks and a stale item eventually ages out.
  if (/\buntil further notice\b|\bhanggang sa (mga )?susunod na abiso\b/.test(text)) {
    return {
      expiresAt: addHours(reference, Math.min(24 * 30, Math.max(ttlHours * 3, 24 * 7))),
      basis: 'until-further-notice',
    };
  }

  const dateRange = matchDateRange(text, reference);
  if (dateRange) return dateRange;

  const explicitDate = matchExplicitDate(text, reference);
  if (explicitDate) return explicitDate;

  const relativeDay = matchRelativeDay(text, reference);
  if (relativeDay) return relativeDay;

  const window = matchTimeWindow(text, reference);
  if (window) return window;

  return { expiresAt: addHours(reference, ttlHours), basis: `category-default:${category ?? 'none'}` };
}

/** "from August 9 to August 11" / "August 9-11, 2026" */
function matchDateRange(text, reference) {
  const sameMonth = text.match(new RegExp(`${MONTHS}\\s+(\\d{1,2})\\s*(?:-|to|until|hanggang)\\s*(\\d{1,2})(?:,?\\s*(\\d{4}))?`));
  if (sameMonth) {
    const month = monthIndex(sameMonth[1]);
    const end = Number(sameMonth[3]);
    const year = Number(sameMonth[4] ?? manilaParts(reference).year);
    if (month !== null && validDay(end)) {
      return { expiresAt: manilaEndOfDay(manilaDate(year, month, end, 12)), basis: 'explicit-date-range' };
    }
  }

  const crossMonth = text.match(
    new RegExp(`${MONTHS}\\s+(\\d{1,2})[^.]{0,20}?(?:to|until|hanggang)\\s*${MONTHS}\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`)
  );
  if (crossMonth) {
    const month = monthIndex(crossMonth[3]);
    const day = Number(crossMonth[4]);
    const year = Number(crossMonth[5] ?? manilaParts(reference).year);
    if (month !== null && validDay(day)) {
      return { expiresAt: manilaEndOfDay(manilaDate(year, month, day, 12)), basis: 'explicit-date-range' };
    }
  }
  return null;
}

/** "on August 9, 2026" / "August 9" */
function matchExplicitDate(text, reference) {
  const match = text.match(new RegExp(`${MONTHS}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`));
  if (!match) return null;
  const month = monthIndex(match[1]);
  const day = Number(match[2]);
  if (month === null || !validDay(day)) return null;

  const year = Number(match[3] ?? manilaParts(reference).year);
  const target = manilaDate(year, month, day, 12);
  if (!target) return null;

  // A date more than a week before publication is a reference to the past, not
  // an end date; fall through to the category default instead.
  const daysFromReference = (new Date(target).getTime() - new Date(reference).getTime()) / 86400000;
  if (daysFromReference < -7 || daysFromReference > 120) return null;

  const clock = endTimeOf(text);
  return {
    expiresAt: clock
      ? manilaDate(year, month, day, clock.hour, clock.minute)
      : manilaEndOfDay(target),
    basis: clock ? 'explicit-date-and-time' : 'explicit-date',
  };
}

/** "today" / "tomorrow" / "bukas" relative to the publication day. */
function matchRelativeDay(text, reference) {
  if (/\b(tomorrow|bukas)\b/.test(text)) {
    return { expiresAt: manilaEndOfDay(reference, 1), basis: 'relative-day:tomorrow' };
  }
  if (/\b(today|ngayong araw|this afternoon|mamayang hapon|tonight|ngayong gabi)\b/.test(text)) {
    const clock = endTimeOf(text);
    if (clock) {
      const parts = manilaParts(reference);
      return {
        expiresAt: manilaDate(parts.year, parts.month, parts.day, clock.hour, clock.minute),
        basis: 'relative-day:today-with-time',
      };
    }
    return { expiresAt: manilaEndOfDay(reference), basis: 'relative-day:today' };
  }
  return null;
}

/** "9:00 AM to 5:00 PM" with no date: applies to the publication day. */
function matchTimeWindow(text, reference) {
  const clock = endTimeOf(text);
  if (!clock) return null;
  const parts = manilaParts(reference);
  const candidate = manilaDate(parts.year, parts.month, parts.day, clock.hour, clock.minute);
  if (!candidate) return null;
  const expiresAt =
    new Date(candidate).getTime() <= new Date(reference).getTime()
      ? manilaEndOfDay(reference, 1)
      : candidate;
  return { expiresAt, basis: 'time-window' };
}

/** The later time in "9:00 AM to 5:00 PM", or null. */
function endTimeOf(text) {
  const range = text.match(
    /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|nn)?)\s*(?:-|to|until|hanggang)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|nn)?)/i
  );
  if (!range) return null;
  return parseClock(range[2]);
}

function monthIndex(name) {
  const months = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  ];
  const key = String(name).slice(0, 3).toLowerCase();
  const index = months.indexOf(key);
  return index === -1 ? null : index;
}

function validDay(day) {
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

/** True when the announcement's usefulness has run out. */
export function isExpired(record, now = new Date().toISOString()) {
  if (!record?.expiresAt) return false;
  return new Date(record.expiresAt).getTime() <= new Date(now).getTime();
}
