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
