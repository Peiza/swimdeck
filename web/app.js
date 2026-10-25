import { CONFIG } from './config.js';
import { supportLine } from './support.js';
import { VERSION } from './version.js';
import { parseList, rankCandidates } from './importer.js';
import { QUAL } from './qual-data.js';
import { ORDER, qualify, qualCounts, usmAgeGroup, sexOf } from './qual.js';
import { LANGS, makeT, detectLang } from './i18n.js';
import {
  eventLabel, eventShort, eventSortKey, eventInfo, fmtTime, fmtDiff, periodRange, seasonLabel, periodOptions,
  summarize, progression, parseTempusRef, parseTime, goalStatus, rankings, rankingsByPoints, rankingsBothPools, sortSwimmers,
  seasonBests, meets, compareTable, rankingsByImprovement, toCsv, profile, form, prognosis, headToHead,
  bestsSnapshot, newSince,
} from './lib.js';

// ---------------------------------------------------------------- state

const TRASH_DAYS = 30;

const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem('swimdeck.' + k);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('swimdeck.' + k, JSON.stringify(v));
    } catch {}
  },
};

const state = {
  lang: detectLang(),
  period: store.get('period', 'season'),
  view: 'deck',
  topN: store.get('topN', 5),
  topOrder: store.get('topOrder', 'fast'), // fast | recent
  cardParts: { stats: true, latest: true, improve: true, qual: true, goals: true, best: true, para: false, ...store.get('cardParts', {}) },
  swimmers: store.get('swimmers', []),
  sort: store.get('sort', 'manual'),
  collapsed: store.get('collapsed', []), // ids of minimised cards
  trash: store.get('trash', []).filter((x) => Date.now() - x.removedAt < TRASH_DAYS * 86400000), // { swimmer, removedAt, index }
  data: store.get('data', {}), // id -> { all, period, periodKey, fetchedAt, error }
  events: {}, // `${site}:${id}:${code}` -> event payload (memory only)
  busy: null, // { done, total }
  rankEvent: store.get('rankEvent2', 'both:11'),
  rankSortPool: store.get('rankSortPool', 25),
  helpOpen: {},
  rankSex: store.get('rankSex', ''),
  rankBasis: store.get('rankBasis', 'pb'),
  rankYear: store.get('rankYear', ''),
  openId: null,
  openPool: 25,
  openEvent: null,
  openTab: 'events', // events | meets
  meetsShown: 5,
  compareIds: store.get('compareIds', []),
  comparePool: store.get('comparePool', 25),
  qComp: store.get('qView', 'done'),
  qSex: store.get('qSex', 'W'),
  qPool: store.get('qPool', 25),
  qClass: store.get('qClass', 9),
  seen: store.get('seen', {}), // id -> snapshot of PBs the user has seen
};

let t = makeT(state.lang);
const API = (CONFIG.api ?? '').replace(/\/$/, '');
const STALE_MS = 6 * 60 * 60 * 1000;
const FEEDBACK_URL = 'https://github.com/Peiza/swimdeck/issues/new/choose';

