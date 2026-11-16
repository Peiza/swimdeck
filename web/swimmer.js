// The swimmer dialog: events, meets and profile tabs, and the para class settings.
import { state, store, t, $, esc, toast, errText, hooks } from './core.js';
import { api, loadAllEvents } from './api.js';
import { eventLabel, fmtDiff, fmtTime, form, meets, periodOptions, profile, summarize } from './lib.js';
import { eventRow, fillEventDetail, meetButton, roundLabel } from './meets.js';
import { qualRows } from './parts.js';
import { metricPill, oldestSwimYear, periodOptionLabel, shortDate } from './viewkit.js';
import { suggestPara } from './wps.js';


export function openSwimmer(id) {
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

export function renderSwimmerDialog() {
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
  hooks.saveNav();
}

export const STROKE_KEYS = ['free', 'back', 'breast', 'fly', 'medley'];

export function profileView(s) {
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

export function radar(strokes) {
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

export async function fillForm(s) {
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
export function paraLookupHtml(s) {
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

export async function paraLookup(s) {
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

export function paraSettings(s) {
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


export async function fillMeets(s) {
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

