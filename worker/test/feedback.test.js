import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFeedback, issueFor, handleFeedback } from '../src/feedback.js';

test('keeps a short message and drops unknown device fields', () => {
  const f = cleanFeedback({ kind: 'bug', message: '  Det hände något  ', contact: 'a@b.se', device: { os: 'Android', secret: 'x', view: 'deck' } });
  assert.deepEqual(f, { kind: 'bug', message: 'Det hände något', contact: 'a@b.se', device: { os: 'Android', view: 'deck' } });
});
test('unknown kind becomes other, no device stays null', () => {
  assert.equal(cleanFeedback({ kind: 'x', message: 'hello there' }).kind, 'other');
  assert.equal(cleanFeedback({ message: 'hello there' }).device, null);
});
test('rejects empty and too long messages', () => {
  assert.throws(() => cleanFeedback({ message: ' a ' }), /few words/);
  assert.throws(() => cleanFeedback({ message: 'x'.repeat(2001) }), /too long/);
  assert.throws(() => cleanFeedback(null));
});
test('honeypot is dropped silently', () => {
  assert.equal(cleanFeedback({ message: 'hello there', website: 'http://spam' }), null);
});
test('issue has kind label and permitted device lines only', () => {
  const i = issueFor(cleanFeedback({ kind: 'idea', message: 'Add a thing', device: { version: '0.56.0' } }));
  assert.equal(i.title, '[idea] Add a thing');
  assert.deepEqual(i.labels, ['idea']);
  assert.match(i.body, /- version: 0\.56\.0/);
});
test('503 when not configured, 405 for GET', async () => {
  await assert.rejects(handleFeedback(new Request('https://x/api/feedback', { method: 'POST', body: '{}' }), {}), (e) => e.status === 503);
  await assert.rejects(handleFeedback(new Request('https://x/api/feedback'), { FEEDBACK_TOKEN: 't', FEEDBACK_REPO: 'a/b' }), (e) => e.status === 405);
});
test('creates an issue with the token and returns ok', async () => {
  const real = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response('{}', { status: 201 }); };
  try {
    const r = await handleFeedback(new Request('https://x/api/feedback', { method: 'POST', body: JSON.stringify({ kind: 'bug', message: 'Broken button' }) }), { FEEDBACK_TOKEN: 'tok', FEEDBACK_REPO: 'Peiza/swimdeck-feedback' });
    assert.deepEqual(r, { ok: true });
    assert.equal(seen.url, 'https://api.github.com/repos/Peiza/swimdeck-feedback/issues');
    assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  } finally {
    globalThis.fetch = real;
  }
});
test('a GitHub failure is a 502 without leaking details', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', { status: 401 });
  try {
    await assert.rejects(handleFeedback(new Request('https://x/api/feedback', { method: 'POST', body: JSON.stringify({ message: 'Broken button' }) }), { FEEDBACK_TOKEN: 't', FEEDBACK_REPO: 'a/b' }), (e) => e.status === 502 && !/401/.test(e.message));
  } finally {
    globalThis.fetch = real;
  }
});
