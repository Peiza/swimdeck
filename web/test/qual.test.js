import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUAL } from '../qual-data.js';
import { standardsFor, qualify, qualCounts, paraClassFor, usmAgeGroup, sexOf } from '../qual.js';

const time = (s) => { const [m, rest] = s.split(':'); const [sec, h] = rest.split(','); return +m * 6000 + +sec * 100 + +h; };

test('data matches spot checks against the 2026 PDFs', () => {
  const sm = (id) => QUAL.standards.find((s) => s.id === id);
  assert.equal(QUAL.windowStart, '2025-01-01');
  // SM A, Damer, 50 m frisim: 00:26,83 (25 m) and 00:27,76 (50 m)
  assert.deepEqual(sm('smA').rows.filter((r) => r[0] === 'W' && (r[1] === 11 || r[1] === 12)).map((r) => r[2]), [time('00:26,83'), time('00:27,76')]);
  // SM B, Herrar, 1500 m frisim 25 m: 17:01,61
  assert.equal(sm('smB').rows.find((r) => r[0] === 'M' && r[1] === 21)[2], time('17:01,61'));
  // USM Flickor 13–14, 100 m frisim 25 m: 01:03,63
  assert.equal(sm('usm').rows.find((r) => r[0] === 'W' && r[1] === 13 && r[2] === 13)[3], time('01:03,63'));
  // USM Pojkar 13–14, 100 m ryggsim 25 m: 01:10,54
  assert.equal(sm('usm').rows.find((r) => r[0] === 'M' && r[1] === 13 && r[2] === 43)[3], time('01:10,54'));
  // Para A Damer SM3 200 m medley: 14:15,85, valid in both pools
  assert.deepEqual(sm('paraA').rows.filter((r) => r[0] === 'W' && r[1] === 'SM3' && (r[2] === 63 || r[2] === 64)).map((r) => r[3]), [time('14:15,85'), time('14:15,85')]);
});

test('sex, USM age groups and para classes', () => {
  assert.equal(sexOf('Woman'), 'W');
  assert.equal(sexOf('Man'), 'M');
  assert.deepEqual(usmAgeGroup(2012), [13, 14]);
  assert.deepEqual(usmAgeGroup(2009), [17, 18]);
  assert.equal(usmAgeGroup(2005), null);
  assert.equal(paraClassFor(33, { S: 9, SB: 8, SM: 9 }), 'SB8');
  assert.equal(paraClassFor(63, { S: 9, SB: 8, SM: 9 }), 'SM9');
  assert.equal(paraClassFor(11, { S: 9 }), 'S9');
  assert.equal(paraClassFor(11, null), null);
});

test('standards and qualification for a swimmer', () => {
  const girl13 = { sex: 'Woman', born: 2013 };
  assert.deepEqual(standardsFor(girl13, 13).map((s) => s.id), ['smA', 'smB', 'usm']);
  const rows = qualify(girl13, [
    { event: 13, pool: 25, time: time('01:03,00') }, // reaches USM (01:03,63), not SM B (00:58,74)
    { event: 11, pool: 25, time: time('00:26,90') }, // SM B 25 m is 00:27,08, SM A 00:26,83
  ]);
  const by = (e) => rows.find((r) => r.event === e);
  assert.deepEqual(by(13).best.map((s) => s.id), ['usm']);
  assert.equal(by(13).next.id, 'smB');
  assert.equal(by(13).next.gap, time('01:03,00') - time('00:58,74'));
  assert.deepEqual(by(11).best.map((s) => s.id), ['smB']);
  assert.equal(by(11).next.id, 'smA');
  assert.deepEqual(qualCounts(rows), { usm: 1, smB: 1 });
});

test('para standards need a class', () => {
  const sw = { sex: 'Man', born: 1990, para: { S: 9 } };
  assert.deepEqual(standardsFor(sw, 12).map((s) => s.id), ['smA', 'smB', 'paraA', 'paraB']);
  const rows = qualify(sw, [{ event: 12, pool: 50, time: time('00:37,50') }]);
  assert.deepEqual(rows[0].best.map((s) => s.id), ['paraA']);
});
