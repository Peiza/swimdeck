import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Modules ask app.js for a redraw through `hooks.name(...)`. The name checker cannot see property
// accesses, so this test makes sure every hook that is called is registered in app.js.
test('every hooks.x() call has a matching registration in app.js', () => {
  const dir = new URL('../', import.meta.url);
  const app = readFileSync(new URL('app.js', dir), 'utf8');
  const registered = new Set((app.match(/Object\.assign\(hooks, \{([^}]*)\}/)?.[1] || '').split(',').map((s) => s.trim()).filter(Boolean));
  const used = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/\bhooks\.(\w+)\(/g)) used.add(m[1]);
  }
  for (const name of used) assert.ok(registered.has(name), `hooks.${name} is used but not registered in app.js`);
});
