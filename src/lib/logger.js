/**
 * Update-cycle logging.
 *
 * Logs are for whoever maintains the board, not for citizens: they record every
 * source contacted, every candidate rejected and why, and every change made to
 * the board. They are written under logs/ and are never published to the site.
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export class RunLogger {
  /**
   * @param {{dir?: string, level?: keyof LEVELS, console?: boolean, runId?: string}} [options]
   */
  constructor(options = {}) {
    this.dir = options.dir ?? 'logs';
    this.level = LEVELS[options.level ?? 'info'];
    this.toConsole = options.console ?? true;
    this.runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, '-');
    this.entries = [];
    this.counters = Object.create(null);
    this.startedAt = Date.now();
  }

  log(level, message, details) {
    const entry = {
      at: new Date().toISOString(),
      level,
      message,
      ...(details === undefined ? {} : { details }),
    };
    this.entries.push(entry);
    if (LEVELS[level] >= this.level && this.toConsole) {
      const suffix = details === undefined ? '' : ` ${formatDetails(details)}`;
      const line = `[${level.toUpperCase()}] ${message}${suffix}`;
      if (level === 'error') process.stderr.write(`${line}\n`);
      else process.stdout.write(`${line}\n`);
    }
    return entry;
  }

  debug(message, details) { return this.log('debug', message, details); }
  info(message, details) { return this.log('info', message, details); }
  warn(message, details) { return this.log('warn', message, details); }
  error(message, details) { return this.log('error', message, details); }

  count(key, amount = 1) {
    this.counters[key] = (this.counters[key] ?? 0) + amount;
    return this.counters[key];
  }

  /** Record why a candidate did not make it onto the board. */
  reject(candidate, reason, detail) {
    this.count(`rejected.${reason}`);
    return this.debug('candidate rejected', {
      reason,
      ...(detail === undefined ? {} : { detail }),
      source: candidate?.sourceId,
      title: (candidate?.title ?? '').slice(0, 120),
      url: candidate?.announcementUrl ?? candidate?.link ?? null,
    });
  }

  summary(extra = {}) {
    return {
      runId: this.runId,
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - this.startedAt,
      counters: { ...this.counters },
      ...extra,
    };
  }

  /** Write the full run to logs/run-<id>.json and append a line to update.log. */
  async persist(extra = {}) {
    const summary = this.summary(extra);
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(
        join(this.dir, `run-${this.runId}.json`),
        `${JSON.stringify({ summary, entries: this.entries }, null, 2)}\n`,
        'utf8'
      );
      await appendFile(join(this.dir, 'update.log'), `${JSON.stringify(summary)}\n`, 'utf8');
    } catch (error) {
      process.stderr.write(`[ERROR] could not write logs: ${error.message}\n`);
    }
    return summary;
  }
}

function formatDetails(details) {
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

/** A logger that records nothing, for tests. */
export function silentLogger() {
  return new RunLogger({ console: false, level: 'error' });
}
