import { CONFIG } from './config.js';
import { supportLine } from './support.js';
import { VERSION } from './version.js';
import { QUAL } from './qual-data.js';
import { ORDER, qualify, qualCounts, usmAgeGroup, sexOf } from './qual.js';
import { hasPara, wpsPoints, wpsEstimate, suggestPara } from './wps.js';
import { isMasters, mastersPct, wrPct, useWorldRecords, worldRecords } from './masters.js';
import { MASTERS } from './masters-data.js';
import { LANGS, makeT, detectLang } from './i18n.js';
import { initReorder } from './reorder.js';
import { QUAL_CARD_MIN, QUAL_GAP, packQualCards, SORTS, cardInfo, sortedSwimmers, deckView, CARD_PARTS, openCustomize, trashLink, bestFor, cardView, newBlock, goalChip, qualChips, baseCode, rankView, rankCsv, compareSelection, compareView, fillH2h, compareCsv, qualTabs, qualHighlights, qualDoneView, qualView } from './views.js';
import { bulkSelect, share, checkSyncLink, checkImport, ask, askRemove, openBulkRemove, renderBulkRemove, doBulkRemove, restore, openTrash, renderTrash, purge } from './lists.js';
import { roundLabel, roundRank, reRank, sexCode, meetCache, meetButton, openMeet, loadMeet, renderMeet, eventRow, fillEventDetail, goalEditor, setGoal, MONTHS, mastersShipped, shortIso, recordStatus, applyRecords, loadRecords, recordLine, prognosisLine, rankRow, rankMsg, fillRank, seasonTable, chart } from './meets.js';
import { usesWps, fmtPctPlain, METRICS, metricsFor, metricFor, metricName, ptsOf, ptsTitle, ptsLabel, metricValue, fmtMetric, compareMetrics, pill, metricPill, NEAR_CHOICES, nearShare, nearPill, closeMenu, periodName, periodOptionLabel, oldestSwimYear, shortDate, fmtPct, downloadCsv, save } from './viewkit.js';
import { addState, updateAddDone, openAdd, openImport, renderImport, selectable, importGroups, importRow, importCache, IMPORT_PRESELECT, importSearch, runImport, renderImportKeepScroll, mergePara, paraUpdates, addImported, MEET_IMPORT_MAX, openMeetImport, findMeets, pickMeet, loadMeetClub, inList, meetImportShown, meetImportGroups, renderMeetImport, addFromMeet, doSearch, renderHits, addSwimmer } from './add.js';
import { loadAllEvents, loadingStop, loadingStart, loadingEnd, api, periodKey, RECENT_DAYS, recentMeet, loadSwimmer, pickSwimmer, refreshAll, needsLoad, loadEvent } from './api.js';
import { flushSync, syncPayload, syncLink, syncApi, schedulePush, pushSync, pullSync, applyRemote, renderSyncStatus, syncStatusHtml, openSyncDialog, renderSyncDialog, createSync, joinSync } from './sync.js';
import { STD_LABEL, stdLabel, SHORT_LABEL, qBadge, newFor, markSeen, qualRows, ICON } from './parts.js';
import { pushSupported, notifyApi, currentSubscription, enableNotify, sendNotifyList, disableNotify, healNotify, notifyProblem, testNotify, scheduleNotifyUpdate, openNotify, renderNotifyDialog } from './notify.js';
import { TRASH_DAYS, store, state, t, setLang, API, STALE_MS, FEEDBACK_URL, $, sexLabel, esc, errText, toast, hideToast, hooks } from './core.js';
import {
  eventLabel, eventShort, eventSortKey, eventInfo, fmtTime, fmtDiff, periodRange, seasonLabel, periodOptions,
  summarize, progression, parseTempusRef, parseTime, goalStatus, rankings, rankingsByPoints, rankingsBothPools, sortSwimmers,
  seasonBests, meets, compareTable, shortNames, rankingsByImprovement, toCsv, profile, form, prognosis, headToHead,
  bestsSnapshot, newSince, mergeSyncLists, cleanRemoteSwimmers,
} from './lib.js';

// ---------------------------------------------------------------- state

// ---------------------------------------------------------------- rendering

