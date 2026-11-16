import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSources, checkProject, resolveImport } from '../../tools/check-names.mjs';

const messages = (sources, options) =>
  checkSources(sources, options).map((f) => `${f.file}:${f.line}: ${f.message}`);

test('reports a name that is used but not declared', () => {
  const found = messages({
    'web/a.js': [
      'export function show(list) {',
      '  const rows = list.map((row) => row.name);',
      '  return render(rows);',
      '}',
    ].join('\n'),
  });
  assert.deepEqual(found, ["web/a.js:3: 'render' is not defined"]);
});

test('reports names that are out of scope where they are used', () => {
  const found = messages({
    'web/a.js': [
      'function outer() { const inner = 1; { let blocked = 2; } return blocked; }',
      'try { outer(); } catch (err) { console.log(err); }',
      'console.log(inner, err);',
      'missing = 1;',
    ].join('\n'),
  });
  assert.deepEqual(found, [
    "web/a.js:1: 'blocked' is not defined",
    "web/a.js:3: 'inner' is not defined",
    "web/a.js:3: 'err' is not defined",
    "web/a.js:4: 'missing' is not defined",
  ]);
});

test('reports an import of a name the module does not export', () => {
  const found = messages({
    'web/a.js': [
      "import { fmtTime, fmtDate } from './lib.js?v=7';",
      "import * as lib from './lib.js';",
      "import { gone } from './gone.js';",
      'console.log(fmtTime, fmtDate, gone, lib.fmtTime, lib.nope);',
    ].join('\n'),
    'web/lib.js': 'export const fmtTime = (t) => String(t);\nconst fmtDate = 1;\n',
  });
  assert.deepEqual(found, [
    "web/a.js:1: 'fmtDate' is not exported by './lib.js?v=7' (web/lib.js)",
    "web/a.js:3: cannot find module './gone.js' (web/gone.js)",
    "web/a.js:4: 'lib.nope' is not exported by './lib.js' (web/lib.js)",
  ]);
});

test('follows re-exports, and reads modules outside the checked set for their exports', () => {
  const sources = {
    'web/a.js': "import { one, two, three, four } from './index.js';\nimport d from './index.js';\nconsole.log(one, two, three, four, d);",
    'web/index.js': "export * from './one.js';\nexport { two, x as three } from './data.js';\nexport default 1;",
    'web/one.js': 'export function one() {}\nexport default 2;',
  };
  const read = (file) => (file === 'web/data.js' ? 'export const two = 2, x = 3;' : null);
  assert.deepEqual(messages(sources, { read }), ["web/a.js:1: 'four' is not exported by './index.js' (web/index.js)"]);
});

test('exports nobody imports are not an error', () => {
  assert.deepEqual(messages({ 'web/a.js': 'export const unused = 1;\nexport function alsoUnused() {}' }), []);
});

test('accepts destructuring, closures, hoisting and the other scoping rules', () => {
  const found = messages({
    'web/a.js': [
      "import { helper as h } from './b.js';",
      'const { a, b: { c = a, ...restObj }, [h()]: computed } = h();',
      'const [first, , third = first, ...others] = [1, 2, 3];',
      'export const total = later(a, c, restObj, computed, first, third, others);',
      'function later(...args) { return counter() + args.length + arguments.length + hoisted; }',
      'var hoisted = 1;',
      'function makeCounter() { let n = 0; return () => { n += 1; return n + inner(); }; function inner() { return n; } }',
      'const counter = makeCounter();',
      'class Box extends Object { #secret = 1; static made = 0; size = total;',
      '  static { Box.made += 1; }',
      '  get value() { return this.#secret; }',
      '  grow({ by = 1 } = {}) { this.size += by; return Box; } }',
      'const Named = class Inner { again() { return Inner; } };',
      'const fact = function f(n) { return n ? n * f(n - 1) : 1; };',
      'outer: for (const [key, value] of Object.entries({ k: 1 })) {',
      '  for (let i = 0; i < 2; i++) { if (i) continue outer; if (key) break outer; console.log(value); }',
      '}',
      'try { throw new Error("x"); } catch ({ message }) { console.log(message); } finally { console.log(Named, fact); }',
      'try { h(); } catch { }',
      'switch (first) { case 1: { const scoped = 1; console.log(scoped); break; } default: { let x; [x, hoisted] = [1, 2]; ({ x } = { x }); } }',
      'if (first) { var fromBlock = 1; function inBlock() { return fromBlock; } inBlock(); }',
      'console.log(fromBlock, new Box().grow, typeof neverDeclared, import.meta.url);',
      'const obj = { document, key: 1, method() { return obj.key.undefinedProp?.deeper; }, [first]: 2 };',
      'document.querySelector("x").addEventListener("click", (event) => window.localStorage.setItem("k", event.type));',
      'export { counter as default, obj };',
    ].join('\n'),
    'web/b.js': 'export function helper() { return {}; }',
  });
  assert.deepEqual(found, []);
});

test('globals depend on the environment and on a global comment', () => {
  const sources = { 'web/a.js': 'document.title = "x";', 'worker/src/a.js': '/* global EXTRA */\ndocument.title = EXTRA;' };
  const globalsFor = (file) => (file.startsWith('web/') ? ['document'] : []);
  assert.deepEqual(messages(sources, { globalsFor }), ["worker/src/a.js:2: 'document' is not defined"]);
});

test('reports a file that does not parse', () => {
  const found = messages({ 'web/a.js': 'const a = 1;\nconst a = 2;' });
  assert.equal(found.length, 1);
  assert.match(found[0], /^web\/a\.js:2: cannot parse: /);
});

test('resolves relative imports and leaves packages alone', () => {
  assert.equal(resolveImport('web/app.js', './lib.js?v=0.51.1'), 'web/lib.js');
  assert.equal(resolveImport('worker/src/index.js', '../../web/lib.js#x'), 'web/lib.js');
  assert.equal(resolveImport('web/app.js', 'node:fs'), null);
});

test('the project has no undeclared names or bad imports', () => {
  const { files, findings } = checkProject();
  assert.ok(files.includes('web/app.js') && files.includes('worker/src/index.js'));
  assert.ok(!files.some((f) => f.endsWith('-data.js') || f.includes('/test/') || f.includes('/vendor/')));
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line}:${f.column}: ${f.message}`), []);
});
