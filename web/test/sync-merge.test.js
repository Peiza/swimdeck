import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSyncLists } from '../lib.js';

const a = (id, extra = {}) => ({ id, site: 'se', ...extra });

test('merge keeps remote additions and applies local removals and additions', () => {
  const base = [a(1), a(2)];
  const local = [a(1), a(3)]; // removed 2, added 3
  const remote = [a(1), a(2), a(4)]; // added 4 elsewhere
  assert.deepEqual(mergeSyncLists(base, local, remote).map((s) => s.id), [1, 4, 3]);
});

test('merge takes local goal edits but keeps untouched remote entries', () => {
  const base = [a(1), a(2)];
  const local = [a(1, { goals: { 13: 6000 } }), a(2)];
  const remote = [a(1), a(2, { goals: { 15: 7000 } })];
  const m = mergeSyncLists(base, local, remote);
  assert.deepEqual(m[0].goals, { 13: 6000 });
  assert.deepEqual(m[1].goals, { 15: 7000 });
});

test('a swimmer removed on both devices stays removed, and nothing is duplicated', () => {
  const m = mergeSyncLists([a(1), a(2)], [a(1), a(2), a(5)], [a(1), a(5)]);
  assert.deepEqual(m.map((s) => s.id), [1, 5]);
});
