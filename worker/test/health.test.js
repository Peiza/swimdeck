import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordHealth } from '../src/index.js';

function kv() {
  const m = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => void m.set(k, v) };
}

test('health: ok while some lookups work, broken when all fail, since is kept', async () => {
  const k = kv();
  assert.equal(await recordHealth(k, { swimmers: 0, failed: 0 }), null);
  assert.equal((await recordHealth(k, { swimmers: 5, failed: 1 })).ok, true);
  const bad = await recordHealth(k, { swimmers: 5, failed: 5 });
  assert.equal(bad.ok, false);
  const again = await recordHealth(k, { swimmers: 4, failed: 4 });
  assert.equal(again.since, bad.since);
  assert.equal((await recordHealth(k, { swimmers: 3, failed: 0 })).since, undefined);
});
