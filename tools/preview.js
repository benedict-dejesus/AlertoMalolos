#!/usr/bin/env node
/**
 * Build a preview of the board from sample data, for design and layout checks
 * when no real announcement is active.
 *
 * The sample notices go through the same rules as live ones - they are only
 * accepted if the real classifier accepts them - and every page carries a
 * banner saying the content is sample data. Output goes to .preview/, which is
 * never published.
 *
 *   node tools/preview.js            8 sample notices
 *   node tools/preview.js 21         21 candidates, to see the 20 limit
 *   node tools/preview.js empty      the empty state
 */

import { rm } from 'node:fs/promises';
import { SOURCES, sourceById } from '../config/sources.js';
import { silentLogger } from '../src/lib/logger.js';
import { assess } from '../src/pipeline/assess.js';
import { emptyState, mergeBoard } from '../src/pipeline/board.js';
import { buildSite } from '../src/site/build.js';
import { QUALIFYING, fillerCandidates } from '../test/fixtures/candidates.js';

const OUT = '.preview';
const argument = process.argv[2] ?? '8';
const now = new Date().toISOString();

let candidates = [];
if (argument === 'empty') {
  candidates = [];
} else {
  const wanted = Number(argument) || 8;
  candidates = [...QUALIFYING, ...fillerCandidates(Math.max(0, wanted - QUALIFYING.length))].slice(0, wanted);
}

const accepted = [];
for (const candidate of candidates) {
  const verdict = assess(candidate, sourceById(candidate.sourceId, SOURCES), { now, sources: SOURCES });
  if (verdict.ok) accepted.push(verdict.record);
  else process.stdout.write(`rejected (${verdict.reason}): ${candidate.title}\n`);
}

const { state } = mergeBoard({ state: emptyState(), incoming: accepted, now });

await rm(OUT, { recursive: true, force: true });
const result = await buildSite({ state, outDir: OUT, preview: true, now, logger: silentLogger() });

process.stdout.write(
  `Preview: ${result.announcements} post-it(s), ${result.pages} page(s) in ${OUT}/\n` +
    `Serve it with: node tools/serve.js ${OUT} 4174\n`
);
