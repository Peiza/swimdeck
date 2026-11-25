// Feedback form: a message to the developer without a GitHub account.
// Device details are only sent when the visitor ticks the box, and they can see them first.
import { state, t, esc, API, $, FEEDBACK_URL } from './core.js';
import { VERSION } from './version.js';

const KINDS = [['bug', 'fbBug'], ['idea', 'fbIdea'], ['other', 'fbOther']];

function browserName(ua) {
  const m = ua.match(/(SamsungBrowser|EdgA?|Edg|OPR|Firefox|FxiOS|CriOS|Chrome|Version)\/(\d+)/);
  if (!m) return 'unknown';
  const name = { SamsungBrowser: 'Samsung Internet', EdgA: 'Edge', Edg: 'Edge', OPR: 'Opera', FxiOS: 'Firefox', Firefox: 'Firefox', CriOS: 'Chrome', Chrome: 'Chrome', Version: /Safari/.test(ua) ? 'Safari' : 'Browser' }[m[1]];
  return `${name} ${m[2]}`;
}

function osName(ua) {
  let m = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (m) return `Android ${m[1]}`;
  m = ua.match(/OS (\d+)[_\d]* like Mac OS X/);
  if (m) return `iOS ${m[1]}`;
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'unknown';
}

/** What "device details" means: nothing that identifies the person. */
export function deviceInfo(nav = navigator, win = window) {
  const ua = nav.userAgent || '';
  return {
    version: VERSION.version,
    lang: state.lang,
    browser: browserName(ua),
    os: osName(ua),
    screen: `${win.innerWidth}×${win.innerHeight} @${win.devicePixelRatio || 1}x`,
    installed: win.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true ? 'yes' : 'no',
    view: state.view,
  };
}

export function openFeedback() {
  const dlg = $('#feedbackDialog');
  dlg.innerHTML = `
    <div class="sheet feedback-sheet">
      <header class="sheet-head">
        <div><h2>${esc(t('fbTitle'))}</h2><p class="muted small">${esc(t('fbIntro'))}</p></div>
        <button class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button>
      </header>
      <div id="fbForm" class="fields fb-fields">
        <div class="wide"><span class="muted small">${esc(t('fbKind'))}</span>
          <div class="seg" role="group" aria-label="${esc(t('fbKind'))}">${KINDS.map(([k, label], i) => `<button type="button" data-fb-kind="${k}" aria-pressed="${i === 0}">${esc(t(label))}</button>`).join('')}</div></div>
        <label class="wide">${esc(t('fbMessage'))}
          <textarea id="fbMessage" rows="6" maxlength="2000" placeholder="${esc(t('fbPlaceholder'))}"></textarea></label>
        <label class="wide">${esc(t('fbContact'))}
          <input id="fbContact" type="email" maxlength="120" autocomplete="email" inputmode="email"></label>
        <label class="check wide"><input id="fbDevice" type="checkbox"> <span>${esc(t('fbDevice'))}</span></label>
        <div class="wide"><button type="button" class="link small" data-action="fbShow">${esc(t('fbShow'))}</button>
          <pre id="fbDeviceInfo" class="fb-device" hidden></pre></div>
        <input id="fbWebsite" class="fb-trap" tabindex="-1" autocomplete="off" aria-hidden="true">
      </div>
      <p id="fbStatus" class="muted small" role="status"></p>
      <footer class="sheet-foot"><a class="link small" href="${FEEDBACK_URL}" target="_blank" rel="noopener">${esc(t('fbGithub'))}</a><button class="btn primary" data-action="fbSend">${esc(t('fbSend'))}</button></footer>
    </div>`;
  if (!dlg.open) dlg.showModal();
}

async function send(btn) {
  const status = $('#fbStatus');
  const message = $('#fbMessage').value.trim();
  if (message.length < 3) {
    status.textContent = t('fbEmpty');
    return;
  }
  const body = {
    kind: $('#fbForm [data-fb-kind][aria-pressed=true]')?.dataset.fbKind || 'other',
    message,
    contact: $('#fbContact').value.trim(),
    website: $('#fbWebsite').value,
    ...($('#fbDevice').checked ? { device: deviceInfo() } : {}),
  };
  btn.disabled = true;
  status.textContent = t('fbSending');
  try {
    const res = await fetch(`${API}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(String(res.status));
    $('#feedbackDialog .sheet').innerHTML = `
      <header class="sheet-head"><h2>${esc(t('fbTitle'))}</h2><button class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
      <p role="status">${esc(t('fbThanks'))}</p>
      <footer class="sheet-foot"><span></span><button class="btn primary" data-action="close">${esc(t('done'))}</button></footer>`;
  } catch {
    status.textContent = t('fbError');
    btn.disabled = false;
  }
}

/** Clicks that belong here. Returns true when it handled the click. */
export function onFeedbackClick(el) {
  if (el.dataset.action === 'feedbackOpen') {
    openFeedback();
    return true;
  }
  if (el.dataset.fbKind) {
    el.parentElement.querySelectorAll('[data-fb-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    return true;
  }
  if (el.dataset.action === 'fbShow') {
    const pre = $('#fbDeviceInfo');
    pre.textContent = Object.entries(deviceInfo()).map(([k, v]) => `${k}: ${v}`).join('\n');
    pre.hidden = !pre.hidden;
    return true;
  }
  if (el.dataset.action === 'fbSend') {
    send(el);
    return true;
  }
  return false;
}
