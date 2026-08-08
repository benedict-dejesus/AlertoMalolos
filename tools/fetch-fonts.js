#!/usr/bin/env node
/**
 * One-off helper: download the four latin font subsets the site self-hosts.
 *
 * Fonts are committed to the repository so the published site makes no external
 * requests at all - no font CDN, no tracking, and no failure mode where the
 * board loads without its typography.
 *
 *   node tools/fetch-fonts.js
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../src/site/assets/fonts/', import.meta.url));

const WANTED = [
  { file: 'plex-sans-400.woff2', family: 'IBM Plex Sans', weight: '400' },
  { file: 'plex-sans-600.woff2', family: 'IBM Plex Sans', weight: '600' },
  { file: 'plex-condensed-700.woff2', family: 'IBM Plex Sans Condensed', weight: '700' },
  { file: 'plex-mono-500.woff2', family: 'IBM Plex Mono', weight: '500' },
];

// A modern browser UA is required for fonts.googleapis.com to serve woff2.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function cssFor(family, weight) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
  const response = await fetch(url, { headers: { 'user-agent': BROWSER_UA } });
  if (!response.ok) throw new Error(`${family} ${weight}: HTTP ${response.status}`);
  return response.text();
}

/** The latin subset is the block whose unicode-range covers U+0000-00FF. */
function latinUrl(css) {
  const blocks = css.split('@font-face').slice(1);
  const latin =
    blocks.find((block) => /unicode-range:[^;]*U\+0000-00FF/i.test(block)) ??
    blocks[blocks.length - 1];
  return latin?.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1] ?? null;
}

await mkdir(OUT, { recursive: true });

for (const { file, family, weight } of WANTED) {
  const css = await cssFor(family, weight);
  const url = latinUrl(css);
  if (!url) throw new Error(`No latin woff2 found for ${family} ${weight}`);
  const response = await fetch(url, { headers: { 'user-agent': BROWSER_UA } });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(file, `file://${OUT.replace(/\\/g, '/')}`), bytes);
  process.stdout.write(`${file}  ${(bytes.length / 1024).toFixed(1)} KB\n`);
}
