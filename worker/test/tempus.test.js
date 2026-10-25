// Run with: node --test worker/test
// Fixtures are synthetic but follow the real Tempus Open page shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInertiaPage,
  shapeOverview,
  shapeEvent,
  dedupe,
  fetchOverview,
  fetchEvent,
  searchSwimmers,
  cookieHeader,
} from '../src/tempus.js';
import worker from '../src/index.js';

const swimmer = {
  id: 1001, swimmer_id: 1001, name: 'Test Simmare', first_name: 'Test', last_name: 'Simmare',
  license: 'XX0000', birth_year: '2010', club_name: 'Exempelklubben SK', class_name: 'Man', swim_clubs_label: '',
};

const row = (o) => ({
  id: Math.floor(Math.random() * 1e6), swimmer_id: 1001, swimmer_name: 'Test Simmare', swimmer_birth_year: '2010',
  club_name: 'Exempelklubben SK', competition_name: 'Höstsimiaden', result_date: '2025-10-04', result_time: 3012,
  swim_time: '00:30.12', aqua_points: 400, event_name: '50m Freestyle', pool_type_name: '25 M',
  event_position: 1, event_code: 11, round_type_name: 'Final', ...o,
});

const html = (page) =>
  `<!doctype html><html><body><div id="app" data-page="${JSON.stringify(page)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')}"></div></body></html>`;

const overviewPage = {
  component: 'Swimmer/Show', version: 'v1', url: '/swimmers/1001/swimming',
  props: {
    swimmer,
    results_short: { data: [row({}), row({ event_code: 13, event_name: '100m Freestyle', result_time: 6550, swim_time: '01:05.50' })] },
    results_long: { data: [row({ event_code: 12, pool_type_name: '50 M', result_time: 3150, swim_time: '00:31.50' })] },
    from_date: '2000-01-01', to_date: '2026-10-22',
  },
};

const eventPage = {
  component: 'Swimmer/Event', version: 'v1',
  props: {
    swimmer,
    swim_event: { id: 25, name: '50m Freestyle' },
    pool_type: { pool_type_id: 1, pool_type_name: '25 M' },
    all_results: {
      data: [
        row({ result_time: 3100, swim_time: '00:31.00', result_date: '2025-03-01', competition_name: 'Vårsim' }),
        row({ result_time: 3012, swim_time: '00:30.12', result_date: '2025-10-04', round_type_name: 'Heat' }),
        row({ result_time: 3012, swim_time: '00:30.12', result_date: '2025-10-04', round_type_name: 'Final' }),
        // duplicate stored on the next day
        row({ result_time: 3100, swim_time: '00:31.00', result_date: '2025-03-02', competition_name: 'Vårsim' }),
        row({ result_time: 0, swim_time: 'DSQ' }),
      ],
    },
  },
};

test('parses the Inertia page from HTML, including entities', () => {
  const p = parseInertiaPage(html(overviewPage));
  assert.equal(p.component, 'Swimmer/Show');
  assert.equal(p.props.swimmer.club_name, 'Exempelklubben SK');
});

test('overview gives bests for both pools', () => {
  const o = shapeOverview(overviewPage.props);
  assert.equal(o.swimmer.id, 1001);
  assert.equal(o.swimmer.born, 2010);
  assert.equal(o.bests.length, 3);
  assert.deepEqual(o.bests.map((b) => b.pool), [25, 25, 50]);
  assert.equal(o.bests[0].time, 3012);
});

test('event page is sorted fastest first, deduped, invalid swims dropped', () => {
  const e = shapeEvent(eventPage.props);
  assert.equal(e.pool, 25);
  assert.equal(e.event.code, 11);
  assert.deepEqual(e.results.map((r) => r.time), [3012, 3012, 3100]);
  assert.deepEqual(e.results.map((r) => r.round), ['Heat', 'Final', 'Final']);
});

