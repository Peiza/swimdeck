// Sync between devices: a secret link, merged lists, and the dialog that manages it.
import { state, store, t, esc, API, toast, errText, hooks, ask, $ } from './core.js';
import { mergeSyncLists, cleanRemoteSwimmers } from './lib.js';
import { scheduleNotifyUpdate } from './notify.js';
import { refreshAll } from './api.js';


let pushTimer = null;
let lastPull = 0;

export const syncPayload = () => ({ swimmers: state.swimmers.map((s) => ({ id: s.id, site: s.site, ...(s.para ? { para: s.para } : {}), ...(s.goals && Object.keys(s.goals).length ? { goals: s.goals } : {}) })) });
export const syncLink = () => `${location.origin}${location.pathname}#sync=${state.sync.token}`;

export async function syncApi(method, path, body) {
  const res = await fetch(`${API}/api/sync${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    keepalive: method === 'PUT',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

/** Send an edit that is waiting for its timer right away (the tab is closing or hidden). */
export function flushSync() {
  if (!pushTimer) return;
  clearTimeout(pushTimer);
  pushSync();
}

export function schedulePush() {
  if (!state.sync) return;
  const payload = JSON.stringify(syncPayload());
  if (payload === state.sync.payload) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushSync, 1200);
}

export async function pushSync() {
  pushTimer = null;
  if (!state.sync) return;
  let payload = JSON.stringify(syncPayload());
  try {
    let r;
    try {
      r = await syncApi('PUT', '/' + state.sync.token, { ...JSON.parse(payload), base: state.sync.updatedAt });
    } catch (e) {
      if (e.status !== 409) throw e;
      // Another device wrote first: merge its changes with ours, then write once more.
      const remote = await syncApi('GET', '/' + state.sync.token);
      let before = [];
      try { before = JSON.parse(state.sync.payload || '{}').swimmers || []; } catch {}
      applyRemote({ swimmers: mergeSyncLists(before, JSON.parse(payload).swimmers, remote.swimmers) });
      payload = JSON.stringify(syncPayload());
      r = await syncApi('PUT', '/' + state.sync.token, { ...JSON.parse(payload), base: remote.updatedAt });
    }
    state.sync = { ...state.sync, updatedAt: r.updatedAt, payload, error: null };
  } catch (e) {
    state.sync = { ...state.sync, error: e.status === 404 ? 'gone' : e.message };
  }
  store.set('sync', state.sync);
  renderSyncStatus();
}

/** Bring in changes made on other devices. */
export async function pullSync({ force = false } = {}) {
  if (!state.sync || pushTimer && !force) return;
  if (!force && Date.now() - lastPull < 20000) return;
  lastPull = Date.now();
  try {
    const remote = await syncApi('GET', '/' + state.sync.token);
    if (remote.updatedAt > (state.sync.updatedAt || 0)) {
      const now = JSON.stringify(syncPayload());
      if (now !== state.sync.payload) {
        // Unsent local edits: merge instead of overwriting them, and send the result.
        let before = [];
        try { before = JSON.parse(state.sync.payload || '{}').swimmers || []; } catch {}
        applyRemote({ swimmers: mergeSyncLists(before, JSON.parse(now).swimmers, remote.swimmers) });
        state.sync = { ...state.sync, updatedAt: remote.updatedAt, error: null };
        schedulePush();
      } else {
        applyRemote(remote);
        state.sync = { ...state.sync, updatedAt: remote.updatedAt, payload: JSON.stringify(syncPayload()), error: null };
      }
    } else {
      state.sync = { ...state.sync, error: null };
    }
  } catch (e) {
    state.sync = { ...state.sync, error: e.status === 404 ? 'gone' : e.message };
  }
  store.set('sync', state.sync);
  renderSyncStatus();
}

export function applyRemote(remote) {
  const known = new Map(state.swimmers.map((s) => [s.id, s]));
  const next = cleanRemoteSwimmers(remote.swimmers).map((r) => ({ ...(known.get(r.id) || { name: '', born: null, club: '', sex: '' }), id: r.id, site: r.site, para: r.para, goals: r.goals }));
  const added = next.filter((s) => !known.has(s.id));
  state.swimmers = next;
  store.set('swimmers', state.swimmers);
  hooks.render();
  scheduleNotifyUpdate();
  if (added.length) refreshAll({ only: added });
}

export function renderSyncStatus() {
  const el = $('#syncStatus');
  if (el) el.outerHTML = syncStatusHtml();
  if ($('#syncDialog').open) renderSyncDialog();
}

export function syncStatusHtml() {
  if (!state.sync) return '<span id="syncStatus"></span>';
  const bad = state.sync.error;
  return `<button id="syncStatus" class="sync-pill ${bad ? 'bad' : ''}" data-action="syncOpen" title="${esc(t('syncTitle'))}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.7L4 16M4 20v-4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    ${esc(bad ? t('syncError') : t('synced'))}</button>`;
}

export function openSyncDialog() {
  renderSyncDialog();
  const dlg = $('#syncDialog');
  if (!dlg.open) dlg.showModal();
}

export async function renderSyncDialog() {
  const dlg = $('#syncDialog');
  const on = !!state.sync;
  dlg.innerHTML = `<div class="sheet small-sheet sync-sheet">
    <header class="sheet-head"><h2>${esc(t('syncTitle'))}</h2><button class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
    ${on ? `
      ${state.sync.error === 'gone' ? `<p class="warn small">${esc(t('syncGone'))}</p>` : state.sync.error ? `<p class="warn small">${esc(errText(state.sync.error))}</p>` : `<p class="small">${esc(t('syncOn', { when: state.sync.updatedAt ? new Date(state.sync.updatedAt).toLocaleString(state.lang, { dateStyle: 'short', timeStyle: 'short' }) : '–' }))}</p>`}
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

export async function createSync() {
  try {
    const payload = syncPayload();
    const r = await syncApi('POST', '', payload);
    state.sync = { token: r.token, updatedAt: r.updatedAt, payload: JSON.stringify(payload) };
    store.set('sync', state.sync);
  } catch (e) {
    toast(errText(e.message));
  }
  renderSyncDialog();
  renderSyncStatus();
}

export async function joinSync(token) {
  const before = state.swimmers.slice();
  let remote;
  try {
    remote = await syncApi('GET', '/' + token);
  } catch (e) {
    toast(e.status === 404 ? t('syncGone') : errText(e.message));
    return;
  }
  const local = state.swimmers.map((s) => s.id);
  const remoteIds = cleanRemoteSwimmers(remote.swimmers).map((s) => s.id);
  const extra = local.filter((id) => !remoteIds.includes(id));
  // Always ask: whoever made the link can see and change the list from now on.
  const dlg = $('#confirmDialog');
  const mode = await new Promise((resolve) => {
    dlg.innerHTML = `<form method="dialog" class="sheet small-sheet">
      <h2>${esc(t('syncJoinTitle'))}</h2><p>${esc(t('syncJoinBody', { n: remoteIds.length, m: extra.length }))}</p>
      <p class="muted small">${esc(t('syncJoinWarn'))}</p>
      <div class="row end wrap"><button class="btn" value="cancel" autofocus>${esc(t('cancel'))}</button>${extra.length ? `<button class="btn" value="replace">${esc(t('syncReplace'))}</button><button class="btn primary" value="merge">${esc(t('syncMerge'))}</button>` : `<button class="btn primary" value="replace">${esc(t('syncJoinYes'))}</button>`}</div></form>`;
    dlg.returnValue = '';
    dlg.onclose = () => resolve(dlg.returnValue || 'cancel');
    dlg.showModal();
  });
  if (mode === 'cancel') return;
  state.sync = { token, updatedAt: remote.updatedAt, payload: '' };
  applyRemote(remote);
  if (mode === 'merge') state.swimmers.push(...before.filter((s) => extra.includes(s.id)));
  else state.sync.payload = JSON.stringify(syncPayload());
  store.set('sync', state.sync);
  hooks.save();
  hooks.render();
  toast(t('syncJoined'));
  renderSyncStatus();
}

/** Clicks that belong here. Returns true when it handled the click. */
export function onSyncClick(el, e) {
  if (el.dataset.action === 'syncOpen') {
    openSyncDialog();
    return true;
  }
  if (el.dataset.action === 'syncCreate') {
    createSync();
    return true;
  }
  if (el.dataset.action === 'syncNow') {
    pullSync({ force: true }).then(() => toast(t('synced')));
    return true;
  }
  if (el.dataset.action === 'syncCopy') {
    navigator.clipboard?.writeText(syncLink()).then(() => toast(t('shareCopied')), () => {});
    return true;
  }
  if (el.dataset.action === 'syncLeave') {
    ask({ title: t('syncLeave'), body: t('syncLeaveBody'), yes: t('syncLeave') }).then((ok) => {
      if (!ok) return;
      state.sync = null;
      store.set('sync', null);
      renderSyncDialog();
      renderSyncStatus();
    });
    return true;
  }
  if (el.dataset.action === 'syncDelete') {
    ask({ title: t('syncDelete'), body: t('syncDeleteBody'), yes: t('syncDelete'), danger: true }).then(async (ok) => {
      if (!ok) return;
      try {
        await syncApi('DELETE', '/' + state.sync.token);
      } catch {}
      state.sync = null;
      store.set('sync', null);
      renderSyncDialog();
      renderSyncStatus();
    });
    return true;
  }
  return false;
}
