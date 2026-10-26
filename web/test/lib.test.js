import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventInfo, eventLabel, fmtTime, fmtDiff, seasonStart, periodRange, summarize, progression, parseTempusRef, rankings, shortNames,
} from '../lib.js';

test('event codes: odd 25 m, even 50 m', () => {
  assert.deepEqual(eventInfo(11), { code: 11, dist: 50, stroke: 'free', pool: 25 });
  assert.deepEqual(eventInfo(54), { code: 54, dist: 100, stroke: 'fly', pool: 50 });
  assert.equal(eventInfo(4).dist, 25);
  assert.equal(eventLabel(43, 'sv'), '100 m ryggsim');
  assert.equal(eventLabel(43, 'fi'), '100 m selkäuinti');
  assert.equal(eventLabel(999, 'en', '50m Fjärilsim'), '50 m butterfly');
});

test('time formatting', () => {
  assert.equal(fmtTime(2489), '24.89');
  assert.equal(fmtTime(6550), '1:05.50');
  assert.equal(fmtTime(59243), '9:52.43');
  assert.equal(fmtTime(0), '–');
  assert.equal(fmtDiff(12), '+0.12');
  assert.equal(fmtDiff(-150), '−1.50');
  assert.equal(fmtDiff(0), '±0.00');
});

test('seasons start 1 September', () => {
  assert.equal(seasonStart(new Date('2026-10-22')).toISOString().slice(0, 10), '2026-09-01');
  assert.equal(seasonStart(new Date('2026-08-31')).toISOString().slice(0, 10), '2025-09-01');
  assert.deepEqual(periodRange('season', new Date('2026-10-22')), { from: '2026-09-01', to: '2026-10-22' });
  assert.deepEqual(periodRange('last', new Date('2026-10-22')), { from: '2025-09-01', to: '2026-08-31' });
  assert.deepEqual(periodRange('12m', new Date('2026-10-22')), { from: '2025-10-23', to: '2026-10-22' });
  assert.deepEqual(periodRange('24m', new Date('2026-10-22')), { from: '2024-10-23', to: '2026-10-22' });
});

const r = (event, pool, time, date, points = 500) => ({ event, pool, time, date, points, name: '', meet: 'M' });

test('summarize merges all-time and period bests', () => {
  const all = { bests: [r(11, 25, 3000, '2026-09-10'), r(13, 25, 6500, '2024-01-01'), r(12, 50, 3100, '2025-07-01', 600)] };
  const period = { bests: [r(11, 25, 3000, '2026-09-10'), r(13, 25, 6620, '2026-10-01')] };
  const s = summarize(all, period);
  assert.equal(s.newPbs, 1);
  assert.equal(s.swumInPeriod, 2);
  assert.equal(s.latest.date, '2026-10-01');
  assert.equal(s.rows.find((x) => x.event === 13).diff, 120);
  assert.equal(s.best[0].event, 12);
});

test('progression tracks running best', () => {
  const p = progression([r(11, 25, 3000, '2025-01-01'), r(11, 25, 3100, '2024-01-01'), r(11, 25, 3050, '2025-06-01')]);
  assert.deepEqual(p.map((x) => x.best), [3100, 3000, 3000]);
});

test('parse Tempus links', () => {
  assert.deepEqual(parseTempusRef('https://www.tempusopen.se/swimmers/123456/swimming'), { site: 'se', id: 123456 });
  assert.deepEqual(parseTempusRef('tempusopen.fi/swimmers/12/events/11'), { site: 'fi', id: 12 });
  assert.deepEqual(parseTempusRef(' 4711 '), { site: 'se', id: 4711 });
  assert.equal(parseTempusRef('hello'), null);
});

test('rankings sort by time within event and pool', () => {
  const sw = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const ov = { 1: { bests: [r(11, 25, 3000)] }, 2: { bests: [r(11, 25, 2900), r(11, 50, 2000)] }, 3: { bests: [] } };
  assert.deepEqual(rankings(sw, ov, 11, 25).map((x) => x.swimmer.id), [2, 1]);
});

test('rankingsByPoints picks each swimmer’s best swim across events', async () => {
  const { rankingsByPoints } = await import('../lib.js');
  const sw = [{ id: 1 }, { id: 2 }];
  const ov = { 1: { bests: [r(11, 25, 3000, 'd', 500), r(51, 25, 3000, 'd', 640)] }, 2: { bests: [r(13, 50, 6000, 'd', 600)] } };
  const out = rankingsByPoints(sw, ov);
  assert.deepEqual(out.map((x) => [x.swimmer.id, x.result.event]), [[1, 51], [2, 13]]);
});

