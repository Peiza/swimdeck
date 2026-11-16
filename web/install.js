// Install as an app: a quiet tip for people who use SwimDeck regularly, and a footer link.
// Chrome on Android hands us an install prompt; Safari on iPhone has none, so we explain the steps.
import { state, store, t, esc, hooks } from './core.js';

let deferred = null;

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const iosSafari = () => /iphone|ipad/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

/** Count visits (one per browser session) so the tip waits until someone has come back. */
function countVisit() {
  try {
    if (sessionStorage.getItem('swimdeck.visit')) return;
    sessionStorage.setItem('swimdeck.visit', '1');
    store.set('visits', (store.get('visits', 0) || 0) + 1);
  } catch { /* storage unavailable: no tip */ }
}

export function initInstall() {
  countVisit();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    hooks.render();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    store.set('installHidden', true);
    hooks.render();
  });
}

export const canInstall = () => !standalone() && !!deferred;

/** The tip shown above the swimmers: from the second visit, once, and never inside the installed app. */
export function installTip() {
  if (standalone() || store.get('installHidden') || !state.swimmers.length || (store.get('visits', 0) || 0) < 2) return '';
  if (!deferred && !iosSafari()) return '';
  return `<div class="move-banner install-tip" role="note"><p>${esc(t(deferred ? 'installTip' : 'installTipIos'))}</p>
    <p>${deferred ? `<button class="btn primary small" data-action="installApp">${esc(t('installBtn'))}</button> ` : ''}<button class="link small" data-action="installHide">${esc(t('installHide'))}</button></p></div>`;
}

export function installFooterLink() {
  return canInstall() ? `<button class="link" data-action="installApp">${esc(t('installBtn'))}</button>` : '';
}

export function onInstallClick(el) {
  if (el.dataset.action === 'installHide') {
    store.set('installHidden', true);
    hooks.render();
    return true;
  }
  if (el.dataset.action === 'installApp') {
    const p = deferred;
    if (!p) return true;
    deferred = null;
    p.prompt();
    p.userChoice.finally(() => hooks.render());
    return true;
  }
  return false;
}
