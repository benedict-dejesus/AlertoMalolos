/**
 * Persistence for the board.
 *
 * data/state.json is the internal record and is never served to citizens.
 * public board data is derived from it at build time. Writes are atomic, and a
 * corrupt state file is set aside rather than silently overwritten.
 */

import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { emptyState } from './board.js';

export const STATE_PATH = join('data', 'state.json');

export async function readState(path = STATE_PATH, { logger } = {}) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.board)) {
      throw new Error('state file has no board array');
    }
    return { ...emptyState(), ...parsed };
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger?.info('no existing state; starting a new board');
      return emptyState();
    }
    // Never destroy data we cannot read: keep a copy for inspection.
    const backup = `${path}.corrupt-${Date.now()}`;
    try {
      await copyFile(path, backup);
      logger?.error('state file unreadable; kept a copy', { backup, message: error.message });
    } catch {
      logger?.error('state file unreadable and could not be copied', { message: error.message });
    }
    return emptyState();
  }
}

export async function writeState(state, path = STATE_PATH) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temp, path);
  return path;
}

/**
 * The subset of each record that may leave the building. Internal scores,
 * hashes and lifecycle bookkeeping stay out of anything published.
 */
export function publicRecord(record) {
  return {
    id: record.id,
    title: record.title,
    snippet: record.snippet,
    category: record.category,
    isEmergency: Boolean(record.isEmergency),
    isTranscribed: Boolean(record.isTranscribed),
    isPriority: Boolean(record.isPriority),
    isNew: Boolean(record.isNew),
    isUpdated: record.status === 'updated' && (record.revisions ?? 0) > 0,
    displayState: record.displayState ?? 'archive',
    priorityRank: record.priorityRank ?? null,
    sourceName: record.sourceName,
    sourceType: record.sourceType,
    sourceHomepage: record.sourceHomepage,
    announcementUrl: record.announcementUrl,
    publishedAt: record.publishedAt ?? null,
    publishedAtIsKnown: Boolean(record.publishedAtIsKnown && record.publishedAt),
    firstSeenAt: record.firstSeenAt,
    updatedAt: record.updatedAt,
    alsoReportedBy: (record.alsoReportedBy ?? []).map((entry) => ({
      sourceName: entry.sourceName,
      url: entry.url,
    })),
  };
}

/** Public board payload: what the site is built from. */
export function publicBoard(state) {
  return {
    lastCheckedAt: state.lastCheckedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    count: state.board.length,
    announcements: state.board.map(publicRecord),
  };
}
