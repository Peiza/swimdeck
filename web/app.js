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
import { bulkSelect, share, checkSyncLink, checkImport, ask, askRemove, openBulkRemove, renderBulkRemove, doBulkRemove, restore, openTrash, renderTrash, purge } from './lists.js';
import { roundLabel, roundRank, reRank, sexCode, meetCache, meetButton, openMeet, loadMeet, renderMeet, eventRow, fillEventDetail, goalEditor, setGoal, MONTHS, mastersShipped, shortIso, recordStatus, applyRecords, loadRecords, recordLine, prognosisLine, rankRow, rankMsg, fillRank, seasonTable, chart } from './meets.js';
import { usesWps, fmtPctPlain, METRICS, metricsFor, metricFor, metricName, ptsOf, ptsTitle, ptsLabel, metricValue, fmtMetric, compareMetrics, pill, metricPill, NEAR_CHOICES, nearShare, nearPill, closeMenu, periodName, periodOptionLabel, oldestSwimYear, shortDate, fmtPct, downloadCsv, save } from './viewkit.js';
import { addState, updateAddDone, openAdd, openImport, renderImport, selectable, importGroups, importRow, importCache, IMPORT_PRESELECT, importSearch, runImport, renderImportKeepScroll, mergePara, paraUpdates, addImported, MEET_IMPORT_MAX, openMeetImport, findMeets, pickMeet, loadMeetClub, inList, meetImportShown, meetImportGroups, renderMeetImport, addFromMeet, doSearch, renderHits, addSwimmer } from './add.js';
import { loadingStop, loadingStart, loadingEnd, api, periodKey, RECENT_DAYS, recentMeet, loadSwimmer, pickSwimmer, refreshAll, needsLoad, loadEvent } from './api.js';
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

/**
 * Qualifying cards: spread them over as many columns as fit, each card going to the currently shortest column.
 * The order reads left to right, row by row, like the Swimmers tab, and short cards leave no gaps.
 */
const QUAL_CARD_MIN = 360;
const QUAL_GAP = 12;
function packQualCards() {
  const box = $('.qual-done');
  if (!box) return;
  const cards = [...box.querySelectorAll('.qd-card')];
  if (!cards.length) return;
  const cols = Math.max(1, Math.floor((box.clientWidth + QUAL_GAP) / (QUAL_CARD_MIN + QUAL_GAP)));
  if (box.dataset.cols === String(cols) && box.dataset.count === String(cards.length) && box.dataset.sig === cards.map((c) => c.dataset.id).join()) return;
  const columns = Array.from({ length: cols }, () => Object.assign(document.createElement('div'), { className: 'qual-col' }));
  box.replaceChildren(...columns);
  const heights = new Array(cols).fill(0);
  for (const card of cards) {
    let k = 0;
    columns.forEach((c, i) => { if (heights[i] < heights[k]) k = i; });
    columns[k].append(card);
    heights[k] += card.offsetHeight + QUAL_GAP;
  }
  box.classList.add('packed');
  box.dataset.cols = String(cols);
  box.dataset.count = String(cards.length);
  box.dataset.sig = cards.map((c) => c.dataset.id).join();
}
let packTimer = 0;
addEventListener('resize', () => {
  clearTimeout(packTimer);
  packTimer = setTimeout(() => {
    const box = $('.qual-done');
    if (!box) return;
    const cards = [...box.querySelectorAll('.qd-card')];
    box.replaceChildren(...cards);
    box.classList.remove('packed');
    delete box.dataset.cols;
    packQualCards();
  }, 150);
});

const SORTS = { manual: 'sortManual', fresh: 'sortFresh', name: 'sortName', born: 'sortBorn', club: 'sortClub', newPbs: 'sortNewPbs', recent: 'sortRecent' };

function cardInfo(id) {
  const d = state.data[id];
  if (!d?.all) return null;
  const sum = summarize(d.all, d.period, d.before);
  return { newPbs: sum.newPbs, latest: sum.latest?.date || '' };
}

