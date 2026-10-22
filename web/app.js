import { CONFIG } from './config.js';
import { LANGS, makeT, detectLang } from './i18n.js';
import {
  eventLabel, eventSortKey, fmtTime, fmtDiff, periodRange, seasonLabel,
  summarize, progression, parseTempusRef, rankings,
} from './lib.js';

// ---------------------------------------------------------------- state

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
  swimmers: store.get('swimmers', []),
  data: store.get('data', {}), // id -> { all, period, periodKey, fetchedAt, error }
  events: {}, // `${site}:${id}:${code}` -> event payload (memory only)
  busy: null, // { done, total }
  rankEvent: store.get('rankEvent', '25:11'),
  rankSex: store.get('rankSex', ''),
  openId: null,
  openPool: 25,
  openEvent: null,
};

let t = makeT(state.lang);
const API = (CONFIG.api ?? '').replace(/\/$/, '');
const STALE_MS = 6 * 60 * 60 * 1000;

const $ = (sel, root = document) => root.querySelector(sel);
const sexLabel = (x) => (/^(wo|fe|kvin|dam|nai|flick|tyt)/i.test(x || '') ? t('women') : x ? t('men') : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function save() {
  store.set('swimmers', state.swimmers);
  store.set('data', state.data);
}

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
  const [all, period] = await Promise.all([
    api(`/api/swimmer/${s.id}`, { site: s.site, refresh }),
    api(`/api/swimmer/${s.id}`, { site: s.site, from, to, refresh }),
  ]);
  if (all.swimmer) Object.assign(s, pickSwimmer(all.swimmer, s.site));
  state.data[s.id] = { all, period, periodKey: periodKey(), fetchedAt: Date.now(), error: null };
}

function pickSwimmer(sw, site) {
  return { id: sw.id, site, name: sw.name, born: sw.born, club: sw.club, sex: sw.sex };
}

async function refreshAll({ fresh = false, only = null } = {}) {
  if (state.busy) return;
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
}

function needsLoad(s) {
  const d = state.data[s.id];
  return !d || !d.all || d.periodKey !== periodKey() || Date.now() - (d.fetchedAt || 0) > STALE_MS;
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
    <div class="brand">
      <svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="6" width="28" height="20" rx="5" fill="var(--accent)"/><path d="M6 19c3-3 5-3 8 0s5 3 8 0 5-3 6-1" stroke="var(--on-accent)" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="11" cy="12" r="2.2" fill="var(--on-accent)"/></svg>
      <div><h1>SwimDeck</h1><p class="tagline">${esc(t('tagline'))}</p></div>
    </div>
    <div class="toolbar">
      <label class="select"><span class="sr">${esc(t('period'))}</span>
        <select id="period">
          ${['season', '12m', 'last'].map((p) => `<option value="${p}" ${p === state.period ? 'selected' : ''}>${esc(t(p === 'season' ? 'periodSeason' : p === '12m' ? 'period12' : 'periodLast'))} · ${esc(seasonLabel(p))}</option>`).join('')}
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
      <span class="spacer"></span>
      <span class="muted small">${esc(t('updated', { when: last ? new Date(last).toLocaleString(state.lang, { dateStyle: 'short', timeStyle: 'short' }) : t('never') }))}</span>
    </nav>`;
}

function renderMain() {
  const main = $('#main');
  if (CONFIG.api == null) {
    main.innerHTML = `<div class="empty"><p>${esc(t('apiMissing'))}</p></div>`;
    return;
  }
  if (!state.swimmers.length) {
    main.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 120 60" aria-hidden="true"><path d="M5 40c10-10 20-10 30 0s20 10 30 0 20-10 30 0 15 8 20 4" stroke="var(--accent)" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M5 52c10-10 20-10 30 0s20 10 30 0 20-10 30 0 15 8 20 4" stroke="var(--line)" stroke-width="4" fill="none" stroke-linecap="round"/></svg>
        <h2>${esc(t('emptyTitle'))}</h2>
        <p>${esc(t('emptyBody'))}</p>
        <button class="btn primary" data-action="add">+ ${esc(t('add'))}</button>
      </div>`;
    return;
  }
  main.innerHTML = state.view === 'rank' ? rankView() : deckView();
}

function deckView() {
  return `<ul class="deck">${state.swimmers.map(cardView).join('')}</ul>`;
}

