import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSync, cleanList, newToken } from '../src/sync.js';
import worker from '../src/index.js';

function memoryKv() {
  const store = new Map();
  return {
    store,
    get: async (k) => store.get(k)?.value ?? null,
    put: async (k, value, opts) => void store.set(k, { value, opts }),
    delete: async (k) => void store.delete(k),
  };
}

const req = (method, body) => new Request('https://api.example/x', { method, body: body == null ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

test('tokens are long and URL-safe', () => {
  const t = newToken();
  assert.match(t, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(t, newToken());
});

test('cleanList keeps only ids, site and valid para classes', () => {
  const out = cleanList({
    swimmers: [
      { id: 5, site: 'se', name: 'Should be dropped', para: { S: 9, SB: 99, SM: 'x' } },
      { id: 5, site: 'se' }, // duplicate
      { id: 'abc' },
      { id: 7, site: 'fi' },
      { id: 8, site: 'evil' },
    ],
  });
  assert.deepEqual(out, { swimmers: [{ id: 5, site: 'se', para: { S: 9 } }, { id: 7, site: 'fi' }, { id: 8, site: 'se' }] });
  assert.throws(() => cleanList({}), /Missing/);
  assert.throws(() => cleanList({ swimmers: Array.from({ length: 201 }, (_, i) => ({ id: i + 1 })) }), /Too many/);
});

test('create, read, update and delete a synced list', async () => {
  const kv = memoryKv();
  const env = { LISTS: kv };
  const { token, updatedAt } = await handleSync(req('POST', { swimmers: [{ id: 1 }, { id: 2, para: { S: 4 } }] }), env, '/api/sync');
  assert.ok(token && updatedAt);

  // The stored key is a hash, never the token itself, and lists expire.
  const [[key, entry]] = [...kv.store.entries()];
  assert.match(key, /^list:[0-9a-f]{64}$/);
  assert.ok(!key.includes(token));
  assert.ok(entry.opts.expirationTtl > 300 * 86400);

  const got = await handleSync(req('GET'), env, `/api/sync/${token}`);
  assert.deepEqual(got.swimmers, [{ id: 1, site: 'se' }, { id: 2, site: 'se', para: { S: 4 } }]);

  await handleSync(req('PUT', { swimmers: [{ id: 3 }] }), env, `/api/sync/${token}`);
  assert.deepEqual((await handleSync(req('GET'), env, `/api/sync/${token}`)).swimmers, [{ id: 3, site: 'se' }]);

  await handleSync(req('DELETE'), env, `/api/sync/${token}`);
  await assert.rejects(handleSync(req('GET'), env, `/api/sync/${token}`), (e) => e.status === 404);
});

test('unknown or malformed tokens are not found, and PUT cannot create lists', async () => {
  const env = { LISTS: memoryKv() };
  await assert.rejects(handleSync(req('GET'), env, '/api/sync/short'), (e) => e.status === 404);
  await assert.rejects(handleSync(req('PUT', { swimmers: [] }), env, `/api/sync/${newToken()}`), (e) => e.status === 404);
  await assert.rejects(handleSync(req('POST', { swimmers: [] }), {}, '/api/sync'), (e) => e.status === 503);
});

test('worker routes sync with CORS and no caching', async () => {
  const env = { LISTS: memoryKv(), ALLOWED_ORIGINS: 'https://app.example' };
  const r = await worker.fetch(
    new Request('https://api.example/api/sync', { method: 'POST', headers: { Origin: 'https://app.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ swimmers: [{ id: 9 }] }) }),
    env,
    { waitUntil: () => {} },
  );
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const pre = await worker.fetch(new Request('https://api.example/api/sync', { method: 'OPTIONS', headers: { Origin: 'https://app.example' } }), env, {});
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /PUT/);
  const evil = await worker.fetch(new Request('https://api.example/api/sync', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }), env, {});
  assert.equal(evil.status, 403);
});

test('goals are kept when valid and dropped otherwise', () => {
  const out = cleanList({ swimmers: [{ id: 1, goals: { 13: 6550, 44: '7000', 999: 100, 11: -5, x: 3000 } }] });
  assert.deepEqual(out.swimmers[0].goals, { 13: 6550, 44: 7000 });
});