test('dedupe keeps swims more than a day apart', () => {
  const a = { time: 1, meet: 'X', round: 'F', event: 11, date: '2025-01-01' };
  assert.equal(dedupe([a, { ...a, date: '2025-01-02' }]).length, 1);
  assert.equal(dedupe([a, { ...a, date: '2025-01-05' }]).length, 2);
});

function fakeFetch(routes, log = []) {
  return async (url, init = {}) => {
    log.push({ url, init });
    const key = `${init.method || 'GET'} ${new URL(url).pathname}`;
    const h = routes[key];
    if (!h) return new Response('nope', { status: 404 });
    return h(url, init);
  };
}

test('fetchOverview passes valid dates only', async () => {
  const log = [];
  const f = fakeFetch({ 'GET /swimmers/1001/swimming': () => new Response(html(overviewPage)) }, log);
  await fetchOverview('https://t.example', 1001, { from: '2025-08-01', to: 'bad' }, f);
  assert.equal(log[0].url, 'https://t.example/swimmers/1001/swimming?from_date=2025-08-01');
});

test('fetchEvent maps 404', async () => {
  const f = fakeFetch({});
  await assert.rejects(fetchEvent('https://t.example', 1, 11, f), (e) => e.status === 404);
});

test('search forwards session + XSRF cookies and Inertia version', async () => {
  const log = [];
  const f = fakeFetch(
    {
      'GET /swimmers': () => {
        const h = new Headers();
        h.append('Set-Cookie', 'XSRF-TOKEN=abc%3D; path=/; samesite=lax');
        h.append('Set-Cookie', 'tempus_session=s3cr3t; path=/; httponly');
        return new Response(html({ component: 'Swimmer/Search', version: 'v9', props: { swimmers: { data: [] } } }), { headers: h });
      },
      'POST /swimmers': () =>
        Response.json({ component: 'Swimmer/Search', props: { swimmers: { data: [swimmer], meta: { total: 1 } } } }),
    },
    log,
  );
  const r = await searchSwimmers('https://t.example', { last: 'Simmare' }, f);
  assert.equal(r.total, 1);
  assert.equal(r.swimmers[0].name, 'Test Simmare');
  const post = log[1].init;
  assert.equal(post.headers['X-XSRF-TOKEN'], 'abc=');
  assert.equal(post.headers['X-Inertia-Version'], 'v9');
  assert.match(post.headers.Cookie, /tempus_session=s3cr3t/);
  assert.equal(JSON.parse(post.body).last_name, 'Simmare');
  assert.equal(JSON.parse(post.body).status, '');
  log.length = 0;
  await searchSwimmers('https://t.example', { club: 'Klubben', active: true, sex: 'W', page: 3 }, f).catch(() => {});
  const p2 = log.find((x) => x.init.method === 'POST');
  assert.equal(new URL(p2.url).searchParams.get('page'), '3');
  assert.equal(JSON.parse(p2.init.body).status, '1');
  assert.equal(JSON.parse(p2.init.body).class, '2');
});

test('cookieHeader handles a single combined set-cookie header', () => {
  const res = { headers: { get: () => 'a=1; path=/; expires=Thu, 01 Jan 2030 00:00:00 GMT, b=2; path=/' } };
  assert.equal(cookieHeader(res), 'a=1; b=2');
});

// ---------------------------------------------------------------- worker routing

function withWorkerEnv(fn) {
  const store = new Map();
  globalThis.caches = {
    default: {
      match: async (req) => store.get(req.url)?.clone(),
      put: async (req, res) => store.set(req.url, res),
    },
  };
  return fn(store);
}

const ctx = { waitUntil: (p) => p };
const env = { ALLOWED_ORIGINS: 'https://app.example' };

