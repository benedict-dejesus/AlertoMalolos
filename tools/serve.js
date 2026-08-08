#!/usr/bin/env node
/**
 * Local preview server for checking the built site. Development only.
 *
 *   node tools/serve.js [directory] [port]
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'public');
const port = Number(process.argv[3] ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let path = join(root, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
  if (!path.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, 'index.html');
  } catch {
    if (!extname(path)) path += '.html';
  }
  try {
    await stat(path);
  } catch {
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    createReadStream(join(root, '404.html')).on('error', () => response.end('Not found')).pipe(response);
    return;
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(response);
}).listen(port, () => {
  process.stdout.write(`Serving ${root} at http://localhost:${port}/\n`);
});