// ---------------------------------------------------------------- keep the place on reload
// The current tab, open swimmer and open event live in sessionStorage, so reloading the page (or the
// browser restoring it) comes back to the same view. A new tab or window starts on the swimmer list.
function saveNav() {
  try {
    sessionStorage.setItem('swimdeck.nav', JSON.stringify({ view: state.view, openId: state.openId || null, openTab: state.openTab, openEvent: state.openEvent || null, openPool: state.openPool }));
  } catch {}
}

function restoreNav() {
  let nav = null;
  try {
    nav = JSON.parse(sessionStorage.getItem('swimdeck.nav') || 'null');
  } catch {}
  if (!nav) return;
  if (['deck', 'rank', 'compare', 'qual'].includes(nav.view)) state.view = nav.view;
  const s = nav.openId && state.swimmers.find((x) => x.id === nav.openId);
  if (!s) return;
  state.openId = s.id;
  state.openTab = ['events', 'meets', 'profile'].includes(nav.openTab) ? nav.openTab : 'events';
  state.openPool = nav.openPool === 50 ? 50 : 25;
  state.openEvent = nav.openEvent || null;
  state.meetsShown = 5;
}

/** A selector that finds the focused control again after the page has been redrawn. */
function focusSelector() {
  const el = document.activeElement;
  if (!el || el === document.body || !el.closest('#header, #main')) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  const attrs = ['data-action', 'data-id', 'data-view', 'data-event', 'data-pool', 'data-otab', 'data-sort'];
  const parts = attrs.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a))}"]`);
  const card = el.closest('[data-id]');
  const scope = card && card !== el ? `[data-id="${CSS.escape(card.dataset.id)}"] ` : '';
  return parts.length ? scope + el.tagName.toLowerCase() + parts.join('') : null;
}

/** A redraw replaces every element; give focus back so keyboard and screen reader users keep their place. */
function restoreFocus(sel) {
  if (!sel || (document.activeElement && document.activeElement !== document.body)) return;
  try { document.querySelector(sel)?.focus({ preventScroll: true }); } catch { /* ignore */ }
}

function render() {
  document.documentElement.lang = state.lang;
  updateAddDone();
  const focusSel = focusSelector();
  renderHeader();
  renderMainRaw();
  restoreFocus(focusSel);
  renderFooter();
  if (state.openId) renderSwimmerDialog();
  saveNav();
}

function renderHeader() {
  const busy = state.busy;
  const last = Math.max(0, ...state.swimmers.map((s) => state.data[s.id]?.fetchedAt || 0));
  const html = `
    <button class="brand" data-action="home" aria-label="${esc(t('home'))}">
      <span class="logo" aria-hidden="true"><svg class="logo-wave" viewBox="0 0 80 20"><path d="M0 13c3-3 5-3 8 0s5 3 8 0 5-3 8 0 5 3 8 0 5-3 8 0 5 3 8 0 5-3 8 0 5 3 8 0 5-3 8 0 5 3 8 0" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg><span class="logo-head"></span></span>
      <div><h1>SwimDeck</h1><p class="tagline">${esc(t('slogan'))}</p></div>
    </button>
    <div class="toolbar">
      <label class="select"><span class="sr">${esc(t('period'))}</span>
        <select id="period">
          ${[...new Set([...periodOptions(oldestSwimYear()), state.period])].map((p) => `<option value="${p}" ${p === state.period ? 'selected' : ''}>${esc(periodOptionLabel(p))}</option>`).join('')}
        </select>
      </label>
      <button id="refresh" class="btn" aria-label="${esc(t('refresh'))}" title="${esc(t('refresh'))}" ${busy || !state.swimmers.length ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true" class="${busy ? 'spin' : ''}"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${busy ? esc(t('refreshing', busy)) : esc(t('refresh'))}</span>
      </button>
      <button id="add" class="btn primary" aria-label="${esc(t('add'))}"><span aria-hidden="true">+</span> <span class="add-long">${esc(t('add'))}</span><span class="add-short">${esc(t('addShort'))}</span></button>
    </div>
    <nav class="tabs" role="tablist">
      <button role="tab" data-view="deck" aria-selected="${state.view === 'deck'}">${esc(t('deck'))} <span class="count">${state.swimmers.length}</span></button>
      <button role="tab" data-view="rank" aria-selected="${state.view === 'rank'}">${esc(t('toplist'))}</button>
      <button role="tab" data-view="compare" aria-selected="${state.view === 'compare'}">${esc(t('compare'))}</button>
      <button role="tab" data-view="qual" aria-selected="${state.view === 'qual'}">${esc(t('qualTab'))}</button>
      <span class="spacer"></span>
      ${syncStatusHtml()}
      ${state.swimmers.length ? `<span class="muted small hide-sm">${esc(t('updated', { when: last ? new Date(last).toLocaleString(state.lang, { dateStyle: 'short', timeStyle: 'short' }) : t('never') }))}</span>` : ''}
    </nav>`;
  const header = $('#header');
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  // Keep the brand button (and so the running logo animation) in place; only refresh its text.
  const oldBrand = header.querySelector(':scope > .brand');
  const newBrand = tpl.content.querySelector('.brand');
  if (oldBrand && newBrand) {
    oldBrand.setAttribute('aria-label', newBrand.getAttribute('aria-label'));
    oldBrand.querySelector('div').replaceWith(newBrand.querySelector('div'));
    newBrand.remove();
    [...header.children].forEach((c) => c !== oldBrand && c.remove());
    header.append(...tpl.content.childNodes);
  } else {
    header.replaceChildren(...tpl.content.childNodes);
  }
}