function cardView(s) {
  const d = state.data[s.id];
  const head = `
    <div class="card-head">
      <div>
        <h3>${esc(s.name || '#' + s.id)}</h3>
        <p class="muted small">${[s.born ? t('born', { year: s.born }) : '', s.club].filter(Boolean).map(esc).join(' · ')}</p>
      </div>
      ${s.site !== 'se' ? `<span class="tag">${esc(s.site.toUpperCase())}</span>` : ''}
    </div>`;
  if (!d || !d.all) {
    return `<li class="card ${d?.error ? 'has-error' : 'loading'}" data-open="${s.id}" tabindex="0">${head}
      <p class="muted">${d?.error ? esc(t('error', { msg: d.error })) : esc(t('loading'))}</p></li>`;
  }
  const sum = summarize(d.all, d.period);
  const latest = sum.latest;
  return `<li class="card" data-open="${s.id}" tabindex="0" role="button">
    ${head}
    <div class="stats">
      <div class="stat ${sum.newPbs ? 'good' : ''}"><b>${sum.newPbs}</b><span>${esc(t('newPbsLabel'))}</span></div>
      <div class="stat"><b>${sum.swumInPeriod}</b><span>${esc(t('eventsSwum'))}</span></div>
    </div>
    <div class="latest">
      ${latest
        ? `<span class="muted small">${esc(t('latest'))}</span>
           <div><b>${esc(eventLabel(latest.event, state.lang, latest.name))}</b> <span class="pool">${latest.pool} m</span> <span class="time">${fmtTime(latest.time)}</span></div>
           <div class="muted small">${esc(latest.date)} · ${esc(latest.meet)}</div>`
        : `<span class="muted small">${esc(t('noSwims'))}</span>`}
    </div>
    ${sum.best.length ? `<div class="chips" aria-label="${esc(t('bestEvents'))}">${sum.best.map((r) => `<span class="chip">${esc(eventLabel(r.event, state.lang, r.name))} <small>${r.pool}</small> <b>${fmtTime(r.pb.time)}</b></span>`).join('')}</div>` : ''}
    ${d.error ? `<p class="warn small">${esc(t('error', { msg: d.error }))}</p>` : ''}
  </li>`;
}

function rankView() {
  const overviews = Object.fromEntries(state.swimmers.map((s) => [s.id, state.data[s.id]?.all]));
  const options = new Map();
  for (const o of Object.values(overviews)) for (const b of o?.bests || []) options.set(`${b.pool}:${b.event}`, b);
  const opts = [...options.values()].sort((a, b) => a.pool - b.pool || eventSortKey(a.event, a.name) - eventSortKey(b.event, b.name));
  if (!options.has(state.rankEvent) && opts[0]) state.rankEvent = `${opts[0].pool}:${opts[0].event}`;
  const [pool, event] = state.rankEvent.split(':').map(Number);
  const sexes = [...new Set(state.swimmers.map((s) => s.sex).filter(Boolean))];
  const swimmers = state.swimmers.filter((s) => !state.rankSex || s.sex === state.rankSex);
  const rows = rankings(swimmers, overviews, event, pool);
  return `
    <div class="rank-controls">
      <label class="select"><span>${esc(t('chooseEvent'))}</span>
        <select id="rankEvent">${opts.map((b) => `<option value="${b.pool}:${b.event}" ${`${b.pool}:${b.event}` === state.rankEvent ? 'selected' : ''}>${esc(eventLabel(b.event, state.lang, b.name))} · ${b.pool} m</option>`).join('')}</select>
      </label>
      ${sexes.length > 1 ? `<div class="seg" role="group">${['', ...sexes].map((x) => `<button data-sex="${esc(x)}" aria-pressed="${state.rankSex === x}">${esc(x ? sexLabel(x) : t('allSexes'))}</button>`).join('')}</div>` : ''}
    </div>
    ${rows.length ? `<ol class="ranking">${rows.map((r, i) => `
      <li data-open="${r.swimmer.id}" tabindex="0" role="button">
        <span class="pos">${i + 1}</span>
        <span class="who"><b>${esc(r.swimmer.name)}</b><span class="muted small">${esc([r.swimmer.born, r.swimmer.club].filter(Boolean).join(' · '))}</span></span>
        <span class="time">${fmtTime(r.result.time)}</span>
        <span class="muted small when">${esc(r.result.date)}<br>${esc(r.result.meet)}</span>
        ${i > 0 ? `<span class="gap small muted">${fmtDiff(r.result.time - rows[0].result.time)}</span>` : '<span class="gap"></span>'}
      </li>`).join('')}</ol>` : `<p class="muted">${esc(t('noneInEvent'))}</p>`}`;
}

