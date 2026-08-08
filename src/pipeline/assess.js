/**
 * Turn a retrieved candidate into a board record - or reject it.
 *
 * Order of checks follows the editorial questions: is the source official, is
 * the link genuinely that source's, is it an announcement rather than news,
 * does it materially affect Malolos, is it still valid. Any failure ends the
 * assessment; nothing is inferred to fill a gap.
 */

import { SNIPPET, THRESHOLDS } from '../../config/rules.js';
import { isTrustedSource, sourceAuthority } from '../../config/sources.js';
import { canonicalUrl, cleanText, hostOf } from '../lib/sanitize.js';
import { contentHash, makeId, makeSnippet, squish } from '../lib/text.js';
import { nowIso } from '../lib/time.js';
import { classify } from './classify.js';
import { inferExpiry, isExpired } from './expiry.js';
import { scoreCandidate } from './relevance.js';

/**
 * @returns {{ok: true, record: object} | {ok: false, reason: string, detail?: string}}
 */
export function assess(rawCandidate, source, options = {}) {
  const now = options.now ?? nowIso();

  // Strip markup here as well as at retrieval: assessment must not depend on an
  // earlier stage having cleaned the text.
  const candidate = {
    ...rawCandidate,
    title: cleanText(rawCandidate.title, 300),
    summary: cleanText(rawCandidate.summary, 1600),
    body: cleanText(rawCandidate.body, 4000),
  };

  if (!source || !isTrustedSource(source.id, options.sources)) {
    return { ok: false, reason: 'source-not-trusted' };
  }

  const url = canonicalUrl(candidate.announcementUrl);
  if (!url) return { ok: false, reason: 'unusable-link' };
  if (!linkBelongsToSource(url, source)) {
    return { ok: false, reason: 'link-host-mismatch', detail: hostOf(url) ?? '' };
  }

  const classification = classify(candidate);
  if (!classification.isAnnouncement) {
    return { ok: false, reason: classification.reason, detail: classification.detail };
  }

  const publishedAt = candidate.publishedAt ?? null;
  const expiry = inferExpiry(candidate, classification.category, publishedAt ?? now);
  const scores = scoreCandidate({ ...candidate, expiresAt: expiry.expiresAt }, classification, source, now);

  if (scores.relevance < THRESHOLDS.minRelevance) {
    return { ok: false, reason: 'not-locally-relevant', detail: scores.relevanceBasis };
  }
  if (source.requiresExplicitLocalMention && isWeakLocalLink(scores.relevanceBasis)) {
    return { ok: false, reason: 'needs-explicit-local-mention', detail: scores.relevanceBasis };
  }
  if (scores.importance < THRESHOLDS.minImportance) {
    return { ok: false, reason: 'below-importance-threshold', detail: String(scores.importance) };
  }
  if (scores.relevanceBasis === 'nationwide' && scores.importance < THRESHOLDS.minImportanceForNationalScope) {
    return { ok: false, reason: 'national-scope-not-important-enough', detail: String(scores.importance) };
  }
  if (scores.total < THRESHOLDS.minTotal) {
    return { ok: false, reason: 'below-total-threshold', detail: String(scores.total) };
  }
  if (isExpired({ expiresAt: expiry.expiresAt }, now)) {
    return { ok: false, reason: 'already-expired', detail: expiry.basis };
  }

  const snippet = buildSnippet(candidate);
  if (!snippet) return { ok: false, reason: 'no-usable-snippet' };

  // Hash the retained source text rather than the shortened snippet, so a
  // revision that changes wording past the snippet cut is still noticed.
  const sourceExcerpt = squish(candidate.summary || candidate.body || '').slice(0, 1200);
  const hash = contentHash([candidate.title, sourceExcerpt]);
  const record = {
    id: makeId(source.id, candidate.guid || url),
    contentHash: hash,
    canonicalUrl: url,

    title: squish(candidate.title),
    snippet,
    sourceExcerpt,

    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.publicDescription ?? '',
    sourceTier: source.tier,
    sourceAuthority: sourceAuthority(source),
    sourceHomepage: source.homepage,
    announcementUrl: candidate.announcementUrl,

    category: classification.category,
    isEmergency: classification.isEmergency,
    // True when a person recorded the notice from a page that may not be read
    // automatically. The reader is told, so the original post stays the wording
    // of record.
    isTranscribed: Boolean(candidate.transcribed || source.transcribed),

    publishedAt,
    publishedAtIsKnown: Boolean(publishedAt),
    discoveredAt: now,
    firstSeenAt: now,
    lastSeenAt: now,
    updatedAt: now,
    expiresAt: expiry.expiresAt,
    expiryBasis: expiry.basis,

    status: 'active',
    importanceScore: scores.importance,
    relevanceScore: scores.relevance,
    relevanceBasis: scores.relevanceBasis,
    urgencyScore: scores.urgency,
    freshnessScore: scores.freshness,
    totalScore: scores.total,
    priorityRank: null,
    displayState: 'archive',
    revisions: 0,
    alsoReportedBy: [],
  };

  return { ok: true, record };
}

/**
 * A feed can be tampered with, and some sites syndicate third-party posts. A
 * link is only accepted when it stays inside the source's own domain, or on
 * another Philippine government domain.
 */
export function linkBelongsToSource(url, source) {
  // A source may pin the exact shape of its links. Where one is given it is the
  // whole test: a page on facebook.com is only acceptable if it is *this* page.
  if (source.linkPattern) return source.linkPattern.test(url);

  const linkHost = hostOf(url);
  const sourceHost = hostOf(source.homepage) ?? hostOf(source.url);
  if (!linkHost || !sourceHost) return false;
  if (linkHost === sourceHost) return true;
  if (linkHost.endsWith(`.${sourceHost}`) || sourceHost.endsWith(`.${linkHost}`)) return true;
  return /(^|\.)gov\.ph$/.test(linkHost);
}

function isWeakLocalLink(basis) {
  return basis === 'nationwide' || basis === 'no-local-link' || basis === 'source-is-provincial';
}

/**
 * The post-it snippet is source text, shortened at sentence boundaries. Nothing
 * is reworded, summarised or added; the original notice stays authoritative.
 */
export function buildSnippet(candidate) {
  const source = squish(candidate.summary || candidate.body || '');
  if (!source) return '';
  const snippet = makeSnippet(source, SNIPPET.maxChars);
  if (snippet.length < SNIPPET.minChars) {
    // Too little text to say anything useful: show nothing rather than a
    // fragment that could read as a different instruction.
    return snippet.length >= 20 ? snippet : '';
  }
  return snippet;
}
