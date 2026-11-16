// Push notifications for new personal bests: subscribing in the browser and keeping the server's list in step.
import { state, store, t, $, esc, API, toast, errText } from './core.js';


state.notify = store.get('notify', null); // { endpoint, count }
let notifyTimer = null;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function notifyApi(method, path, body) {
  const res = await fetch(`${API}/api/push${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enableNotify() {
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
    if (state.notify?.endpoint && state.notify.endpoint !== sub.endpoint) await notifyApi('DELETE', '', { endpoint: state.notify.endpoint }).catch(() => {});
    await sendNotifyList(sub, true);
    renderNotifyDialog();
    toast(t('notifyOnToast'));
  } catch (e) {
    renderNotifyDialog(errText(e.message));
  }
}

export async function sendNotifyList(sub, force = false) {
  const swimmers = state.swimmers.filter((s) => s.site === 'se').map((s) => s.id);
  const goals = Object.fromEntries(state.swimmers.filter((s) => s.site === 'se' && s.goals && Object.keys(s.goals).length).map((s) => [s.id, s.goals]));
  // Nothing to tell the server when the list, goals and language are what it already has (saves a server write).
  const sig = JSON.stringify([sub.endpoint, swimmers, goals, state.lang]);
  if (!force && state.notify?.sig === sig && Date.now() - (state.notify.sentAt || 0) < 7 * 864e5) return;
  await notifyApi('POST', '', { subscription: sub.toJSON(), swimmers, goals, lang: state.lang });
  state.notify = { endpoint: sub.endpoint, count: swimmers.length, sig, sentAt: Date.now() };
  store.set('notify', state.notify);
}

export async function disableNotify() {
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

/**
 * Browsers sometimes drop a push subscription (Brave does after a while, and when site data or permissions are
 * reset). If notifications are still allowed, subscribe again quietly and replace the old address on the server.
 * Returns 'ok', 'reset' (the permission was forgotten, the user must allow again) or 'blocked'.
 */
export async function healNotify() {
  if (!state.notify || !pushSupported()) return 'ok';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'reset';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.endpoint === state.notify.endpoint) return 'ok';
  if (!sub) {
    const { key } = await notifyApi('GET', '/key');
    const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((key.length + 3) % 4));
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
  }
  if (state.notify.endpoint && state.notify.endpoint !== sub.endpoint) await notifyApi('DELETE', '', { endpoint: state.notify.endpoint }).catch(() => {});
  await sendNotifyList(sub);
  return 'ok';
}

export const notifyProblem = (status) => (status === 'blocked' ? t('notifyDenied') : status === 'reset' ? t('notifyReset') : '');

export async function testNotify() {
  try {
    const status = await healNotify();
    if (status !== 'ok') return renderNotifyDialog(notifyProblem(status), status);
    const sub = await currentSubscription();
    if (!sub) return renderNotifyDialog(t('notifyGone'), 'reset');
    await notifyApi('POST', '/test', { endpoint: sub.endpoint });
    toast(t('notifyTestSent'));
  } catch (e) {
    toast(/429|minute/i.test(e.message) ? t('notifyWait') : errText(e.message));
  }
}

export function scheduleNotifyUpdate() {
  if (!state.notify || !pushSupported()) return;
  const count = state.swimmers.filter((s) => s.site === 'se').length;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(async () => {
    try {
      const sub = await currentSubscription();
      if (sub) await sendNotifyList(sub);
      else await healNotify();
    } catch {}
  }, count === state.notify.count ? 30000 : 1500);
}

export function openNotify() {
  renderNotifyDialog();
  const dlg = $('#confirmDialog');
  if (!dlg.open) dlg.showModal();
  healNotify().then((status) => { if (status !== 'ok' && dlg.open) renderNotifyDialog(notifyProblem(status), status); }).catch(() => {});
}

export function renderNotifyDialog(msg = '', problem = '') {
  const dlg = $('#confirmDialog');
  const on = !!state.notify;
  const ios = /iphone|ipad/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;
  dlg.innerHTML = `<form method="dialog" class="sheet small-sheet">
    <header class="sheet-head"><h2>${esc(t('notifyTitle'))}</h2><button type="button" class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
    ${msg ? `<p class="warn small">${esc(msg)}</p>` : ''}
    ${!pushSupported() ? `<p class="small">${esc(ios ? t('notifyIos') : t('notifyUnsupported'))}</p>`
      : on ? `<p class="small">${esc(t('notifyOn', { n: state.notify.count }))}</p><p class="small muted">${esc(t('notifyHow'))}</p>
        <div class="row end wrap"><button type="button" class="link danger" data-action="notifyOff">${esc(t('notifyDisable'))}</button>${problem === 'reset' ? `<button type="button" class="btn primary" data-action="notifyOn">${esc(t('notifyAgain'))}</button>` : `<button type="button" class="btn" data-action="notifyTest">${esc(t('notifyTest'))}</button><button class="btn primary" value="ok">${esc(t('done'))}</button>`}</div>`
      : `<p class="small">${esc(t('notifyIntro'))}</p><p class="small muted">${esc(t('notifyHow'))}</p><p class="small muted">${esc(t('notifyPrivacy'))}</p>
        <div class="row end"><button type="button" class="btn primary" data-action="notifyOn" ${state.swimmers.length ? '' : 'disabled'}>${esc(t('notifyEnable'))}</button></div>`}
  </form>`;
  dlg.onclose = null;
}