test('sortSwimmers by name, birth year, club, new PBs and recency', async () => {
  const { sortSwimmers } = await import('../lib.js');
  const sw = [
    { id: 1, name: 'Örjan', born: 2010, club: 'B' },
    { id: 2, name: 'Anna', born: 2012, club: 'A' },
    { id: 3, name: 'Bo', born: 2008, club: '' },
  ];
  const info = (id) => ({ 1: { newPbs: 2, latest: '2026-10-01' }, 2: { newPbs: 5, latest: '2026-09-01' }, 3: null })[id];
  const ids = (m) => sortSwimmers(sw, m, info, 'sv').map((s) => s.id);
  assert.deepEqual(ids('manual'), [1, 2, 3]);
  assert.deepEqual(ids('name'), [2, 3, 1]);
  assert.deepEqual(ids('born'), [3, 1, 2]);
  assert.deepEqual(ids('club'), [2, 1, 3]);
  assert.deepEqual(ids('newPbs'), [2, 1, 3]);
  assert.deepEqual(ids('recent'), [1, 2, 3]);
});

test('short event labels', async () => {
  const { eventShort } = await import('../lib.js');
  assert.equal(eventShort(43, 'sv'), '100 rygg');
  assert.equal(eventShort(12, 'en'), '50 free');
  assert.equal(eventShort(63, 'en'), '200 IM');
  assert.equal(eventShort(53, 'fi'), '100 perho');
});

test('summarize measures improvement against bests before the period', async () => {
  const { summarize } = await import('../lib.js');
  const all = { bests: [r(11, 25, 2950, '2026-10-01'), r(13, 25, 6500, '2024-01-01'), r(51, 25, 3300, '2026-09-20')] };
  const period = { bests: [r(11, 25, 2950, '2026-10-01'), r(13, 25, 6600, '2026-10-02'), r(51, 25, 3300, '2026-09-20')] };
  const before = { bests: [r(11, 25, 3000, '2025-05-01'), r(13, 25, 6500, '2024-01-01')] };
  const s = summarize(all, period, before);
  const row = (e) => s.rows.find((x) => x.event === e);
  assert.equal(row(11).improve, 50);
  assert.ok(Math.abs(row(11).improvePct - 50 / 30) < 1e-9);
  assert.equal(row(13).improve, null);
  assert.equal(row(51).firstSwim, true);
  assert.equal(s.topImprove.event, 11);
  assert.equal(s.newPbs, 2);
});

test('seasons and season bests', async () => {
  const { seasonOf, seasonBests } = await import('../lib.js');
  assert.equal(seasonOf('2026-08-31'), '2025/26');
  assert.equal(seasonOf('2026-09-01'), '2026/27');
  const sb = seasonBests([r(11, 25, 3100, '2025-03-01'), r(11, 25, 3050, '2025-06-01'), r(11, 25, 3000, '2025-10-01'), r(11, 25, 3020, '2026-01-01')]);
  assert.deepEqual(sb.map((x) => [x.season, x.best.time, x.change, x.count]), [['2025/26', 3000, -50, 2], ['2024/25', 3050, null, 2]]);
});

test('meets group swims, newest first, and mark PBs and first swims', async () => {
  const { meets } = await import('../lib.js');
  const sw = (time, date, meet, round = 'Final') => ({ ...r(11, 25, time, date), meet, round });
  const out = meets([{ pool: 25, results: [sw(3100, '2025-01-10', 'A'), sw(3000, '2025-05-02', 'B', 'Heat'), sw(2990, '2025-05-02', 'B'), sw(3050, '2025-09-20', 'C')] }]);
  assert.deepEqual(out.map((g) => g.meet), ['C', 'B', 'A']);
  assert.deepEqual(out[1].swims.map((w) => [w.time, w.pb]), [[3000, true], [2990, true]]);
  assert.equal(out[2].swims[0].first, true);
  assert.equal(out[0].swims[0].pb, false);
  assert.equal(out[1].pbs, 2);
});

test('compare table marks the fastest per event', async () => {
  const { compareTable } = await import('../lib.js');
  const sw = [{ id: 1 }, { id: 2 }];
  const ov = { 1: { bests: [r(11, 25, 3000), r(41, 25, 3500)] }, 2: { bests: [r(11, 25, 2900)] } };
  const tbl = compareTable(sw, ov, 25);
  assert.deepEqual(tbl.map((x) => [x.event, x.fastest, x.cells.map((c) => c?.time ?? null)]), [[11, 2900, [3000, 2900]], [41, 3500, [3500, null]]]);
});

