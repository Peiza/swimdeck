import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventInfo, eventLabel, fmtTime, fmtDiff, seasonStart, periodRange, summarize, progression, parseTempusRef, rankings,
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
