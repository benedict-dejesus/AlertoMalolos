/**
 * The board itself: lifecycle, ranking, the top three, and the hard limit of
 * twenty post-its.
 *
 * `mergeBoard` is pure and idempotent. Running it twice with the same inputs
 * produces the same board, the same order and no duplicate post-its.
 */

import { BOARD_LIMITS } from '../../config/rules.js';
import { sourceById } from '../../config/sources.js';
import { nowIso } from '../lib/time.js';
import { compare, dedupe, mergeInto, preferred } from './dedupe.js';
import { isExpired } from './expiry.js';
import { scoreCandidate } from './relevance.js';

export const LIFECYCLE = ['discovered', 'verified', 'active', 'updated', 'expired', 'archived', 'rejected'];

/** How long an expired announcement is remembered so it is not re-posted. */
const RETIRED_MEMORY = 400;

export function emptyState() {
  return {
    version: 1,
    lastUpdatedAt: null,
    lastCheckedAt: null,
    board: [],
    retired: [],
    sources: {},
  };
}

/**
 * @param {object} options
 * @param {object} options.state    previous state (never mutated)
 * @param {object[]} options.incoming assessed records from this cycle
 * @param {string} [options.now]
 * @param {(id:string)=>object} [options.sourceLookup]
 * @returns {{state: object, changes: object}}
 */
export function mergeBoard({
  state,
  incoming,
  now = nowIso(),
  sourceLookup = (id) => sourceById(id),
  completeSources = new Map(),
}) {
  const previous = state ?? emptyState();
  const changes = {
    added: [], updated: [], unchanged: [], expired: [], evicted: [],
    duplicates: [], skippedRetired: [], withdrawn: [],
  };

  const retired = new Map((previous.retired ?? []).map((entry) => [entry.id, entry]));
  const board = (previous.board ?? []).map((record) => ({ ...record }));

  // 1. Collapse duplicates inside this cycle's own harvest.
  const { unique, duplicates } = dedupe(incoming, sourceLookup);
  changes.duplicates.push(...duplicates.map((entry) => ({ ...entry, stage: 'incoming' })));

  // 2. Merge each new record against what is already pinned up.
  for (const candidate of unique) {
    const retiredEntry = retired.get(candidate.id);
    if (retiredEntry && retiredEntry.contentHash === candidate.contentHash) {
      changes.skippedRetired.push({ id: candidate.id, reason: 'expired-and-unchanged' });
      continue;
    }

    const index = findMatch(board, candidate);
    if (index === -1) {
      board.push({ ...candidate, status: 'active', firstSeenAt: candidate.firstSeenAt ?? now, lastSeenAt: now });
      changes.added.push({ id: candidate.id, title: candidate.title, source: candidate.sourceId });
      retired.delete(candidate.id);
      continue;
    }

    const existing = board[index];
    const contentChanged = existing.contentHash !== candidate.contentHash;
    const winner = preferred(existing, candidate, sourceLookup);
    const loser = winner === existing ? candidate : existing;

    // Keep the post-it's own history: it stays the same post-it even when a
    // more authoritative source takes it over or the wording is revised.
    const merged = mergeInto(
      {
        ...winner,
        id: existing.id,
        firstSeenAt: existing.firstSeenAt,
        discoveredAt: existing.discoveredAt,
        revisions: (existing.revisions ?? 0) + (contentChanged ? 1 : 0),
        updatedAt: contentChanged ? now : existing.updatedAt,
        status: contentChanged ? 'updated' : existing.status === 'updated' ? 'updated' : 'active',
        lastSeenAt: now,
      },
      loser
    );

    board[index] = merged;
    if (contentChanged) {
      changes.updated.push({ id: merged.id, title: merged.title, revisions: merged.revisions });
    } else {
      changes.unchanged.push({ id: merged.id });
    }
  }

  // 3. Retire anything whose usefulness has run out, or that its source has
  //    taken back.
  const surviving = [];
  for (const record of board) {
    if (wasWithdrawn(record, completeSources)) {
      changes.withdrawn.push({ id: record.id, title: record.title, source: record.sourceId });
      retired.set(record.id, {
        id: record.id,
        contentHash: record.contentHash,
        retiredAt: now,
        reason: 'withdrawn-by-source',
      });
      continue;
    }
    if (isExpired(record, now)) {
      changes.expired.push({ id: record.id, title: record.title, expiresAt: record.expiresAt });
      retired.set(record.id, {
        id: record.id,
        contentHash: record.contentHash,
        retiredAt: now,
        reason: 'expired',
      });
      continue;
    }
    surviving.push(record);
  }

  // 4. Re-score what remains: urgency and freshness move with the clock.
  const rescored = surviving.map((record) => rescore(record, now, sourceLookup));

  // 5. Rank, then enforce the twenty post-it limit.
  const ranked = rank(rescored);
  const { kept, evicted } = enforceLimit(ranked, BOARD_LIMITS.maxPostIts);
  for (const record of evicted) {
    changes.evicted.push({ id: record.id, title: record.title, totalScore: record.totalScore });
    retired.set(record.id, {
      id: record.id,
      contentHash: record.contentHash,
      retiredAt: now,
      reason: 'board-full',
    });
  }

  const finalBoard = assignDisplayState(kept, now);

  return {
    state: {
      ...previous,
      version: 1,
      lastCheckedAt: now,
      lastUpdatedAt:
        changes.added.length || changes.updated.length || changes.expired.length || changes.evicted.length
          ? now
          : previous.lastUpdatedAt ?? now,
      board: finalBoard,
      retired: [...retired.values()]
        .sort((a, b) => new Date(b.retiredAt) - new Date(a.retiredAt))
        .slice(0, RETIRED_MEMORY),
      sources: previous.sources ?? {},
    },
    changes,
  };
}