const HELP_VIEWS = ['deck', 'rank', 'compare', 'qual'];

/** A short, collapsible explanation at the top of each view. */
/** First weeks after the move to swimdeck.se: tell people with an empty list why it is empty. */
const MOVED_UNTIL = '2026-11-24';
function movedNotice() {
  if (location.hostname !== 'swimdeck.se' || state.swimmers.length || store.get('movedHidden') || new Date().toISOString().slice(0, 10) > MOVED_UNTIL) return '';
  return `<div class="move-banner" role="note"><p>${esc(t('movedNotice'))}</p>
    <p><button class="link small" data-action="movedHide">${esc(t('movedHide'))}</button></p></div>`;
}

function helpBox(view) {
  if (!HELP_VIEWS.includes(view)) return '';
  return `<details class="help" data-help="${view}" ${state.helpOpen[view] ? 'open' : ''}>
    <summary><span class="help-i" aria-hidden="true">i</span> ${esc(t('helpSummary'))}</summary>
    <div class="help-body">${helpHtml(view)}<p><button class="link small" data-action="about">${esc(t('aboutMore'))}</button></p></div>
  </details>`;
}

const helpHtml = (view) => t('help_' + view).split('\n').map((p) => `<p>${esc(p)}</p>`).join('');

/** 'auto' follows the device; 'light' or 'dark' is a manual choice kept in this browser. */
function applyTheme(theme) {
  state.theme = theme;
  store.set('theme', theme);
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (theme === 'auto') m.media = m.dataset.media || m.media;
    else { m.dataset.media = m.dataset.media || m.media; m.media = 'all'; m.content = dark ? '#0b1724' : '#0b5cad'; }
  });
}

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
      <section><h3>${esc(t('sourcesTitle'))}</h3><dl class="glossary">${(() => { const r = recordStatus(); return [
        [t('srcResults'), t('srcResultsText')],
        [t('srcWr'), (r.wrLive ? t('srcWrLive', { date: shortIso(r.wrDate) }) : t('srcWrShipped', { date: shortIso(r.wrDate) })) + (r.wrStale ? ' ' + t('wrStale', { date: shortIso(r.wrDate) }) : '')],
        [t('srcMasters'), t('srcMastersText', { date: shortIso(r.mastersDate) }) + (r.mastersNewer ? ' ' + t('mastersNewer', { date: shortIso(r.mastersNewer), ours: shortIso(r.mastersDate) }) : '')],
        [t('srcQual'), t('srcQualText', { checked: QUAL.checked })],
        ['WPS', t('srcWpsText')],
      ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join(''); })()}</dl></section>
      <footer class="sheet-foot"><span class="muted small">${esc(versionLabel())}</span><button class="btn primary" data-action="close">${esc(t('done'))}</button></footer>
    </div>`;
  if (!dlg.open) dlg.showModal();
}

function renderMain() {
  const focusSel = focusSelector();
  renderMainRaw();
  restoreFocus(focusSel);
}

function renderMainRaw() {
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
    main.innerHTML = movedNotice() + `
      <div class="empty">
        <svg viewBox="0 28 120 36" aria-hidden="true"><path d="M5 40c10-10 20-10 30 0s20 10 30 0 20-10 30 0 15 8 20 4" stroke="var(--accent)" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M5 52c10-10 20-10 30 0s20 10 30 0 20-10 30 0 15 8 20 4" stroke="var(--line)" stroke-width="4" fill="none" stroke-linecap="round"/></svg>
        <h2>${esc(t('emptyTitle'))}</h2>
        <p>${esc(t('emptyBody'))}</p>
        <button class="btn primary" data-action="add">+ ${esc(t('add'))}</button>
        ${trashLink()}
      </div>`;
    return;
  }
  main.innerHTML = helpBox(state.view) + (state.view === 'rank' ? rankView() : state.view === 'compare' ? compareView() : state.view === 'qual' ? qualView() : deckView());
  packQualCards();
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
    <div class="lang theme" role="group" aria-label="${esc(t('theme'))}">
      ${[['auto', t('themeAuto')], ['light', t('themeLight')], ['dark', t('themeDark')]].map(([k, v]) => `<button data-theme-set="${k}" aria-pressed="${state.theme === k}">${esc(v)}</button>`).join('')}
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
        <div class="seg" role="tablist" ${pools.length < 2 ? 'hidden' : ''}>${pools.sort().map((p) => `<button data-pool="${p}" aria-pressed="${p === state.openPool}">${esc(t(p === 25 ? 'pool25' : 'pool50'))}</button>`).join('')}</div>
        <label class="select compact period-sheet"><span class="muted small">${esc(t('periodBest'))}</span>
          <select id="periodSheet">${[...new Set([...periodOptions(oldestSwimYear()), state.period])].map((p) => `<option value="${p}" ${p === state.period ? 'selected' : ''}>${esc(periodOptionLabel(p))}</option>`).join('')}</select></label>
      </div>
      ${!sum ? `<p class="muted">${esc(d?.error ? errText(d.error) : t('loading'))}</p>` : `
      <table class="events">
        <thead><tr><th>${esc(t('event'))}</th><th class="num">${esc(t('pb'))}</th><th class="num">${esc(t('periodBest'))}</th><th class="num metric-th">${metricPill(s, 'table')}</th></tr></thead>
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
  saveNav();
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
    ${failed ? `<p class="warn small">${esc(errText(failed.message))}</p>` : ''}
    <div class="form-head form-${level}"><b>${esc(t('form_' + level))}</b>
      <span class="small">${esc(t('formAvg', { pct: pct(f.avg), n: f.recent.length }))}${trend ? ' · ' + esc(t('trend_' + trend)) : ''}</span></div>
    <ol class="top form-list">${f.recent.map((w) => `
      <li><span class="small muted nowrap">${esc(shortDate(w.date))}</span><span>${esc(eventLabel(w.event, state.lang, w.name))} <span class="pool">${w.pool} m</span></span>
      <span class="time">${fmtTime(w.time)}</span><span class="small num ${w.pct < 0 ? 'good' : 'muted'}">${w.pct < 0 ? esc(t('newPb')) : pct(w.pct)}</span></li>`).join('')}</ol>`;
}

/** Look a swimmer up in the national para records (the only public source of classes in Tempus). */
function paraLookupHtml(s) {
  const r = state.paraLookup[s.id];
  if (!r) return `<div class="para-lookup"><button type="button" class="btn small" data-action="paraLookup">${esc(t('paraLookup'))}</button> <span class="muted small">${esc(t('paraLookupHint'))}</span></div>`;
  if (r.busy) return `<p class="muted small">${esc(t('loading'))}</p>`;
  if (r.error) return `<p class="warn small">${esc(errText(r.error))}</p>`;
  if (!r.found) return `<p class="muted small">${esc(t('paraLookupNone'))}</p>`;
  const top = r.classes[0];
  return `<div class="para-suggest"><span class="small">${esc(t('paraLookupFound', { cls: top.cls, date: top.latest }))}${r.classes.length > 1 ? ` <span class="muted">(${esc(t('paraLookupEarlier', { list: r.classes.slice(1).map((c) => c.cls).join(', ') }))})</span>` : ''}</span>
    <button type="button" class="btn small" data-action="paraLookupUse" data-cls="${esc(top.cls)}">${esc(t('paraSuggestUse'))}</button>
    <p class="small muted">${esc(t('paraLookupNote'))}</p></div>`;
}

async function paraLookup(s) {
  state.paraLookup[s.id] = { busy: true };
  renderSwimmerDialog();
  try {
    const r = await api('/api/para-class', { site: s.site, name: s.name, born: s.born || '', club: s.club || '' });
    state.paraLookup[s.id] = r;
  } catch (e) {
    state.paraLookup[s.id] = { error: e.message };
  }
  if (state.openId === s.id) renderSwimmerDialog();
}

function paraSettings(s) {
  if (!s.para && !state.cardParts.para) return '';
  const p = s.para || {};
  const sel = (k) => `<label class="select compact"><span>${k}</span><select data-para="${k}"><option value="">–</option>${Array.from({ length: 14 }, (_, i) => i + 1).filter((n) => !(k === 'SB' && n === 10)).map((n) => `<option value="${n}" ${Number(p[k]) === n ? 'selected' : ''}>${k}${n}</option>`).join('')}</select></label>`;
  const sug = suggestPara(p);
  const set = ['S', 'SB', 'SM'].filter((k) => p[k]).map((k) => k + p[k]).join(' · ');
  const label = set ? `${t('paraClass')}: ${set}` : t('paraAdd');
  return `<details class="para-set" data-para-set="${s.id}" ${state.paraOpen === s.id ? 'open' : ''}><summary class="small muted">${esc(label)}</summary>
    <p class="small muted">${esc(t('paraHint'))}</p><div class="row">${['S', 'SB', 'SM'].map(sel).join('')}</div>
    ${sug ? `<div class="para-suggest"><span class="small">${esc(t('paraSuggest', { classes: Object.entries(sug).map(([k, v]) => k + v).join(' · ') }))}</span>
      <button type="button" class="btn small" data-action="paraSuggest">${esc(t('paraSuggestUse'))}</button>
      <p class="small muted">${esc(t('paraSuggestNote'))}</p></div>` : ''}
    ${paraLookupHtml(s)}
    ${set ? `<div class="row end"><button type="button" class="link danger small" data-action="paraClear">${esc(t('paraClear'))}</button></div>` : ''}</details>`;
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
    ${failed ? `<p class="warn small">${esc(errText(failed.message))}</p>` : ''}
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
    ${list.length > shown.length ? `<div class="row more-row"><button class="btn small" data-action="moreMeets">${esc(t('showMore'))}</button></div>` : ''}`;
}

