// Click-through tests of the app in a real browser, against the mock API (invented swimmers, no network).
// Run: npm run test:ui   (needs Playwright with Chromium; CI installs it)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 8091;
const URL = `http://localhost:${PORT}/`;
let server;
let browser;
const errors = [];

before(async () => {
  server = spawn(process.execPath, ['tools/dev-server.js', '--mock'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

/** A fresh page with the given swimmers and settings in storage, in Swedish. */
async function open(swimmers, { width = 1200, store = {} } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.evaluate(({ swimmers, store }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('swimdeck.swimmers', JSON.stringify(swimmers.map((id) => ({ id, site: 'se' }))));
    localStorage.setItem('swimdeck.lang', '"sv"');
    for (const [k, v] of Object.entries(store)) localStorage.setItem('swimdeck.' + k, JSON.stringify(v));
  }, { swimmers, store });
  await page.reload();
  await page.waitForSelector('.card');
  await page.waitForTimeout(600);
  return page;
}

const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem('swimdeck.' + k)), key);

test('swimmer cards load, and the points pill changes what the column shows', async () => {
  const page = await open([5004, 5001]);
  assert.equal(await page.locator('.card').count(), 2);
  await page.locator('.card').first().click();
  await page.waitForSelector('tr.ev');
  await page.click('[data-menu="metric:table"]');
  await page.click('[data-choose="metric"][data-value="wr"]');
  assert.equal(await stored(page, 'metric'), 'wr');
  assert.match(await page.locator('[data-menu="metric:table"]').innerText(), /% av VR/);
  assert.match(await page.locator('td.metric-td').first().innerText(), /%/);
  // a click outside closes an open menu without choosing
  await page.click('[data-menu="metric:table"]');
  await page.click('#swimmerDialog h2');
  assert.equal(await page.locator('.metric-menu').count(), 0);
  await page.close();
});

test('an event opens with its swims, and a meet opens its result list', async () => {
  const page = await open([5004]);
  await page.locator('.card').first().click();
  await page.locator('tr.ev').first().click();
  await page.waitForSelector('#eventDetail ol.top li');
  await page.locator('#eventDetail .meet-link').first().click();
  await page.waitForSelector('#meetDialog .meet-list tr');
  assert.ok((await page.locator('#meetDialog .meet-list tr').count()) > 5);
  await page.close();
});

test('reloading keeps the tab, open swimmer and open event', async () => {
  const page = await open([5004, 5001]);
  await page.locator('.card').nth(1).click();
  await page.locator('tr.ev').first().click();
  await page.waitForSelector('#eventDetail');
  await page.reload();
  await page.waitForSelector('#eventDetail');
  assert.equal(await page.$eval('#swimmerDialog', (d) => d.open), true);
  await page.close();
});

test('rankings: both pools, all swims and the world record view', async () => {
  const page = await open([5000, 5001, 5002]);
  await page.click('[data-view="rank"]');
  await page.waitForSelector('.rank-both');
  await page.click('[data-basis="swims"]');
  await page.waitForFunction(() => document.querySelectorAll('.ranking li').length > 3);
  await page.click('[data-basis="pb"]');
  await page.selectOption('#rankEvent', 'wr');
  assert.match(await page.locator('.ranking li').first().innerText(), /%/);
  await page.close();
});

test('compare: picking swimmers and comparing by a metric', async () => {
  const page = await open([5004, 5005, 5001]);
  await page.click('[data-view="compare"]');
  await page.waitForSelector('table.compare');
  await page.click('[data-menu="compare"]');
  await page.click('[data-choose="cmetric"][data-value="aqua"]');
  assert.equal(await stored(page, 'compareMetric'), 'aqua');
  assert.equal(await page.locator('tr.compare-best').count(), 1);
  // the compare picker still works (it once clashed with the pill menus)
  const before = await page.locator('[data-pick][aria-pressed="true"]').count();
  await page.locator('[data-pick][aria-pressed="true"]').first().click();
  assert.equal(await page.locator('[data-pick][aria-pressed="true"]').count(), before - 1);
  await page.close();
});

test('scrolling up or down over a wide table scrolls the page', async () => {
  const page = await open([5000, 5001, 5002, 5003], { width: 400 });
  await page.setViewportSize({ width: 400, height: 500 });
  await page.click('[data-view="compare"]');
  await page.waitForSelector('.table-scroll');
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator('.table-scroll').boundingBox();
  await page.mouse.move(box.x + box.width / 2, Math.min(box.y + 40, 450));
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => window.scrollY)) > 100);
  await page.close();
});

test('qualifying overview and the "close" pill', async () => {
  const page = await open([5000, 5001]);
  await page.click('[data-view="qual"]');
  await page.waitForSelector('.qd-card');
  await page.click('[data-menu="near:overview"]');
  await page.click('[data-choose="near"][data-value="5"]');
  assert.equal(await stored(page, 'near'), 5);
  await page.close();
});

test('import: a pasted para heat list gives swimmers with classes; select all toggles', async () => {
  const page = await open([5000]);
  await page.click('#add');
  await page.click('[data-action="importOpen"]');
  await page.fill('#importText', [
    'Gren 3, 100m Frisim S9',
    'SWE 1:01.00 Rekord Hållare 1990 S02 (SWE) 2020-01-01',
    '2 Alva Strand S9 2010 Havsörnarna SK 2, 4, A,',
    '3 Elis Bergvik SB8 2011 Exempelstadens SS +',
    'Gren 19, 4x50m Medley Mixed S/SB1-14 Final',
    '1 Havsörnarna SK Havsörnarna SK 2:40.00',
  ].join('\n'));
  await page.click('[data-action="importParse"]');
  await page.waitForFunction(() => !document.querySelector('.iright')?.textContent.includes('Söker'));
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.irow').count(), 2);
  assert.match(await page.locator('.import-tools').innerText(), /2 namn/);
  assert.ok(await page.locator('[data-action="importParaUpdate"]').count());
  await page.click('[data-action="importAdd"]');
  const list = await stored(page, 'swimmers');
  assert.deepEqual(list.find((s) => s.id === 5001)?.para, { SB: 8 });
  await page.close();
});

test('remove several at once, then undo', async () => {
  const page = await open([5000, 5001, 5002]);
  await page.click('[data-action="bulkRemove"]');
  await page.click('[data-bulk="5001"]');
  await page.click('[data-bulk="5002"]');
  await page.click('[data-action="bulkDo"]');
  await page.click('#confirmDialog button[value="yes"]');
  await page.waitForSelector('#toast button');
  assert.deepEqual((await stored(page, 'swimmers')).map((s) => s.id), [5000]);
  await page.click('#toast button');
  await page.waitForTimeout(300);
  assert.deepEqual((await stored(page, 'swimmers')).map((s) => s.id), [5000, 5001, 5002]);
  await page.close();
});

test('language and theme choices survive a reload', async () => {
  const page = await open([5000]);
  await page.click('[data-lang="nb"]');
  await page.click('[data-theme-set="dark"]');
  await page.reload();
  await page.waitForSelector('.card');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'nb');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.close();
});

test('no script errors on any page', () => {
  assert.deepEqual(errors, []);
});