test('improvement ranking and CSV', async () => {
  const { rankingsByImprovement, toCsv } = await import('../lib.js');
  const sums = { 1: { rows: [{ event: 11, pool: 25, improve: 50, improvePct: 1.6 }] }, 2: { rows: [{ event: 13, pool: 25, improve: 120, improvePct: 1.9 }] } };
  assert.deepEqual(rankingsByImprovement([{ id: 1 }, { id: 2 }], sums).map((x) => x.swimmer.id), [2, 1]);
  assert.deepEqual(rankingsByImprovement([{ id: 1 }, { id: 2 }], sums, 11, 25).map((x) => x.swimmer.id), [1]);
  assert.equal(toCsv([['a', 'b;c'], [1, 'x"y']]), '﻿a;"b;c"\r\n1;"x""y"\r\n');
});

test('25 m events do not count as improvements', async () => {
  const { summarize } = await import('../lib.js');
  const s = summarize({ bests: [r(4, 25, 1100, '2026-10-01')] }, { bests: [r(4, 25, 1100, '2026-10-01')] }, { bests: [r(4, 25, 1300, '2018-01-01')] });
  assert.equal(s.rows[0].improve, null);
  assert.equal(s.topImprove, null);
  assert.equal(s.newPbs, 1);
});

test('profile: strokes and distance type', async () => {
  const { profile } = await import('../lib.js');
  const p = profile([r(11, 25, 2500, 'd', 700), r(13, 25, 5600, 'd', 650), r(17, 25, 26000, 'd', 500), r(43, 25, 6000, 'd', 720), r(4, 25, 1100, 'd', 900)]);
  assert.equal(p.strokes.back, 720);
  assert.equal(p.strokes.free, 700);
  assert.equal(p.best, 'back');
  assert.deepEqual(p.dist, { sprint: 700, middle: 720, distance: 500 });
  assert.equal(p.type, 'allround');
  assert.equal(profile([r(11, 25, 2500, 'd', 800), r(13, 25, 5600, 'd', 650)]).type, 'sprint');
});

test('form compares recent swims with the PB before them', async () => {
  const { form } = await import('../lib.js');
  const ev = { results: [r(11, 25, 3000, '2025-01-01'), r(11, 25, 3030, '2025-02-01'), r(11, 25, 2970, '2025-03-01')] };
  const f = form([ev], 8);
  assert.equal(f.recent.length, 2);
  assert.equal(f.pbs, 1);
  assert.ok(Math.abs(f.recent[0].pct - -1) < 1e-9);
  assert.ok(Math.abs(f.recent[1].pct - 1) < 1e-9);
});

test('prognosis projects a steady improvement', async () => {
  const { prognosis } = await import('../lib.js');
  const today = new Date('2026-10-01T00:00:00Z');
  // one second (100) better every ~100 days
  const res = [0, 100, 200, 300, 400].map((d, i) => ({ ...r(13, 25, 6400 - i * 100, new Date(Date.UTC(2025, 6, 1) + d * 86400000).toISOString().slice(0, 10)), meet: 'M' + i }));
  const p = prognosis(res, 5900, today);
  assert.ok(p && p.date > '2026-10-01' && p.date < '2027-12-31');
  assert.equal(prognosis(res.map((x, i) => ({ ...x, time: 6000 + i * 50 })), 5900, today), null);
});

test('head-to-head matches the same race', async () => {
  const { headToHead } = await import('../lib.js');
  const a = [{ pool: 25, results: [{ ...r(11, 25, 3000, '2026-01-01'), meet: 'X', round: 'Final' }, { ...r(11, 25, 3100, '2026-02-01'), meet: 'Y', round: 'Final' }] }];
  const b = [{ pool: 25, results: [{ ...r(11, 25, 3050, '2026-01-01'), meet: 'X', round: 'Final' }, { ...r(11, 25, 3000, '2026-02-01'), meet: 'Y', round: 'Final' }, { ...r(11, 25, 2900, '2026-03-01'), meet: 'Z', round: 'Final' }] }];
  const h = headToHead(a, b);
  assert.equal(h.races.length, 2);
  assert.equal(h.a, 1);
  assert.equal(h.b, 1);
  assert.equal(h.races[0].meet, 'Y');
});