// ---------------------------------------------------------------- events

document.addEventListener('click', (e) => {
  if (state.menu && !e.target.closest('.metric-wrap')) {
    closeMenu();
    if (!e.target.closest('button, [data-open], tr.ev, a')) return;
  }
  const el = e.target.closest('button, [data-open], tr.ev, a');
  if (!el) {
    // click on the dialog backdrop closes it
    if (e.target.tagName === 'DIALOG') e.target.close();
    return;
  }
  if (el.dataset.choose === 'metric') {
    state.metric = el.dataset.value;
    store.set('metric', state.metric);
    return closeMenu();
  }
  if (el.dataset.choose === 'cmetric') {
    state.compareMetric = el.dataset.value;
    store.set('compareMetric', state.compareMetric);
    return closeMenu();
  }
  if (el.dataset.choose === 'near') {
    state.near = Number(el.dataset.value);
    store.set('near', state.near);
    return closeMenu();
  }
  el.closest('.deck-more')?.removeAttribute('open');
  if (el.id === 'add' || el.dataset.action === 'add') return openAdd();
  if (el.id === 'refresh') return refreshAll({ fresh: true });
  if (el.id === 'share') return share();
  if (el.dataset.action === 'close') return el.closest('dialog').close();
  if (el.dataset.action === 'bulkRemove') return openBulkRemove();
  if (el.dataset.action === 'bulkDo') return doBulkRemove();
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
  if (el.dataset.themeSet) {
    applyTheme(el.dataset.themeSet);
    return renderFooter();
  }
  if (el.dataset.lang) {
    setLang(el.dataset.lang);
    store.set('lang', state.lang);
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
  if (el.dataset.action === 'movedHide') { store.set('movedHidden', true); return render(); }
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
  if (el.dataset.menu) {
    state.menu = state.menu === el.dataset.menu ? null : el.dataset.menu;
    renderMain();
    if ($('#swimmerDialog').open) renderSwimmerDialog();
    $(`[data-menu="${el.dataset.menu}"]`)?.focus();
    return;
  }
  if (el.dataset.action === 'paraLookup') {
    const sw = state.swimmers.find((x) => x.id === state.openId);
    return sw && paraLookup(sw);
  }
  if (el.dataset.action === 'paraLookupUse') {
    const sw = state.swimmers.find((x) => x.id === state.openId);
    const m = String(el.dataset.cls).match(/^(S|SB|SM)(\d+)$/);
    if (!sw || !m) return;
    const n = Number(m[2]);
    sw.para = n >= 11 ? { S: n, SB: n, SM: n } : { ...(sw.para || {}), [m[1]]: n };
    save();
    renderSwimmerDialog();
    return renderMain();
  }
  if (el.dataset.action === 'paraSuggest' || el.dataset.action === 'paraClear') {
    const sw = state.swimmers.find((x) => x.id === state.openId);
    if (!sw) return;
    if (el.dataset.action === 'paraClear') sw.para = undefined;
    else sw.para = { ...(sw.para || {}), ...suggestPara(sw.para) };
    save();
    renderSwimmerDialog();
    return renderMain();
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
    return doSearch($('#searchForm'), (addState.searchState?.page || 1) + 1);
  }
  if (el.dataset.action === 'addAll') {
    const todo = addState.searchState.swimmers.filter((s) => !state.swimmers.some((x) => x.id === s.id)).slice(0, 30);
    for (const s of todo) addSwimmer(pickSwimmer(s, 'se'), { load: false });
    refreshAll({ only: state.swimmers.filter((s) => todo.some((x) => x.id === s.id)) });
    renderHits();
    toast(t('addedN', { n: todo.length }));
    return;
  }
  if (el.dataset.action === 'importOpen') return openImport();
  if (el.dataset.action === 'meetImport') return openMeetImport();
  if (el.dataset.mpick) return pickMeet(Number(el.dataset.mpick));
  if (el.dataset.action === 'meetImportBack') {
    Object.assign(addState.meetImport, { step: 'pick', data: null, club: '' });
    return addState.meetImport.meets ? renderMeetImport() : findMeets();
  }
  if (el.dataset.action === 'meetImportAdd') return addFromMeet();
  if (el.dataset.misex != null && addState.meetImport) {
    addState.meetImport.sex = el.dataset.misex;
    return renderMeetImport();
  }
  if (el.dataset.migroup && addState.meetImport) {
    addState.meetImport.groupBy = el.dataset.migroup;
    return renderMeetImport();
  }
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
    addState.importState = { ...addState.importState, entries: [], status: new Map(), selected: new Set() };
    return renderImport();
  }
  if (el.dataset.action === 'importAdd') return addImported();
  if (el.dataset.action === 'importAll') {
    const list = addState.importState.entries.filter(selectable);
    const all = list.every((e) => addState.importState.selected.has(e.key));
    for (const e of list) all ? addState.importState.selected.delete(e.key) : addState.importState.selected.add(e.key);
    return renderImportKeepScroll();
  }
  if (el.dataset.action === 'importParaUpdate') {
    const list = paraUpdates();
    for (const { sw, merged } of list) sw.para = merged;
    save();
    render();
    toast(t('importParaUpdated', { n: list.length }));
    return renderImportKeepScroll();
  }
  if (el.dataset.igroup) {
    addState.importState.groupBy = el.dataset.igroup;
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
  if (e.key === 'Escape' && state.menu) {
    e.preventDefault();
    const id = state.menu;
    closeMenu();
    $(`[data-menu="${id}"]`)?.focus();
    return;
  }
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
  if (e.target.id === 'meetSearchForm') {
    e.preventDefault();
    addState.meetImport.q = new FormData(e.target).get('q').trim();
    return findMeets();
  }
  if (e.target.id === 'searchForm') {
    e.preventDefault();
    doSearch(e.target);
  }
});

document.addEventListener('toggle', (e) => {
  const v = e.target?.dataset?.help;
  if (v) state.helpOpen[v] = e.target.open;
  // keep the para class box open while it is being filled in (the dialog re-renders on every change)
  const ps = e.target?.dataset?.paraSet;
  if (ps) state.paraOpen = e.target.open ? Number(ps) : state.paraOpen === Number(ps) ? null : state.paraOpen;
}, true);

document.addEventListener('change', (e) => {
  if (e.target.id === 'period' || e.target.id === 'periodSheet') {
    state.period = e.target.value;
    store.set('period', state.period);
    render();
    refreshAll({ only: state.swimmers.filter(needsLoad) });
  }
  if (e.target.dataset?.part) {
    state.cardParts = { ...state.cardParts, [e.target.dataset.part]: e.target.checked };
    store.set('cardParts', state.cardParts);
    if (e.target.dataset.part === 'recent' && e.target.checked) refreshAll({ only: state.swimmers.filter(needsLoad) });
    return renderMain();
  }
  if (e.target.dataset?.bulk) {
    const id = Number(e.target.dataset.bulk);
    return bulkSelect(id, e.target.checked);
  }
  if (e.target.dataset?.bulkAll !== undefined) {
    return bulkSelect('all', e.target.checked);
  }
  if (e.target.id === 'miClub') return loadMeetClub(e.target.value);
  if (e.target.id === 'miBorn') {
    addState.meetImport.born = e.target.value;
    return renderMeetImport();
  }
  if (e.target.dataset?.misel) {
    const id = Number(e.target.dataset.misel);
    if (e.target.checked) addState.meetImport.selected.add(id);
    else addState.meetImport.selected.delete(id);
    return renderMeetImport();
  }
  if (e.target.dataset?.migroupAll !== undefined) {
    const list = meetImportGroups().find(([k]) => k === e.target.dataset.migroupAll)?.[2] || [];
    for (const sw of list) if (!inList(sw.id)) e.target.checked ? addState.meetImport.selected.add(sw.id) : addState.meetImport.selected.delete(sw.id);
    return renderMeetImport();
  }
  if (e.target.dataset?.iparaopt !== undefined) {
    addState.importState.usePara = e.target.checked;
    return renderImportKeepScroll();
  }
  if (e.target.dataset?.isel) {
    const k = e.target.dataset.isel;
    if (e.target.checked) addState.importState.selected.add(k);
    else addState.importState.selected.delete(k);
    return renderImportKeepScroll();
  }
  if (e.target.dataset?.igroupAll !== undefined) {
    const label = e.target.dataset.igroupAll;
    const list = importGroups().find(([l]) => l === label)?.[1] || [];
    for (const en of list) if (selectable(en)) e.target.checked ? addState.importState.selected.add(en.key) : addState.importState.selected.delete(en.key);
    return renderImportKeepScroll();
  }
  if (e.target.dataset?.ipick) {
    const k = e.target.dataset.ipick;
    const st = addState.importState.status.get(k);
    st.pick = st.candidates.find((c) => String(c.id) === e.target.value) || null;
    if (st.pick && !state.swimmers.some((s) => s.id === st.pick.id)) addState.importState.selected.add(k);
    else addState.importState.selected.delete(k);
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
      // classes 11–13 (vision) and 14 (intellectual) are the same in every stroke, so set all three at once;
      // 1–10 (physical) differ between strokes and are set one by one
      const v = Number(e.target.value);
      if (v >= 11 && v <= 14) Object.assign(p, { S: v, SB: v, SM: v });
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
  state.menu = null;
  saveNav();
});

Object.assign(hooks, { render, renderHeader, renderMain, renderSwimmerDialog, save });
initReorder({ state, save });

// ---------------------------------------------------------------- start

// Name every dialog by its first heading, so screen readers announce what opened.
for (const d of document.querySelectorAll('dialog')) {
  new MutationObserver(() => {
    const h = d.querySelector('h2');
    if (!h) return d.removeAttribute('aria-labelledby');
    if (!h.id) h.id = d.id + '-title';
    d.setAttribute('aria-labelledby', h.id);
  }).observe(d, { childList: true, subtree: true });
}

// Another tab changed the list: follow it instead of overwriting it later.
window.addEventListener('storage', (e) => {
  if (e.key !== 'swimdeck.swimmers') return;
  state.swimmers = store.get('swimmers', []);
  render();
});

// Do not lose an edit made just before the tab closes.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSync(); });
window.addEventListener('pagehide', flushSync);

restoreNav();
loadRecords();
render();
if (state.openId && !$('#swimmerDialog').open) $('#swimmerDialog').showModal();
checkSyncLink();
checkImport();
pullSync({ force: true });
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && pullSync());
window.addEventListener('focus', () => pullSync());
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').then(() => setTimeout(() => healNotify().catch(() => {}), 3000)).catch(() => {});
}
refreshAll({ only: state.swimmers.filter(needsLoad) });
