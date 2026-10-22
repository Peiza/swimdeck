import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KOFI_URL, supportLine } from '../support.js';
import { makeT } from '../i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '');

test('Ko-fi line: URL, text, same tab, noreferrer, in every language', () => {
  assert.equal(KOFI_URL, 'https://ko-fi.com/peiza');
  const en = supportLine(makeT('en'), esc);
  assert.match(en, /^<p class="support">/);
  assert.equal((en.match(/<a /g) || []).length, 1);
  assert.match(en, new RegExp(`<a href="${KOFI_URL}" rel="noreferrer">Buy me a coffee on Ko-fi</a>`));
  assert.doesNotMatch(en, /target=/);
  assert.equal(text(en), 'Like SwimDeck? Buy me a coffee on Ko-fi');
  assert.equal(text(supportLine(makeT('sv'), esc)), 'Gillar du SwimDeck? Bjud mig på en kaffe på Ko-fi');
  assert.equal(text(supportLine(makeT('fi'), esc)), 'Pidätkö SwimDeckistä? Tarjoa minulle kahvi Ko-fissa');
});
