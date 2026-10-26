import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorldRecords, fetchWorldRecords, parseMastersAsOf, refreshRecords, getRecords } from '../src/records.js';

const rec = (name, dist, group, time, extra = {}) => ({ eventDisciplineName: name, disciplineDistance: dist, disciplineGroup: group, timeFormatted: time, isRelay: false, ...extra });

test('world records are read per pool and sex, relays skipped', () => {
  const json = { records: [
    rec("Men's 100m Freestyle", 100, 'Freestyle', '46.40'),
    rec("Men's 1500m Freestyle", 1500, 'Freestyle', '14:26.79'),
    rec("Men's 4x100m Freestyle Relay", '4x100', 'Freestyle', '03:08.24', { isRelay: true }),
    rec("Women's 100m Freestyle", 100, 'Freestyle', '51.68'),
  ] };
  assert.deepEqual(parseWorldRecords(json, 'LCM', 'M'), { LM100fr: 4640, LM1500fr: 86679 });
  assert.deepEqual(parseWorldRecords(json, 'LCM', 'W'), { LW100fr: 5168 });
});

test('a half-empty answer never replaces the table', async () => {
  const f = async () => Response.json({ records: [rec("Men's 50m Freestyle", 50, 'Freestyle', '20.88')] });
  await assert.rejects(fetchWorldRecords(f), /Only/);
});

test('masters page date and a daily refresh into KV', async () => {
  assert.equal(parseMastersAsOf('<a>Masters World Records - LCM (as of 01.09.2026)</a> as of 01.08.2026'), '2026-09-01');
  const store = new Map();
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => store.set(k, v) };
  const many = (pool, sex) => ({ records: Array.from({ length: 18 }, (_, i) => rec(`${sex === 'F' ? 'Women' : 'Men'}'s ${50 + i}m Freestyle`, 50 + i, 'Freestyle', `${30 + i}.00`)) });
  const f = async (url) => {
    if (url.includes('/masters/')) return new Response('Masters World Records - SCM (as of 01.10.2026)');
    const u = new URL(url);
    return Response.json(many(u.searchParams.get('pool'), u.searchParams.get('gender')));
  };
  const now = Date.parse('2026-10-26T12:00:00Z');
  const r = await refreshRecords(kv, f, now);
  assert.equal(r.wr, 72);
  assert.equal(r.mastersAsOf, '2026-10-01');
  assert.deepEqual(await refreshRecords(kv, f, now + 3600e3), { skipped: true });
  const out = await getRecords(kv);
  assert.equal(out.mastersAsOf, '2026-10-01');
  assert.equal(out.wr.fetched, '2026-10-26');
});
