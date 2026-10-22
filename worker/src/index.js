// SwimDeck API – a small, polite proxy in front of Tempus Open.
//
//   GET /api/search?first=&last=&club=        find swimmers
//   GET /api/swimmer/:id?from=YYYY-MM-DD      personal bests (optionally since a date)
//   GET /api/swimmer/:id/event/:code          every swim in one event
//
// Every route accepts ?site=se (default) or ?site=fi.
// Responses are cached at the edge so Tempus sees as few requests as possible.

import { SITES, fetchOverview, fetchEvent, searchSwimmers, nationalRank } from './tempus.js';

const TTL = {
  search: 60 * 60, // 1 h
  swimmer: 30 * 60, // 30 min
  event: 30 * 60,
  rank: 6 * 60 * 60, // 6 h
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);
    if (!cors['Access-Control-Allow-Origin']) return json({ error: 'Origin not allowed' }, 403, {});

    const route = matchRoute(url.pathname);
    if (!route) return json({ error: 'Not found' }, 404, cors);

    const site = url.searchParams.get('site') || 'se';
    const base = SITES[site];
    if (!base) return json({ error: 'Unknown site' }, 400, cors);

    // ?refresh=1 skips the edge cache (used by the app's "update" button).
    const fresh = url.searchParams.get('refresh') === '1';
    const cacheKey = new Request(cacheUrl(url), { method: 'GET' });
    const cache = caches.default;
    if (!fresh) {
      const hit = await cache.match(cacheKey);
      if (hit) return withHeaders(hit, { ...cors, 'X-Cache': 'HIT' });
    }

    try {
      const data = await route.run(base, url.searchParams);
      const res = json(data, 200, { 'Cache-Control': `public, max-age=${TTL[route.kind]}` });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return withHeaders(res, { ...cors, 'X-Cache': 'MISS' });
    } catch (err) {
      const status = err.status || 502;
      return json({ error: err.message || 'Upstream error' }, status, cors);
    }
  },
};

function matchRoute(path) {
  let m;
  if (path === '/api/search') {
    return {
      kind: 'search',
      run: (base, q) => {
        const first = clean(q.get('first'));
        const last = clean(q.get('last'));
        const club = clean(q.get('club'));
        if (!first && !last && !club) throw Object.assign(new Error('Empty search'), { status: 400 });
        return searchSwimmers(base, { first, last, club });
      },
    };
  }
  if (path === '/api/rank') {
    return {
      kind: 'rank',
      run: (base, q) =>
        nationalRank(base, {
          code: Number(q.get('event')),
          sex: q.get('sex') === 'W' ? 'W' : 'M',
          born: Number(q.get('born')),
          from: q.get('from') || '',
          to: q.get('to') || '',
          time: Number(q.get('time')),
        }),
    };
  }
  if ((m = path.match(/^\/api\/swimmer\/(\d{1,9})$/))) {
    const id = m[1];
    return { kind: 'swimmer', run: (base, q) => fetchOverview(base, id, { from: q.get('from'), to: q.get('to') }) };
  }
  if ((m = path.match(/^\/api\/swimmer\/(\d{1,9})\/event\/(\d{1,3})$/))) {
    const [, id, code] = m;
    return { kind: 'event', run: (base) => fetchEvent(base, id, code) };
  }
  return null;
}

const clean = (s) => (s || '').trim().slice(0, 60);

function cacheUrl(url) {
  const u = new URL(url);
  u.searchParams.delete('refresh');
  u.searchParams.sort();
  return u.toString();
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  const ok = allowed.includes('*') || !origin || allowed.includes(origin);
  if (!ok) return {};
  return {
    'Access-Control-Allow-Origin': allowed.includes('*') || !origin ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function withHeaders(res, headers) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