function renderFooter() {
  $('#footer').innerHTML = `
    <div class="lang" role="group" aria-label="${esc(t('language'))}">
      ${Object.entries(LANGS).map(([k, v]) => `<button data-lang="${k}" aria-pressed="${state.lang === k}">${esc(v)}</button>`).join('')}
    </div>
    ${state.swimmers.length ? `<button class="link" id="share">${esc(t('share'))}</button>` : ''}
    <p class="muted small">${esc(t('dataFrom'))}</p>`;
}

// ---------------------------------------------------------------- swimmer dialog

function openSwimmer(id) {
  state.openId = Number(id);
  state.openEvent = null;
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
  const sum = d?.all ? summarize(d.all, d.period) : null;
  const rows = sum ? sum.rows.filter((r) => r.pool === state.openPool) : [];
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
      <div class="sheet-tools">
        <div class="seg" role="tablist">${pools.sort().map((p) => `<button data-pool="${p}" aria-pressed="${p === state.openPool}">${esc(t(p === 25 ? 'pool25' : 'pool50'))}</button>`).join('')}</div>
        <span class="muted small">${esc(t('periodBest'))}: ${esc(seasonLabel(state.period))}</span>
      </div>
      ${!sum ? `<p class="muted">${esc(d?.error ? t('error', { msg: d.error }) : t('loading'))}</p>` : `
      <table class="events">
        <thead><tr><th>${esc(t('event'))}</th><th class="num">${esc(t('pb'))}</th><th class="num">${esc(t('periodBest'))}</th><th class="num hide-sm">${esc(t('points'))}</th></tr></thead>
        <tbody>${rows.map((r) => eventRow(s, r)).join('')}</tbody>
      </table>`}
      <footer class="sheet-foot">
        <a href="${base}/swimmers/${s.id}/swimming" target="_blank" rel="noopener">${esc(t('openTempus'))} ↗</a>
        <button class="link danger" data-action="remove">${esc(t('remove'))}</button>
      </footer>
    </div>`;
  if (state.openEvent) fillEventDetail(s, state.openEvent);
}

function eventRow(s, r) {
  const open = state.openEvent === r.event;
  return `
    <tr class="ev ${r.newPb ? 'pb' : ''} ${open ? 'open' : ''}" data-event="${r.event}" tabindex="0" aria-expanded="${open}">
      <td><span class="chev" aria-hidden="true">›</span>${esc(eventLabel(r.event, state.lang, r.name))}${r.newPb ? ` <span class="badge">${esc(t('newPb'))}</span>` : ''}</td>
      <td class="num"><b>${r.pb ? fmtTime(r.pb.time) : '–'}</b><small>${esc(r.pb?.date || '')}</small></td>
      <td class="num">${r.period ? `${fmtTime(r.period.time)}<small class="${r.diff > 0 ? '' : 'good'}">${r.diff != null ? fmtDiff(r.diff) : ''}</small>` : '<span class="muted">–</span>'}</td>
      <td class="num hide-sm">${r.pb?.points ?? ''}</td>
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
    const top = ev.results.slice(0, n);
    $('#eventDetail').innerHTML = `
      <div class="detail-tools">
        <span class="muted small">${esc(t('swims', { n: ev.results.length }))}</span>
        <div class="seg small" role="group" aria-label="${esc(t('topN'))}">
          ${[3, 5, 10, 'all'].map((k) => `<button data-topn="${k}" aria-pressed="${state.topN === k}">${k === 'all' ? esc(t('all')) : `${esc(t('topN'))} ${k}`}</button>`).join('')}
        </div>
      </div>
      <ol class="top">${top.map((r, i) => `
        <li><span class="pos">${i + 1}</span><span class="time">${fmtTime(r.time)}</span>
        <span class="small"><span>${esc(r.date)}</span> · <span class="muted">${esc(r.meet)}${r.round ? ' · ' + esc(r.round) : ''}</span></span>
        <span class="small muted num">${r.points ?? ''}</span></li>`).join('')}</ol>
      ${ev.results.length > 1 ? `<h4 class="small muted">${esc(t('progression'))}</h4>${chart(ev.results)}` : ''}`;
  } catch (e) {
    box.innerHTML = `<p class="warn">${esc(t('error', { msg: e.message }))}</p><button class="btn small" data-retry-event="${code}">${esc(t('retry'))}</button>`;
  }
}

