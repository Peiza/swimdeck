#!/usr/bin/env node
// Local development server: serves web/ and the /api routes.
//
//   node tools/dev-server.js           real data, fetched from Tempus Open from your computer
//   node tools/dev-server.js --mock    invented swimmers, no network needed
//
// Then open http://localhost:8080

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES, fetchOverview, fetchEvent, searchSwimmers } from '../worker/src/tempus.js';
import { mockApi } from './mock.js';

const ROOT = fileURLToPath(new URL('../web/', import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const MOCK = process.argv.includes('--mock');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

const live = {
  search: (base, q) => searchSwimmers(base, { first: q.get('first') || '', last: q.get('last') || '', club: q.get('club') || '' }),
  swimmer: (base, id, q) => fetchOverview(base, id, { from: q.get('from'), to: q.get('to') }),
  event: (base, id, code) => fetchEvent(base, id, code),
};

async function handleApi(url) {
  const impl = MOCK ? mockApi : live;
  const base = SITES[url.searchParams.get('site') || 'se'];
  let m;
  if (url.pathname === '/api/search') return impl.search(base, url.searchParams);
  if ((m = url.pathname.match(/^\/api\/swimmer\/(\d+)$/))) return impl.swimmer(base, m[1], url.searchParams);
  if ((m = url.pathname.match(/^\/api\/swimmer\/(\d+)\/event\/(\d+)$/))) return impl.event(base, m[1], m[2]);
  throw Object.assign(new Error('Not found'), { status: 404 });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      try {
        const data = await handleApi(url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(e.status || 502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      console.log(req.method, url.pathname + url.search, res.statusCode);
      return;
    }
    const path = normalize(join(ROOT, url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
    if (!path.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  })
  .listen(PORT, () => console.log(`SwimDeck on http://localhost:${PORT} (${MOCK ? 'mock data' : 'live Tempus Open data'})`));
