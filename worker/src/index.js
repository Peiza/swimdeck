// SwimDeck API – a small, polite proxy in front of Tempus Open.
//
//   GET /api/search?first=&last=&club=        find swimmers
//   GET /api/swimmer/:id?from=YYYY-MM-DD      personal bests (optionally since a date)
//   GET /api/swimmer/:id/event/:code          every swim in one event
//   GET /api/rank?event=&sex=&born=&from=&to=&time=   place in Sweden by birth year
//   GET /api/meet?id=|name=&date=, code=, sex=    result list for one event at a meet, with places
//   GET /api/para-class?name=&born=&club=           para classes from the national para records
//   GET /api/meets?name=&from=&to=                 competitions to import from
//   GET /api/meet/:id/swimmers?club=               swimmers at a meet (per club, or all on small meets)
//   POST /api/sync, GET|PUT|DELETE /api/sync/:token  sync a list between devices
//   GET /api/push/key, POST|DELETE /api/push          notifications for new personal bests
//   GET /api/records                                  current world records and the latest masters list date
//   scheduled (cron): checks watched swimmers and sends push notifications; refreshes records once a day
//
// Every route accepts ?site=se (default) or ?site=fi.
// Responses are cached at the edge so Tempus sees as few requests as possible.

import { SITES, fetchOverview, fetchEvent, searchSwimmers, nationalCohort, rankIn, fetchMeet, searchMeets, meetSwimmers, paraRecords, paraClassFrom } from './tempus.js';
import { handleSync } from './sync.js';
import { handlePush, runCheck } from './push.js';
import { refreshRecords, getRecords } from './records.js';

const APP_URL = 'https://peiza.github.io/swimdeck/';

const TTL = {
  search: 60 * 60, // 1 h
  swimmer: 30 * 60, // 30 min
  event: 30 * 60,
  rank: 6 * 60 * 60, // 6 h
  meet: 6 * 60 * 60,
  meets: 60 * 60,
  meetSwimmers: 6 * 60 * 60,
  paraClass: 24 * 60 * 60,
};

export default {
  async scheduled(event, env, ctx) {
    if (!env.LISTS) return;
    ctx.waitUntil(refreshRecords(env.LISTS).then((r) => console.log('records', JSON.stringify(r))).catch((e) => console.log('records failed', e.message)));
    ctx.waitUntil(
      runCheck(env, async (id) => {
        const o = await fetchOverview(SITES.se, id);
        return { swimmer: o.swimmer, bests: o.bests };
      }, { appUrl: env.APP_URL || APP_URL }).then((r) => console.log('push check', JSON.stringify(r))),
    );
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!cors['Access-Control-Allow-Origin']) return json({ error: 'Origin not allowed' }, 403, {});

    if (url.pathname === '/api/push' || url.pathname.startsWith('/api/push/')) {
      try {
        const data = await handlePush(request, env, url.pathname);
        return json(data, 200, { ...cors, 'Cache-Control': 'no-store' });
      } catch (err) {
        return json({ error: err.message || 'Error' }, err.status || 500, cors);
      }
    }
    if (url.pathname === '/api/records' && request.method === 'GET') {
      try {
        const data = await getRecords(env.LISTS);
        // first call after a deploy, or the cron has not run for a while: refresh in the background
        if (env.LISTS && (!data.checkedAt || Date.now() - data.checkedAt > 26 * 3600e3)) ctx.waitUntil(refreshRecords(env.LISTS).catch(() => {}));
        delete data.checkedAt;
        return json(data, 200, { ...cors, 'Cache-Control': 'public, max-age=3600' });
      } catch (err) {
        return json({ error: err.message || 'Error' }, 500, cors);
      }
    }
    if (url.pathname === '/api/sync' || url.pathname.startsWith('/api/sync/')) {
      try {
        const data = await handleSync(request, env, url.pathname);
        return json(data, 200, { ...cors, 'Cache-Control': 'no-store' });
      } catch (err) {
        return json({ error: err.message || 'Error' }, err.status || 500, cors);
      }
    }
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);

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
        return searchSwimmers(base, { first, last, club, active: q.get('active') === '1', sex: q.get('sex') || '', page: q.get('page') || 1 });
      },
    };
  }
  if (path === '/api/rank') {
    return {
      kind: 'rank',
      run: async (base, q) => {
        const params = { code: Number(q.get('event')), sex: q.get('sex') === 'W' ? 'W' : 'M', born: Number(q.get('born')), from: q.get('from') || '', to: q.get('to') || '' };
        return rankIn(await cachedCohort(base, params), Number(q.get('time')));
      },
    };
  }
  if (path === '/api/para-class') {
    return {
      kind: 'paraClass',
      run: async (base, q) => paraClassFrom(await cachedParaRecords(base), { name: clean(q.get('name')), born: Number(q.get('born')) || null, club: clean(q.get('club')) }),
    };
  }
  if (path === '/api/meets') {
    return { kind: 'meets', run: (base, q) => searchMeets(base, { name: clean(q.get('name')), from: q.get('from') || '', to: q.get('to') || '', page: q.get('page') || 1 }) };
  }
  if ((m = path.match(/^\/api\/meet\/(\d{1,9})\/swimmers$/))) {
    const id = m[1];
    return { kind: 'meetSwimmers', run: (base, q) => meetSwimmers(base, id, { club: (q.get('club') || '').slice(0, 10) }) };
  }
  if (path === '/api/meet') {
    return {
      kind: 'meet',
      run: (base, q) => fetchMeet(base, { id: q.get('id'), name: clean(q.get('name')), date: q.get('date') || '', code: q.get('code'), sex: q.get('sex') || '' }),
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

/** The national para records change rarely; read them once a week and share them between all lookups. */
async function cachedParaRecords(base) {
  const key = new Request(`https://cache.swimdeck.invalid/para-records?base=${encodeURIComponent(base)}`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache && (await cache.match(key));
  if (hit) return hit.json();
  const data = await paraRecords(base);
  if (cache) await cache.put(key, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800' } }));
  return data;
}

/** The national cohort (one birth year, event, period) is cached on its own, so every swimmer and time shares it. */
async function cachedCohort(base, params) {
  const key = new Request(`https://cache.swimdeck.invalid/cohort?${new URLSearchParams({ base, ...params })}`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache && (await cache.match(key));
  if (hit) return hit.json();
  const data = await nationalCohort(base, params);
  if (cache) await cache.put(key, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL.rank}` } }));
  return data;
}

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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