function chart(results) {
  const pts = progression(results);
  const W = 320, H = 130, P = { l: 44, r: 8, t: 8, b: 20 };
  const ts = pts.map((p) => Date.parse(p.date));
  const x0 = Math.min(...ts), x1 = Math.max(...ts) || x0 + 1;
  const times = pts.map((p) => p.time);
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
        <label class="wide"><span>${esc(t('club'))}</span><input name="club" autocomplete="off"></label>
      </div>
      <button class="btn primary" type="submit" id="doSearch">${esc(t('search'))}</button>
      <div id="hits" aria-live="polite"></div>
      <div class="paste">
        <label><span class="muted small">${esc(t('orPaste'))}</span>
          <div class="row"><input name="link" placeholder="${esc(t('pastePlaceholder'))}" inputmode="url"><button type="button" class="btn" id="addLink">${esc(t('addBtn'))}</button></div>
        </label>
      </div>
    </form>`;
  dlg.showModal();
  $('input[name=last]', dlg).focus();
}

async function doSearch(form) {
  const f = new FormData(form);
  const params = { first: f.get('first').trim(), last: f.get('last').trim(), club: f.get('club').trim() };
  if (!params.first && !params.last && !params.club) return;
  const hits = $('#hits');
  hits.innerHTML = `<p class="muted">${esc(t('searching'))}</p>`;
  try {
    const r = await api('/api/search', params);
    if (!r.swimmers.length) return (hits.innerHTML = `<p class="muted">${esc(t('noHits'))}</p>`);
    hits.innerHTML = `
      <p class="muted small">${esc(t('hits', { n: r.total }))}${r.total > r.swimmers.length ? ' · ' + esc(t('tooMany', { n: r.swimmers.length })) : ''}</p>
      <ul class="hits">${r.swimmers.map((s) => {
        const has = state.swimmers.some((x) => x.id === s.id);
        return `<li><span><b>${esc(s.name)}</b><span class="muted small">${esc([s.born, s.club, sexLabel(s.sex)].filter(Boolean).join(' · '))}</span></span>
          <button type="button" class="btn small ${has ? '' : 'primary'}" data-add='${esc(JSON.stringify(pickSwimmer(s, 'se')))}' ${has ? 'disabled' : ''}>${esc(has ? t('added') : t('addBtn'))}</button></li>`;
      }).join('')}</ul>`;
  } catch (e) {
    hits.innerHTML = `<p class="warn">${esc(t('error', { msg: e.message }))}</p>`;
  }
}

function addSwimmer(s) {
  if (state.swimmers.some((x) => x.id === s.id)) return null;
  const sw = { id: s.id, site: s.site || 'se', name: s.name || '', born: s.born ?? null, club: s.club || '', sex: s.sex || '' };
  state.swimmers.push(sw);
  save();
  render();
  refreshAll({ only: [sw] });
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

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2500);
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
  if (el.dataset.sex !== undefined && el.closest('.rank-controls')) {
    state.rankSex = el.dataset.sex;
    store.set('rankSex', state.rankSex);
    return renderMain();
  }
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
  if (el.dataset.action === 'remove') {
    const s = state.swimmers.find((x) => x.id === state.openId);
    if (s && confirm(t('removeConfirm', { name: s.name }))) {
      state.swimmers = state.swimmers.filter((x) => x.id !== s.id);
      delete state.data[s.id];
      save();
      $('#swimmerDialog').close();
      render();
    }
    return;
  }
  if (el.dataset.add) {
    const sw = addSwimmer(JSON.parse(el.dataset.add));
    if (sw) {
      el.disabled = true;
      el.classList.remove('primary');
      el.textContent = t('added');
    }
    return;
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

document.addEventListener('change', (e) => {
  if (e.target.id === 'period') {
    state.period = e.target.value;
    store.set('period', state.period);
    render();
    refreshAll({ only: state.swimmers.filter(needsLoad) });
  }
  if (e.target.id === 'rankEvent') {
    state.rankEvent = e.target.value;
    store.set('rankEvent', state.rankEvent);
    renderMain();
  }
});

$('#swimmerDialog').addEventListener('close', () => {
  state.openId = null;
  state.openEvent = null;
});

// ---------------------------------------------------------------- start

render();
checkImport();
refreshAll({ only: state.swimmers.filter(needsLoad) });