/** The swimmers in the order chosen under "Sort by" on the Swimmers tab; other views follow it. */
function sortedSwimmers() {
  return state.sort === 'fresh'
    ? [...state.swimmers].sort((a, b) => newFor(b).length - newFor(a).length)
    : sortSwimmers(state.swimmers, state.sort, cardInfo, state.lang);
}

function deckView() {
  const allCollapsed = state.swimmers.every((s) => state.collapsed.includes(s.id));
  const list = sortedSwimmers();
  return `
    <div class="deck-tools">
      <div class="deck-tools-left">
        <label class="select compact"><span class="sr">${esc(t('sortBy'))}</span>
          <select id="sortMode" aria-label="${esc(t('sortBy'))}">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === state.sort ? 'selected' : ''}>${esc(t('sortBy'))}: ${esc(t(v))}</option>`).join('')}</select>
        </label>
        <button class="link" data-action="${allCollapsed ? 'expandAll' : 'collapseAll'}">${esc(t(allCollapsed ? 'expandAll' : 'collapseAll'))}</button>
        <button class="link" data-action="notifyOpen">${esc(state.notify ? t('notifyOnShort') : t('notifyShort'))}</button>
        <details class="deck-more">
          <summary class="link">${esc(t('moreMenu'))}</summary>
          <div class="deck-more-body">
            <button class="link" data-action="cardsCustomize">${esc(t('customize'))}</button>
            ${state.swimmers.length > 1 ? `<button class="link" data-action="bulkRemove">${esc(t('bulkRemove'))}</button>` : ''}
            ${trashLink()}
          </div>
        </details>
      </div>
    </div>
    ${(() => { const n = state.swimmers.reduce((a, s) => a + newFor(s).length, 0); const who = state.swimmers.filter((s) => newFor(s).length).length; return n ? `<div class="new-banner"><span>${esc(t('newBanner', { n, who }))}</span><button class="link" data-action="seenAll">${esc(t('markSeen'))}</button></div>` : ''; })()}
    ${state.sort === 'manual' && state.swimmers.length > 1 ? `<p class="muted small drag-hint">${esc(t('dragHint'))}</p>` : ''}
    <ul class="deck" id="deck">${list.map(cardView).join('')}</ul>`;
}

const CARD_PARTS = ['stats', 'recent', 'latest', 'improve', 'qual', 'goals', 'best', 'para'];

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

/** Best events for the card: by WPS (50 m) for para swimmers who have them, otherwise by AQUA. */
function bestFor(s, sum) {
  if (hasPara(s)) {
    const wb = sum.rows.filter((r) => r.pb && r.pool === 50).map((r) => ({ r, w: wpsPoints(s, r.pb) })).filter((x) => x.w).sort((a, b) => b.w - a.w).slice(0, 4).map((x) => x.r);
    if (wb.length) return { list: wb, label: t('bestEventsWps') };
  }
  if (isMasters(s)) {
    const mb = sum.rows.filter((r) => r.pb).map((r) => ({ r, m: mastersPct(s, r.pb) })).filter((x) => x.m).sort((a, b) => b.m.pct - a.m.pct).slice(0, 4).map((x) => x.r);
    if (mb.length) return { list: mb, label: t('bestEventsMasters') };
  }
  return { list: sum.best, label: t('bestEventsAqua') };
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
      : esc(d?.error ? errText(d.error) : t('loading'));
    const fresh = newFor(s).length;
    return `<li class="card collapsed ${fresh ? 'has-new' : ''}" data-open="${s.id}" tabindex="0">${head}<p class="small muted">${fresh ? `<span class="new-tag">${esc(t('newSince', { n: fresh }))}</span> ` : ''}${line}</p></li>`;
  }
  if (!d || !d.all) {
    return `<li class="card ${d?.error ? 'has-error' : 'loading'}" data-open="${s.id}" tabindex="0">${head}
      <p class="muted">${d?.error ? esc(errText(d.error)) : esc(t('loading'))}</p></li>`;
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
    ${P.recent ? (() => { const rm = recentMeet(d); return rm ? `<div class="recent-meet">
      <span class="muted small">${esc(t('recentMeet'))}</span>
      <div class="rm-head"><b>${esc(rm.meet)}</b> <span class="muted small">${esc(rm.date)}</span></div>
      <div class="rm-swims">${rm.swims.slice(0, 6).map((w) => `<span class="rm-swim"><span>${esc(eventShort(w.event, state.lang, w.name))} <small class="pool">${w.pool} m</small></span> <b>${fmtTime(w.time)}</b>${w.pb != null && w.time <= w.pb ? ` <span class="badge">${esc(t('pb'))}</span>` : w.pb ? ` <small class="muted">${fmtDiff(w.time - w.pb)}</small>` : ''}</span>`).join('')}${rm.swims.length > 6 ? `<span class="muted small">${esc(t('andMore', { n: rm.swims.length - 6 }))}</span>` : ''}</div>
    </div>` : ''; })() : ''}
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
    ${P.best && bestFor(s, sum).list.length ? `<div class="best-block"><span class="muted small">${esc(bestFor(s, sum).label)}</span><div class="chips">${bestFor(s, sum).list.map((r) => `<span class="chip"><span class="chip-name">${esc(eventLabel(r.event, state.lang, r.name))}</span><span class="chip-meta"><small>${r.pool} m</small><b>${fmtTime(r.pb.time)}</b></span></span>`).join('')}</div></div>` : ''}
    ${d.error ? `<p class="warn small">${esc(errText(d.error))}</p>` : ''}
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
  const anyPara = state.swimmers.some(hasPara);
  const anyMasters = state.swimmers.some((x) => isMasters(x));
  if (state.rankEvent === 'wps' && !anyPara) state.rankEvent = 'aqua';
  if (state.rankEvent === 'masters' && !anyMasters) state.rankEvent = 'aqua';
  if (state.rankEvent !== 'aqua' && state.rankEvent !== 'wps' && state.rankEvent !== 'masters' && state.rankEvent !== 'wr' && !options.has(state.rankEvent) && !both.has(state.rankEvent)) state.rankEvent = bothOpts[0] ? `both:${bothOpts[0].code}` : 'aqua';
  const wpsMode = state.rankEvent === 'wps';
  const mastersMode = state.rankEvent === 'masters';
  const wrMode = state.rankEvent === 'wr';
  const aqua = state.rankEvent === 'aqua' || wpsMode || mastersMode || wrMode;
  const bothMode = state.rankEvent.startsWith('both:');
  const sexes = [...new Set(state.swimmers.map((s) => s.sex).filter(Boolean))];
  const years = [...new Set(state.swimmers.map((s) => s.born).filter(Boolean))].sort((a, b) => b - a);
  const swimmers = state.swimmers.filter(
    (s) => (!state.rankSex || s.sex === state.rankSex) && (!state.rankYear || String(s.born) === String(state.rankYear)),
  );
  const c25 = bothMode ? Number(state.rankEvent.slice(5)) : null;
  const c50 = bothMode && c25 > 10 ? c25 + 1 : null;
  // "All swims": the list's fastest swims in one event, where a swimmer can appear more than once
  const swimsCode = aqua ? null : bothMode ? (state.rankSortPool === 50 && c50 ? c50 : c25) : Number(state.rankEvent.split(':')[1]);
  const swimsMode = basis === 'swims' && !!swimsCode;
  let swimsLoading = 0;
  let rows;
  if (swimsMode) {
    rows = [];
    for (const sw of swimmers) {
      const k = `${sw.site}:${sw.id}:${swimsCode}`;
      const ev = state.eventData[k];
      if (ev === undefined) {
        swimsLoading++;
        loadEvent(sw, swimsCode).then((d) => { state.eventData[k] = d; }, () => { state.eventData[k] = null; }).then(() => state.view === 'rank' && renderMain());
        continue;
      }
      for (const r of ev?.results || []) rows.push({ swimmer: sw, result: r });
    }
    rows.sort((a, b) => a.result.time - b.result.time || String(a.result.date).localeCompare(String(b.result.date)));
    rows = rows.slice(0, 50);
  } else if (improveMode) {
    const sums = Object.fromEntries(swimmers.map((s) => { const d = state.data[s.id]; return [s.id, d?.all ? summarize(d.all, d.period, d.before) : null]; }));
    if (bothMode) rows = rankingsByImprovement(swimmers, sums, [c25, c50].filter(Boolean));
    else {
      const [pool, event] = aqua ? [null, null] : state.rankEvent.split(':').map(Number);
      rows = rankingsByImprovement(swimmers, sums, event, pool);
    }
  } else if (wpsMode) {
    rows = swimmers.filter(hasPara).map((sw) => {
      let best = null;
      for (const b of overviews[sw.id]?.bests || []) {
        const w = wpsPoints(sw, b);
        if (w && (!best || w > best.points)) best = { ...b, points: w };
      }
      return best ? { swimmer: sw, result: best } : null;
    }).filter(Boolean).sort((a, b) => b.result.points - a.result.points);
  } else if (wrMode) {
    rows = swimmers.map((sw) => {
      let best = null;
      for (const b of overviews[sw.id]?.bests || []) {
        const w = wrPct(sw, b);
        if (w && (!best || w.pct > best.pct)) best = { ...b, pct: w.pct, record: w.record };
      }
      return best ? { swimmer: sw, result: best } : null;
    }).filter(Boolean).sort((a, b) => b.result.pct - a.result.pct);
  } else if (mastersMode) {
    rows = swimmers.filter((x) => isMasters(x)).map((sw) => {
      let best = null;
      for (const b of overviews[sw.id]?.bests || []) {
        const m = mastersPct(sw, b);
        if (m && (!best || m.pct > best.pct)) best = { ...b, pct: m.pct, group: m.group, record: m.record };
      }
      return best ? { swimmer: sw, result: best } : null;
    }).filter(Boolean).sort((a, b) => b.result.pct - a.result.pct);
  } else if (aqua) rows = rankingsByPoints(swimmers, overviews);
  else if (bothMode) rows = rankingsBothPools(swimmers, overviews, c25, c50, state.rankSortPool);
  else {
    const [pool, event] = state.rankEvent.split(':').map(Number);
    rows = rankings(swimmers, overviews, event, pool);
  }
  const twoCols = bothMode && !improveMode && !swimsMode;
  const lead = rows[0]?.result;
  state.rankRows = { rows, aqua, improveMode, twoCols };
  const sortKey = state.rankSortPool === 50 ? 'r50' : 'r25';
  const leadTime = (k) => rows.find((r) => r[k])?.[k]?.time;
  const cell = (r, k) => {
    const x = r[k];
    if (!x) return '<td class="num muted">–</td><td class="gapc"></td>';
    const gap = x.time - leadTime(k);
    return `<td class="num"><b>${fmtTime(x.time)}</b><small class="muted">${esc(x.date || '')}</small></td><td class="gapc muted">${gap > 0 ? fmtDiff(gap) : ''}</td>`;
  };
  return `
    <div class="rank-controls">
      <label class="select"><span>${esc(t('chooseEvent'))}</span>
        <select id="rankEvent">
          <option value="aqua" ${state.rankEvent === 'aqua' ? 'selected' : ''}>${esc(t('allEventsAqua'))}</option>
          ${anyPara ? `<option value="wps" ${wpsMode ? 'selected' : ''}>${esc(t('allEventsWps'))}</option>` : ''}
          <option value="wr" ${wrMode ? 'selected' : ''}>${esc(t('allEventsWr'))}</option>
          ${anyMasters ? `<option value="masters" ${mastersMode ? 'selected' : ''}>${esc(t('allEventsMasters'))}</option>` : ''}
          ${bothOpts.length ? `<optgroup label="${esc(t('bothPools'))}">${bothOpts.map((b) => `<option value="both:${b.code}" ${`both:${b.code}` === state.rankEvent ? 'selected' : ''}>${esc(eventLabel(b.code, state.lang, b.name))}${b.code > 10 ? ' · 25 + 50 m' : ' · 25 m'}</option>`).join('')}</optgroup>` : ''}
          ${[25, 50].map((p) => { const o = opts.filter((b) => b.pool === p); return o.length ? `<optgroup label="${esc(t(p === 25 ? 'shortCourse' : 'longCourse'))}">${o.map((b) => `<option value="${b.pool}:${b.event}" ${`${b.pool}:${b.event}` === state.rankEvent ? 'selected' : ''}>${esc(eventLabel(b.event, state.lang, b.name))} · ${b.pool} m</option>`).join('')}</optgroup>` : ''; }).join('')}
        </select>
      </label>
      <div class="seg" role="group">${['pb', 'period', 'improve', ...(swimsCode ? ['swims'] : [])].map((x) => `<button data-basis="${x}" aria-pressed="${basis === x}">${esc(x === 'pb' ? t('basisPb') : x === 'period' ? t('basisPeriod', { period: periodName() }) : x === 'swims' ? t('basisSwims') : t('basisImprove'))}</button>`).join('')}</div>
      ${sexes.length > 1 ? `<div class="seg" role="group">${['', ...sexes].map((x) => `<button data-sex="${esc(x)}" aria-pressed="${state.rankSex === x}">${esc(x ? sexLabel(x) : t('allSexes'))}</button>`).join('')}</div>` : ''}
      ${years.length > 1 ? `<label class="select compact"><span class="sr">${esc(t('birthYear'))}</span><select id="rankYear"><option value="">${esc(t('allYears'))}</option>${years.map((y) => `<option value="${y}" ${String(state.rankYear) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select></label>` : ''}
    </div>
    ${improveMode ? `<p class="muted small rank-note">${esc(t('improveNote', { period: periodName() }))}</p>` : ''}
    ${swimsMode && bothMode && c50 ? `<div class="seg small" role="group">${[[25, c25], [50, c50]].map(([p]) => `<button data-sortpool="${p}" aria-pressed="${(state.rankSortPool === 50 ? 50 : 25) === p}">${p} m</button>`).join('')}</div>` : ''}
    ${swimsMode ? `<p class="muted small rank-note">${esc(t('swimsNote', { event: `${eventLabel(swimsCode, state.lang)} ${swimsCode % 2 ? 25 : 50} m` }))}${swimsLoading ? ' · ' + esc(t('loadingMeets', { done: swimmers.length - swimsLoading, total: swimmers.length })) : ''}</p>` : ''}
    ${wpsMode && !improveMode ? `<p class="muted small rank-note">${esc(t('wpsNote'))}</p>` : ''}
    ${mastersMode && !improveMode ? `<p class="muted small rank-note">${esc(t('mastersNote', { date: shortIso(recordStatus().mastersDate) }))}</p>${recordStatus().mastersNewer ? `<p class="warn small rank-note">${esc(t('mastersNewer', { date: shortIso(recordStatus().mastersNewer), ours: shortIso(recordStatus().mastersDate) }))}</p>` : ''}` : ''}
    ${wrMode && !improveMode ? `<p class="muted small rank-note">${esc(t(recordStatus().wrLive ? 'wrNoteLive' : 'wrNote', { date: shortIso(recordStatus().wrDate) }))}</p>${recordStatus().wrStale ? `<p class="warn small rank-note">${esc(t('wrStale', { date: shortIso(recordStatus().wrDate) }))}</p>` : ''}` : ''}
    ${!rows.length ? `<p class="muted">${esc(swimsMode && swimsLoading ? t('loading') : improveMode ? t('noImprove') : basis === 'period' ? t('noneInPeriod') : t('noneInEvent'))}</p>`
      : twoCols ? `<div class="row end"><button class="link small" data-action="csvRank">${esc(t('exportCsv'))}</button></div>
      <div class="table-scroll"><table class="compare rank-both">
        <thead><tr><th class="pos">#</th><th>${esc(t('swimmer'))}</th>${[[25, 'r25', 'shortCourse'], ...(c50 ? [[50, 'r50', 'longCourse']] : [])].map(([p, k, label]) => `<th class="num"><button class="sort-head" data-sortpool="${p}" aria-pressed="${sortKey === k}">${p} m${sortKey === k ? ' ↓' : ''}<small>${esc(t(label))}</small></button></th><th class="gapc"></th>`).join('')}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr data-open="${r.swimmer.id}" tabindex="0">
          <td class="pos">${r[sortKey] ? i + 1 : ''}</td>
          <td><b>${esc(r.swimmer.name)}</b><small class="muted">${esc(r.swimmer.born || '')}${r.swimmer.club ? `<span class="club-part">${r.swimmer.born ? ' · ' : ''}${esc(r.swimmer.club)}</span>` : ''}</small></td>
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
          ? wrMode
            ? `<span class="time">${fmtPctPlain(r.result.pct)}</span>
             <span class="muted small when">${esc(eventLabel(r.result.event, state.lang, r.result.name))} ${r.result.pool} m · <b>${fmtTime(r.result.time)}</b><br>${esc(t('mastersRecord'))} ${fmtTime(r.result.record)} · ${esc(r.result.date)}</span>
             <span class="gap"></span>`
            : mastersMode
            ? `<span class="time">${fmtPctPlain(r.result.pct)}</span>
             <span class="muted small when">${esc(eventLabel(r.result.event, state.lang, r.result.name))} ${r.result.pool} m · <b>${fmtTime(r.result.time)}</b> · ${esc(t('mastersGroup', { group: r.result.group })).replace(' ', '\u00a0').replace('–', '\u2060–\u2060')}<br>${esc(t('mastersRecord'))} ${fmtTime(r.result.record)} · ${esc(r.result.date)}</span>
             <span class="gap"></span>`
            : `<span class="time">${r.result.points} <small class="muted">${wpsMode ? 'WPS' : 'p'}</small></span>
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
    else if (aqua) line.push(res.pct != null ? fmtPctPlain(res.pct) : res.points || '');
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
  const labels = shortNames(chosen.map((s) => s.name));
  const first = (i) => esc(labels[i]);
  const options = compareMetrics(chosen);
  const m = options.includes(state.compareMetric) ? state.compareMetric : 'time';
  const val = (i, c) => (c ? metricValue(chosen[i], c, m) : null);
  const cellHtml = (row) => {
    if (m === 'time') return row.cells.map((c) => c
      ? `<td class="num ${c.time === row.fastest && chosen.length > 1 ? 'fastest' : ''}"><b>${fmtTime(c.time)}</b>${c.time !== row.fastest ? `<small>${fmtDiff(c.time - row.fastest)}</small>` : `<small>${esc(c.date.slice(0, 4))}</small>`}</td>`
      : '<td class="num muted">–</td>').join('');
    const vals = row.cells.map((c, i) => val(i, c));
    const top = Math.max(...vals.filter((v) => v != null));
    return row.cells.map((c, i) => (c
      ? `<td class="num ${vals[i] != null && vals[i] === top && chosen.length > 1 ? 'fastest' : ''}"><b>${esc(fmtMetric(vals[i], m, c))}</b><small>${fmtTime(c.time)}</small></td>`
      : '<td class="num muted">–</td>')).join('');
  };
  // with a metric, a last row with each swimmer's best value over all events in the table
  const bestRow = m === 'time' ? '' : (() => {
    const best = chosen.map((sw, i) => table.reduce((acc, row) => { const c = row.cells[i]; const v = val(i, c); return v != null && (!acc || v > acc.v) ? { v, c, row } : acc; }, null));
    const top = Math.max(...best.filter(Boolean).map((b) => b.v));
    return `<tr class="compare-best"><th scope="row">${esc(t('compareBest'))}</th>${best.map((b) => (b
      ? `<td class="num ${b.v === top && chosen.length > 1 ? 'fastest' : ''}"><b>${esc(fmtMetric(b.v, m, b.c))}</b><small>${esc(eventShort(b.row.event, state.lang, b.row.name))}</small></td>`
      : '<td class="num muted">–</td>')).join('')}</tr>`;
  })();
  return `
    <div class="compare-pick">
      <p class="muted small">${esc(t('compareHint'))}</p>
      <div class="pick-list">${state.swimmers.map((s) => `<button class="pick" data-pick="${s.id}" aria-pressed="${ids.includes(s.id)}" ${!ids.includes(s.id) && ids.length >= 4 ? 'disabled' : ''}>${esc(s.name || '#' + s.id)}</button>`).join('')}</div>
    </div>
    <div class="rank-controls">
      <div class="seg" role="group">${[25, 50].map((p) => `<button data-cpool="${p}" aria-pressed="${state.comparePool === p}">${esc(t(p === 25 ? 'pool25' : 'pool50'))}</button>`).join('')}</div>
      <span class="near-control"><span class="muted small">${esc(t('compareShow'))}</span> ${pill('compare', 'cmetric', m, options.map((k) => ({ value: k, label: k === 'time' ? t('compareTimes') : metricName(k), desc: k === 'time' ? t('compareTimesDesc') : t('metricDesc_' + k) })), options.length < METRICS.length + 1 ? t('compareOnlyShared') : '', t('compareShow'))}</span>
      <span class="spacer"></span>
      ${table.length ? `<button class="link small" data-action="csvCompare">${esc(t('exportCsv'))}</button>` : ''}
    </div>
    ${table.length ? `<div class="table-scroll"><table class="compare">
      <thead><tr><th>${esc(t('event'))}</th>${chosen.map((s, i) => `<th class="num" title="${esc(s.name)}">${first(i)}</th>`).join('')}</tr></thead>
      <tbody>${table.map((row) => `<tr><th scope="row">${esc(eventLabel(row.event, state.lang, row.name))}</th>${cellHtml(row)}</tr>`).join('')}${bestRow}</tbody>
    </table></div>` : `<p class="muted">${esc(t('noneInEvent'))}</p>`}
    ${chosen.length === 2 ? `<div class="h2h"><h3 class="small">${esc(t('h2hTitle', { a: labels[0], b: labels[1] }))}</h3>
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
  const [la, lb] = shortNames([a.name, b.name]).map(esc);
  if (!h.races.length) {
    box().innerHTML = `<p class="muted small">${esc(t('h2hNone'))}</p>`;
    return;
  }
  box().innerHTML = `
    <div class="h2h-score"><span><b>${la}</b> ${h.a}</span><span class="muted">–</span><span>${h.b} <b>${lb}</b></span>${h.ties ? `<span class="small muted">(${esc(t('h2hTies', { n: h.ties }))})</span>` : ''}</div>
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

function qualDoneView() {
  const doc = QUAL.standards[0];
  const byEvent = (a, b) => a.pool - b.pool || eventSortKey(a.event) - eventSortKey(b.event);
  const people = sortedSwimmers().map((s) => {
    const all = qualRows(s);
    const rows = all.filter((q) => q.reached.length).sort(byEvent);
    const near = all
      .filter((q) => !q.reached.length && q.missing.some((m) => m.gap / q.result.time <= nearShare()))
      .map((q) => ({ ...q, close: q.missing.filter((m) => m.gap / q.result.time <= nearShare()) }))
      .sort((a, b) => a.close[0].gap / a.result.time - b.close[0].gap / b.result.time);
    return { s, rows, near };
  });
  const shown = people.filter((p) => p.rows.length || p.near.length);
  const none = people.filter((p) => !p.rows.length && !p.near.length);
  const loading = state.swimmers.some((s) => !state.data[s.id]?.qual);
  const std = (id, time) => `<span class="qd-std">${qBadge(id, '', true)}<span class="qd-lim">${fmtTime(time)}</span></span>`;
  const next = (q) => (q.next ? `<span class="qd-next">${esc(t('toNext', { gap: fmtTime(q.next.gap), std: stdLabel(q.next.id) }))} (${fmtTime(q.next.time)})</span>` : '');
  const swum = (q) => `<td class="num"><b>${fmtTime(q.result.time)}</b><small class="muted">${esc(q.result.date || '')}</small></td>`;
  const head = (label) => `<thead><tr><th class="qd-pool">${label}</th><th class="num">${esc(t('qdSwum'))}</th><th class="num">${esc(t('qdLimit'))}</th></tr></thead>`;
  return `
    <div class="rank-controls qual-controls">${qualTabs()}<span class="near-control"><span class="muted small">${esc(t('qdNear'))}</span> ${nearPill('overview')}</span></div>
    ${!state.swimmers.length ? `<p class="muted">${esc(t('emptyBody'))}</p>` : ''}
    ${shown.length ? `<div class="qual-done">${shown.map(({ s, rows, near }) => `
      <section class="qd-card" data-id="${s.id}">
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
      <p>${esc(t('qdNearNote', { n: nearShare() * 100 }))}</p>
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
  const short = Object.fromEntries(shortNames(swimmers.map((s) => s.name)).map((n, i) => [swimmers[i].id, n]));
  const reached = (code) => swimmers.flatMap((s) => {
    const q = qualRows(s).find((x) => x.event === code);
    const hit = q?.reached.find((x) => ids.includes(x.id));
    return hit ? [{ s, hit, time: q.result.time }] : [];
  });
  // swimmers within 3 % of a standard of this championship that they have not reached yet
  const nearBy = (code) => swimmers.flatMap((s) => {
    const q = qualRows(s).find((x) => x.event === code);
    const m = q?.missing.find((x) => ids.includes(x.id) && x.gap / q.result.time <= nearShare());
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
      <thead><tr><th>${esc(t('event'))}</th>${cols.map(([, label]) => `<th class="num">${esc(label)}</th>`).join('')}<th>${esc(t('reachedByNear'))} ${nearPill('tab')}</th></tr></thead>
      <tbody>${lines.map((l) => `<tr><th scope="row">${esc(eventLabel(l.code, state.lang))}${comp === 'para' ? ` <small class="muted">${prefixFor(l.code)}${cls}</small>` : ''}</th>
        ${l.vals.map((v) => `<td class="num">${v ? fmtTime(v) : '<span class="muted">–</span>'}</td>`).join('')}
        <td class="who-cell">${[
          ...l.who.map((w) => ({ w, badge: qBadge(w.hit.id), n: l.near.find((x) => x.s.id === w.s.id) })),
          ...l.near.filter((w) => !l.who.some((x) => x.s.id === w.s.id)).map((w) => ({ w, badge: '', n: w })),
        ].map(({ w, badge, n }) => `<div class="who-item">
          <button class="pick small-pick ${badge ? '' : 'near-pick'}" data-open="${w.s.id}" title="${esc(w.s.name)} · ${fmtTime(w.time)}">${esc(short[w.s.id])}${badge ? ' ' + badge : ''}</button>
          ${n ? `<span class="qd-next">${esc(t('toNext', { gap: fmtTime(n.m.gap), std: stdLabel(n.m.id) }))} (${fmtTime(n.m.time)})</span>` : ''}
        </div>`).join('')}</td></tr>`).join('')}</tbody>
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
