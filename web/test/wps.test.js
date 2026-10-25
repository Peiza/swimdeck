import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wpsFor, wpsPoints, hasPara } from '../wps.js';
import { WPS } from '../wps-data.js';

test('the table has every published event', () => {
  assert.equal(Object.keys(WPS.events).length, 18);
  assert.deepEqual(WPS.events['100_Freestyle'].S10, [6.188847, 410.743, 5.621993, 432.746]);
  assert.deepEqual(WPS.events['1500_Freestyle'].S11, [7.615153, 10641.101, 10.233307, 15486.278]);
});

test('Gompertz points follow the published formula', () => {
  // 100 m freestyle S10 men (50 m pool, code 14) in 50.64: 1200 * e^(-e^(6.188847 - 410.743 / 50.64))
  const expected = Math.floor(1200 * Math.exp(-Math.exp(6.188847 - 410.743 / 50.64)));
  assert.equal(wpsFor(14, 'S10', 'M', 5064), expected);
  assert.ok(expected > 1000 && expected < 1100);
  // slower is fewer points, and women use their own parameters
  assert.ok(wpsFor(14, 'S10', 'M', 6000) < expected);
  assert.notEqual(wpsFor(14, 'S10', 'W', 5064), expected);
  // 25 m events and classes without a row give nothing
  assert.equal(wpsFor(13, 'S10', 'M', 5064), null);
  assert.equal(wpsFor(18, 'S1', 'M', 50000), null); // no 400 m free for S1
});

test('wpsPoints uses the class for the stroke', () => {
  const s = { sex: 'Woman', para: { S: 9, SB: 8 } };
  assert.equal(hasPara(s), true);
  assert.equal(wpsPoints(s, { event: 34, pool: 50, time: 8000 }), wpsFor(34, 'SB8', 'W', 8000)); // 100 m breaststroke
  assert.equal(wpsPoints(s, { event: 64, pool: 50, time: 16000 }), null); // no SM class given
  assert.equal(wpsPoints({ sex: 'Woman' }, { event: 14, pool: 50, time: 6000 }), null);
});
