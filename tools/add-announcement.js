#!/usr/bin/env node
/**
 * Record a notice from an official page that may not be read automatically -
 * at the moment, the Malolos City Information Office page on Facebook.
 *
 * The entry is written to data/curated.json and then judged by exactly the same
 * rules as every crawled source: it can still be rejected as news, as not
 * locally relevant, or as expired. Nothing is posted just because it was typed
 * in by hand.
 *
 *   npm run add -- \
 *     --url "https://www.facebook.com/MalolosCIOPage/posts/1234567890" \
 *     --title "Suspension of classes on 9 August 2026" \
 *     --text "PAALALA: Suspendido ang klase sa lahat ng antas ..." \
 *     --published "2026-08-08 19:30"
 *
 * Options:
 *   --source <id>   registry id, default malolos-cio-facebook
 *   --file <path>   read --text from a file instead of the command line
 *   --remove <url>  take a recorded notice out again
 *   --list          show what is currently recorded
 *   --check         validate and report the verdict without writing
 *
 * Paste the wording exactly as the office published it. Do not summarise,
 * translate or tidy it: the board shortens text at sentence boundaries by
 * itself, and the original post remains the wording of record.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { SOURCES, sourceById } from '../config/sources.js';
import { assess } from '../src/pipeline/assess.js';
import { safeUrl } from '../src/lib/sanitize.js';
import { squish } from '../src/lib/text.js';
import { formatManila, nowIso, parseDate } from '../src/lib/time.js';

const FILE = 'data/curated.json';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function load() {
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    return Array.isArray(parsed)
      ? { _readme: undefined, announcements: parsed }
      : { ...parsed, announcements: parsed.announcements ?? [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { announcements: [] };
    throw new Error(`${FILE} is not readable: ${error.message}`);
  }
}

async function save(payload) {
  await writeFile(FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function fail(message) {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const store = await load();

/* ---- list ------------------------------------------------------------- */
if (args.list) {
  if (!store.announcements.length) process.stdout.write('Nothing recorded.\n');
  for (const entry of store.announcements) {
    process.stdout.write(
      `\n  ${entry.title}\n  ${entry.url}\n  published ${entry.publishedAt ?? 'unknown'}  ·  added ${entry.addedAt ?? 'unknown'}\n`
    );
  }
  process.exit(0);
}

/* ---- remove ----------------------------------------------------------- */
if (args.remove && args.remove !== true) {
  const before = store.announcements.length;
  store.announcements = store.announcements.filter((entry) => entry.url !== args.remove);
  if (store.announcements.length === before) fail(`No recorded notice with that link.`);
  await save(store);
  process.stdout.write(`Removed. ${store.announcements.length} notice(s) still recorded.\n`);
  process.stdout.write('Run "npm run update" to take it off the board.\n');
  process.exit(0);
}

/* ---- add -------------------------------------------------------------- */
const sourceId = typeof args.source === 'string' ? args.source : 'malolos-cio-facebook';
const source = sourceById(sourceId, SOURCES);
if (!source) fail(`"${sourceId}" is not in the source registry (config/sources.js).`);
if (source.kind !== 'manual') fail(`"${sourceId}" is read automatically; nothing needs recording by hand.`);

const url = safeUrl(typeof args.url === 'string' ? args.url : '');
if (!url) fail('Give the link to the original post with --url.');
if (source.linkPattern && !source.linkPattern.test(url)) {
  fail(`That link does not point at ${source.name}. Expected a post on ${source.homepage}`);
}

const title = squish(typeof args.title === 'string' ? args.title : '');
if (title.length < 12) fail('Give a title of at least 12 characters with --title.');

let text = typeof args.text === 'string' ? args.text : '';
if (typeof args.file === 'string') text = await readFile(args.file, 'utf8');
text = squish(text);
if (text.length < 40) fail('Paste the notice text with --text (or --file), exactly as it was published.');

const publishedAt = args.published ? parseDate(args.published) : null;
if (args.published && !publishedAt) fail(`Could not read "${args.published}" as a date and time.`);
if (!publishedAt) {
  process.stdout.write('\n  Note: no --published given, so the board will say the time was not stated.\n');
}

const entry = {
  id: `${sourceId}-${url.split('/').filter(Boolean).pop()}`,
  sourceId,
  title,
  url,
  text,
  publishedAt,
  addedAt: nowIso(),
};

/* Judge it before writing, so the verdict is visible immediately. */
const verdict = assess(
  {
    sourceId,
    title: entry.title,
    announcementUrl: entry.url,
    summary: entry.text,
    body: entry.text,
    publishedAt: entry.publishedAt,
    guid: entry.id,
    transcribed: true,
  },
  source,
  { sources: SOURCES }
);

process.stdout.write(`\n  ${entry.title}\n  ${entry.url}\n`);
process.stdout.write(`  published: ${entry.publishedAt ? formatManila(entry.publishedAt) : 'not stated'}\n\n`);

if (!verdict.ok) {
  process.stdout.write(`  The rules would reject this: ${verdict.reason}${verdict.detail ? ` (${verdict.detail})` : ''}\n\n`);
  process.stdout.write('  Common reasons and what to do:\n');
  process.stdout.write('    reads-as-news              this is a story or a greeting, not an advisory - leave it off\n');
  process.stdout.write('    not-locally-relevant       name the city or the barangay as the post does\n');
  process.stdout.write('    already-expired            the notice covers a date that has passed\n');
  process.stdout.write('    no-announcement-signal     the text does not say what residents should do\n\n');
  if (!args.force) {
    process.stdout.write('  Nothing was written. Use --force to record it anyway (it still will not be posted\n  unless it passes at update time).\n\n');
    process.exit(2);
  }
} else {
  process.stdout.write(`  Accepted as: ${verdict.record.category}`);
  if (verdict.record.isEmergency) process.stdout.write(' (emergency)');
  process.stdout.write(`, score ${verdict.record.totalScore}\n`);
  process.stdout.write(`  Snippet on the alert:\n    "${verdict.record.snippet}"\n\n`);
}

if (args.check) {
  process.stdout.write('  Checked only; nothing written.\n\n');
  process.exit(0);
}

const existing = store.announcements.findIndex((item) => item.url === entry.url);
if (existing === -1) store.announcements.push(entry);
else store.announcements[existing] = { ...store.announcements[existing], ...entry };

await save(store);
process.stdout.write(
  `  ${existing === -1 ? 'Recorded' : 'Updated'}. ${store.announcements.length} notice(s) in ${FILE}.\n` +
    '  Run "npm run update" to put it on the board.\n\n'
);
