import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRemoteSwimmers } from '../lib.js';

test('remote swimmers are coerced to plain numbers and unknown fields are dropped', () => {
  const out = cleanRemoteSwimmers([
    { id: '123', site: 'se', para: { S: 5, SB: 'x<img>', SM: 99 }, goals: { 13: 6000, 14: '<script>', 15: 5 }, evil: '<img src=x onerror=alert(1)>' },
    { id: '<img src=x onerror=alert(1)>' },
    { id: 123 },
    { id: -4 },
    null,
  ]);
  assert.deepEqual(out, [{ id: 123, site: 'se', para: { S: 5 }, goals: { 13: 6000 } }]);
  assert.deepEqual(cleanRemoteSwimmers('nope'), []);
});