/**
 * True when a source that reports its complete set no longer carries this
 * notice. A post-it corroborated by another office stays up: only that office's
 * own credit would be withdrawn, and the advisory itself still stands.
 */
function wasWithdrawn(record, completeSources) {
  const present = completeSources.get(record.sourceId);
  if (!present) return false;
  if (present.has(record.id)) return false;
  return (record.alsoReportedBy ?? []).length === 0;
}

/** Existing post-it representing the same announcement, or -1. */
function findMatch(board, candidate) {
  const byId = board.findIndex((record) => record.id === candidate.id);
  if (byId !== -1) return byId;
  return board.findIndex((record) => compare(record, candidate).isDuplicate);
}

/** Recompute the time-sensitive parts of the score. */
export function rescore(record, now, sourceLookup = (id) => sourceById(id)) {
  const source = sourceLookup(record.sourceId);
  const scores = scoreCandidate(
    {
      title: record.title,
      summary: record.sourceExcerpt ?? record.snippet,
      body: '',
      publishedAt: record.publishedAt ?? record.firstSeenAt,
      expiresAt: record.expiresAt,
    },
    { category: record.category, isEmergency: record.isEmergency },
    source,
    now
  );
  return {
    ...record,
    // Relevance and importance are properties of the announcement, not of the
    // clock, so the values decided at assessment time are kept.
    urgencyScore: scores.urgency,
    freshnessScore: scores.freshness,
    totalScore: Math.round(
      record.importanceScore * 0.35 +
        record.relevanceScore * 0.3 +
        scores.urgency * 0.2 +
        scores.freshness * 0.15 +
        (record.isEmergency ? 8 : 0)
    ),
  };
}

/** Deterministic ordering: score, then most recent publication, then id. */
export function rank(records) {
  return [...records]
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      const timeA = new Date(a.publishedAt ?? a.firstSeenAt ?? 0).getTime();
      const timeB = new Date(b.publishedAt ?? b.firstSeenAt ?? 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return a.id.localeCompare(b.id);
    })
    .map((record, index) => ({ ...record, priorityRank: index + 1 }));
}

/**
 * Trim to the limit. Emergencies and high-scoring notices are protected; among
 * the rest, the lowest-scoring go first and the oldest breaks a tie - so an
 * older but still important advisory outlives a newer trivial one.
 */
export function enforceLimit(ranked, max = BOARD_LIMITS.maxPostIts) {
  if (ranked.length <= max) return { kept: ranked, evicted: [] };

  const evictionOrder = [...ranked].sort((a, b) => {
    const protectedA = isProtected(a) ? 1 : 0;
    const protectedB = isProtected(b) ? 1 : 0;
    if (protectedA !== protectedB) return protectedA - protectedB;
    if (a.totalScore !== b.totalScore) return a.totalScore - b.totalScore;
    const timeA = new Date(a.publishedAt ?? a.firstSeenAt ?? 0).getTime();
    const timeB = new Date(b.publishedAt ?? b.firstSeenAt ?? 0).getTime();
    return timeA - timeB;
  });

  const evicted = evictionOrder.slice(0, ranked.length - max);
  const evictedIds = new Set(evicted.map((record) => record.id));
  const kept = ranked.filter((record) => !evictedIds.has(record.id));
  return { kept: rank(kept), evicted };
}

function isProtected(record) {
  return record.isEmergency || record.totalScore >= BOARD_LIMITS.protectedScore;
}

/**
 * Visual state. The top three are the priority postings; anything first seen in
 * the last day is recent; everything else is the active archive. Colour follows
 * this state and never changes on its own between updates.
 */
export function assignDisplayState(ranked, now = nowIso()) {
  const dayAgo = new Date(now).getTime() - 24 * 60 * 60 * 1000;
  return ranked.map((record, index) => {
    const isPriority = index < BOARD_LIMITS.priorityCount;
    const isRecent = new Date(record.firstSeenAt ?? record.discoveredAt ?? 0).getTime() >= dayAgo;
    return {
      ...record,
      priorityRank: index + 1,
      isPriority,
      isNew: isRecent,
      displayState: isPriority ? 'priority' : isRecent ? 'recent' : 'archive',
    };
  });
}

/** The three announcements the board is currently leading with. */
export function topThree(board) {
  return board.filter((record) => record.isPriority).slice(0, BOARD_LIMITS.priorityCount);
}
