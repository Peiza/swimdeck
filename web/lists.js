// Sharing and importing a list, removing swimmers, the trash and undo.
import { state, t, esc, toast, hooks, ask, $ } from './core.js';
import { refreshAll } from './api.js';
import { TRASH_DAYS } from './core.js';
import { ICON } from './parts.js';
import { joinSync } from './sync.js';



export async function share() {
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

export function checkSyncLink() {
  const m = location.hash.match(/sync=([A-Za-z0-9_-]{32,64})/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (state.sync?.token === m[1]) return;
  joinSync(m[1]);
}

export function checkImport() {
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
    hooks.save();
    hooks.render();
    refreshAll({ only: added });
  };
  dlg.showModal();
}

// ---------------------------------------------------------------- remove, trash, undo

export async function askRemove(id) {
  const s = state.swimmers.find((x) => x.id === Number(id));
  if (!s) return;
  const ok = await ask({ title: t('removeTitle'), body: t('removeBody', { name: s.name || '#' + s.id, days: TRASH_DAYS }), yes: t('remove'), danger: true });
  if (!ok) return;
  const index = state.swimmers.indexOf(s);
  state.swimmers.splice(index, 1);
  state.collapsed = state.collapsed.filter((x) => x !== s.id);
  state.trash = [{ swimmer: s, removedAt: Date.now(), index }, ...state.trash.filter((x) => x.swimmer.id !== s.id)];
  delete state.data[s.id];
  hooks.save();
  if ($('#swimmerDialog').open && state.openId === s.id) $('#swimmerDialog').close();
  hooks.render();
  toast(t('removed', { name: s.name || '#' + s.id }), { label: t('undo'), run: () => restore(s.id) });
}

// ---------------------------------------------------------------- remove several at once

let bulkSel = new Set();

/** Tick or untick one swimmer, or all of them, in the remove-several dialog. */
export function bulkSelect(id, on) {
  if (id === 'all') bulkSel = on ? new Set(state.swimmers.map((s) => s.id)) : new Set();
  else if (on) bulkSel.add(id);
  else bulkSel.delete(id);
  renderBulkRemove();
}

export function openBulkRemove() {
  bulkSel = new Set();
  renderBulkRemove();
  const dlg = $('#trashDialog');
  if (!dlg.open) dlg.showModal();
}

export function renderBulkRemove() {
  const dlg = $('#trashDialog');
  const all = state.swimmers.length && bulkSel.size === state.swimmers.length;
  const box = $('.bulk-list', dlg);
  const top = box ? box.scrollTop : 0;
  dlg.innerHTML = `<div class="sheet">
    <header class="sheet-head"><div><h2>${esc(t('bulkTitle'))}</h2><p class="muted small">${esc(t('bulkHint', { days: TRASH_DAYS }))}</p></div>
      <button class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
    <label class="igroup-head bulk-all"><input type="checkbox" data-bulk-all ${all ? 'checked' : ''}> <b>${esc(t('bulkAll'))}</b> <span class="muted small">${state.swimmers.length}</span></label>
    <div class="import-list bulk-list">${state.swimmers.map((s) => `<label class="irow">
      <input type="checkbox" data-bulk="${s.id}" ${bulkSel.has(s.id) ? 'checked' : ''}>
      <span class="iname"><b>${esc(s.name || '#' + s.id)}</b><span class="muted small">${esc([s.born, s.club].filter(Boolean).join(' · '))}</span></span></label>`).join('')}</div>
    <div class="row end wrap"><button class="btn" data-action="close">${esc(t('cancel'))}</button>
      <button class="btn danger" data-action="bulkDo" ${bulkSel.size ? '' : 'disabled'}>${esc(t('bulkDo', { n: bulkSel.size }))}</button></div>
  </div>`;
  const nb = $('.bulk-list', dlg);
  if (nb) nb.scrollTop = top;
}

export async function doBulkRemove() {
  const ids = [...bulkSel];
  if (!ids.length) return;
  $('#trashDialog').close();
  const ok = await ask({ title: t('bulkConfirmTitle', { n: ids.length }), body: t('bulkConfirmBody', { n: ids.length, days: TRASH_DAYS }), yes: t('bulkDo', { n: ids.length }), danger: true });
  if (!ok) return;
  const now = Date.now();
  const gone = [];
  for (const id of ids) {
    const s = state.swimmers.find((x) => x.id === id);
    if (!s) continue;
    const index = state.swimmers.indexOf(s);
    state.swimmers.splice(index, 1);
    gone.push({ swimmer: s, removedAt: now, index });
    delete state.data[s.id];
  }
  state.collapsed = state.collapsed.filter((x) => !ids.includes(x));
  state.trash = [...gone, ...state.trash.filter((x) => !ids.includes(x.swimmer.id))];
  if ($('#swimmerDialog').open && ids.includes(state.openId)) $('#swimmerDialog').close();
  hooks.save();
  hooks.render();
  toast(t('bulkDone', { n: gone.length }), { label: t('undo'), run: () => [...gone].reverse().forEach((g) => restore(g.swimmer.id)) });
}

export function restore(id) {
  const item = state.trash.find((x) => x.swimmer.id === Number(id));
  if (!item) return;
  state.trash = state.trash.filter((x) => x !== item);
  if (!state.swimmers.some((x) => x.id === item.swimmer.id)) {
    state.swimmers.splice(Math.min(item.index ?? state.swimmers.length, state.swimmers.length), 0, item.swimmer);
  }
  hooks.save();
  hooks.render();
  if ($('#trashDialog').open) renderTrash();
  refreshAll({ only: [item.swimmer] });
}

export function openTrash() {
  renderTrash();
  const dlg = $('#trashDialog');
  if (!dlg.open) dlg.showModal();
}

export function renderTrash() {
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

export async function purge(ids) {
  const n = ids.length;
  const ok = await ask({ title: t('deletePermanent'), body: t('purgeConfirm', { n }), yes: t('deletePermanent'), danger: true });
  if (!ok) return;
  state.trash = state.trash.filter((x) => !ids.includes(x.swimmer.id));
  hooks.save();
  renderTrash();
  hooks.render();
}

/** Clicks that belong here. Returns true when it handled the click. */
export function onListsClick(el, e) {
  if (el.dataset.action === 'bulkRemove') {
    openBulkRemove();
    return true;
  }
  if (el.dataset.action === 'bulkDo') {
    doBulkRemove();
    return true;
  }
  if (el.dataset.remove) {
    askRemove(el.dataset.remove);
    return true;
  }
  if (el.dataset.action === 'trash') {
    openTrash();
    return true;
  }
  if (el.dataset.restore) {
    restore(el.dataset.restore);
    return true;
  }
  if (el.dataset.purge) {
    purge([Number(el.dataset.purge)]);
    return true;
  }
  if (el.dataset.action === 'emptyTrash') {
    purge(state.trash.map((x) => x.swimmer.id));
    return true;
  }
  if (el.dataset.action === 'remove') {
    askRemove(state.openId);
    return true;
  }
  return false;
}
