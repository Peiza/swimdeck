import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASTERS } from '../masters-data.js';
import { ageGroupIndex, ageGroupLabel, recordFor, mastersPct, isMasters } from '../masters.js';

test('data covers both pools, both sexes and every age group', () => {
  assert.equal(Object.keys(MASTERS.records).length, 70);
  assert.equal(MASTERS.ages.length, 17);
  assert.equal(MASTERS.records.LW50fr[0], 2537); // women 50 m free long course 25-29: 25.37
  assert.ok(MASTERS.records.SM100im); // 100 m IM is short course only
  assert.equal(MASTERS.records.LM100im, undefined);
});

test('age groups follow the calendar-year age from 25', () => {
  assert.equal(ageGroupIndex(24), -1);
  assert.equal(ageGroupIndex(25), 0);
  assert.equal(ageGroupIndex(44), 3);
  assert.equal(ageGroupLabel(3), '40–44');
  assert.equal(isMasters({ born: 2001 }, 2026), true);
  assert.equal(isMasters({ born: 2002 }, 2026), false);
});

test('a swim as a share of the record for its age group', () => {
  // long course 50 m free is code 12; women 25-29 record 25.37
  assert.equal(recordFor(12, 'W', 27), 2537);
  const r = mastersPct({ born: 1998, sex: 'Woman' }, { event: 12, time: 2800, date: '2025-06-01' }); // age 27
  assert.equal(r.group, '25–29');
  assert.equal(Math.round(r.pct * 10) / 10, 90.6);
  // under 25 and unknown events give nothing
  assert.equal(mastersPct({ born: 2005, sex: 'Woman' }, { event: 12, time: 2800, date: '2025-06-01' }), null);
  assert.equal(recordFor(62, 'M', 40), null); // no long course 100 m IM
});
