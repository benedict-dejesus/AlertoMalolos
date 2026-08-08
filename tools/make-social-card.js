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
  wood: [42, 29, 21],
  cork: [192, 142, 85],
  corkDark: [162, 112, 62],
  paper: [255, 203, 51],
  paperEdge: [232, 174, 5],
  ink: [25, 20, 16],
  cream: [243, 230, 213],
  muted: [232, 216, 196],
  pin: [198, 57, 43],
  alertInk: [125, 28, 17],
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
rect(0, 0, WIDTH, HEIGHT, COLOURS.wood);

// cork panel with a speckle, inside a wood frame
const M = 34;
rect(M, M, WIDTH - M * 2, HEIGHT - M * 2, COLOURS.cork);
let seed = 20260808;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
for (let i = 0; i < 3200; i += 1) {
  const x = M + Math.floor(random() * (WIDTH - M * 2));
  const y = M + Math.floor(random() * (HEIGHT - M * 2));
  disc(x, y, random() < 0.3 ? 2 : 1, random() < 0.25 ? COLOURS.cream : COLOURS.corkDark);
}

// the post-it carrying the wordmark
const cardX = 86;
const cardY = 96;
const cardW = WIDTH - cardX * 2;
const cardH = 340;
rect(cardX + 8, cardY + 10, cardW, cardH, [120, 82, 40]);
rect(cardX, cardY, cardW, cardH, COLOURS.paper);
rect(cardX, cardY + cardH - 8, cardW, 8, COLOURS.paperEdge);
disc(cardX + cardW / 2, cardY + 6, 13, COLOURS.pin);
disc(cardX + cardW / 2 - 4, cardY + 2, 4, COLOURS.cream);

// Two-tone wordmark, echoing the masthead on the site.
const wordScale = 11;
const wordmarkWidth = textWidth('ALERTOMALOLOS', wordScale);
const wordmarkX = Math.round((WIDTH - wordmarkWidth) / 2) + 6;
text('ALERTO', wordmarkX, cardY + 92, wordScale, COLOURS.ink);
text('MALOLOS', wordmarkX + textWidth('ALERTO', wordScale), cardY + 92, wordScale, COLOURS.alertInk);

const line = 'IMPORTANT ANNOUNCEMENTS FOR';
const line2 = 'THE CITIZENS OF MALOLOS';
const capScale = 4;
text(line, Math.round((WIDTH - textWidth(line, capScale)) / 2) + 3, cardY + 208, capScale, COLOURS.ink);
text(line2, Math.round((WIDTH - textWidth(line2, capScale)) / 2) + 3, cardY + 254, capScale, COLOURS.ink);

// credit strip on the cork
const credit = 'A CIVIC INFORMATION PROJECT BY BENEDICT DE JESUS';
const creditScale = 3;
text(credit, Math.round((WIDTH - textWidth(credit, creditScale)) / 2) + 2, cardY + cardH + 62, creditScale, COLOURS.cream);

const note = 'NOT THE OFFICIAL WEBSITE OF THE CITY GOVERNMENT OF MALOLOS';
const noteScale = 2;
text(note, Math.round((WIDTH - textWidth(note, noteScale)) / 2) + 1, cardY + cardH + 118, noteScale, COLOURS.muted);

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