test('worker: CORS, routing, caching', async () => {
  await withWorkerEnv(async (store) => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(html(overviewPage));
    };
    try {
      const req = (path, origin = 'https://app.example') =>
        new Request('https://api.example' + path, { headers: origin ? { Origin: origin } : {} });

      let r = await worker.fetch(req('/api/swimmer/1001'), env, ctx);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
      assert.equal(r.headers.get('X-Cache'), 'MISS');
      assert.equal((await r.json()).bests.length, 3);

      r = await worker.fetch(req('/api/swimmer/1001'), env, ctx);
      assert.equal(r.headers.get('X-Cache'), 'HIT');
      assert.equal(calls, 1);

      r = await worker.fetch(req('/api/swimmer/1001?refresh=1'), env, ctx);
      assert.equal(r.headers.get('X-Cache'), 'MISS');
      assert.equal(calls, 2);

      r = await worker.fetch(req('/api/swimmer/1001', 'https://evil.example'), env, ctx);
      assert.equal(r.status, 403);

      r = await worker.fetch(req('/api/nothing'), env, ctx);
      assert.equal(r.status, 404);

      r = await worker.fetch(req('/api/search'), env, ctx);
      assert.equal(r.status, 400);

      r = await worker.fetch(req('/api/swimmer/1001?site=xx'), env, ctx);
      assert.equal(r.status, 400);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

test('nationalRank keeps one birth year, pages until past the time', async () => {
  const { nationalRank, statEvent } = await import('../src/tempus.js');
  assert.deepEqual(statEvent(13), { id: 6, pool: 1 });
  assert.deepEqual(statEvent(44), { id: 21, pool: 2 });
  const rowsFor = (page) => {
    // page 1: 100 rows from 5500 upward, alternating birth years 2011/2010; page 2 continues
    const start = (page - 1) * 100;
    return Array.from({ length: 100 }, (_, i) => ({ swimmer_id: start + i, swimmer_birth_year: (start + i) % 2 ? '2010' : '2011', result_time: 5500 + start + i }));
  };
  const bodies = [];
  const f = async (url, init = {}) => {
    if (!init.method) {
      const h = new Headers();
      h.append('Set-Cookie', 'XSRF-TOKEN=t; path=/');
      return new Response(html({ component: 'Statistics/Swimming', version: 'v1', props: {} }), { headers: h });
    }
    bodies.push(JSON.parse(init.body));
    const page = Number(new URL(url).searchParams.get('page') || 1);
    return Response.json({ props: { results: { data: rowsFor(page), meta: { total: 1000, last_page: 10 } } } });
  };
  const r = await nationalRank('https://t.example', { code: 13, sex: 'W', born: 2011, from: '2026-09-01', to: '2027-08-31', time: 5650 }, f);
  // birth year 2011 = even offsets; times below 5650 among them: 5500,5502,…,5648 → 75 faster
  assert.equal(r.rank, 76);
  assert.equal(r.complete, true);
  assert.equal(r.leader, 5500);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].from_age, 15);
  assert.equal(bodies[0].to_age, 16);
  assert.equal(bodies[0].class, '2');
  assert.equal(bodies[0].swim_event, 6);
  const young = await nationalRank('https://t.example', { code: 13, sex: 'M', born: 2016, from: '2026-09-01', to: '2027-08-31', time: 5650 }, f);
  assert.equal(young.available, false);
});

// ---------------------------------------------------------------- sync

function memoryKv() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
}

