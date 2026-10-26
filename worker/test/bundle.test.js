import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swimmerBundle } from '../src/index.js';

function memCache() {
  const m = new Map();
  return {
    keys: m,
    match: async (req) => m.get(req.url)?.clone(),
    put: async (req, res) => void m.set(req.url, res),
  };
}
const ctx = { waitUntil: (p) => p };

test('bundle returns each range in order and caches each under its own single-request key', async () => {
  const cache = memCache();
  const calls = [];
  const fetchFn = async (base, id, r) => (calls.push(r), { id, ...r });
  const url = new URL('https://api.example/api/swimmer/7/bundle?site=se&r=_&r=2026-01-01_2026-06-30&r=2025-07-01_');
  const out = await swimmerBundle(url, '7', 'https://x', ctx, { cache, fetchFn });
  assert.deepEqual(out.map((o) => [o.from, o.to]), [[null, null], ['2026-01-01', '2026-06-30'], ['2025-07-01', null]]);
  assert.ok(cache.keys.has('https://api.example/api/swimmer/7?from=2026-01-01&site=se&to=2026-06-30'));
  assert.ok(cache.keys.has('https://api.example/api/swimmer/7?site=se'));
  await swimmerBundle(url, '7', 'https://x', ctx, { cache, fetchFn });
  assert.equal(calls.length, 3, 'second call is served from the cache');
});

test('a failing range gives an error in its place; bad input is refused', async () => {
  const fetchFn = async (b, id, r) => {
    if (r.from) throw new Error('boom');
    return { ok: 1 };
  };
  const url = new URL('https://api.example/api/swimmer/7/bundle?r=_&r=2026-01-01_&r=x_y');
  const out = await swimmerBundle(url, '7', 'b', ctx, { cache: memCache(), fetchFn });
  assert.deepEqual(out, [{ ok: 1 }, { error: 'boom' }, { error: 'Bad range' }]);
  await assert.rejects(swimmerBundle(new URL('https://a/api/swimmer/7/bundle'), '7', 'b', ctx, { cache: memCache(), fetchFn }));
});
