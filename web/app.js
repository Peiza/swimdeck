import { CONFIG } from './config.js';
import { supportLine } from './support.js';
import { VERSION } from './version.js';
import { QUAL } from './qual-data.js';

import { LANGS } from './i18n.js';
import { initReorder } from './reorder.js';
import { initInstall, installTip, installFooterLink, onInstallClick } from './install.js';
import { onSwimmerClick, openSwimmer, renderSwimmerDialog } from './swimmer.js';
import { onViewsClick, packQualCards, deckView, openCustomize, trashLink, rankView, compareView, qualView } from './views.js';
import { onListsClick, bulkSelect, share, checkSyncLink, checkImport } from './lists.js';
import { shortIso, recordStatus, loadRecords } from './meets.js';
import { closeMenu, periodOptionLabel, oldestSwimYear, save } from './viewkit.js';
import {
  onAddClick,
  addState,
  updateAddDone,
  openAdd,
  selectable,
  importGroups,
  renderImportKeepScroll,
  findMeets,
  loadMeetClub,
  inList,
  meetImportGroups,
  renderMeetImport,
  doSearch,
} from './add.js';
import { refreshAll, needsLoad } from './api.js';
import { onSyncClick, flushSync, pullSync, syncStatusHtml } from './sync.js';
import { newFor, markSeen } from './parts.js';
import { onNotifyClick, healNotify } from './notify.js';
import { store, state, t, setLang, FEEDBACK_URL, esc, toast, hideToast, hooks, $ } from './core.js';
import { meets, profile } from './lib.js';
import { periodOptions } from './lib.js';

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
  main.innerHTML = (state.view === 'deck' ? installTip() : '') + helpBox(state.view) + (state.view === 'rank' ? rankView() : state.view === 'compare' ? compareView() : state.view === 'qual' ? qualView() : deckView());
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
      ${installFooterLink()}
      <a class="link" href="${FEEDBACK_URL}" target="_blank" rel="noopener">${esc(t('feedback'))}</a>
    </div>
    ${supportLine(t, esc)}
    <p class="muted small">${esc(t('dataFrom'))}</p>
    <p class="version">SwimDeck – ${esc(t('slogan'))} · © ${new Date().getFullYear()} Peiza · ${esc(versionLabel())}</p>`;
}

// ---------------------------------------------------------------- events

const clickGroups = [onInstallClick, onSyncClick, onNotifyClick, onAddClick, onListsClick, onSwimmerClick, onViewsClick];

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
  if (el.dataset.action === 'home') return goHome();
  if (el.dataset.action === 'about') return openAbout();
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
  if (el.hasAttribute('data-toast-action')) {
    const run = toast.action;
    hideToast();
    return run && run();
  }
  if (el.dataset.drag) return;
  if (el.dataset.action === 'movedHide') { store.set('movedHidden', true); return render(); }
  if (el.dataset.action === 'cardsCustomize') return openCustomize();
  for (const handle of clickGroups) if (handle(el, e)) return;
  // A card or a button inside one that opens the swimmer: last, so the specific buttons above win.
  if (el.dataset.open) return openSwimmer(el.dataset.open);
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

Object.assign(hooks, { render, renderHeader, renderMain, renderSwimmerDialog, save, saveNav });
initReorder({ state, save });
initInstall();

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