test('sync: create, read, update, delete; only clean fields stored', async () => {
  const kv = memoryKv();
  const env = { ALLOWED_ORIGINS: 'https://app.example', LISTS: kv };
  const call = (method, path, body) =>
    worker.fetch(new Request('https://api.example' + path, { method, headers: { Origin: 'https://app.example', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, ctx);

  let r = await call('POST', '/api/sync', { swimmers: [{ id: 5, site: 'se', name: 'Should not be stored', para: { S: 9, X: 3 } }, { id: 5 }, { id: -1 }] });
  assert.equal(r.status, 200);
  const { token } = await r.json();
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
  const stored = [...kv.m.values()][0];
  assert.doesNotMatch(stored, /Should not be stored/);
  assert.ok(![...kv.m.keys()][0].includes(token), 'KV key must not contain the token');

  r = await call('GET', '/api/sync/' + token);
  assert.deepEqual((await r.json()).swimmers, [{ id: 5, site: 'se', para: { S: 9 } }]);

  r = await call('PUT', '/api/sync/' + token, { swimmers: [{ id: 7, site: 'fi' }, { id: 5 }] });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/sync/' + token);
  assert.deepEqual((await r.json()).swimmers.map((s) => s.id), [7, 5]);

  r = await call('GET', '/api/sync/' + 'x'.repeat(32));
  assert.equal(r.status, 404);
  r = await call('GET', '/api/sync/short');
  assert.equal(r.status, 404);
  r = await call('PUT', '/api/sync/' + token, { swimmers: Array.from({ length: 201 }, (_, i) => ({ id: i + 1 })) });
  assert.equal(r.status, 400);

  r = await call('DELETE', '/api/sync/' + token);
  assert.equal(r.status, 200);
  r = await call('GET', '/api/sync/' + token);
  assert.equal(r.status, 404);

  r = await worker.fetch(new Request('https://api.example/api/sync', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }), env, ctx);
  assert.equal(r.status, 403);
});

test('fetchMeet finds the meet by name and date, reads every page and sets places per round', async () => {
  const { fetchMeet, placeRows } = await import('../src/tempus.js');
  const row = (id, time, round) => ({ swimmer_id: id, swimmer_name: 'Simmare ' + id, swimmer_birth_year: '2012', club_name: 'Klubb', competition_name: 'Höstsim', result_date: '2026-10-18', result_time: time, swim_time: '', event_name: '100m Frisim', pool_type_name: '25 M', event_code: 13, round_type_name: round });
  const bodies = [];
  const f = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (!init.method) {
      const h = new Headers();
      h.append('Set-Cookie', 'XSRF-TOKEN=t; path=/');
      return new Response(html({ component: 'Competition/Swimming/Index', version: 'v1', props: {} }), { headers: h });
    }
    const body = JSON.parse(init.body);
    bodies.push({ path, body });
    if (path === '/competitions/swimming') {
      return Response.json({ props: { competitions: { data: [
        { id: 9, name: 'Höstsim', competition_date: '2025-10-18', pool_type_name: '25 M' },
        { id: 10, name: 'Höstsim ', competition_date: '2026-10-17', pool_type_name: '25 M' },
      ] } } });
    }
    const pages = { 1: [row(1, 6000, 'Final'), row(2, 6100, 'Final')], 2: [row(3, 6100, 'Final'), row(4, 6200, 'Heat')] };
    return Response.json({ props: { competition: { id: 10, name: 'Höstsim', competition_date: '2026-10-17', pool_type_name: '25 M' }, swim_events: { data: [{ id: 6, name: '100m Frisim' }] }, results: { data: pages[body.page], meta: { total: 4, last_page: 2 } } } });
  };
  const r = await fetchMeet('https://t.example', { name: 'Höstsim', date: '2026-10-18', code: 13, sex: 'W' }, f);
  assert.equal(r.meet.id, 10);
  assert.deepEqual(bodies.slice(1).map((b) => [b.path, b.body.swim_event, b.body.class, b.body.page]), [['/competitions/swimming/10', 6, '2', 1], ['/competitions/swimming/10', 6, '2', 2]]);
  assert.deepEqual(r.results.map((x) => [x.swimmerId, x.place, x.of]), [[1, 1, 3], [2, 2, 3], [3, 2, 3], [4, 1, 1]]);
  assert.equal(r.complete, true);
  await assert.rejects(fetchMeet('https://t.example', { code: 99 }, f), (e) => e.status === 400);
  assert.equal(placeRows([]).length, 0);
  const twice = placeRows([{ swimmerId: 1, time: 3000, round: 'Final' }, { swimmerId: 1, time: 2900, round: 'Final' }, { swimmerId: 2, time: 2950, round: 'Final' }]);
  assert.deepEqual(twice.map((x) => [x.swimmerId, x.time, x.place, x.of, x.swims]), [[1, 2900, 1, 2, 2], [2, 2950, 2, 2, 1]]);
});
