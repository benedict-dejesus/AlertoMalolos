#!/usr/bin/env node
/**
 * One update cycle.
 *
 *   check sources -> extract candidates -> verify source -> classify ->
 *   score -> infer expiry -> de-duplicate -> merge -> expire -> rank ->
 *   cap at twenty -> write state -> rebuild the site -> write logs
 *
 * The cycle is idempotent: running it twice in a row changes nothing but the
 * "last checked" time. A source that fails is logged and skipped; the board
 * keeps everything it already had.
 */

import { pathToFileURL } from 'node:url';
import { activeSources, SOURCES, sourceById } from '../../config/sources.js';
import { RunLogger } from '../lib/logger.js';
import { nowIso } from '../lib/time.js';
import { assess } from './assess.js';
import { mergeBoard, topThree } from './board.js';
import { discoverAll } from './discover.js';
import { readState, STATE_PATH, writeState } from './store.js';

/**
 * @param {object} [options]
 * @param {object[]} [options.sources] source registry override (tests)
 * @param {string}   [options.statePath]
 * @param {boolean}  [options.dryRun] assess and report, write nothing
 * @param {RunLogger}[options.logger]
 * @param {string}   [options.now]
 * @returns {Promise<{state: object, changes: object, summary: object}>}
 */
export async function runUpdate(options = {}) {
  const {
    sources = SOURCES,
    statePath = STATE_PATH,
    dryRun = false,
    now = nowIso(),
    fetchOptions,
  } = options;
  const logger = options.logger ?? new RunLogger();

  const enabled = activeSources(sources);
  logger.info('update started', { sources: enabled.length, registered: sources.length });

  const previous = await readState(statePath, { logger });
  const { results, candidates } = await discoverAll(enabled, {
    sourceState: previous.sources ?? {},
    logger,
    fetchOptions,
  });

  const succeeded = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  for (const result of failed) {
    logger.count('source.failed');
    logger.error('source unavailable', { source: result.sourceId, ...result.error });
  }
  logger.info('sources checked', {
    ok: succeeded.length,
    failed: failed.length,
    unchanged: succeeded.filter((result) => result.notModified).length,
    candidates: candidates.length,
  });

  if (enabled.length && succeeded.length === 0) {
    // Every source is down. The existing board stays exactly as it is, apart
    // from the lifecycle sweep that time alone dictates.
    logger.error('every source failed; board left as it is');
  }

  // ---- assess every candidate -------------------------------------------
  const accepted = [];
  for (const candidate of candidates) {
    logger.count('candidate.discovered');
    const source = sourceById(candidate.sourceId, sources);
    const verdict = assess(candidate, source, { now, sources });
    if (!verdict.ok) {
      logger.reject(candidate, verdict.reason, verdict.detail);
      continue;
    }
    logger.count('candidate.accepted');
    logger.debug('candidate accepted', {
      id: verdict.record.id,
      source: verdict.record.sourceId,
      category: verdict.record.category,
      total: verdict.record.totalScore,
      title: verdict.record.title.slice(0, 120),
    });
    accepted.push(verdict.record);
  }

  // ---- merge into the board ---------------------------------------------
  // Sources that reported their complete set: anything of theirs that is no
  // longer there has been taken back, not merely paged out of a feed.
  const completeSources = new Map();
  for (const result of results) {
    if (!result.ok || !result.complete) continue;
    completeSources.set(
      result.sourceId,
      new Set(accepted.filter((record) => record.sourceId === result.sourceId).map((record) => record.id))
    );
  }

  const { state, changes } = mergeBoard({
    state: previous,
    incoming: accepted,
    now,
    sourceLookup: (id) => sourceById(id, sources),
    completeSources,
  });

  state.sources = { ...(previous.sources ?? {}) };
  for (const result of results) {
    const entry = state.sources[result.sourceId] ?? { consecutiveFailures: 0 };
    if (result.ok) {
      state.sources[result.sourceId] = {
        ...entry,
        lastSuccessAt: result.fetchedAt,
        consecutiveFailures: 0,
        lastError: null,
        etag: result.validators.etag ?? entry.etag ?? null,
        lastModified: result.validators.lastModified ?? entry.lastModified ?? null,
      };
    } else {
      state.sources[result.sourceId] = {
        ...entry,
        lastFailureAt: result.fetchedAt,
        consecutiveFailures: (entry.consecutiveFailures ?? 0) + 1,
        lastError: result.error,
      };
    }
  }

  const priority = topThree(state.board);
  logger.info('board updated', {
    added: changes.added.length,
    updated: changes.updated.length,
    unchanged: changes.unchanged.length,
    expired: changes.expired.length,
    withdrawn: changes.withdrawn.length,
    evicted: changes.evicted.length,
    duplicates: changes.duplicates.length,
    skippedRetired: changes.skippedRetired.length,
    total: state.board.length,
  });
  logger.info('top three', {
    items: priority.map((record) => ({
      rank: record.priorityRank,
      score: record.totalScore,
      source: record.sourceId,
      title: record.title.slice(0, 100),
    })),
  });

  if (state.board.length > 20) {
    logger.error('board limit breached', { count: state.board.length });
    throw new Error(`Board holds ${state.board.length} post-its; the limit is 20`);
  }

  if (dryRun) {
    logger.info('dry run: nothing written');
  } else {
    await writeState(state, statePath);
    logger.info('state written', { path: statePath });
  }

  const summary = logger.summary({
    sources: results.map((result) => ({
      id: result.sourceId,
      ok: result.ok,
      notModified: result.notModified,
      candidates: result.candidates.length,
      durationMs: result.durationMs,
      error: result.error,
    })),
    board: {
      count: state.board.length,
      topThree: priority.map((record) => ({ id: record.id, rank: record.priorityRank, title: record.title })),
    },
    changes,
  });

  return { state, changes, summary, results };
}

/** CLI entry point. */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const skipBuild = process.argv.includes('--no-build') || dryRun;
  const logger = new RunLogger({ level: process.argv.includes('--verbose') ? 'debug' : 'info' });

  try {
    const { summary, state } = await runUpdate({ dryRun, logger });
    if (!skipBuild) {
      const { buildSite } = await import('../site/build.js');
      await buildSite({ state, logger });
    }
    await logger.persist(summary);
    process.stdout.write(`\nBoard: ${state.board.length} post-it(s). Last checked ${state.lastCheckedAt}.\n`);
  } catch (error) {
    logger.error('update failed', { message: error.message, stack: error.stack });
    await logger.persist({ failed: true, message: error.message });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