const $ = (sel, root = document) => root.querySelector(sel);
const sexLabel = (x) => (/^(wo|fe|kvin|dam|nai|flick|tyt)/i.test(x || '') ? t('women') : x ? t('men') : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const periodName = (p = state.period) => seasonLabel(p) || t('periodAllShort');
const periodOptionLabel = (p) => p === 'season' ? `${t('periodSeason')} · ${seasonLabel(p)}` : p === '12m' ? t('period12') : p === '24m' ? t('period24') : p === 'last' ? `${t('periodLast')} · ${seasonLabel(p)}` : p === 'all' ? t('periodAll') : `${t('periodSeasonOf')} ${seasonLabel(p)}`;
function oldestSwimYear() {
  let y = Infinity;
  for (const s of state.swimmers) {
    // Competitive swimming usually starts around age 8; PB dates alone would hide earlier seasons.
    if (s.born) y = Math.min(y, s.born + 8);
    for (const b of state.data[s.id]?.all?.bests || []) if (b.date) y = Math.min(y, Number(b.date.slice(0, 4)));
  }
  return Number.isFinite(y) ? y : null;
}
const shortDate = (iso) => {
  const d = new Date(iso + 'T12:00:00Z');
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString(state.lang, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' });
};
const fmtPct = (p) => `−${p.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

function downloadCsv(name, rows) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

function save() {
  store.set('swimmers', state.swimmers);
  store.set('data', state.data);
  store.set('collapsed', state.collapsed);
  store.set('trash', state.trash);
  store.set('compareIds', state.compareIds);
  store.set('comparePool', state.comparePool);
  for (const k of ['qSex', 'qPool', 'qClass']) store.set(k, state[k]);
  store.set('qView', state.qComp);
  store.set('seen', state.seen);
  schedulePush();
  scheduleNotifyUpdate();
}

// ---------------------------------------------------------------- sync between devices

state.sync = store.get('sync', null); // { token, updatedAt, payload }
let pushTimer = null;
let lastPull = 0;

const syncPayload = () => ({ swimmers: state.swimmers.map((s) => ({ id: s.id, site: s.site, ...(s.para ? { para: s.para } : {}), ...(s.goals && Object.keys(s.goals).length ? { goals: s.goals } : {}) })) });
const syncLink = () => `${location.origin}${location.pathname}#sync=${state.sync.token}`;

async function syncApi(method, path, body) {
  const res = await fetch(`${API}/api/sync${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

function schedulePush() {
  if (!state.sync) return;
  const payload = JSON.stringify(syncPayload());
  if (payload === state.sync.payload) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushSync, 1200);
}

async function pushSync() {
  pushTimer = null;
  if (!state.sync) return;
  const payload = JSON.stringify(syncPayload());
  try {
    const r = await syncApi('PUT', '/' + state.sync.token, JSON.parse(payload));
    state.sync = { ...state.sync, updatedAt: r.updatedAt, payload, error: null };
  } catch (e) {
    state.sync = { ...state.sync, error: e.status === 404 ? 'gone' : e.message };
  }
  store.set('sync', state.sync);
  renderSyncStatus();
}

/** Bring in changes made on other devices. */
async function pullSync({ force = false } = {}) {
  if (!state.sync || pushTimer && !force) return;
  if (!force && Date.now() - lastPull < 20000) return;
  lastPull = Date.now();
  try {
    const remote = await syncApi('GET', '/' + state.sync.token);
    if (remote.updatedAt > (state.sync.updatedAt || 0)) applyRemote(remote);
    state.sync = { ...state.sync, updatedAt: remote.updatedAt, payload: JSON.stringify(syncPayload()), error: null };
  } catch (e) {
    state.sync = { ...state.sync, error: e.status === 404 ? 'gone' : e.message };
  }
  store.set('sync', state.sync);
  renderSyncStatus();
}

function applyRemote(remote) {
  const known = new Map(state.swimmers.map((s) => [s.id, s]));
  const next = remote.swimmers.map((r) => ({ ...(known.get(r.id) || { name: '', born: null, club: '', sex: '' }), id: r.id, site: r.site, para: r.para, goals: r.goals }));
  const added = next.filter((s) => !known.has(s.id));
  state.swimmers = next;
  store.set('swimmers', state.swimmers);
  render();
  if (added.length) refreshAll({ only: added });
}

function renderSyncStatus() {
  const el = $('#syncStatus');
  if (el) el.outerHTML = syncStatusHtml();
  if ($('#syncDialog').open) renderSyncDialog();
}

function syncStatusHtml() {
  if (!state.sync) return '<span id="syncStatus"></span>';
  const bad = state.sync.error;
  return `<button id="syncStatus" class="sync-pill ${bad ? 'bad' : ''}" data-action="syncOpen" title="${esc(t('syncTitle'))}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.7L4 16M4 20v-4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    ${esc(bad ? t('syncError') : t('synced'))}</button>`;
}

function openSyncDialog() {
  renderSyncDialog();
  const dlg = $('#syncDialog');
  if (!dlg.open) dlg.showModal();
}

async function renderSyncDialog() {
  const dlg = $('#syncDialog');
  const on = !!state.sync;
  dlg.innerHTML = `<div class="sheet small-sheet sync-sheet">
    <header class="sheet-head"><h2>${esc(t('syncTitle'))}</h2><button class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
    ${on ? `
      ${state.sync.error === 'gone' ? `<p class="warn small">${esc(t('syncGone'))}</p>` : state.sync.error ? `<p class="warn small">${esc(t('error', { msg: state.sync.error }))}</p>` : `<p class="small">${esc(t('syncOn', { when: state.sync.updatedAt ? new Date(state.sync.updatedAt).toLocaleString(state.lang, { dateStyle: 'short', timeStyle: 'short' }) : '–' }))}</p>`}
      <p class="small muted">${esc(t('syncHowTo'))}</p>
      <div class="qr" id="syncQr"></div>
      <div class="row"><input class="sync-link" readonly value="${esc(syncLink())}"><button class="btn small" data-action="syncCopy">${esc(t('copy'))}</button></div>
      <p class="small muted">${esc(t('syncSecret'))}</p>
      <div class="row end wrap"><button class="link" data-action="syncNow">${esc(t('syncNow'))}</button><button class="link" data-action="syncLeave">${esc(t('syncLeave'))}</button><button class="link danger" data-action="syncDelete">${esc(t('syncDelete'))}</button></div>`
    : `
      <p class="small">${esc(t('syncIntro'))}</p>
      <p class="small muted">${esc(t('syncPrivacy'))}</p>
      <button class="btn primary" data-action="syncCreate" ${state.swimmers.length ? '' : 'disabled'}>${esc(t('syncCreate'))}</button>`}
  </div>`;
  if (on) {
    try {
      const { default: qrcode } = await import('./vendor/qrcode.js');
      const q = qrcode(0, 'M');
      q.addData(syncLink());
      q.make();
      const box = $('#syncQr');
      if (box) box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {}
  }
}

async function createSync() {
  try {
    const payload = syncPayload();
    const r = await syncApi('POST', '', payload);
    state.sync = { token: r.token, updatedAt: r.updatedAt, payload: JSON.stringify(payload) };
    store.set('sync', state.sync);
  } catch (e) {
    toast(t('error', { msg: e.message }));
  }
  renderSyncDialog();
  renderSyncStatus();
}

async function joinSync(token) {
  const before = state.swimmers.slice();
  let remote;
  try {
    remote = await syncApi('GET', '/' + token);
  } catch (e) {
    toast(e.status === 404 ? t('syncGone') : t('error', { msg: e.message }));
    return;
  }
  const local = state.swimmers.map((s) => s.id);
  const remoteIds = remote.swimmers.map((s) => s.id);
  const extra = local.filter((id) => !remoteIds.includes(id));
  let mode = 'replace';
  if (extra.length) {
    const dlg = $('#confirmDialog');
    mode = await new Promise((resolve) => {
      dlg.innerHTML = `<form method="dialog" class="sheet small-sheet">
        <h2>${esc(t('syncJoinTitle'))}</h2><p>${esc(t('syncJoinBody', { n: remoteIds.length, m: extra.length }))}</p>
        <div class="row end wrap"><button class="btn" value="cancel">${esc(t('cancel'))}</button><button class="btn" value="replace">${esc(t('syncReplace'))}</button><button class="btn primary" value="merge">${esc(t('syncMerge'))}</button></div></form>`;
      dlg.returnValue = '';
      dlg.onclose = () => resolve(dlg.returnValue || 'cancel');
      dlg.showModal();
    });
  }
  if (mode === 'cancel') return;
  state.sync = { token, updatedAt: remote.updatedAt, payload: '' };
  applyRemote(remote);
  if (mode === 'merge') state.swimmers.push(...before.filter((s) => extra.includes(s.id)));
  else state.sync.payload = JSON.stringify(syncPayload());
  store.set('sync', state.sync);
  save();
  render();
  toast(t('syncJoined'));
  renderSyncStatus();
}

const STD_LABEL = { smA: 'SM A', smB: 'SM B', usm: 'USM', paraA: 'Para-SM A', paraB: 'Para-SM B' };
const stdLabel = (id) => STD_LABEL[id] || id;
const qBadge = (id, extra = '') => `<span class="q q-${id}">${esc(stdLabel(id))}${extra}</span>`;

function newFor(s) {
  return newSince(state.data[s.id]?.all?.bests, state.seen[s.id]);
}

function markSeen(ids) {
  for (const id of ids) {
    const b = state.data[id]?.all?.bests;
    if (b) state.seen[id] = bestsSnapshot(b);
  }
  store.set('seen', state.seen);
}

function qualRows(s) {
  return qualify(s, state.data[s.id]?.qual?.bests || []);
}

const ICON = {
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ---------------------------------------------------------------- api

async function api(path, params = {}) {
  if (CONFIG.api == null) throw new Error(t('apiMissing'));
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  const res = await fetch(`${API}${path}${q.toString() ? '?' + q : ''}`);
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

const periodKey = () => {
  const { from, to } = periodRange(state.period);
  return `${from}_${to}`;
};

async function loadSwimmer(s, { fresh = false } = {}) {
  const { from, to } = periodRange(state.period);
  const refresh = fresh ? 1 : '';
  const dayBefore = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const [all, period, before, qual] = await Promise.all([
    api(`/api/swimmer/${s.id}`, { site: s.site, refresh }),
    api(`/api/swimmer/${s.id}`, { site: s.site, from, to, refresh }),
    api(`/api/swimmer/${s.id}`, { site: s.site, from: '1990-01-01', to: dayBefore, refresh }),
    api(`/api/swimmer/${s.id}`, { site: s.site, from: QUAL.windowStart, refresh }),
  ]);
  if (all.swimmer) Object.assign(s, pickSwimmer(all.swimmer, s.site));
  if (!state.seen[s.id]) state.seen[s.id] = bestsSnapshot(all.bests);
  state.data[s.id] = { all, period, before, qual, periodKey: periodKey(), fetchedAt: Date.now(), error: null };
}

function pickSwimmer(sw, site) {
  return { id: sw.id, site, name: sw.name, born: sw.born, club: sw.club, sex: sw.sex };
}

let pendingLoad = [];

async function refreshAll({ fresh = false, only = null } = {}) {
  if (state.busy) {
    // Queue swimmers added while a refresh is running; they load right after it.
    pendingLoad.push(...(only || state.swimmers));
    return;
  }
  const list = (only || state.swimmers).slice();
  if (!list.length) return;
  state.busy = { done: 0, total: list.length };
  renderHeader();
  const queue = list.slice();
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      try {
        await loadSwimmer(s, { fresh });
      } catch (e) {
        state.data[s.id] = { ...(state.data[s.id] || {}), error: e.message };
      }
      state.busy.done++;
      renderHeader();
      renderMain();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  state.busy = null;
  save();
  render();
  if (pendingLoad.length) {
    const next = [...new Map(pendingLoad.map((s) => [s.id, s])).values()].filter((s) => state.swimmers.includes(s));
    pendingLoad = [];
    if (next.length) refreshAll({ only: next });
  }
}

function needsLoad(s) {
  const d = state.data[s.id];
  return !d || !d.all || !d.before || !d.qual || d.periodKey !== periodKey() || Date.now() - (d.fetchedAt || 0) > STALE_MS;
}

async function loadEvent(s, code) {
  const k = `${s.site}:${s.id}:${code}`;
  if (!state.events[k]) state.events[k] = api(`/api/swimmer/${s.id}/event/${code}`, { site: s.site });
  try {
    return await state.events[k];
  } catch (e) {
    delete state.events[k];
    throw e;
  }
}

// ---------------------------------------------------------------- rendering

function render() {
  document.documentElement.lang = state.lang;
  renderHeader();
  renderMain();
  renderFooter();
  if (state.openId) renderSwimmerDialog();
}

function renderHeader() {
  const busy = state.busy;
  const last = Math.max(0, ...state.swimmers.map((s) => state.data[s.id]?.fetchedAt || 0));
  $('#header').innerHTML = `
    <button class="brand" data-action="home" aria-label="${esc(t('home'))}">
      <svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="6" width="28" height="20" rx="5" fill="var(--accent)"/><path d="M6 19c3-3 5-3 8 0s5 3 8 0 5-3 6-1" stroke="var(--on-accent)" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="11" cy="12" r="2.2" fill="var(--on-accent)"/></svg>
      <div><h1>SwimDeck</h1><p class="tagline">${esc(t('tagline'))}</p></div>
    </button>
    <div class="toolbar">
      <label class="select"><span class="sr">${esc(t('period'))}</span>
        <select id="period">
          ${[...new Set([...periodOptions(oldestSwimYear()), state.period])].map((p) => `<option value="${p}" ${p === state.period ? 'selected' : ''}>${esc(periodOptionLabel(p))}</option>`).join('')}
        </select>
      </label>
      <button id="refresh" class="btn" ${busy || !state.swimmers.length ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true" class="${busy ? 'spin' : ''}"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${busy ? esc(t('refreshing', busy)) : esc(t('refresh'))}</span>
      </button>
      <button id="add" class="btn primary"><span aria-hidden="true">+</span> <span>${esc(t('add'))}</span></button>
    </div>
    <nav class="tabs" role="tablist">
      <button role="tab" data-view="deck" aria-selected="${state.view === 'deck'}">${esc(t('deck'))} <span class="count">${state.swimmers.length}</span></button>
      <button role="tab" data-view="rank" aria-selected="${state.view === 'rank'}">${esc(t('toplist'))}</button>
      <button role="tab" data-view="compare" aria-selected="${state.view === 'compare'}">${esc(t('compare'))}</button>
      <button role="tab" data-view="qual" aria-selected="${state.view === 'qual'}">${esc(t('qualTab'))}</button>
      <span class="spacer"></span>
      ${syncStatusHtml()}
      <span class="muted small hide-sm">${esc(t('updated', { when: last ? new Date(last).toLocaleString(state.lang, { dateStyle: 'short', timeStyle: 'short' }) : t('never') }))}</span>
    </nav>`;
}

const HELP_VIEWS = ['deck', 'rank', 'compare', 'qual'];

/** A short, collapsible explanation at the top of each view. */
function helpBox(view) {
  if (!HELP_VIEWS.includes(view)) return '';
  return `<details class="help" data-help="${view}" ${state.helpOpen[view] ? 'open' : ''}>
    <summary><span class="help-i" aria-hidden="true">i</span> ${esc(t('helpSummary'))}</summary>
    <div class="help-body">${helpHtml(view)}<p><button class="link small" data-action="about">${esc(t('aboutMore'))}</button></p></div>
  </details>`;
}

const helpHtml = (view) => t('help_' + view).split('\n').map((p) => `<p>${esc(p)}</p>`).join('');

function goHome() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  state.view = 'deck';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openAbout() {
  const dlg = $('#aboutDialog');
  const sections = [['help_deck', 'deck'], ['help_rank', 'toplist'], ['help_compare', 'compare'], ['help_qual', 'qualTab']];
  dlg.innerHTML = `
    <div class="sheet about">
      <header class="sheet-head">
        <div><h2>${esc(t('aboutTitle'))}</h2><p class="muted small">${esc(t('slogan'))}</p></div>
        <button class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button>
      </header>
      <p>${esc(t('aboutIntro'))}</p>
      ${sections.map(([k, title]) => `<section><h3>${esc(t(title))}</h3>${t(k).split('\n').map((p) => `<p>${esc(p)}</p>`).join('')}</section>`).join('')}
      <section><h3>${esc(t('glossaryTitle'))}</h3><dl class="glossary">${t('glossary').split('\n').map((line) => { const [term, ...rest] = line.split(':'); return `<dt>${esc(term)}</dt><dd>${esc(rest.join(':').trim())}</dd>`; }).join('')}</dl></section>
      <section><h3>${esc(t('aboutDataTitle'))}</h3>${t('aboutData').split('\n').map((p) => `<p>${esc(p)}</p>`).join('')}</section>
      <footer class="sheet-foot"><span class="muted small">${esc(versionLabel())}</span><button class="btn primary" data-action="close">${esc(t('done'))}</button></footer>
    </div>`;
  if (!dlg.open) dlg.showModal();
}

function renderMain() {
  const main = $('#main');
  if (CONFIG.api == null) {
    main.innerHTML = `<div class="empty"><p>${esc(t('apiMissing'))}</p></div>`;
    return;
  }
  if (!state.swimmers.length && state.view === 'qual') {
    main.innerHTML = helpBox('qual') + qualView();
    return;
  }
  if (!state.swimmers.length) {
    main.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 120 60" aria-hidden="true"><path d="M5 40c10-10 20-10 30 0s20 10 30 0 20-10 30 0 15 8 20 4" stroke="var(--accent)" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M5 52c10-10 20-10 30 0s20 10 30 0 20-10 30 0 15 8 20 4" stroke="var(--line)" stroke-width="4" fill="none" stroke-linecap="round"/></svg>
        <h2>${esc(t('emptyTitle'))}</h2>
        <p>${esc(t('emptyBody'))}</p>
        <button class="btn primary" data-action="add">+ ${esc(t('add'))}</button>
        ${trashLink()}
      </div>`;
    return;
  }
  main.innerHTML = helpBox(state.view) + (state.view === 'rank' ? rankView() : state.view === 'compare' ? compareView() : state.view === 'qual' ? qualView() : deckView());
}

const SORTS = { manual: 'sortManual', fresh: 'sortFresh', name: 'sortName', born: 'sortBorn', club: 'sortClub', newPbs: 'sortNewPbs', recent: 'sortRecent' };

function cardInfo(id) {
  const d = state.data[id];
  if (!d?.all) return null;
  const sum = summarize(d.all, d.period, d.before);
  return { newPbs: sum.newPbs, latest: sum.latest?.date || '' };
}

function deckView() {
  const allCollapsed = state.swimmers.every((s) => state.collapsed.includes(s.id));
  const list = state.sort === 'fresh'
    ? [...state.swimmers].sort((a, b) => newFor(b).length - newFor(a).length)
    : sortSwimmers(state.swimmers, state.sort, cardInfo, state.lang);
  return `
    <div class="deck-tools">
      <div class="deck-tools-left">
        <label class="select compact"><span class="sr">${esc(t('sortBy'))}</span>
          <select id="sortMode" aria-label="${esc(t('sortBy'))}">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === state.sort ? 'selected' : ''}>${esc(t('sortBy'))}: ${esc(t(v))}</option>`).join('')}</select>
        </label>
        <button class="link" data-action="${allCollapsed ? 'expandAll' : 'collapseAll'}">${esc(t(allCollapsed ? 'expandAll' : 'collapseAll'))}</button>
        <button class="link" data-action="cardsCustomize">${esc(t('customize'))}</button>
        <button class="link" data-action="notifyOpen">${esc(state.notify ? t('notifyOnShort') : t('notifyShort'))}</button>
      </div>
      ${trashLink()}
    </div>
    ${(() => { const n = state.swimmers.reduce((a, s) => a + newFor(s).length, 0); const who = state.swimmers.filter((s) => newFor(s).length).length; return n ? `<div class="new-banner"><span>${esc(t('newBanner', { n, who }))}</span><button class="link" data-action="seenAll">${esc(t('markSeen'))}</button></div>` : ''; })()}
    ${state.sort === 'manual' && state.swimmers.length > 1 ? `<p class="muted small drag-hint">${esc(t('dragHint'))}</p>` : ''}
    <ul class="deck" id="deck">${list.map(cardView).join('')}</ul>`;
}

// ---------------------------------------------------------------- push notifications

state.notify = store.get('notify', null); // { endpoint, count }
let notifyTimer = null;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function notifyApi(method, path, body) {
  const res = await fetch(`${API}/api/push${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function enableNotify() {
  if (!pushSupported()) return toast(t('notifyUnsupported'));
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return renderNotifyDialog(t('notifyDenied'));
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await notifyApi('GET', '/key');
      const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((key.length + 3) % 4));
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    }
    await sendNotifyList(sub);
    renderNotifyDialog();
    toast(t('notifyOnToast'));
  } catch (e) {
    renderNotifyDialog(t('error', { msg: e.message }));
  }
}

async function sendNotifyList(sub) {
  const swimmers = state.swimmers.filter((s) => s.site === 'se').map((s) => s.id);
  await notifyApi('POST', '', { subscription: sub.toJSON(), swimmers, lang: state.lang });
  state.notify = { endpoint: sub.endpoint, count: swimmers.length };
  store.set('notify', state.notify);
}

async function disableNotify() {
  try {
    const sub = await currentSubscription();
    if (sub) {
      await notifyApi('DELETE', '', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {}
  state.notify = null;
  store.set('notify', null);
  renderNotifyDialog();
}

async function testNotify() {
  try {
    const sub = await currentSubscription();
    if (!sub) return renderNotifyDialog(t('notifyGone'));
    await notifyApi('POST', '/test', { endpoint: sub.endpoint });
    toast(t('notifyTestSent'));
  } catch (e) {
    toast(/429|minute/i.test(e.message) ? t('notifyWait') : t('error', { msg: e.message }));
  }
}

function scheduleNotifyUpdate() {
  if (!state.notify || !pushSupported()) return;
  const count = state.swimmers.filter((s) => s.site === 'se').length;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(async () => {
    try {
      const sub = await currentSubscription();
      if (sub) await sendNotifyList(sub);
      else {
        state.notify = null;
        store.set('notify', null);
      }
    } catch {}
  }, count === state.notify.count ? 30000 : 1500);
}

function openNotify() {
  renderNotifyDialog();
  const dlg = $('#confirmDialog');
  if (!dlg.open) dlg.showModal();
}

function renderNotifyDialog(msg = '') {
  const dlg = $('#confirmDialog');
  const on = !!state.notify;
  const ios = /iphone|ipad/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;
  dlg.innerHTML = `<form method="dialog" class="sheet small-sheet">
    <header class="sheet-head"><h2>${esc(t('notifyTitle'))}</h2><button type="button" class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
    ${msg ? `<p class="warn small">${esc(msg)}</p>` : ''}
    ${!pushSupported() ? `<p class="small">${esc(ios ? t('notifyIos') : t('notifyUnsupported'))}</p>`
      : on ? `<p class="small">${esc(t('notifyOn', { n: state.notify.count }))}</p><p class="small muted">${esc(t('notifyHow'))}</p>
        <div class="row end wrap"><button type="button" class="link danger" data-action="notifyOff">${esc(t('notifyDisable'))}</button><button type="button" class="btn" data-action="notifyTest">${esc(t('notifyTest'))}</button><button class="btn primary" value="ok">${esc(t('done'))}</button></div>`
      : `<p class="small">${esc(t('notifyIntro'))}</p><p class="small muted">${esc(t('notifyHow'))}</p><p class="small muted">${esc(t('notifyPrivacy'))}</p>
        <div class="row end"><button type="button" class="btn primary" data-action="notifyOn" ${state.swimmers.length ? '' : 'disabled'}>${esc(t('notifyEnable'))}</button></div>`}
  </form>`;
  dlg.onclose = null;
}

const CARD_PARTS = ['stats', 'latest', 'improve', 'qual', 'goals', 'best', 'para'];

function openCustomize() {
  const dlg = $('#confirmDialog');
  dlg.innerHTML = `<form method="dialog" class="sheet small-sheet">
    <header class="sheet-head"><h2>${esc(t('customizeTitle'))}</h2><button type="button" class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
    <p class="small muted">${esc(t('customizeHint'))}</p>
    <div class="parts">${CARD_PARTS.map((k) => `<label class="check"><input type="checkbox" data-part="${k}" ${state.cardParts[k] ? 'checked' : ''}> <span>${esc(t('part_' + k))}</span></label>`).join('')}</div>
    <div class="row end"><button class="btn primary" value="ok">${esc(t('done'))}</button></div></form>`;
  dlg.onclose = null;
  dlg.showModal();
}

function trashLink() {
  return `<button class="link muted-link" data-action="trash">${ICON.trash}<span>${esc(state.trash.length ? t('trashCount', { n: state.trash.length }) : t('trash'))}</span></button>`;
}

function cardView(s) {
  const d = state.data[s.id];
  const collapsed = state.collapsed.includes(s.id);
  const head = `
    <div class="card-head">
      <div>
        <h3>${esc(s.name || '#' + s.id)}</h3>
        <p class="muted small">${[s.born ? t('born', { year: s.born }) : '', s.club].filter(Boolean).map(esc).join(' · ')}</p>
      </div>
      <div class="card-actions">
        <button class="icon-btn remove-btn" data-remove="${s.id}" aria-label="${esc(t('remove'))}" title="${esc(t('remove'))}">${ICON.trash}</button>
        ${state.sort === 'manual' && state.swimmers.length > 1 ? `<button class="icon-btn drag-handle" data-drag="${s.id}" aria-label="${esc(t('dragHint'))}" title="${esc(t('dragHint'))}">${ICON.grip}</button>` : ''}
        ${s.site !== 'se' ? `<span class="tag">${esc(s.site.toUpperCase())}</span>` : ''}
        <button class="icon-btn" data-collapse="${s.id}" aria-expanded="${!collapsed}" aria-label="${esc(t(collapsed ? 'expand' : 'collapse'))}" title="${esc(t(collapsed ? 'expand' : 'collapse'))}">${ICON.chevron}</button>
      </div>
    </div>`;
  if (collapsed) {
    const sum = d?.all ? summarize(d.all, d.period, d.before) : null;
    const line = sum
      ? [sum.newPbs ? `<b class="good">${sum.newPbs} ${esc(t('newPbsLabel'))}</b>` : esc(t('noPbsInPeriod')),
         sum.latest ? `${esc(eventLabel(sum.latest.event, state.lang, sum.latest.name))} <span class="time">${fmtTime(sum.latest.time)}</span>` : ''].filter(Boolean).join(' · ')
      : esc(d?.error ? t('error', { msg: d.error }) : t('loading'));
    const fresh = newFor(s).length;
    return `<li class="card collapsed ${fresh ? 'has-new' : ''}" data-open="${s.id}" tabindex="0">${head}<p class="small muted">${fresh ? `<span class="new-tag">${esc(t('newSince', { n: fresh }))}</span> ` : ''}${line}</p></li>`;
  }
  if (!d || !d.all) {
    return `<li class="card ${d?.error ? 'has-error' : 'loading'}" data-open="${s.id}" tabindex="0">${head}
      <p class="muted">${d?.error ? esc(t('error', { msg: d.error })) : esc(t('loading'))}</p></li>`;
  }
  const sum = summarize(d.all, d.period, d.before);
  const latest = sum.latest;
  const P = state.cardParts;
  return `<li class="card ${newFor(s).length ? 'has-new' : ''}" data-open="${s.id}" tabindex="0">
    ${head}
    ${P.stats ? `<div class="stats">
      <div class="stat ${sum.newPbs ? 'good' : ''}"><b>${sum.newPbs}</b><span>${esc(t('newPbsLabel'))}</span></div>
      <div class="stat"><b>${sum.swumInPeriod}</b><span>${esc(t('eventsSwum'))}</span></div>
    </div>` : ''}
    ${P.latest ? `<div class="latest">
      ${latest
        ? `<span class="muted small">${esc(t('latest'))}</span>
           <div><b>${esc(eventLabel(latest.event, state.lang, latest.name))}</b> <span class="pool">${latest.pool} m</span> <span class="time">${fmtTime(latest.time)}</span></div>
           <div class="muted small">${esc(latest.date)} · ${esc(latest.meet)}</div>`
        : `<span class="muted small">${esc(t('noSwims'))}</span>`}
    </div>` : ''}
    ${newBlock(s)}
    ${P.improve && sum.topImprove ? `<div class="improve small"><span class="muted">${esc(t('topImprove'))}</span>
      <span><b>${esc(eventLabel(sum.topImprove.event, state.lang, sum.topImprove.name))}</b> <span class="pool">${sum.topImprove.pool} m</span>
      <b class="good">${fmtDiff(-sum.topImprove.improve)}</b> <span class="muted">(${fmtPct(sum.topImprove.improvePct)})</span></span></div>` : ''}
    ${P.qual ? qualChips(s) : ''}
    ${P.goals ? goalChip(s) : ''}
    ${P.best && sum.best.length ? `<div class="best-block"><span class="muted small">${esc(t('bestEventsAqua'))}</span><div class="chips">${sum.best.map((r) => `<span class="chip"><span class="chip-name">${esc(eventLabel(r.event, state.lang, r.name))}</span><span class="chip-meta"><small>${r.pool} m</small><b>${fmtTime(r.pb.time)}</b></span></span>`).join('')}</div></div>` : ''}
    ${d.error ? `<p class="warn small">${esc(t('error', { msg: d.error }))}</p>` : ''}
  </li>`;
}

function newBlock(s) {
  const list = newFor(s);
  if (!list.length) return '';
  return `<div class="new-block"><span class="new-tag">${esc(t('newSince', { n: list.length }))}</span>
    ${list.slice(0, 3).map((b) => `<div class="small"><b>${esc(eventLabel(b.event, state.lang, b.name))}</b> <span class="pool">${b.pool} m</span> <b class="time">${fmtTime(b.time)}</b>${b.prev ? ` <span class="good">${fmtDiff(b.time - b.prev)}</span>` : ` <span class="muted">${esc(t('firstSwim'))}</span>`}</div>`).join('')}
    ${list.length > 3 ? `<div class="small muted">${esc(t('andMore', { n: list.length - 3 }))}</div>` : ''}</div>`;
}

function goalChip(s) {
  const g = goalStatus(s.goals, state.data[s.id]?.all?.bests);
  if (!g.length) return '';
  const done = g.filter((x) => x.reached).length;
  const near = g.filter((x) => !x.reached && x.gap != null).sort((a, b) => a.gap / a.goal - b.gap / b.goal)[0];
  return `<div class="goal-card small"><span class="gbadge ${done === g.length ? 'ok' : ''}">${esc(t('goalsCard', { done, n: g.length }))}</span>
    ${near ? `<span class="muted">${esc(t('goalNearest', { event: eventLabel(near.event, state.lang), pool: near.pool, gap: fmtTime(near.gap) }))}</span>` : ''}</div>`;
}

function qualChips(s) {
  const counts = qualCounts(qualRows(s));
  const ids = ORDER.filter((id) => counts[id]);
  if (!ids.length) return '';
  return `<div class="qual-block"><span class="muted small">${esc(t('qualTitle', { year: QUAL.year }))}</span>
    <div class="qchips">${ids.map((id) => qBadge(id, ` <b>×${counts[id]}</b>`)).join('')}</div></div>`;
}

const baseCode = (code) => (code > 10 && code % 2 === 0 ? code - 1 : code);

function rankView() {
  const basis = state.rankBasis;
  const improveMode = basis === 'improve';
  const source = (id) => (basis === 'period' ? state.data[id]?.period : state.data[id]?.all);
  const overviews = Object.fromEntries(state.swimmers.map((s) => [s.id, source(s.id)]));
  const options = new Map();
  const both = new Map();
  for (const s of state.swimmers) for (const b of state.data[s.id]?.all?.bests || []) {
    options.set(`${b.pool}:${b.event}`, b);
    both.set(`both:${baseCode(b.event)}`, { code: baseCode(b.event), name: b.name });
  }
  const opts = [...options.values()].sort((a, b) => a.pool - b.pool || eventSortKey(a.event, a.name) - eventSortKey(b.event, b.name));
  const bothOpts = [...both.values()].sort((a, b) => eventSortKey(a.code) - eventSortKey(b.code));
  if (state.rankEvent !== 'aqua' && !options.has(state.rankEvent) && !both.has(state.rankEvent)) state.rankEvent = bothOpts[0] ? `both:${bothOpts[0].code}` : 'aqua';
  const aqua = state.rankEvent === 'aqua';
  const bothMode = state.rankEvent.startsWith('both:');
  const sexes = [...new Set(state.swimmers.map((s) => s.sex).filter(Boolean))];
  const years = [...new Set(state.swimmers.map((s) => s.born).filter(Boolean))].sort((a, b) => b - a);
  const swimmers = state.swimmers.filter(
    (s) => (!state.rankSex || s.sex === state.rankSex) && (!state.rankYear || String(s.born) === String(state.rankYear)),
  );
  const c25 = bothMode ? Number(state.rankEvent.slice(5)) : null;
  const c50 = bothMode && c25 > 10 ? c25 + 1 : null;
  let rows;
  if (improveMode) {
    const sums = Object.fromEntries(swimmers.map((s) => { const d = state.data[s.id]; return [s.id, d?.all ? summarize(d.all, d.period, d.before) : null]; }));
    if (bothMode) rows = rankingsByImprovement(swimmers, sums, [c25, c50].filter(Boolean));
    else {
      const [pool, event] = aqua ? [null, null] : state.rankEvent.split(':').map(Number);
      rows = rankingsByImprovement(swimmers, sums, event, pool);
    }
  } else if (aqua) rows = rankingsByPoints(swimmers, overviews);
  else if (bothMode) rows = rankingsBothPools(swimmers, overviews, c25, c50, state.rankSortPool);
  else {
    const [pool, event] = state.rankEvent.split(':').map(Number);
    rows = rankings(swimmers, overviews, event, pool);
  }
  const twoCols = bothMode && !improveMode;
  const lead = rows[0]?.result;
  state.rankRows = { rows, aqua, improveMode, twoCols };
  const sortKey = state.rankSortPool === 50 ? 'r50' : 'r25';
  const leadTime = (k) => rows.find((r) => r[k])?.[k]?.time;
  const cell = (r, k) => {
    const x = r[k];
    if (!x) return '<td class="num muted">–</td>';
    const gap = x.time - leadTime(k);
    return `<td class="num"><b>${fmtTime(x.time)}</b><small class="muted">${gap > 0 ? fmtDiff(gap) : x.date || ''}</small></td>`;
  };
  return `
    <div class="rank-controls">
      <label class="select"><span>${esc(t('chooseEvent'))}</span>
        <select id="rankEvent">
          <option value="aqua" ${aqua ? 'selected' : ''}>${esc(t('allEventsAqua'))}</option>
          ${bothOpts.length ? `<optgroup label="${esc(t('bothPools'))}">${bothOpts.map((b) => `<option value="both:${b.code}" ${`both:${b.code}` === state.rankEvent ? 'selected' : ''}>${esc(eventLabel(b.code, state.lang, b.name))}${b.code > 10 ? ' · 25 + 50 m' : ' · 25 m'}</option>`).join('')}</optgroup>` : ''}
          ${[25, 50].map((p) => { const o = opts.filter((b) => b.pool === p); return o.length ? `<optgroup label="${esc(t(p === 25 ? 'shortCourse' : 'longCourse'))}">${o.map((b) => `<option value="${b.pool}:${b.event}" ${`${b.pool}:${b.event}` === state.rankEvent ? 'selected' : ''}>${esc(eventLabel(b.event, state.lang, b.name))} · ${b.pool} m</option>`).join('')}</optgroup>` : ''; }).join('')}
        </select>
      </label>
      <div class="seg" role="group">${['pb', 'period', 'improve'].map((x) => `<button data-basis="${x}" aria-pressed="${basis === x}">${esc(x === 'pb' ? t('basisPb') : x === 'period' ? t('basisPeriod', { period: periodName() }) : t('basisImprove'))}</button>`).join('')}</div>
      ${sexes.length > 1 ? `<div class="seg" role="group">${['', ...sexes].map((x) => `<button data-sex="${esc(x)}" aria-pressed="${state.rankSex === x}">${esc(x ? sexLabel(x) : t('allSexes'))}</button>`).join('')}</div>` : ''}
      ${years.length > 1 ? `<label class="select compact"><span class="sr">${esc(t('birthYear'))}</span><select id="rankYear"><option value="">${esc(t('allYears'))}</option>${years.map((y) => `<option value="${y}" ${String(state.rankYear) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select></label>` : ''}
    </div>
    ${improveMode ? `<p class="muted small rank-note">${esc(t('improveNote', { period: periodName() }))}</p>` : ''}
    ${!rows.length ? `<p class="muted">${esc(improveMode ? t('noImprove') : basis === 'period' ? t('noneInPeriod') : t('noneInEvent'))}</p>`
      : twoCols ? `<div class="row end"><button class="link small" data-action="csvRank">${esc(t('exportCsv'))}</button></div>
      <div class="table-scroll"><table class="compare rank-both">
        <thead><tr><th class="pos">#</th><th>${esc(t('swimmer'))}</th>${[[25, 'r25', 'shortCourse'], ...(c50 ? [[50, 'r50', 'longCourse']] : [])].map(([p, k, label]) => `<th class="num"><button class="sort-head" data-sortpool="${p}" aria-pressed="${sortKey === k}">${p} m${sortKey === k ? ' ↓' : ''}<small>${esc(t(label))}</small></button></th>`).join('')}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr data-open="${r.swimmer.id}" tabindex="0">
          <td class="pos">${r[sortKey] ? i + 1 : ''}</td>
          <td><b>${esc(r.swimmer.name)}</b><small class="muted">${esc([r.swimmer.born, r.swimmer.club].filter(Boolean).join(' · '))}</small></td>
          ${cell(r, 'r25')}${c50 ? cell(r, 'r50') : ''}</tr>`).join('')}</tbody>
      </table></div>`
      : `<div class="row end"><button class="link small" data-action="csvRank">${esc(t('exportCsv'))}</button></div><ol class="ranking">${rows.map((r, i) => `
      <li data-open="${r.swimmer.id}" tabindex="0" role="button">
        <span class="pos">${i + 1}</span>
        <span class="who"><b>${esc(r.swimmer.name)}</b><span class="muted small">${esc([r.swimmer.born, r.swimmer.club].filter(Boolean).join(' · '))}</span></span>
        ${improveMode
          ? `<span class="time good">${fmtPct(r.row.improvePct)}</span>
             <span class="muted small when">${esc(eventLabel(r.row.event, state.lang, r.row.name))} ${r.row.pool} m · <b>${fmtTime(r.row.period.time)}</b> (${fmtDiff(-r.row.improve)})<br>${esc(t('prevPb'))} ${fmtTime(r.row.prev.time)} · ${esc(r.row.period.date)}</span>
             <span class="gap"></span>`
          : aqua
          ? `<span class="time">${r.result.points} <small class="muted">p</small></span>
             <span class="muted small when">${esc(eventLabel(r.result.event, state.lang, r.result.name))} ${r.result.pool} m · <b>${fmtTime(r.result.time)}</b><br>${esc(r.result.date)} · ${esc(r.result.meet)}</span>
             ${i > 0 ? `<span class="gap small muted">−${lead.points - r.result.points} p</span>` : '<span class="gap"></span>'}`
          : `<span class="time">${fmtTime(r.result.time)}</span>
             <span class="muted small when">${esc(r.result.date)}<br>${esc(r.result.meet)}</span>
             ${i > 0 ? `<span class="gap small muted">${fmtDiff(r.result.time - lead.time)}</span>` : '<span class="gap"></span>'}`}
      </li>`).join('')}</ol>`}`;
}

function rankCsv() {
  const { rows, aqua, improveMode, twoCols } = state.rankRows || { rows: [] };
  if (twoCols) {
    const head = [t('rank'), t('swimmer'), t('birthYear'), t('club'), t('event'), '25 m', t('date'), '50 m', t('date')];
    const ev = rows[0]?.r25 || rows[0]?.r50;
    const lines = rows.map((r, i) => [i + 1, r.swimmer.name, r.swimmer.born || '', r.swimmer.club || '', ev ? eventLabel(baseCode(ev.event), state.lang, ev.name) : '', r.r25 ? fmtTime(r.r25.time) : '', r.r25?.date || '', r.r50 ? fmtTime(r.r50.time) : '', r.r50?.date || '']);
    return downloadCsv(`swimdeck-${t('toplist').toLowerCase()}.csv`, [head, ...lines]);
  }
  const head = [t('rank'), t('swimmer'), t('birthYear'), t('club'), t('event'), t('pool'), t('time'), t('date'), t('meet')];
  if (improveMode) head.push(t('prevPb'), t('basisImprove'));
  else if (aqua) head.push(t('points'));
  const lines = rows.map((r, i) => {
    const res = improveMode ? r.row.period : r.result;
    const ev = improveMode ? r.row : res;
    const line = [i + 1, r.swimmer.name, r.swimmer.born || '', r.swimmer.club || '', eventLabel(ev.event, state.lang, ev.name), ev.pool, fmtTime(res.time), res.date, res.meet];
    if (improveMode) line.push(fmtTime(r.row.prev.time), fmtPct(r.row.improvePct));
    else if (aqua) line.push(res.points || '');
    return line;
  });
  downloadCsv(`swimdeck-${t('toplist').toLowerCase()}.csv`, [head, ...lines]);
}

function compareSelection() {
  const ids = state.compareIds.filter((id) => state.swimmers.some((s) => s.id === id));
  return ids.length ? ids : state.swimmers.slice(0, Math.min(3, state.swimmers.length)).map((s) => s.id);
}

function compareView() {
  const ids = compareSelection();
  const chosen = ids.map((id) => state.swimmers.find((s) => s.id === id));
  const overviews = Object.fromEntries(state.swimmers.map((s) => [s.id, state.data[s.id]?.all]));
  const table = compareTable(chosen, overviews, state.comparePool);
  const first = (n) => esc(String(n || '').split(' ')[0]);
  return `
    <div class="compare-pick">
      <p class="muted small">${esc(t('compareHint'))}</p>
      <div class="pick-list">${state.swimmers.map((s) => `<button class="pick" data-pick="${s.id}" aria-pressed="${ids.includes(s.id)}" ${!ids.includes(s.id) && ids.length >= 4 ? 'disabled' : ''}>${esc(s.name || '#' + s.id)}</button>`).join('')}</div>
    </div>
    <div class="rank-controls">
      <div class="seg" role="group">${[25, 50].map((p) => `<button data-cpool="${p}" aria-pressed="${state.comparePool === p}">${esc(t(p === 25 ? 'pool25' : 'pool50'))}</button>`).join('')}</div>
      <span class="spacer"></span>
      ${table.length ? `<button class="link small" data-action="csvCompare">${esc(t('exportCsv'))}</button>` : ''}
    </div>
    ${table.length ? `<div class="table-scroll"><table class="compare">
      <thead><tr><th>${esc(t('event'))}</th>${chosen.map((s) => `<th class="num" title="${esc(s.name)}">${first(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${table.map((row) => `<tr><th scope="row">${esc(eventLabel(row.event, state.lang, row.name))}</th>${row.cells.map((c) => c
        ? `<td class="num ${c.time === row.fastest && chosen.length > 1 ? 'fastest' : ''}"><b>${fmtTime(c.time)}</b>${c.time !== row.fastest ? `<small>${fmtDiff(c.time - row.fastest)}</small>` : `<small>${esc(c.date.slice(0, 4))}</small>`}</td>`
        : '<td class="num muted">–</td>').join('')}</tr>`).join('')}</tbody>
    </table></div>` : `<p class="muted">${esc(t('noneInEvent'))}</p>`}
    ${chosen.length === 2 ? `<div class="h2h"><h3 class="small">${esc(t('h2hTitle', { a: first(chosen[0].name), b: first(chosen[1].name) }))}</h3>
      <div id="h2hBox"><button class="btn small" data-action="h2h">${esc(t('h2hShow'))}</button><p class="muted small">${esc(t('h2hHint'))}</p></div></div>` : `<p class="muted small h2h-hint">${esc(t('h2hPickTwo'))}</p>`}`;
}

async function fillH2h() {
  const ids = compareSelection();
  if (ids.length !== 2) return;
  const [a, b] = ids.map((id) => state.swimmers.find((s) => s.id === id));
  const box = () => (state.view === 'compare' ? $('#h2hBox') : null);
  const codesOf = (s) => new Set((state.data[s.id]?.all?.bests || []).map((x) => x.event));
  const shared = [...codesOf(a)].filter((c) => codesOf(b).has(c));
  if (!shared.length) {
    if (box()) box().innerHTML = `<p class="muted small">${esc(t('h2hNone'))}</p>`;
    return;
  }
  let doneA = 0, doneB = 0;
  const progress = () => box() && (box().innerHTML = `<p class="muted small">${esc(t('loadingMeets', { done: doneA + doneB, total: shared.length * 2 }))}</p>`);
  const [ra, rb] = await Promise.all([
    loadAllEvents(a, (d) => { doneA = d; progress(); }, shared),
    loadAllEvents(b, (d) => { doneB = d; progress(); }, shared),
  ]);
  if (!box()) return;
  const h = headToHead(ra.results, rb.results);
  const first = (n) => esc(String(n || '').split(' ')[0]);
  if (!h.races.length) {
    box().innerHTML = `<p class="muted small">${esc(t('h2hNone'))}</p>`;
    return;
  }
  box().innerHTML = `
    <div class="h2h-score"><span><b>${first(a.name)}</b> ${h.a}</span><span class="muted">–</span><span>${h.b} <b>${first(b.name)}</b></span>${h.ties ? `<span class="small muted">(${esc(t('h2hTies', { n: h.ties }))})</span>` : ''}</div>
    <ol class="meets">${h.races.slice(0, 30).map((r) => `
      <li class="h2h-race"><span class="small muted">${esc(r.date)} · ${esc(r.meet)}${r.round ? ' · ' + esc(roundLabel(r.round)) : ''}</span>
        <span>${esc(eventLabel(r.event, state.lang, r.name))} <span class="pool">${r.pool} m</span></span>
        <span class="num"><b class="${r.a < r.b ? 'good' : ''}">${fmtTime(r.a)}</b> – <b class="${r.b < r.a ? 'good' : ''}">${fmtTime(r.b)}</b></span></li>`).join('')}</ol>`;
}

function compareCsv() {
  const ids = compareSelection();
  const chosen = ids.map((id) => state.swimmers.find((s) => s.id === id));
  const overviews = Object.fromEntries(state.swimmers.map((s) => [s.id, state.data[s.id]?.all]));
  const table = compareTable(chosen, overviews, state.comparePool);
  const head = [t('event'), t('pool'), ...chosen.map((s) => s.name)];
  const lines = table.map((row) => [eventLabel(row.event, state.lang, row.name), state.comparePool, ...row.cells.map((c) => (c ? fmtTime(c.time) : ''))]);
  downloadCsv(`swimdeck-${t('compare').toLowerCase()}.csv`, [head, ...lines]);
}

const qualTabs = () => `<div class="seg" role="group">${[['done', t('qualDone')], ['sm', 'SM / U21-SM'], ['usm', 'USM'], ['para', 'Para-SM']].map(([k, v]) => `<button data-qcomp="${k}" aria-pressed="${state.qComp === k}">${esc(v)}</button>`).join('')}</div>`;

/** The highest SM standard, USM and the highest Para-SM standard reached (SM A implies SM B, so B is left out). */
const qualHighlights = (reached) => {
  const ids = reached.map((x) => x.id);
  return [ids.includes('smA') ? 'smA' : ids.includes('smB') ? 'smB' : null, ids.includes('usm') ? 'usm' : null, ids.includes('paraA') ? 'paraA' : ids.includes('paraB') ? 'paraB' : null].filter(Boolean);
};

/** Overview: every qualifying time the swimmers in the list have reached, all championships and pools. */
const NEAR = 0.03; // "close to a standard": within 3 %

function qualDoneView() {
  const doc = QUAL.standards[0];
  const byEvent = (a, b) => a.pool - b.pool || eventSortKey(a.event) - eventSortKey(b.event);
  const people = state.swimmers.map((s) => {
    const all = qualRows(s);
    const rows = all.filter((q) => q.reached.length).sort(byEvent);
    const near = all
      .filter((q) => !q.reached.length && q.next && q.next.gap / q.result.time <= NEAR)
      .map((q) => ({ ...q, close: q.missing.filter((m) => m.gap / q.result.time <= NEAR) }))
      .sort((a, b) => a.next.gap / a.result.time - b.next.gap / b.result.time);
    return { s, rows, near };
  });
  const shown = people.filter((p) => p.rows.length || p.near.length);
  const none = people.filter((p) => !p.rows.length && !p.near.length);
  const loading = state.swimmers.some((s) => !state.data[s.id]?.qual);
  const std = (id, time) => `<span class="qd-std">${qBadge(id)}<span class="qd-lim">${fmtTime(time)}</span></span>`;
  const next = (q) => (q.next ? `<span class="qd-next">${esc(t('toNext', { gap: fmtTime(q.next.gap), std: stdLabel(q.next.id) }))} (${fmtTime(q.next.time)})</span>` : '');
  const swum = (q) => `<td class="num"><b>${fmtTime(q.result.time)}</b><small class="muted">${esc(q.result.date || '')}</small></td>`;
  const head = (label) => `<thead><tr><th class="qd-pool">${label}</th><th class="num">${esc(t('qdSwum'))}</th><th class="num">${esc(t('qdLimit'))}</th></tr></thead>`;
  return `
    <div class="rank-controls qual-controls">${qualTabs()}</div>
    ${!state.swimmers.length ? `<p class="muted">${esc(t('emptyBody'))}</p>` : ''}
    ${shown.length ? `<div class="qual-done">${shown.map(({ s, rows, near }) => `
      <section class="qd-card">
        <button class="qd-name" data-open="${s.id}"><b>${esc(s.name)}</b> <span class="muted small">${esc([s.born, s.club].filter(Boolean).join(' · '))}</span></button>
        ${[25, 50].map((p) => { const rs = rows.filter((q) => q.pool === p); return rs.length ? `<table class="qd-table">${head(`${esc(t(p === 25 ? 'shortCourse' : 'longCourse'))} ${p} m`)}
          <tbody>${rs.map((q) => `<tr>
          <td>${esc(eventLabel(q.event, state.lang, q.result.name))}</td>
          ${swum(q)}
          <td class="num qd-badges">${qualHighlights(q.reached).map((id) => std(id, q.reached.find((x) => x.id === id).time)).join('')}</td></tr>
          ${q.next ? `<tr class="qd-next-row"><td colspan="3">${next(q)}</td></tr>` : ''}`).join('')}</tbody></table>` : ''; }).join('')}
        ${near.length ? `<table class="qd-table qd-near">${head(esc(t('qdNear')))}
          <tbody>${near.map((q) => `<tr>
          <td>${esc(eventLabel(q.event, state.lang, q.result.name))} <span class="pool">${q.pool} m</span></td>
          ${swum(q)}
          <td class="num qd-badges">${q.close.map((m) => std(m.id, m.time)).join('')}</td></tr>
          <tr class="qd-next-row"><td colspan="3"><span class="qd-next">${q.close.map((m) => esc(t('toNext', { gap: fmtTime(m.gap), std: stdLabel(m.id) }))).join(' · ')}</span></td></tr>`).join('')}</tbody></table>` : ''}
      </section>`).join('')}</div>` : state.swimmers.length && !loading ? `<p class="muted">${esc(t('qualNoneYet'))}</p>` : ''}
    ${loading ? `<p class="muted small">${esc(t('loading'))}</p>` : ''}
    ${shown.length && none.length ? `<p class="muted small">${esc(t('qualNotReached'))}: ${none.map((p) => esc(p.s.name)).join(', ')}</p>` : ''}
    <div class="qual-source small muted">
      <p>${esc(t('qdNearNote'))}</p>
      <p>${esc(t('qualWindow', { from: QUAL.windowStart }))}</p>
      <p>${esc(t('qualSource', { version: doc.version, checked: QUAL.checked }))} <a href="${QUAL.page}" target="_blank" rel="noopener">svensksimidrott.se ↗</a></p>
    </div>`;
}

function qualView() {
  if (state.qComp === 'done') return qualDoneView();
  const comp = state.qComp;
  const sex = state.qSex;
  const pool = comp === 'para' ? 25 : state.qPool;
  const std = (id) => QUAL.standards.find((x) => x.id === id);
  const cls = state.qClass;
  const prefixFor = (code) => { const st = eventInfo(code).stroke; return st === 'breast' ? 'SB' : st === 'medley' ? 'SM' : 'S'; };
  let cols, rowsFor;
  if (comp === 'sm') {
    cols = [['smA', 'A'], ['smB', 'B']];
    rowsFor = (code) => cols.map(([id]) => std(id).rows.find((r) => r[0] === sex && r[1] === code)?.[2]);
  } else if (comp === 'usm') {
    cols = std('usm').ages.map(([a, b]) => [`usm${a}`, `${a}–${b} ${t('years')}`]);
    rowsFor = (code) => std('usm').ages.map(([a]) => std('usm').rows.find((r) => r[0] === sex && r[1] === a && r[2] === code)?.[3]);
  } else {
    cols = [['paraA', 'A'], ['paraB', 'B']];
    rowsFor = (code) => cols.map(([id]) => std(id).rows.find((r) => r[0] === sex && r[1] === prefixFor(code) + cls && r[2] === code)?.[3]);
  }
  const ids = comp === 'sm' ? ['smA', 'smB'] : comp === 'usm' ? ['usm'] : ['paraA', 'paraB'];
  const codes = [...new Set(ids.flatMap((id) => std(id).rows.map((r) => r[r.length - 2])))]
    .filter((c) => c % 2 === (pool === 25 ? 1 : 0))
    .sort((a, b) => eventSortKey(a) - eventSortKey(b));
  const swimmers = state.swimmers.filter((s) => sexOf(s.sex) === sex);
  const reached = (code) => swimmers.flatMap((s) => {
    const q = qualRows(s).find((x) => x.event === code);
    const hit = q?.reached.find((x) => ids.includes(x.id));
    return hit ? [{ s, hit, time: q.result.time }] : [];
  });
  // swimmers within 3 % of a standard of this championship that they have not reached yet
  const nearBy = (code) => swimmers.flatMap((s) => {
    const q = qualRows(s).find((x) => x.event === code);
    const m = q?.missing.find((x) => ids.includes(x.id) && x.gap / q.result.time <= NEAR);
    if (!m) return [];
    const hit = q.reached.find((x) => ids.includes(x.id));
    return hit && ORDER.indexOf(hit.id) < ORDER.indexOf(m.id) ? [] : [{ s, m, time: q.result.time }];
  });
  const lines = codes.map((code) => ({ code, vals: rowsFor(code), who: reached(code), near: nearBy(code) })).filter((l) => l.vals.some(Boolean));
  const doc = std(ids[0]);
  return `
    <div class="rank-controls qual-controls">
      ${qualTabs()}
      <div class="seg" role="group">${[['W', t('women')], ['M', t('men')]].map(([k, v]) => `<button data-qsex="${k}" aria-pressed="${sex === k}">${esc(v)}</button>`).join('')}</div>
      ${comp === 'para'
        ? `<label class="select compact"><span class="sr">${esc(t('paraClass'))}</span><select id="qClass">${Array.from({ length: 14 }, (_, i) => `<option value="${i + 1}" ${cls === i + 1 ? 'selected' : ''}>${esc(t('classN', { n: i + 1 }))}</option>`).join('')}</select></label>`
        : `<div class="seg" role="group">${[25, 50].map((p) => `<button data-qpool="${p}" aria-pressed="${pool === p}">${esc(t(p === 25 ? 'pool25' : 'pool50'))}</button>`).join('')}</div>`}
    </div>
    ${comp === 'para' ? `<p class="muted small rank-note">${esc(t('paraPools'))}</p>` : ''}
    ${comp === 'usm' ? `<p class="muted small rank-note">${esc(t('usmAges', { year: QUAL.year }))}</p>` : ''}
    <div class="table-scroll"><table class="compare qual-table">
      <thead><tr><th>${esc(t('event'))}</th>${cols.map(([, label]) => `<th class="num">${esc(label)}</th>`).join('')}<th>${esc(t('reachedByNear'))}</th></tr></thead>
      <tbody>${lines.map((l) => `<tr><th scope="row">${esc(eventLabel(l.code, state.lang))}${comp === 'para' ? ` <small class="muted">${prefixFor(l.code)}${cls}</small>` : ''}</th>
        ${l.vals.map((v) => `<td class="num">${v ? fmtTime(v) : '<span class="muted">–</span>'}</td>`).join('')}
        <td class="who-cell">${l.who.map((w) => { const n = l.near.find((x) => x.s.id === w.s.id); const gap = n ? esc(t('toNext', { gap: fmtTime(n.m.gap), std: stdLabel(n.m.id) })) : ''; return `<button class="pick small-pick" data-open="${w.s.id}" title="${esc(w.s.name)} · ${fmtTime(w.time)}${gap ? ' · ' + gap : ''}">${esc(String(w.s.name).split(' ')[0])} ${qBadge(w.hit.id)}${gap ? ` <span class="muted near-txt">${gap}</span>` : ''}</button>`; }).join('')}${l.near.filter((w) => !l.who.some((x) => x.s.id === w.s.id)).map((w) => `<button class="pick small-pick near-pick" data-open="${w.s.id}" title="${esc(w.s.name)} · ${fmtTime(w.time)} · ${esc(t('toNext', { gap: fmtTime(w.m.gap), std: stdLabel(w.m.id) }))}">${esc(String(w.s.name).split(' ')[0])} <span class="muted">${esc(t('toNext', { gap: fmtTime(w.m.gap), std: stdLabel(w.m.id) }))}</span></button>`).join('')}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="qual-source small muted">
      <p>${esc(t('qualWindow', { from: QUAL.windowStart }))}</p>
      <p>${esc(t('qualSource', { version: doc.version, checked: QUAL.checked }))} <a href="${doc.doc}" target="_blank" rel="noopener">PDF ↗</a> · <a href="${QUAL.page}" target="_blank" rel="noopener">svensksimidrott.se ↗</a></p>
    </div>`;
}

function versionLabel() {
  const date = VERSION.date ? new Date(VERSION.date + 'T12:00:00Z').toLocaleDateString(state.lang, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  return [`v${VERSION.version}`, date].filter(Boolean).join(' · ');
}

function renderFooter() {
  $('#footer').innerHTML = `
    <div class="lang" role="group" aria-label="${esc(t('language'))}">
      ${Object.entries(LANGS).map(([k, v]) => `<button data-lang="${k}" aria-pressed="${state.lang === k}">${esc(v)}</button>`).join('')}
    </div>
    <div class="foot-links">
      ${state.swimmers.length ? `<button class="link" id="share">${esc(t('share'))}</button>` : ''}
      <button class="link" data-action="about">${esc(t('aboutLink'))}</button>
      <button class="link" data-action="syncOpen">${esc(t('syncTitle'))}</button>
      <a class="link" href="${FEEDBACK_URL}" target="_blank" rel="noopener">${esc(t('feedback'))}</a>
    </div>
    ${supportLine(t, esc)}
    <p class="muted small">${esc(t('dataFrom'))}</p>
    <p class="version">SwimDeck – ${esc(t('slogan'))} · © ${new Date().getFullYear()} Peiza · ${esc(versionLabel())}</p>`;
}

// ---------------------------------------------------------------- swimmer dialog

function openSwimmer(id) {
  state.openId = Number(id);
  state.openEvent = null;
  state.openTab = 'events';
  state.meetsShown = 5;
  const d = state.data[state.openId];
  const pools = new Set((d?.all?.bests || []).map((b) => b.pool));
  state.openPool = pools.has(state.openPool) ? state.openPool : pools.has(25) ? 25 : 50;
  renderSwimmerDialog();
  const dlg = $('#swimmerDialog');
  if (!dlg.open) dlg.showModal();
}

function renderSwimmerDialog() {
  const s = state.swimmers.find((x) => x.id === state.openId);
  const dlg = $('#swimmerDialog');
  if (!s) return dlg.open && dlg.close();
  const d = state.data[s.id];
  const sum = d?.all ? summarize(d.all, d.period, d.before) : null;
  const rows = sum ? sum.rows.filter((r) => r.pool === state.openPool) : [];
  state.qualByEvent = Object.fromEntries(qualRows(s).map((q) => [q.event, q]));
  const pools = sum ? [...new Set(sum.rows.map((r) => r.pool))] : [];
  const base = s.site === 'fi' ? 'https://www.tempusopen.fi' : 'https://www.tempusopen.se';
  dlg.innerHTML = `
    <div class="sheet">
      <header class="sheet-head">
        <div>
          <h2>${esc(s.name)}</h2>
          <p class="muted small">${[s.born ? t('born', { year: s.born }) : '', s.club].filter(Boolean).map(esc).join(' · ')}</p>
        </div>
        <button class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button>
      </header>
      <nav class="tabs sheet-tabs" role="tablist">
        <button role="tab" data-otab="events" aria-selected="${state.openTab === 'events'}">${esc(t('tabEvents'))}</button>
        <button role="tab" data-otab="meets" aria-selected="${state.openTab === 'meets'}">${esc(t('tabMeets'))}</button>
        <button role="tab" data-otab="profile" aria-selected="${state.openTab === 'profile'}">${esc(t('tabProfile'))}</button>
      </nav>
      ${state.openTab === 'profile' ? profileView(s) : state.openTab === 'meets' ? `<div id="meetsBox"><p class="muted">${esc(t('loading'))}</p></div>` : `
      <div class="sheet-tools">
        <div class="seg" role="tablist">${pools.sort().map((p) => `<button data-pool="${p}" aria-pressed="${p === state.openPool}">${esc(t(p === 25 ? 'pool25' : 'pool50'))}</button>`).join('')}</div>
        <span class="muted small">${esc(t('periodBest'))}: ${esc(periodName())}</span>
      </div>
      ${!sum ? `<p class="muted">${esc(d?.error ? t('error', { msg: d.error }) : t('loading'))}</p>` : `
      <table class="events">
        <thead><tr><th>${esc(t('event'))}</th><th class="num">${esc(t('pb'))}</th><th class="num">${esc(t('periodBest'))}</th><th class="num hide-sm">${esc(t('points'))}</th></tr></thead>
        <tbody>${rows.map((r) => eventRow(s, r)).join('')}</tbody>
      </table>`}`}
      ${paraSettings(s)}
      <footer class="sheet-foot">
        <a href="${base}/swimmers/${s.id}/swimming" target="_blank" rel="noopener">${esc(t('openTempus'))} ↗</a>
      </footer>
    </div>`;
  if (state.openTab === 'meets') fillMeets(s);
  else if (state.openTab === 'profile') fillForm(s);
  else if (state.openEvent) fillEventDetail(s, state.openEvent);
}

const STROKE_KEYS = ['free', 'back', 'breast', 'fly', 'medley'];

function profileView(s) {
  const d = state.data[s.id];
  if (!d?.all) return `<p class="muted">${esc(t('loading'))}</p>`;
  const p = profile(d.all.bests);
  if (!p.best) return `<p class="muted">${esc(t('profileEmpty'))}</p>`;
  const max = Math.max(...Object.values(p.strokes), 1);
  const distMax = Math.max(...Object.values(p.dist), 1);
  return `
    <div class="profile">
      <div class="profile-radar">${radar(p.strokes)}</div>
      <div class="profile-facts">
        <p><span class="muted small">${esc(t('strongest'))}</span><br><b>${esc(t('stroke_' + p.best))}</b> · ${p.strokes[p.best]} p</p>
        ${p.type ? `<p><span class="muted small">${esc(t('swimmerType'))}</span><br><b>${esc(t('type_' + p.type))}</b></p>` : ''}
        <div class="bars">${['sprint', 'middle', 'distance'].map((k) => `
          <div class="bar-row"><span class="small">${esc(t('dist_' + k))}</span>
            <span class="bar"><span style="width:${Math.round((p.dist[k] / distMax) * 100)}%"></span></span>
            <span class="small num">${p.dist[k] || '–'}</span></div>`).join('')}</div>
        <div class="bars">${STROKE_KEYS.map((k) => `
          <div class="bar-row"><span class="small">${esc(t('stroke_' + k))}</span>
            <span class="bar"><span style="width:${Math.round((p.strokes[k] / max) * 100)}%"></span></span>
            <span class="small num">${p.strokes[k] || '–'}</span></div>`).join('')}</div>
        <p class="muted small">${esc(t('profileNote'))}</p>
      </div>
    </div>
    <h4 class="small muted">${esc(t('formTitle'))}</h4>
    <div id="formBox"><p class="muted small">${esc(t('loading'))}</p></div>`;
}

function radar(strokes) {
  const W = 220, C = 110, R = 80;
  const keys = STROKE_KEYS;
  const max = Math.max(...keys.map((k) => strokes[k]), 1);
  // Scale from 70 % of the best stroke, so differences between strokes are visible.
  const floor = max * 0.7;
  const scale = (v) => (v ? 0.12 + 0.88 * Math.max(0, (v - floor) / (max - floor || 1)) : 0);
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / keys.length;
    return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v];
  };
  const ring = (v) => keys.map((_, i) => pt(i, v).map((n) => n.toFixed(1)).join(',')).join(' ');
  const poly = keys.map((k, i) => pt(i, scale(strokes[k])).map((n) => n.toFixed(1)).join(',')).join(' ');
  return `<svg viewBox="0 0 ${W} ${W}" class="radar" role="img" aria-label="${esc(t('tabProfile'))}">
    ${[0.25, 0.5, 0.75, 1].map((v) => `<polygon points="${ring(v)}" class="radar-ring"/>`).join('')}
    ${keys.map((_, i) => { const [x, y] = pt(i, 1); return `<line x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="radar-ring"/>`; }).join('')}
    <polygon points="${poly}" class="radar-area"/>
    ${keys.map((k, i) => { const [x, y] = pt(i, 1.22); return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" class="radar-label">${esc(t('stroke_' + k))}</text>`; }).join('')}
  </svg>`;
}

async function fillForm(s) {
  const box = () => (state.openId === s.id && state.openTab === 'profile' ? $('#formBox') : null);
  const { results, failed } = await loadAllEvents(s, (done, total) => {
    if (box() && done < total) box().innerHTML = `<p class="muted small">${esc(t('loadingMeets', { done, total }))}</p>`;
  });
  if (!box()) return;
  const f = form(results);
  if (!f.recent.length) {
    box().innerHTML = `<p class="muted small">${esc(t('formEmpty'))}</p>`;
    return;
  }
  const pct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toLocaleString(state.lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;
  const level = f.avg <= 0.5 ? 'top' : f.avg <= 2 ? 'good' : f.avg <= 4 ? 'ok' : 'low';
  const trend = f.prevAvg == null ? '' : f.avg < f.prevAvg - 0.3 ? 'up' : f.avg > f.prevAvg + 0.3 ? 'down' : 'flat';
  box().innerHTML = `
    ${failed ? `<p class="warn small">${esc(t('error', { msg: failed.message }))}</p>` : ''}
    <div class="form-head form-${level}"><b>${esc(t('form_' + level))}</b>
      <span class="small">${esc(t('formAvg', { pct: pct(f.avg), n: f.recent.length }))}${trend ? ' · ' + esc(t('trend_' + trend)) : ''}</span></div>
    <ol class="top form-list">${f.recent.map((w) => `
      <li><span class="small muted nowrap">${esc(shortDate(w.date))}</span><span>${esc(eventLabel(w.event, state.lang, w.name))} <span class="pool">${w.pool} m</span></span>
      <span class="time">${fmtTime(w.time)}</span><span class="small num ${w.pct < 0 ? 'good' : 'muted'}">${w.pct < 0 ? esc(t('newPb')) : pct(w.pct)}</span></li>`).join('')}</ol>`;
}

function paraSettings(s) {
  if (!s.para && !state.cardParts.para) return '';
  const p = s.para || {};
  const sel = (k) => `<label class="select compact"><span>${k}</span><select data-para="${k}"><option value="">–</option>${Array.from({ length: 14 }, (_, i) => `<option value="${i + 1}" ${Number(p[k]) === i + 1 ? 'selected' : ''}>${k}${i + 1}</option>`).join('')}</select></label>`;
  const set = ['S', 'SB', 'SM'].filter((k) => p[k]).map((k) => k + p[k]).join(' · ');
  const label = set ? `${t('paraClass')}: ${set}` : t('paraAdd');
  return `<details class="para-set"><summary class="small muted">${esc(label)}</summary>
    <p class="small muted">${esc(t('paraHint'))}</p><div class="row">${['S', 'SB', 'SM'].map(sel).join('')}</div></details>`;
}

/** Load every event page for a swimmer (cached per session), reporting progress. */
async function loadAllEvents(s, onProgress = () => {}, codes = null) {
  const d = state.data[s.id];
  codes = codes || [...new Set((d?.all?.bests || []).map((b) => b.event))];
  let done = 0;
  onProgress(done, codes.length);
  const queue = codes.slice();
  const results = [];
  let failed = null;
  const worker = async () => {
    while (queue.length) {
      const code = queue.shift();
      try {
        results.push(await loadEvent(s, code));
      } catch (e) {
        failed = e;
      }
      done++;
      onProgress(done, codes.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { results, failed };
}

async function fillMeets(s) {
  const box = () => (state.openId === s.id && state.openTab === 'meets' ? $('#meetsBox') : null);
  const { results, failed } = await loadAllEvents(s, (done, total) => {
    if (box() && done < total) box().innerHTML = `<p class="muted">${esc(t('loadingMeets', { done, total }))}</p>`;
  });
  if (!box()) return;
  const list = meets(results);
  const shown = list.slice(0, state.meetsShown);
  box().innerHTML = `
    ${failed ? `<p class="warn small">${esc(t('error', { msg: failed.message }))}</p>` : ''}
    <ol class="meets">${shown.map((g) => `
      <li class="meet">
        <div class="meet-head">${meetButton(g.meet, g.swims[0].date, g.swims[0].event, `<b>${esc(g.meet)}</b>`, 'strong')}
          <span class="muted small">${esc(g.from === g.to ? g.from : `${g.from} – ${g.to}`)} · ${esc(t('swims', { n: g.swims.length }))}${g.pbs ? ` · <span class="good">${esc(t('pbsAtMeet', { n: g.pbs }))}</span>` : ''}</span></div>
        <table class="meet-swims"><tbody>${g.swims.map((w) => `
          <tr class="${w.pb ? 'pb' : ''}">
            <td>${meetButton(w.meet, w.date, w.event, esc(eventLabel(w.event, state.lang, w.name)), 'plain')} <span class="pool">${w.pool} m</span>${w.round ? ` <span class="muted small">${esc(roundLabel(w.round))}</span>` : ''}</td>
            <td class="num"><b>${fmtTime(w.time)}</b></td>
            <td class="num tag-cell">${w.pb ? `<span class="badge">${esc(t('newPb'))} ${fmtDiff(w.time - w.prevBest)}</span>` : w.first ? `<span class="badge neutral">${esc(t('firstSwim'))}</span>` : ''}</td>
          </tr>`).join('')}</tbody></table>
      </li>`).join('')}</ol>
    ${list.length > shown.length ? `<div class="row"><button class="btn small" data-action="moreMeets">${esc(t('showMore'))}</button></div>` : ''}`;
}

// ---------------------------------------------------------------- meet result lists

const roundLabel = (k) => (!k ? '' : /^heat$|^försök$/i.test(k) ? t('roundHeat') : /^semi/i.test(k) ? t('roundSemi') : /^final$/i.test(k) ? t('roundFinal') : k);
const roundRank = (k) => (/^final$/i.test(k || '') ? 0 : /final/i.test(k || '') ? 1 : /semi/i.test(k || '') ? 2 : 3);
/** Places again within a filtered list (already ordered by round, then time); ties share a place. */
function reRank(rows) {
  return rows.map((r, i, a) => ({ ...r, place: 0, of: a.length })).map((r, i, a) => {
    r.place = i > 0 && a[i - 1].time === r.time && roundRank(a[i - 1].round) === roundRank(r.round) ? a[i - 1].place : i + 1;
    return r;
  });
}
const sexCode = (x) => (/^(wo|fe|kvin|dam|nai|flick|tyt)/i.test(x || '') ? 'W' : x ? 'M' : '');
const meetCache = new Map();

function meetButton(name, date, code, html, kind = '') {
  if (!name || !date) return html;
  return `<button type="button" class="meet-link ${kind}" data-meet="${esc(name)}" data-mdate="${esc(date)}" data-mcode="${Number(code)}" title="${esc(t('meetOpen'))}">${html}</button>`;
}

function openMeet(el) {
  const s = state.swimmers.find((x) => x.id === state.openId);
  state.meet = { name: el.dataset.meet, date: el.dataset.mdate, code: Number(el.dataset.mcode), sex: sexCode(s?.sex), site: s?.site || 'se', me: s?.id ?? null, born: s?.born || null, cohort: false, round: null };
  const dlg = $('#meetDialog');
  renderMeet();
  if (!dlg.open) dlg.showModal();
  loadMeet();
}

async function loadMeet() {
  const m = state.meet;
  const key = [m.site, m.id || m.name, m.date, m.code, m.sex].join('|');
  try {
    if (!meetCache.has(key)) meetCache.set(key, api('/api/meet', { v: 3, site: m.site, ...(m.id ? { id: m.id } : { name: m.name, date: m.date }), code: m.code, sex: m.sex }));
    const data = await meetCache.get(key);
    if (state.meet !== m) return;
    m.id = data.meet?.id || m.id;
    m.data = data;
  } catch (e) {
    meetCache.delete(key);
    if (state.meet !== m) return;
    m.error = e.status === 404 || /not found/i.test(e.message) ? t('meetNotFound') : t('error', { msg: e.message });
  }
  renderMeet();
}

function renderMeet() {
  const m = state.meet;
  const dlg = $('#meetDialog');
  if (!m) return;
  const d = m.data;
  const rounds = d ? [...new Set(d.results.map((r) => r.round || ''))] : [];
  const view = rounds.length > 1 && rounds.includes(m.round) ? m.round : 'all';
  const overall = d ? d.overall || d.results : [];
  const cohort = m.cohort && m.born ? m.born : null;
  const rows = !d ? [] : reRank((view === 'all' ? overall : d.results.filter((r) => (r.round || '') === view)).filter((r) => !cohort || r.born === cohort));
  const listed = new Set(state.swimmers.filter((x) => x.site === m.site).map((x) => x.id));
  const me = rows.find((r) => r.swimmerId === m.me);
  const base = m.site === 'fi' ? 'https://www.tempusopen.fi' : 'https://www.tempusopen.se';
  const meta = d?.meet ? [d.meet.location, d.meet.date, d.meet.pool ? `${d.meet.pool} m` : ''].filter(Boolean).join(' · ') : m.date;
  dlg.innerHTML = `
    <div class="sheet">
      <header class="sheet-head">
        <div>
          <h2>${esc(d?.meet?.name || m.name)}</h2>
          <p class="muted small">${esc(meta)}</p>
        </div>
        <button class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button>
      </header>
      <div class="sheet-tools">
        <b>${esc(eventLabel(m.code, state.lang))}</b>
        <div class="seg small" role="group">${[['W', t('women')], ['M', t('men')]].map(([k, v]) => `<button data-msex="${k}" aria-pressed="${m.sex === k}">${esc(v)}</button>`).join('')}</div>
      </div>
      ${m.born ? `<div class="seg small" role="group">${[[0, t('meetAllAges')], [1, t('meetCohort', { year: m.born })]].map(([k, v]) => `<button data-mcohort="${k}" aria-pressed="${!!m.cohort === !!k}">${esc(v)}</button>`).join('')}</div>` : ''}
      ${rounds.length > 1 ? `<div class="seg small" role="group">${[['all', t('meetOverall')], ...rounds.map((k) => [k, roundLabel(k) || '–'])].map(([k, v]) => `<button data-mround="${esc(k)}" aria-pressed="${view === k}">${esc(v)}</button>`).join('')}</div>` : ''}
      ${m.error ? `<p class="warn">${esc(m.error)}</p>` : !d ? `<p class="muted">${esc(t('loading'))}</p>` : `
        ${me ? `<p class="meet-me">${esc(t('placeOf', { place: me.place, of: me.of }))}${me.round && rounds.length > 1 ? ` · ${esc(roundLabel(me.round))}` : ''} · <b>${fmtTime(me.time)}</b></p>` : ''}
        ${rows.length ? `<table class="meet-list"><tbody>${rows.map((r) => `
          <tr class="${r.swimmerId === m.me ? 'me' : listed.has(r.swimmerId) ? 'mine' : ''}">
            <td class="num place">${r.place}</td>
            <td>${esc(r.swimmer)}${r.born ? ` <span class="muted small">${r.born}</span>` : ''}<small class="muted">${esc(r.club)}${view === 'all' && rounds.length > 1 ? ` · ${esc(roundLabel(r.round))}` : ''}</small></td>
            <td class="num"><b>${fmtTime(r.time)}</b><small class="muted">${r.points || ''}</small></td>
          </tr>`).join('')}</tbody></table>` : `<p class="muted">${esc(t('meetEmpty'))}</p>`}
        ${d.complete ? '' : `<p class="muted small">${esc(t('meetPartial', { n: d.results.length, total: d.total }))}</p>`}
        <p class="muted small">${esc(t(d.ambiguous ? 'meetNoteMixed' : 'meetNote'))}</p>`}
      <footer class="sheet-foot">
        ${m.id ? `<a href="${base}/competitions/swimming/${Number(m.id)}" target="_blank" rel="noopener">${esc(t('meetOnTempus'))} ↗</a>` : '<span></span>'}
        <button class="btn primary" data-action="close">${esc(t('done'))}</button>
      </footer>
    </div>`;
}

function eventRow(s, r) {
  const open = state.openEvent === r.event;
  const q = (state.qualByEvent || {})[r.event];
  const qHtml = q ? `${q.best.map((x) => ' ' + qBadge(x.id)).join('')}${q.next && q.next.gap / q.result.time < 0.08 ? `<small class="qnext">${esc(t('toNext', { std: stdLabel(q.next.id), gap: fmtTime(q.next.gap) }))}</small>` : ''}` : '';
  const goal = s.goals?.[r.event];
  const gHtml = goal ? (r.pb && r.pb.time <= goal ? ` <span class="gbadge ok">✓ ${esc(t('goal'))}</span>` : `<small class="qnext">${esc(t('goal'))} ${fmtTime(goal)}${r.pb ? ' · ' + esc(t('goalLeft', { gap: fmtTime(r.pb.time - goal) })) : ''}</small>`) : '';
  return `
    <tr class="ev ${r.newPb ? 'pb' : ''} ${open ? 'open' : ''}" data-event="${r.event}" tabindex="0" aria-expanded="${open}">
      <td><span class="chev" aria-hidden="true">›</span>${esc(eventLabel(r.event, state.lang, r.name))}${r.newPb ? ` <span class="badge">${esc(t('newPb'))}${r.improve ? ' ' + fmtDiff(-r.improve) : ''}</span>` : ''}${qHtml}${gHtml}</td>
      <td class="num"><b>${r.pb ? fmtTime(r.pb.time) : '–'}</b><small>${esc(r.pb?.date || '')}</small></td>
      <td class="num">${r.period ? `${fmtTime(r.period.time)}<small class="${r.diff > 0 ? '' : 'good'}">${r.diff != null ? fmtDiff(r.diff) : ''}</small>` : '<span class="muted">–</span>'}</td>
      <td class="num hide-sm">${r.pb?.points || ''}</td>
    </tr>
    ${open ? `<tr class="detail"><td colspan="4"><div id="eventDetail" class="event-detail"><p class="muted">${esc(t('loading'))}</p></div></td></tr>` : ''}`;
}

async function fillEventDetail(s, code) {
  const box = $('#eventDetail');
  if (!box) return;
  try {
    const ev = await loadEvent(s, code);
    if (state.openEvent !== code || !$('#eventDetail')) return;
    const n = state.topN === 'all' ? ev.results.length : state.topN;
    const recent = state.topOrder === 'recent';
    const pbTime = ev.results[0]?.time;
    const ordered = recent ? [...ev.results].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.round === 'Final') - (a.round === 'Final')) : ev.results;
    const top = ordered.slice(0, n);
    $('#eventDetail').innerHTML = `
      ${goalEditor(s, code, ev.results[0]?.time)}
      <div class="detail-tools">
        <span class="muted small">${esc(t('swims', { n: ev.results.length }))}</span>
        <div class="seg small" role="group" aria-label="${esc(t('order'))}">
          ${['fast', 'recent'].map((k) => `<button data-toporder="${k}" aria-pressed="${state.topOrder === k}">${esc(t(k === 'fast' ? 'orderFast' : 'orderRecent'))}</button>`).join('')}
        </div>
        <div class="seg small" role="group" aria-label="${esc(t('topN'))}">
          ${[3, 5, 7, 10, 'all'].map((k) => `<button data-topn="${k}" aria-pressed="${state.topN === k}">${k === 'all' ? esc(t('all')) : k}</button>`).join('')}
        </div>
      </div>
      <ol class="top ${recent ? 'recent' : ''}">${top.map((r, i) => `
        <li><span class="pos">${recent ? '' : i + 1}</span><span class="time ${r.time === pbTime ? 'is-pb' : ''}">${fmtTime(r.time)}${recent && r.time !== pbTime ? `<small class="muted"> ${fmtDiff(r.time - pbTime)}</small>` : ''}</span>
        <span class="small"><span>${esc(r.date)}</span> · ${meetButton(r.meet, r.date, code, `${esc(r.meet)}${r.round ? ' · ' + esc(roundLabel(r.round)) : ''}`)}</span>
        <span class="small muted num">${r.points || ''}</span></li>`).join('')}</ol>
      <div id="rankBox" class="rank-box"></div>
      ${prognosisLine(s, code, ev.results)}
      ${ev.results.length > 1 ? `<h4 class="small muted">${esc(t('progression'))}</h4>${chart(ev.results, s.goals?.[code] || null)}` : ''}
      ${seasonTable(ev.results)}`;
    fillRank(s, code);
  } catch (e) {
    box.innerHTML = `<p class="warn">${esc(t('error', { msg: e.message }))}</p><button class="btn small" data-retry-event="${code}">${esc(t('retry'))}</button>`;
  }
}

function goalEditor(s, code, pb) {
  const goal = s.goals?.[code];
  const status = goal && pb ? (pb <= goal ? `<span class="goal-ok">✓ ${esc(t('goalReached'))}</span>` : `<span class="muted">${esc(t('goalLeft', { gap: fmtTime(pb - goal) }))}</span>`) : '';
  return `<div class="goal-edit">
    <label class="small"><span>${esc(t('goal'))}</span>
      <input id="goalInput" data-code="${code}" inputmode="decimal" autocomplete="off" placeholder="${esc(t('goalPlaceholder'))}" value="${goal ? esc(fmtTime(goal)) : ''}"></label>
    <button class="btn small" data-action="goalSave" data-code="${code}">${esc(t('goalSave'))}</button>
    ${goal ? `<button class="link small" data-action="goalClear" data-code="${code}">${esc(t('goalClear'))}</button>` : ''}
    <span class="small goal-status">${status}</span>
  </div>`;
}

function setGoal(code, value) {
  const s = state.swimmers.find((x) => x.id === state.openId);
  if (!s) return;
  const goals = { ...(s.goals || {}) };
  if (value == null) delete goals[code];
  else goals[code] = value;
  s.goals = Object.keys(goals).length ? goals : undefined;
  save();
  renderSwimmerDialog();
  renderMain();
}

function prognosisLine(s, code, results) {
  const q = (state.qualByEvent || {})[code];
  if (!q?.next) return '';
  const p = prognosis(results, q.next.time);
  const label = stdLabel(q.next.id);
  if (!p) return `<p class="small muted prog">${esc(t('progNone', { std: label, gap: fmtTime(q.next.gap) }))}</p>`;
  const when = new Date(p.date + 'T12:00:00Z').toLocaleDateString(state.lang, { year: 'numeric', month: 'long' });
  return `<p class="small prog">${esc(t('progWhen', { std: label, when, gap: fmtTime(q.next.gap) }))}</p>`;
}

async function fillRank(s, code) {
  const box = () => (state.openEvent === code ? $('#rankBox') : null);
  const d = state.data[s.id];
  const row = d?.period?.bests?.find((b) => b.event === code);
  const sex = sexOf(s.sex);
  if (!box() || !row || !s.born || !sex || s.site !== 'se') return;
  const { from, to } = periodRange(state.period);
  box().innerHTML = `<span class="muted small">${esc(t('rankLoading'))}</span>`;
  try {
    const key = `rank:${s.id}:${code}:${from}:${to}:${row.time}`;
    state.events[key] ||= api('/api/rank', { event: code, sex, born: s.born, from, to, time: row.time });
    const r = await state.events[key];
    if (!box()) return;
    if (!r.available) {
      box().innerHTML = `<span class="muted small">${esc(t('rankTooYoung'))}</span>`;
      return;
    }
    const head = r.complete ? t('rankPlace', { place: r.rank }) : t('rankBeyond', { n: r.rank - 1 });
    box().innerHTML = `<div class="rank-line"><span class="rank-num">${esc(head)}</span>
      <span class="small muted">${esc(t('rankDetail', { year: s.born, period: periodName(), time: fmtTime(row.time) }))}${r.leader && r.rank > 1 ? ' · ' + esc(t('rankLeader', { time: fmtTime(r.leader) })) : ''}</span></div>`;
  } catch (e) {
    if (box()) box().innerHTML = `<span class="muted small">${esc(t('error', { msg: e.message }))}</span>`;
  }
}

function seasonTable(results) {
  const sb = seasonBests(results);
  if (sb.length < 2) return '';
  return `<h4 class="small muted">${esc(t('seasonBests'))}</h4>
    <table class="seasons"><thead><tr><th>${esc(t('season'))}</th><th class="num">${esc(t('time'))}</th><th class="num">${esc(t('change'))}</th><th class="num hide-sm">${esc(t('swimsCol'))}</th></tr></thead>
    <tbody>${sb.map((x) => `<tr><td>${esc(x.season)}</td><td class="num"><b>${fmtTime(x.best.time)}</b></td>
      <td class="num ${x.change < 0 ? 'good' : x.change > 0 ? 'muted' : ''}">${x.change == null ? '' : fmtDiff(x.change)}</td><td class="num hide-sm muted">${x.count}</td></tr>`).join('')}</tbody></table>`;
}

function chart(results, goal = null) {
  const pts = progression(results);
  const W = 320, H = 130, P = { l: 44, r: 8, t: 8, b: 20 };
  const ts = pts.map((p) => Date.parse(p.date));
  const x0 = Math.min(...ts), x1 = Math.max(...ts) || x0 + 1;
  const times = pts.map((p) => p.time).concat(goal ? [goal] : []);
  const y0 = Math.min(...times), y1 = Math.max(...times);
  const pad = Math.max(10, (y1 - y0) * 0.08);
  const X = (t) => P.l + ((t - x0) / Math.max(1, x1 - x0)) * (W - P.l - P.r);
  const Y = (v) => P.t + ((v - (y0 - pad)) / Math.max(1, y1 - y0 + 2 * pad)) * (H - P.t - P.b); // faster = higher
  let step = '';
  pts.forEach((p, i) => {
    const x = X(ts[i]), y = Y(p.best);
    step += i ? ` H${x.toFixed(1)} V${y.toFixed(1)}` : `M${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  step += ` H${(W - P.r).toFixed(1)}`;
  const yTicks = [y0, (y0 + y1) / 2, y1];
  const years = [...new Set(pts.map((p) => p.date.slice(0, 4)))];
  const yearTicks = years.filter((_, i) => years.length < 7 || i % Math.ceil(years.length / 6) === 0);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('progression'))}">
    ${yTicks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${P.l - 4}" y="${Y(v) + 3}" class="axis" text-anchor="end">${fmtTime(v)}</text>`).join('')}
    ${yearTicks.map((yr) => { const x = X(Date.UTC(Number(yr), 0, 1)); return x >= P.l ? `<text x="${x}" y="${H - 5}" class="axis" text-anchor="middle">${yr}</text>` : ''; }).join('')}
    ${goal ? `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(goal).toFixed(1)}" y2="${Y(goal).toFixed(1)}" class="goal-line"/><text x="${W - P.r - 2}" y="${(Y(goal) - 3).toFixed(1)}" class="axis goal-label" text-anchor="end">${esc(t('goal'))} ${fmtTime(goal)}</text>` : ''}
    <path d="${step}" class="best"/>
    ${pts.map((p, i) => `<circle cx="${X(ts[i]).toFixed(1)}" cy="${Y(p.time).toFixed(1)}" r="${p.time === p.best ? 3 : 2.2}" class="${p.time === p.best ? 'dot pb' : 'dot'}"><title>${fmtTime(p.time)} · ${esc(p.date)}</title></circle>`).join('')}
  </svg>`;
}

// ---------------------------------------------------------------- add dialog

function openAdd() {
  const dlg = $('#addDialog');
  dlg.innerHTML = `
    <form class="sheet" id="searchForm" method="dialog">
      <header class="sheet-head"><h2>${esc(t('searchTitle'))}</h2><button type="button" class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
      <div class="fields">
        <label><span>${esc(t('firstName'))}</span><input name="first" autocomplete="off"></label>
        <label><span>${esc(t('lastName'))}</span><input name="last" autocomplete="off"></label>
        <label class="wide"><span>${esc(t('club'))}</span><input name="club" autocomplete="off" placeholder="${esc(t('clubPlaceholder'))}"></label>
        <label class="check"><input type="checkbox" name="active" checked> <span>${esc(t('activeOnly'))}</span></label>
        <label class="select compact"><span class="sr">${esc(t('sexFilter'))}</span><select name="sex"><option value="">${esc(t('allSexes'))}</option><option value="W">${esc(t('women'))}</option><option value="M">${esc(t('men'))}</option></select></label>
      </div>
      <button class="btn primary" type="submit" id="doSearch">${esc(t('search'))}</button>
      <div id="hits" aria-live="polite"></div>
      <div class="paste import-cta">
        <span class="muted small">${esc(t('importCta'))}</span>
        <button type="button" class="btn small" data-action="importOpen">${esc(t('importOpen'))}</button>
      </div>
      <div class="paste">
        <label><span class="muted small">${esc(t('orPaste'))}</span>
          <div class="row"><input name="link" placeholder="${esc(t('pastePlaceholder'))}" inputmode="url"><button type="button" class="btn" id="addLink">${esc(t('addBtn'))}</button></div>
        </label>
      </div>
    </form>`;
  dlg.showModal();
  $('input[name=last]', dlg).focus();
}

let searchState = null;

// ---------------------------------------------------------------- import from a pasted list

let importState = null; // { entries, groups, groupBy, status: Map(key -> {state, candidates, pick}), selected: Set }

function openImport() {
  importState = importState || { entries: [], groups: [], groupBy: 'club', status: new Map(), selected: new Set(), text: '' };
  renderImport();
}

function renderImport() {
  const dlg = $('#addDialog');
  const st = importState;
  const found = st.entries.filter((e) => st.status.get(e.key)?.pick);
  dlg.innerHTML = `
    <div class="sheet import-sheet">
      <header class="sheet-head"><div><h2>${esc(t('importTitle2'))}</h2><p class="muted small">${esc(t('importHint'))}</p></div>
        <button type="button" class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
      ${!st.entries.length ? `
        <textarea id="importText" rows="10" placeholder="${esc(t('importPlaceholder'))}">${esc(st.text)}</textarea>
        <div class="row"><button type="button" class="btn primary" data-action="importParse">${esc(t('importFind'))}</button>
          <button type="button" class="link" data-action="add">${esc(t('back'))}</button></div>
        <p class="muted small">${esc(t('importPrivacy'))}</p>`
      : `
        <div class="row wrap import-tools">
          <span class="small muted">${esc(t('importFound', { n: st.entries.length, m: found.length }))}</span>
          <span class="spacer"></span>
          ${st.groups.length ? `<div class="seg small" role="group">${['club', 'group'].map((k) => `<button type="button" data-igroup="${k}" aria-pressed="${st.groupBy === k}">${esc(t(k === 'club' ? 'club' : 'event'))}</button>`).join('')}</div>` : ''}
        </div>
        <div class="import-list">${importGroups().map(([label, list]) => `
          <section class="igroup">
            <label class="igroup-head"><input type="checkbox" data-igroup-all="${esc(label)}" ${list.every((e) => !selectable(e) || st.selected.has(e.key)) && list.some(selectable) ? 'checked' : ''} ${list.some(selectable) ? '' : 'disabled'}>
              <b>${esc(label || t('importNoGroup'))}</b> <span class="muted small">${list.length}</span></label>
            ${list.map(importRow).join('')}
          </section>`).join('')}</div>
        <div class="row end wrap import-foot">
          <button type="button" class="link" data-action="importReset">${esc(t('importAgain'))}</button>
          <button type="button" class="btn primary" data-action="importAdd" ${st.selected.size ? '' : 'disabled'}>${esc(t('importAdd', { n: st.selected.size }))}</button>
        </div>`}
    </div>`;
  if (!dlg.open) dlg.showModal();
  $('#importText')?.focus();
}

function selectable(e) {
  const pick = importState.status.get(e.key)?.pick;
  return !!pick && !state.swimmers.some((s) => s.id === pick.id);
}

function importGroups() {
  const st = importState;
  const map = new Map();
  for (const e of st.entries) {
    const labels = st.groupBy === 'group' ? (e.groups.length ? e.groups : ['']) : [e.club || ''];
    for (const l of labels) {
      if (!map.has(l)) map.set(l, []);
      map.get(l).push(e);
    }
  }
  return [...map.entries()].sort((a, b) => (st.groupBy === 'group' ? 0 : a[0].localeCompare(b[0], state.lang)));
}

function importRow(e) {
  const st = importState.status.get(e.key) || { state: 'wait' };
  const pick = st.pick;
  const inList = pick && state.swimmers.some((s) => s.id === pick.id);
  const meta = [e.born, e.club].filter(Boolean).join(' · ');
  let right;
  if (st.state === 'wait') right = `<span class="muted small">${esc(t('searching'))}</span>`;
  else if (inList) right = `<span class="muted small">${esc(t('alreadyInList'))}</span>`;
  else if (!st.candidates?.length) right = `<span class="warn small">${esc(t('importNotFound'))}</span>`;
  else if (st.candidates.length > 1 && !st.sure)
    right = `<select class="ipick" data-ipick="${esc(e.key)}"><option value="">${esc(t('importChoose'))}</option>${st.candidates.slice(0, 6).map((c) => `<option value="${c.id}" ${pick?.id === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc([c.born, c.club].filter(Boolean).join(' · '))}</option>`).join('')}</select>`;
  else right = `<span class="small ok-match">✓ ${esc([pick.born, pick.club].filter(Boolean).join(' · '))}</span>`;
  return `<label class="irow ${selectable(e) ? '' : 'off'}">
    <input type="checkbox" data-isel="${esc(e.key)}" ${importState.selected.has(e.key) ? 'checked' : ''} ${selectable(e) ? '' : 'disabled'}>
    <span class="iname"><b>${esc(e.first)} ${esc(e.last)}</b><span class="muted small">${esc(meta)}</span></span>
    <span class="iright">${right}</span></label>`;
}

const importCache = new Map();
async function importSearch(first, last) {
  const k = `${first}|${last}`.toLocaleLowerCase('sv');
  if (!importCache.has(k)) importCache.set(k, api('/api/search', { first, last }).then((r) => r.swimmers).catch(() => []));
  return importCache.get(k);
}

async function runImport(text) {
  const { entries, groups } = parseList(text);
  const MAX = 80;
  importState = { entries: entries.slice(0, MAX), groups, groupBy: groups.length > 1 ? 'group' : 'club', status: new Map(), selected: new Set(), text, truncated: entries.length > MAX };
  if (!entries.length) {
    toast(t('importNothing'));
    importState.entries = [];
    return renderImport();
  }
  if (importState.truncated) toast(t('importMax', { n: MAX }));
  renderImport();
  const queue = importState.entries.slice();
  const work = async () => {
    while (queue.length) {
      const e = queue.shift();
      let list = await importSearch(e.first.split(' ')[0], e.last);
      if (!list.length) list = await importSearch('', e.last);
      const { candidates, sure } = rankCandidates(e, list);
      const pick = candidates.length && (sure || candidates.length === 1) ? candidates[0] : null;
      importState.status.set(e.key, { state: 'done', candidates, sure, pick });
      if (pick && !state.swimmers.some((s) => s.id === pick.id)) importState.selected.add(e.key);
      if ($('#addDialog').open && $('.import-sheet')) renderImportKeepScroll();
    }
  };
  await Promise.all([work(), work(), work()]);
}

function renderImportKeepScroll() {
  const box = $('.import-list');
  const top = box ? box.scrollTop : 0;
  renderImport();
  const nb = $('.import-list');
  if (nb) nb.scrollTop = top;
}

function addImported() {
  const picks = importState.entries.filter((e) => importState.selected.has(e.key)).map((e) => importState.status.get(e.key)?.pick).filter(Boolean);
  const added = [];
  for (const p of picks) {
    const sw = addSwimmer({ ...p, site: 'se' }, { load: false });
    if (sw) added.push(sw);
  }
  importState = null;
  $('#addDialog').close();
  render();
  if (added.length) refreshAll({ only: added });
  toast(t('importDone', { n: added.length }));
}

async function doSearch(form, page = 1) {
  const f = new FormData(form);
  const params = {
    first: f.get('first').trim(),
    last: f.get('last').trim(),
    club: f.get('club').trim(),
    active: f.get('active') ? 1 : '',
    sex: f.get('sex') || '',
  };
  if (!params.first && !params.last && !params.club) return;
  const hits = $('#hits');
  if (page === 1) {
    searchState = { params, swimmers: [], total: 0, page: 0, lastPage: 1 };
    hits.innerHTML = `<p class="muted">${esc(t('searching'))}</p>`;
  }
  try {
    const r = await api('/api/search', { ...params, page });
    searchState.swimmers.push(...r.swimmers);
    Object.assign(searchState, { total: r.total, page: r.page || page, lastPage: r.lastPage || 1 });
    renderHits();
  } catch (e) {
    hits.innerHTML = `<p class="warn">${esc(t('error', { msg: e.message }))}</p>`;
  }
}

function renderHits() {
  const hits = $('#hits');
  if (!hits || !searchState) return;
  const list = searchState.swimmers;
  if (!list.length) return (hits.innerHTML = `<p class="muted">${esc(t('noHits'))}</p>`);
  const notAdded = list.filter((s) => !state.swimmers.some((x) => x.id === s.id));
  hits.innerHTML = `
    <div class="hits-head"><p class="muted small">${esc(t('hitsShown', { n: list.length, total: searchState.total }))}</p>
      ${notAdded.length > 1 ? `<button type="button" class="btn small" data-action="addAll">${esc(t('addAll', { n: Math.min(notAdded.length, 30) }))}</button>` : ''}</div>
    <ul class="hits">${list.map((s) => {
      const has = state.swimmers.some((x) => x.id === s.id);
      return `<li><span><b>${esc(s.name)}</b><span class="muted small">${esc([s.born, s.club, sexLabel(s.sex)].filter(Boolean).join(' · '))}</span></span>
        <button type="button" class="btn small ${has ? '' : 'primary'}" data-add='${esc(JSON.stringify(pickSwimmer(s, 'se')))}' ${has ? 'disabled' : ''}>${esc(has ? t('added') : t('addBtn'))}</button></li>`;
    }).join('')}</ul>
    ${searchState.page < searchState.lastPage ? `<button type="button" class="btn small more" data-action="moreHits">${esc(t('showMore'))}</button>` : ''}`;
}

function addSwimmer(s, { load = true } = {}) {
  if (state.swimmers.some((x) => x.id === s.id)) return null;
  state.trash = state.trash.filter((x) => x.swimmer.id !== s.id);
  const sw = { id: s.id, site: s.site || 'se', name: s.name || '', born: s.born ?? null, club: s.club || '', sex: s.sex || '' };
  state.swimmers.push(sw);
  save();
  render();
  if (load) refreshAll({ only: [sw] });
  return sw;
}

// ---------------------------------------------------------------- share / import

async function share() {
  const ids = state.swimmers.map((s) => (s.site === 'se' ? s.id : `${s.site}${s.id}`)).join(',');
  const url = `${location.origin}${location.pathname}#add=${ids}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'SwimDeck', text: t('shareHint'), url });
      return;
    } catch {}
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t('shareCopied'));
  } catch {
    prompt(t('share'), url);
  }
}

function checkSyncLink() {
  const m = location.hash.match(/sync=([A-Za-z0-9_-]{32,64})/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (state.sync?.token === m[1]) return;
  joinSync(m[1]);
}

function checkImport() {
  const m = location.hash.match(/add=([\w,]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const refs = m[1].split(',').map((x) => {
    const mm = x.match(/^(fi)?(\d+)$/);
    return mm ? { site: mm[1] || 'se', id: Number(mm[2]) } : null;
  }).filter(Boolean).filter((r) => !state.swimmers.some((s) => s.id === r.id)).slice(0, 50);
  if (!refs.length) return;
  const dlg = $('#confirmDialog');
  dlg.innerHTML = `<form method="dialog" class="sheet small-sheet">
    <h2>${esc(t('importTitle'))}</h2><p>${esc(t('importBody', { n: refs.length }))}</p>
    <div class="row end"><button class="btn" value="no">${esc(t('cancel'))}</button><button class="btn primary" value="yes">${esc(t('importYes'))}</button></div></form>`;
  dlg.onclose = () => {
    if (dlg.returnValue !== 'yes') return;
    const added = refs.map((r) => ({ id: r.id, site: r.site, name: '', born: null, club: '', sex: '' }));
    state.swimmers.push(...added);
    save();
    render();
    refreshAll({ only: added });
  };
  dlg.showModal();
}

function toast(msg, action = null) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-toast-action>${esc(action.label)}</button>` : ''}`;
  toast.action = action?.run || null;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), action ? 8000 : 2500);
}

function hideToast() {
  clearTimeout(toast.timer);
  $('#toast').classList.remove('show');
}

/** A small yes/no dialog. Resolves true when the person confirms. */
function ask({ title, body, yes, danger = false }) {
  return new Promise((resolve) => {
    const dlg = $('#confirmDialog');
    dlg.innerHTML = `<form method="dialog" class="sheet small-sheet">
      <h2>${esc(title)}</h2><p>${esc(body)}</p>
      <div class="row end"><button class="btn" value="no">${esc(t('cancel'))}</button><button class="btn ${danger ? 'danger' : 'primary'}" value="yes">${esc(yes)}</button></div></form>`;
    dlg.returnValue = '';
    dlg.onclose = () => resolve(dlg.returnValue === 'yes');
    dlg.showModal();
    $('button[value=no]', dlg).focus();
  });
}

// ---------------------------------------------------------------- remove, trash, undo

async function askRemove(id) {
  const s = state.swimmers.find((x) => x.id === Number(id));
  if (!s) return;
  const ok = await ask({ title: t('removeTitle'), body: t('removeBody', { name: s.name || '#' + s.id, days: TRASH_DAYS }), yes: t('remove'), danger: true });
  if (!ok) return;
  const index = state.swimmers.indexOf(s);
  state.swimmers.splice(index, 1);
  state.collapsed = state.collapsed.filter((x) => x !== s.id);
  state.trash = [{ swimmer: s, removedAt: Date.now(), index }, ...state.trash.filter((x) => x.swimmer.id !== s.id)];
  delete state.data[s.id];
  save();
  if ($('#swimmerDialog').open && state.openId === s.id) $('#swimmerDialog').close();
  render();
  toast(t('removed', { name: s.name || '#' + s.id }), { label: t('undo'), run: () => restore(s.id) });
}

function restore(id) {
  const item = state.trash.find((x) => x.swimmer.id === Number(id));
  if (!item) return;
  state.trash = state.trash.filter((x) => x !== item);
  if (!state.swimmers.some((x) => x.id === item.swimmer.id)) {
    state.swimmers.splice(Math.min(item.index ?? state.swimmers.length, state.swimmers.length), 0, item.swimmer);
  }
  save();
  render();
  if ($('#trashDialog').open) renderTrash();
  refreshAll({ only: [item.swimmer] });
}

function openTrash() {
  renderTrash();
  const dlg = $('#trashDialog');
  if (!dlg.open) dlg.showModal();
}

function renderTrash() {
  const dlg = $('#trashDialog');
  const fmtDate = (ms) => new Date(ms).toLocaleDateString(state.lang);
  dlg.innerHTML = `<div class="sheet">
    <header class="sheet-head"><div><h2>${esc(t('trash'))}</h2><p class="muted small">${esc(t('trashHint', { days: TRASH_DAYS }))}</p></div>
      <button class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
    ${state.trash.length ? `<ul class="hits">${state.trash.map((x) => `
      <li><span><b>${esc(x.swimmer.name || '#' + x.swimmer.id)}</b><span class="muted small">${esc(t('removedOn', { date: fmtDate(x.removedAt) }))}</span></span>
        <span class="row"><button class="btn small primary" data-restore="${x.swimmer.id}">${esc(t('restore'))}</button>
        <button class="btn small" data-purge="${x.swimmer.id}" aria-label="${esc(t('deletePermanent'))}" title="${esc(t('deletePermanent'))}">${ICON.trash}</button></span></li>`).join('')}</ul>
      <div class="row end"><button class="link danger" data-action="emptyTrash">${esc(t('emptyTrash'))}</button></div>`
      : `<p class="muted">${esc(t('trashEmpty'))}</p>`}
  </div>`;
}

async function purge(ids) {
  const n = ids.length;
  const ok = await ask({ title: t('deletePermanent'), body: t('purgeConfirm', { n }), yes: t('deletePermanent'), danger: true });
  if (!ok) return;
  state.trash = state.trash.filter((x) => !ids.includes(x.swimmer.id));
  save();
  renderTrash();
  render();
}

// ---------------------------------------------------------------- events

document.addEventListener('click', (e) => {
  const el = e.target.closest('button, [data-open], tr.ev, a');
  if (!el) {
    // click on the dialog backdrop closes it
    if (e.target.tagName === 'DIALOG') e.target.close();
    return;
  }
  if (el.id === 'add' || el.dataset.action === 'add') return openAdd();
  if (el.id === 'refresh') return refreshAll({ fresh: true });
  if (el.id === 'share') return share();
  if (el.dataset.action === 'close') return el.closest('dialog').close();
  if (el.dataset.sortpool) {
    state.rankSortPool = Number(el.dataset.sortpool);
    store.set('rankSortPool', state.rankSortPool);
    return renderMain();
  }
  if (el.dataset.action === 'home') return goHome();
  if (el.dataset.action === 'about') return openAbout();
  if (el.dataset.meet) return openMeet(el);
  if (el.dataset.msex) {
    state.meet = { ...state.meet, sex: el.dataset.msex, data: null, error: null };
    renderMeet();
    return loadMeet();
  }
  if (el.dataset.mcohort != null && state.meet) {
    state.meet.cohort = el.dataset.mcohort === '1';
    return renderMeet();
  }
  if (el.dataset.mround != null && state.meet) {
    state.meet.round = el.dataset.mround;
    return renderMeet();
  }
  if (el.dataset.view) {
    state.view = el.dataset.view;
    return render();
  }
  if (el.dataset.lang) {
    state.lang = el.dataset.lang;
    store.set('lang', state.lang);
    t = makeT(state.lang);
    return render();
  }
  if (el.dataset.basis) {
    state.rankBasis = el.dataset.basis;
    store.set('rankBasis', state.rankBasis);
    return renderMain();
  }
  if (el.dataset.sex !== undefined && el.closest('.rank-controls')) {
    state.rankSex = el.dataset.sex;
    store.set('rankSex', state.rankSex);
    return renderMain();
  }
  if (el.hasAttribute('data-toast-action')) {
    const run = toast.action;
    hideToast();
    return run && run();
  }
  if (el.dataset.drag) return;
  if (el.dataset.otab) {
    state.openTab = el.dataset.otab;
    state.meetsShown = 5;
    return renderSwimmerDialog();
  }
  if (el.dataset.action === 'moreMeets') {
    state.meetsShown += 10;
    const s = state.swimmers.find((x) => x.id === state.openId);
    return s && fillMeets(s);
  }
  if (el.dataset.pick) {
    const id = Number(el.dataset.pick);
    const cur = compareSelection();
    state.compareIds = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 4);
    if (!state.compareIds.length) state.compareIds = [id];
    save();
    return renderMain();
  }
  if (el.dataset.cpool) {
    state.comparePool = Number(el.dataset.cpool);
    save();
    return renderMain();
  }
  if (el.dataset.qcomp) {
    state.qComp = el.dataset.qcomp;
    save();
    return renderMain();
  }
  if (el.dataset.qsex) {
    state.qSex = el.dataset.qsex;
    save();
    return renderMain();
  }
  if (el.dataset.qpool) {
    state.qPool = Number(el.dataset.qpool);
    save();
    return renderMain();
  }
  if (el.dataset.action === 'seenAll') {
    markSeen(state.swimmers.map((s) => s.id));
    return renderMain();
  }
  if (el.dataset.action === 'syncOpen') return openSyncDialog();
  if (el.dataset.action === 'syncCreate') return createSync();
  if (el.dataset.action === 'syncNow') return pullSync({ force: true }).then(() => toast(t('synced')));
  if (el.dataset.action === 'syncCopy') {
    navigator.clipboard?.writeText(syncLink()).then(() => toast(t('shareCopied')), () => {});
    return;
  }
  if (el.dataset.action === 'syncLeave') {
    return ask({ title: t('syncLeave'), body: t('syncLeaveBody'), yes: t('syncLeave') }).then((ok) => {
      if (!ok) return;
      state.sync = null;
      store.set('sync', null);
      renderSyncDialog();
      renderSyncStatus();
    });
  }
  if (el.dataset.action === 'syncDelete') {
    return ask({ title: t('syncDelete'), body: t('syncDeleteBody'), yes: t('syncDelete'), danger: true }).then(async (ok) => {
      if (!ok) return;
      try {
        await syncApi('DELETE', '/' + state.sync.token);
      } catch {}
      state.sync = null;
      store.set('sync', null);
      renderSyncDialog();
      renderSyncStatus();
    });
  }
  if (el.dataset.action === 'goalSave') {
    const input = $('#goalInput');
    const v = parseTime(input?.value);
    if (input?.value.trim() && v == null) {
      toast(t('goalInvalid'));
      return input.focus();
    }
    return setGoal(Number(el.dataset.code), v);
  }
  if (el.dataset.action === 'goalClear') return setGoal(Number(el.dataset.code), null);
  if (el.dataset.action === 'csvRank') return rankCsv();
  if (el.dataset.action === 'h2h') return fillH2h();
  if (el.dataset.action === 'csvCompare') return compareCsv();
  if (el.dataset.collapse) {
    const id = Number(el.dataset.collapse);
    state.collapsed = state.collapsed.includes(id) ? state.collapsed.filter((x) => x !== id) : [...state.collapsed, id];
    save();
    return renderMain();
  }
  if (el.dataset.action === 'collapseAll' || el.dataset.action === 'expandAll') {
    state.collapsed = el.dataset.action === 'collapseAll' ? state.swimmers.map((s) => s.id) : [];
    save();
    return renderMain();
  }
  if (el.dataset.remove) return askRemove(el.dataset.remove);
  if (el.dataset.action === 'trash') return openTrash();
  if (el.dataset.restore) return restore(el.dataset.restore);
  if (el.dataset.purge) return purge([Number(el.dataset.purge)]);
  if (el.dataset.action === 'emptyTrash') return purge(state.trash.map((x) => x.swimmer.id));
  if (el.dataset.open) return openSwimmer(el.dataset.open);
  if (el.dataset.pool) {
    state.openPool = Number(el.dataset.pool);
    state.openEvent = null;
    return renderSwimmerDialog();
  }
  if (el.matches('tr.ev')) {
    const code = Number(el.dataset.event);
    state.openEvent = state.openEvent === code ? null : code;
    return renderSwimmerDialog();
  }
  if (el.dataset.toporder) {
    state.topOrder = el.dataset.toporder;
    store.set('topOrder', state.topOrder);
    const s = state.swimmers.find((x) => x.id === state.openId);
    return fillEventDetail(s, state.openEvent);
  }
  if (el.dataset.topn) {
    state.topN = el.dataset.topn === 'all' ? 'all' : Number(el.dataset.topn);
    store.set('topN', state.topN);
    const s = state.swimmers.find((x) => x.id === state.openId);
    return fillEventDetail(s, state.openEvent);
  }
  if (el.dataset.retryEvent) {
    const s = state.swimmers.find((x) => x.id === state.openId);
    return fillEventDetail(s, Number(el.dataset.retryEvent));
  }
  if (el.dataset.action === 'remove') return askRemove(state.openId);
  if (el.dataset.add) {
    const sw = addSwimmer(JSON.parse(el.dataset.add));
    if (sw) {
      el.disabled = true;
      el.classList.remove('primary');
      el.textContent = t('added');
    }
    return;
  }
  if (el.dataset.action === 'moreHits') {
    el.disabled = true;
    return doSearch($('#searchForm'), (searchState?.page || 1) + 1);
  }
  if (el.dataset.action === 'addAll') {
    const todo = searchState.swimmers.filter((s) => !state.swimmers.some((x) => x.id === s.id)).slice(0, 30);
    for (const s of todo) addSwimmer(pickSwimmer(s, 'se'), { load: false });
    refreshAll({ only: state.swimmers.filter((s) => todo.some((x) => x.id === s.id)) });
    renderHits();
    toast(t('addedN', { n: todo.length }));
    return;
  }
  if (el.dataset.action === 'importOpen') return openImport();
  if (el.dataset.action === 'cardsCustomize') return openCustomize();
  if (el.dataset.action === 'notifyOpen') return openNotify();
  if (el.dataset.action === 'notifyOn') return enableNotify();
  if (el.dataset.action === 'notifyOff') return disableNotify();
  if (el.dataset.action === 'notifyTest') return testNotify();
  if (el.dataset.action === 'importParse') {
    const text = $('#importText')?.value || '';
    if (!text.trim()) return $('#importText')?.focus();
    return runImport(text);
  }
  if (el.dataset.action === 'importReset') {
    importState = { ...importState, entries: [], status: new Map(), selected: new Set() };
    return renderImport();
  }
  if (el.dataset.action === 'importAdd') return addImported();
  if (el.dataset.igroup) {
    importState.groupBy = el.dataset.igroup;
    return renderImportKeepScroll();
  }
  if (el.id === 'addLink') {
    const input = $('input[name=link]');
    const ref = parseTempusRef(input.value);
    if (!ref) return input.focus();
    addSwimmer({ id: ref.id, site: ref.site });
    input.value = '';
    toast(t('added'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'goalInput') {
    e.preventDefault();
    e.target.closest('.goal-edit')?.querySelector('[data-action=goalSave]')?.click();
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open], tr.ev')) {
    e.preventDefault();
    e.target.click();
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'searchForm') {
    e.preventDefault();
    doSearch(e.target);
  }
});

document.addEventListener('toggle', (e) => {
  const v = e.target?.dataset?.help;
  if (v) state.helpOpen[v] = e.target.open;
}, true);

document.addEventListener('change', (e) => {
  if (e.target.id === 'period') {
    state.period = e.target.value;
    store.set('period', state.period);
    render();
    refreshAll({ only: state.swimmers.filter(needsLoad) });
  }
  if (e.target.dataset?.part) {
    state.cardParts = { ...state.cardParts, [e.target.dataset.part]: e.target.checked };
    store.set('cardParts', state.cardParts);
    return renderMain();
  }
  if (e.target.dataset?.isel) {
    const k = e.target.dataset.isel;
    if (e.target.checked) importState.selected.add(k);
    else importState.selected.delete(k);
    return renderImportKeepScroll();
  }
  if (e.target.dataset?.igroupAll !== undefined) {
    const label = e.target.dataset.igroupAll;
    const list = importGroups().find(([l]) => l === label)?.[1] || [];
    for (const en of list) if (selectable(en)) e.target.checked ? importState.selected.add(en.key) : importState.selected.delete(en.key);
    return renderImportKeepScroll();
  }
  if (e.target.dataset?.ipick) {
    const k = e.target.dataset.ipick;
    const st = importState.status.get(k);
    st.pick = st.candidates.find((c) => String(c.id) === e.target.value) || null;
    if (st.pick && !state.swimmers.some((s) => s.id === st.pick.id)) importState.selected.add(k);
    else importState.selected.delete(k);
    return renderImportKeepScroll();
  }
  if (e.target.id === 'qClass') {
    state.qClass = Number(e.target.value);
    save();
    renderMain();
  }
  if (e.target.dataset?.para) {
    const s = state.swimmers.find((x) => x.id === state.openId);
    if (s) {
      const p = { ...(s.para || {}) };
      if (e.target.value) p[e.target.dataset.para] = Number(e.target.value);
      else delete p[e.target.dataset.para];
      s.para = Object.keys(p).length ? p : undefined;
      save();
      renderSwimmerDialog();
      renderMain();
    }
  }
  if (e.target.id === 'sortMode') {
    state.sort = e.target.value;
    store.set('sort', state.sort);
    renderMain();
  }
  if (e.target.id === 'rankYear') {
    state.rankYear = e.target.value;
    store.set('rankYear', state.rankYear);
    renderMain();
  }
  if (e.target.id === 'rankEvent') {
    state.rankEvent = e.target.value;
    store.set('rankEvent2', state.rankEvent);
    renderMain();
  }
});

$('#swimmerDialog').addEventListener('close', () => {
  if (state.openId && newFor({ id: state.openId }).length) {
    markSeen([state.openId]);
    renderMain();
  }
  state.openId = null;
  state.openEvent = null;
});

// ---------------------------------------------------------------- drag to reorder (mouse and touch)

let drag = null;

function finishReorder() {
  const order = [...$('#deck').children].map((li) => Number(li.dataset.open));
  state.swimmers.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  save();
}

document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('[data-drag]');
  if (!handle || e.button > 0) return;
  e.preventDefault();
  const card = handle.closest('.card');
  drag = { card, pointer: e.pointerId };
  card.classList.add('dragging');
  handle.setPointerCapture(e.pointerId);
});

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  if (e.clientY < 70) window.scrollBy(0, -14);
  else if (e.clientY > innerHeight - 70) window.scrollBy(0, 14);
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('#deck > .card');
  if (!over || over === drag.card) return;
  const items = [...over.parentElement.children];
  const before = items.indexOf(drag.card) > items.indexOf(over);
  over.parentElement.insertBefore(drag.card, before ? over : over.nextSibling);
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointer) return;
  drag.card.classList.remove('dragging');
  drag = null;
  finishReorder();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

// Keyboard: arrow keys on the handle move the card.
document.addEventListener('keydown', (e) => {
  const handle = e.target.closest?.('[data-drag]');
  if (!handle || !['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const card = handle.closest('.card');
  const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
  const sib = back ? card.previousElementSibling : card.nextElementSibling;
  if (!sib) return;
  card.parentElement.insertBefore(card, back ? sib : sib.nextSibling);
  finishReorder();
  handle.focus();
});

// ---------------------------------------------------------------- start

render();
checkSyncLink();
checkImport();
pullSync({ force: true });
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && pullSync());
window.addEventListener('focus', () => pullSync());
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
refreshAll({ only: state.swimmers.filter(needsLoad) });
