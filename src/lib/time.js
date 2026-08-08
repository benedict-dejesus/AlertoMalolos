/**
 * Date handling. Sources publish times in Philippine local time, often without
 * a timezone marker, so bare dates are read as Asia/Manila (UTC+8).
 */

export const MANILA_OFFSET_MINUTES = 8 * 60;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

export function nowIso() {
  return new Date().toISOString();
}

export function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Parse a published date from arbitrary source text. Returns an ISO string or
 * null. Never guesses: an unparseable value stays null so callers can decide.
 */
export function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // RFC 822 / ISO 8601 with an explicit offset - Date handles these correctly.
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(raw) || /^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  // Bare ISO date or datetime, e.g. 2026-08-09 or 2026-08-09T14:30:00
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    return manilaDate(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0));
  }

  // "August 9, 2026" / "9 August 2026" with an optional time
  const monthFirst = raw.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  const dayFirst = raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  const match = monthFirst
    ? { month: monthFirst[1], day: monthFirst[2], year: monthFirst[3] }
    : dayFirst
      ? { month: dayFirst[2], day: dayFirst[1], year: dayFirst[3] }
      : null;
  if (match) {
    const month = MONTHS[match.month.toLowerCase()];
    if (month !== undefined) {
      const time = parseClock(raw);
      return manilaDate(+match.year, month, +match.day, time?.hour ?? 0, time?.minute ?? 0);
    }
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

/** Read a clock time such as "9:00 AM" or "17:30" out of text. */
export function parseClock(text) {
  const match = String(text).match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|nn|hrs?)\b/i)
    ?? String(text).match(/\b(\d{1,2}):(\d{2})\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = (match[3] ?? '').toLowerCase().replace(/\./g, '');
  if (meridiem.startsWith('p') && hour < 12) hour += 12;
  if (meridiem.startsWith('a') && hour === 12) hour = 0;
  if (meridiem === 'nn') hour = 12;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Build an ISO instant from Manila wall-clock components. */
export function manilaDate(year, month, day, hour = 0, minute = 0, second = 0) {
  const utc = Date.UTC(year, month, day, hour, minute, second) - MANILA_OFFSET_MINUTES * 60 * 1000;
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Manila calendar parts for an instant. */
export function manilaParts(value) {
  const date = new Date(value);
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MINUTES * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** End of the Manila calendar day that contains `value`, plus `addDays`. */
export function manilaEndOfDay(value, addDays = 0) {
  const parts = manilaParts(value);
  return manilaDate(parts.year, parts.month, parts.day + addDays, 23, 59, 59);
}

export function hoursBetween(from, to) {
  return (new Date(to).getTime() - new Date(from).getTime()) / HOUR_MS;
}

export function addHours(value, hours) {
  return new Date(new Date(value).getTime() + hours * HOUR_MS).toISOString();
}

export function isBefore(a, b) {
  return new Date(a).getTime() < new Date(b).getTime();
}

/** "Aug 9, 2026, 5:00 PM" in Manila time. */
export function formatManila(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: options.dateStyle ?? 'medium',
    timeStyle: options.timeStyle ?? 'short',
    ...options,
  }).format(date);
}

/** "23 minutes ago", "2 hours ago", "yesterday". */
export function relativeTime(value, reference = Date.now()) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((reference - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
