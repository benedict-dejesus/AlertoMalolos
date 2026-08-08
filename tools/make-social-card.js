#!/usr/bin/env node
/**
 * Draw the social preview image (1200x630 PNG).
 *
 * Written from scratch with a stencil bitmap alphabet and a hand-rolled PNG
 * writer so the project keeps its "no dependencies" rule. Run it after changing
 * the wording; the result is committed with the other assets.
 *
 *   node tools/make-social-card.js
 */

import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const WIDTH = 1200;
const HEIGHT = 630;

const COLOURS = {
  bg: [9, 13, 19],
  panel: [18, 27, 38],
  panelLit: [23, 34, 47],
  line: [34, 48, 63],
  amber: [255, 178, 36],
  cyan: [63, 216, 228],
  green: [69, 207, 124],
  slate: [143, 166, 191],
  text: [234, 241, 248],
  dim: [157, 176, 198],
  faint: [109, 129, 153],
  ink: [16, 22, 31],
};

/* A 5x7 stencil alphabet. Enough for the wordmark and two lines of caption. */
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '01100', '01000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  "'": ['01100', '01100', '01000', '00000', '00000', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
};

const pixels = new Uint8Array(WIDTH * HEIGHT * 3);

function put(x, y, colour) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const index = (y * WIDTH + x) * 3;
  pixels[index] = colour[0];
  pixels[index + 1] = colour[1];
  pixels[index + 2] = colour[2];
}

function rect(x, y, w, h, colour) {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) put(column, row, colour);
  }
}

function disc(cx, cy, radius, colour) {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) put(x, y, colour);
    }
  }
}

/** Draw uppercase text; returns the width used. */
function text(value, x, y, scale, colour, tracking = 1) {
  let cursor = x;
  for (const character of value.toUpperCase()) {
    const glyph = GLYPHS[character] ?? GLYPHS[' '];
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if (glyph[row][column] === '1') {
          rect(cursor + column * scale, y + row * scale, scale, scale, colour);
        }
      }
    }
    cursor += (5 + tracking) * scale;
  }
  return cursor - x;
}

function textWidth(value, scale, tracking = 1) {
  return value.length * (5 + tracking) * scale;
}

/* ---- compose ---------------------------------------------------------- */
rect(0, 0, WIDTH, HEIGHT, COLOURS.bg);

// a faint instrument grid, the same one the site uses
for (let x = 0; x < WIDTH; x += 44) rect(x, 0, 1, HEIGHT, [14, 20, 28]);
for (let y = 0; y < HEIGHT; y += 44) rect(0, y, WIDTH, 1, [14, 20, 28]);

// warm glow at the top left, cool at the top right
for (let y = 0; y < 320; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const warm = Math.max(0, 1 - Math.hypot((x - 140) / 620, (y + 40) / 380));
    const cool = Math.max(0, 1 - Math.hypot((x - 1080) / 520, (y + 30) / 330));
    if (warm <= 0 && cool <= 0) continue;
    const index = (y * WIDTH + x) * 3;
    pixels[index] = Math.min(255, pixels[index] + warm * 26 + cool * 4);
    pixels[index + 1] = Math.min(255, pixels[index + 1] + warm * 18 + cool * 16);
    pixels[index + 2] = Math.min(255, pixels[index + 2] + warm * 4 + cool * 20);
  }
}

// the wordmark, two tone
const wordScale = 11;
const wordmarkX = 74;
const wordmarkY = 84;
text('ALERTO', wordmarkX, wordmarkY, wordScale, COLOURS.text);
text('MALOLOS', wordmarkX + textWidth('ALERTO', wordScale), wordmarkY, wordScale, COLOURS.amber);

// the beacon beside it
const beaconX = wordmarkX + textWidth('ALERTOMALOLOS', wordScale) + 34;
disc(beaconX, wordmarkY + 42, 11, COLOURS.green);

// tagline
text('IMPORTANT ANNOUNCEMENTS FOR THE CITIZENS OF MALOLOS', wordmarkX, wordmarkY + 112, 3, COLOURS.dim);

// the hourly cycle bar
const barY = wordmarkY + 156;
rect(wordmarkX, barY, WIDTH - wordmarkX * 2, 4, COLOURS.line);
rect(wordmarkX, barY, Math.round((WIDTH - wordmarkX * 2) * 0.62), 4, COLOURS.amber);

// three ranked alert panels, in the colours the site uses
const panels = [
  { accent: COLOURS.amber, label: 'CLASS AND WORK SUSPENSION', bar: 0.82 },
  { accent: COLOURS.cyan, label: 'WEATHER', bar: 0.6 },
  { accent: COLOURS.slate, label: 'WATER AND POWER', bar: 0.44 },
];
const panelX = 74;
const panelW = WIDTH - panelX * 2;
let panelY = barY + 32;
panels.forEach((panel, index) => {
  const h = 78;
  rect(panelX, panelY, panelW, h, COLOURS.panel);
  rect(panelX, panelY, panelW, 1, COLOURS.line);
  rect(panelX, panelY + h - 1, panelW, 1, COLOURS.line);
  rect(panelX, panelY, 5, h, panel.accent);
  text(String(index + 1).padStart(2, '0'), panelX + 26, panelY + 22, 3, panel.accent);
  text(panel.label, panelX + 70, panelY + 22, 3, COLOURS.faint);
  // two ruled lines standing in for the notice text
  rect(panelX + 26, panelY + 44, Math.round((panelW - 60) * panel.bar), 9, COLOURS.dim);
  rect(panelX + 26, panelY + 60, Math.round((panelW - 60) * panel.bar * 0.55), 7, COLOURS.line);
  panelY += h + 12;
});

// credit and disclaimer
text('A CIVIC PROJECT BY BENEDICT DE JESUS', panelX, HEIGHT - 56, 3, COLOURS.dim);
text('NOT THE OFFICIAL WEBSITE OF THE CITY GOVERNMENT OF MALOLOS', panelX, HEIGHT - 28, 2, COLOURS.faint);

/* ---- encode ----------------------------------------------------------- */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // truecolour
const raw = Buffer.alloc(HEIGHT * (WIDTH * 3 + 1));
for (let y = 0; y < HEIGHT; y += 1) {
  raw[y * (WIDTH * 3 + 1)] = 0; // no filter
  Buffer.from(pixels.buffer, y * WIDTH * 3, WIDTH * 3).copy(raw, y * (WIDTH * 3 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = fileURLToPath(new URL('../src/site/assets/social-card.png', import.meta.url));
await writeFile(out, png);
process.stdout.write(`social-card.png  ${WIDTH}x${HEIGHT}  ${(png.length / 1024).toFixed(1)} KB\n`);