test('head-to-head counts each race once', async () => {
  const { headToHead } = await import('../lib.js');
  const sw = (t) => ({ ...r(11, 25, t, '2026-10-11'), meet: 'DM', round: 'Final' });
  const h = headToHead([{ pool: 25, results: [sw(2635), sw(2667)] }], [{ pool: 25, results: [sw(2634)] }]);
  assert.equal(h.races.length, 1);
  assert.equal(h.races[0].a, 2635);
  assert.equal(h.b, 1);
});

test('new personal bests since a snapshot', async () => {
  const { bestsSnapshot, newSince } = await import('../lib.js');
  const before = [r(11, 25, 3000, '2026-01-01'), r(13, 25, 6500, '2026-01-01')];
  const snap = bestsSnapshot(before);
  assert.deepEqual(newSince(before, snap), []);
  const after = [r(11, 25, 2950, '2026-10-01'), r(13, 25, 6500, '2026-01-01'), r(41, 25, 3300, '2026-10-02')];
  const n = newSince(after, snap);
  assert.deepEqual(n.map((x) => [x.event, x.prev]), [[41, null], [11, 3000]]);
  assert.deepEqual(newSince(after, null), []);
});

test('parseTime accepts common ways of writing a time', async () => {
  const { parseTime } = await import('../lib.js');
  assert.equal(parseTime('1:05.50'), 6550);
  assert.equal(parseTime('1.05,50'), 6550);
  assert.equal(parseTime('65.5'), 6550);
  assert.equal(parseTime('32,10'), 3210);
  assert.equal(parseTime('28'), 2800);
  assert.equal(parseTime('10:31.17'), 63117);
  assert.equal(parseTime('1:75.00'), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(''), null);
});

test('goalStatus compares goals with personal bests', async () => {
  const { goalStatus } = await import('../lib.js');
  const g = goalStatus({ 13: 6500, 11: 3000, 44: 7000 }, [r(13, 25, 6450), r(11, 25, 3050)]);
  assert.deepEqual(g.map((x) => [x.event, x.reached, x.gap]), [[11, false, 50], [13, true, -50], [44, false, null]]);
});

test('older seasons and all time', async () => {
  const { periodRange, seasonLabel, periodOptions } = await import('../lib.js');
  const today = new Date('2026-10-25');
  assert.deepEqual(periodRange('s2022', today), { from: '2022-09-01', to: '2023-08-31' });
  assert.deepEqual(periodRange('all', today), { from: '1990-01-01', to: '2026-10-25' });
  assert.equal(seasonLabel('s2022', today), '2022/23');
  assert.equal(seasonLabel('all', today), null);
  assert.deepEqual(periodOptions(2022, today), ['season', '12m', '24m', 'last', 's2024', 's2023', 's2022', 'all']);
  assert.deepEqual(periodOptions(2026, today), ['season', '12m', '24m', 'last', 'all']);
});

test('rankingsBothPools puts 25 m and 50 m side by side and sorts by the chosen pool', async () => {
  const { rankingsBothPools } = await import('../lib.js');
  const sw = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const ov = {
    1: { bests: [{ event: 13, pool: 25, time: 6000 }, { event: 14, pool: 50, time: 6300 }] },
    2: { bests: [{ event: 14, pool: 50, time: 6100 }] },
    3: { bests: [{ event: 13, pool: 25, time: 5900 }] },
  };
  assert.deepEqual(rankingsBothPools(sw, ov, 13, 14, 25).map((r) => r.swimmer.id), [3, 1, 2]);
  assert.deepEqual(rankingsBothPools(sw, ov, 13, 14, 50).map((r) => r.swimmer.id), [2, 1, 3]);
});

test('shortNames uses first names and tells apart swimmers who share one', () => {
  assert.deepEqual(shortNames(['Anna Svensson', 'Erik Berg']), ['Anna', 'Erik']);
  assert.deepEqual(shortNames(['Anna Svensson', 'Anna Larsson', 'Erik Berg']), ['Anna S.', 'Anna L.', 'Erik']);
  assert.deepEqual(shortNames(['Anna Svensson', 'Anna Sandberg', 'Anna Lind']), ['Anna Sv.', 'Anna Sa.', 'Anna L.']);
  assert.deepEqual(shortNames(['Anna Ek', 'Anna Ekberg']), ['Anna Ek', 'Anna Ekb.']);
  assert.deepEqual(shortNames(['Anna Svensson', 'Anna Svensson']), ['Anna Svensson (1)', 'Anna Svensson (2)']);
  assert.deepEqual(shortNames(['Anna', 'Anna Berg']), ['Anna', 'Anna B.']);
});
