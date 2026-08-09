#!/usr/bin/env node
/**
 * Report whether retrieval is actually working, and fail when it is not.
 *
 * The update cycle deliberately survives a source being down. This is the other
 * half of that bargain: something has to say so out loud.
 *
 *   node tools/source-health.js                 read the last run's record
 *   node tools/source-health.js --max-failures 6
 *   node tools/source-health.js --live          contact every source now as well
 *
 * Exit 1 when any source is broken, so the hourly run goes red and the owner is
 * told rather than the failure sitting in a log nobody opens.
 */

import { appendFile, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { SOURCES, activeSources } from '../config/sources.js';
import { DEFAULT_MAX_FAILURES, brokenIn, report } from '../src/lib/health.js';
import { retrieveSource } from '../src/pipeline/discover.js';

const { values: args } = parseArgs({
  options: {
    'max-failures': { type: 'string', default: String(DEFAULT_MAX_FAILURES) },
    state: { type: 'string', default: 'data/state.json' },
    live: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  process.stdout.write('Usage: node tools/source-health.js [--max-failures N] [--state path] [--live]\n');
  process.exit(0);
}

const maxFailures = Number.parseInt(args['max-failures'], 10);
if (!Number.isFinite(maxFailures) || maxFailures < 1) {
  process.stderr.write('--max-failures must be a positive whole number.\n');
  process.exit(2);
}

let state = {};
try {
  state = JSON.parse(await readFile(args.state, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  process.stdout.write(`No state at ${args.state} yet; nothing to report.\n`);
  process.exit(0);
}

// A source that needs a token it has not been given is a configuration choice,
// not an outage, so it is not judged here. Nor is one switched off on purpose.
const judged = activeSources(SOURCES, process.env);
const rows = report(judged, state.sources ?? {}, { maxFailures });

// --live contacts every source now. The stored record answers "was retrieval
// working"; this answers "is it working this second", which is what you want
// immediately after changing a URL.
if (args.live) {
  const results = await Promise.all(judged.map((source) => retrieveSource(source, {})));
  for (const result of results) {
    const row = rows.find((entry) => entry.id === result.sourceId);
    if (!row) continue;
    row.live = result.ok ? `ok, ${result.candidates.length} item(s)` : `FAILED: ${result.error?.message}`;
    if (!result.ok && row.status === 'healthy') {
      row.status = 'stale';
      row.detail = `retrieved last run, failing now: ${result.error?.message}`;
    }
    if (result.ok && row.status === 'broken') row.detail += ' (reachable again now)';
  }
}

const mark = { healthy: 'ok    ', stale: 'STALE ', broken: 'BROKEN', unknown: '?     ' };
process.stdout.write(`\nSource health (${rows.length} checked, limit ${maxFailures} failures)\n\n`);
for (const row of rows) {
  process.stdout.write(`  ${mark[row.status]} tier ${row.tier}  ${row.name} (${row.id})\n`);
  process.stdout.write(`         ${row.detail}\n`);
  if (row.lastError) process.stdout.write(`         last error: ${row.lastError.kind} ${row.lastError.status ?? ''} ${row.lastError.message}\n`);
  if (row.live) process.stdout.write(`         live: ${row.live}\n`);
}

const broken = brokenIn(rows);
const stale = rows.filter((row) => row.status === 'stale');
process.stdout.write(
  `\n  ${rows.length - broken.length - stale.length} healthy, ${stale.length} stale, ${broken.length} broken\n\n`
);

// GitHub renders this on the run page, so the state of retrieval is visible
// without opening a log or downloading an artifact.
if (process.env.GITHUB_STEP_SUMMARY) {
  const icon = { healthy: '✅', stale: '⚠️', broken: '❌', unknown: '❔' };
  const lines = [
    '### Source health',
    '',
    '| | Source | Tier | State |',
    '| --- | --- | --- | --- |',
    ...rows.map((row) => `| ${icon[row.status]} | ${row.name} \`${row.id}\` | ${row.tier} | ${row.detail} |`),
    '',
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
}

if (broken.length) {
  process.stderr.write(
    `${broken.length} source(s) broken: ${broken.map((row) => row.id).join(', ')}\n`
      + 'Fix the URL in config/sources.js, or set enabled: false with a disabledReason.\n'
  );
  process.exitCode = 1;
}

// Set the code and let the loop drain rather than calling process.exit(): after
// --live there are still keep-alive sockets open, and tearing the process down
// under them aborts on Windows. A health check that crashes at the finish line
// is exactly the false alarm this tool exists to prevent.
if (args.live) {
  // Node's fetch keeps its connection pool on a global dispatcher, which holds
  // the loop open. Closing it is what lets the process end on its own.
  await globalThis[Symbol.for('undici.globalDispatcher.1')]?.close?.();
}
