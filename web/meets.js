// Meet result lists, event rows and detail, rankings, records and the season chart.
import { state, t, $, esc, toast, errText, hooks, sexLabel } from './core.js';
import { api, loadEvent } from './api.js';
import { store } from './core.js';
import { eventLabel, fmtDiff, fmtTime, periodRange, prognosis, progression, seasonBests } from './lib.js';
import { MASTERS } from './masters-data.js';
import { isMasters, mastersPct, useWorldRecords, worldRecords, wrPct } from './masters.js';
import { scheduleNotifyUpdate } from './notify.js';
import { qBadge, stdLabel } from './parts.js';
import { sexOf } from './qual.js';
import { fmtPctPlain, metricPill, periodName, ptsOf, ptsTitle } from './viewkit.js';

export const roundLabel = (k) => (!k ? '' : /^heat$|^försök$/i.test(k) ? t('roundHeat') : /^semi/i.test(k) ? t('roundSemi') : /^final$/i.test(k) ? t('roundFinal') : k);
export const roundRank = (k) => (/^final$/i.test(k || '') ? 0 : /final/i.test(k || '') ? 1 : /semi/i.test(k || '') ? 2 : 3);
/** Places again within a filtered list (already ordered by round, then time); ties share a place. */
export function reRank(rows) {
  return rows.map((r, i, a) => ({ ...r, place: 0, of: a.length })).map((r, i, a) => {
    r.place = i > 0 && a[i - 1].time === r.time && roundRank(a[i - 1].round) === roundRank(r.round) ? a[i - 1].place : i + 1;
    return r;
  });
}
export const sexCode = (x) => (/^(wo|fe|kvin|dam|nai|flick|tyt)/i.test(x || '') ? 'W' : x ? 'M' : '');
export const meetCache = new Map();

export function meetButton(name, date, code, html, kind = '') {
  if (!name || !date) return html;
  return `<button type="button" class="meet-link ${kind}" data-meet="${esc(name)}" data-mdate="${esc(date)}" data-mcode="${Number(code)}" title="${esc(t('meetOpen'))}">${html}</button>`;
}

export function openMeet(el) {
  const s = state.swimmers.find((x) => x.id === state.openId);
  state.meet = { name: el.dataset.meet, date: el.dataset.mdate, code: Number(el.dataset.mcode), sex: sexCode(s?.sex), site: s?.site || 'se', me: s?.id ?? null, born: s?.born || null, cohort: false, round: null };
  const dlg = $('#meetDialog');
  renderMeet();
  if (!dlg.open) dlg.showModal();
  loadMeet();
}

export async function loadMeet() {
  const m = state.meet;
  const key = [m.site, m.id || m.name, m.date, m.code, m.sex].join('|');
  try {
    if (!meetCache.has(key)) meetCache.set(key, api('/api/meet', { v: 3, site: m.site, ...(m.id ? { id: m.id } : { name: m.name, date: m.date }), code: m.code, sex: m.sex }));
    const data = await meetCache.get(key);
    if (state.meet !== m) return;
    m.id = data.meet?.id || m.id;
    m.data = data;
  } catch (e) {
    meetCache.delete(key);
    if (state.meet !== m) return;
    m.error = e.status === 404 || /not found/i.test(e.message) ? t('meetNotFound') : errText(e.message);
  }
  renderMeet();
}

export function renderMeet() {
  const m = state.meet;
  const dlg = $('#meetDialog');
  if (!m) return;
  const d = m.data;
  const rounds = d ? [...new Set(d.results.map((r) => r.round || ''))] : [];
  const view = rounds.length > 1 && rounds.includes(m.round) ? m.round : 'all';
  const overall = d ? d.overall || d.results : [];
  const cohort = m.cohort && m.born ? m.born : null;
  const rows = !d ? [] : reRank((view === 'all' ? overall : d.results.filter((r) => (r.round || '') === view)).filter((r) => !cohort || r.born === cohort));
  const listed = new Set(state.swimmers.filter((x) => x.site === m.site).map((x) => x.id));
  const me = rows.find((r) => r.swimmerId === m.me);
  const base = m.site === 'fi' ? 'https://www.tempusopen.fi' : 'https://www.tempusopen.se';
  const meta = d?.meet ? [d.meet.location, d.meet.date, d.meet.pool ? `${d.meet.pool} m` : ''].filter(Boolean).join(' · ') : m.date;
  dlg.innerHTML = `
    <div class="sheet">
      <header class="sheet-head">
        <div>
          <h2>${esc(d?.meet?.name || m.name)}</h2>
          <p class="muted small">${esc(meta)}</p>
        </div>
        <button class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button>
      </header>
      <details class="help" data-help="meet" ${state.helpOpen.meet ? 'open' : ''}>
        <summary><span class="help-i" aria-hidden="true">i</span> ${esc(t('helpSummary'))}</summary>
        <div class="help-body">${t('help_meet').split('\n').map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      </details>
      <div class="sheet-tools">
        <b>${esc(eventLabel(m.code, state.lang))}</b>
        <div class="seg small" role="group">${[['W', t('women')], ['M', t('men')]].map(([k, v]) => `<button data-msex="${k}" aria-pressed="${m.sex === k}">${esc(v)}</button>`).join('')}</div>
      </div>
      ${m.born ? `<div class="seg small" role="group">${[[0, t('meetAllAges')], [1, t('meetCohort', { year: m.born })]].map(([k, v]) => `<button data-mcohort="${k}" aria-pressed="${!!m.cohort === !!k}">${esc(v)}</button>`).join('')}</div>` : ''}
      ${rounds.length > 1 ? `<div class="seg small" role="group">${[['all', t('meetOverall')], ...rounds.map((k) => [k, roundLabel(k) || '–'])].map(([k, v]) => `<button data-mround="${esc(k)}" aria-pressed="${view === k}">${esc(v)}</button>`).join('')}</div>` : ''}
      ${m.error ? `<p class="warn">${esc(m.error)}</p>` : !d ? `<p class="muted">${esc(t('loading'))}</p>` : `
        ${me ? `<p class="meet-me">${esc(t('placeOf', { place: me.place, of: me.of }))}${me.round && rounds.length > 1 ? ` · ${esc(roundLabel(me.round))}` : ''} · <b>${fmtTime(me.time)}</b></p>` : ''}
        ${rows.length ? `<table class="meet-list"><tbody>${rows.map((r) => `
          <tr class="${r.swimmerId === m.me ? 'me' : listed.has(r.swimmerId) ? 'mine' : ''}">
            <td class="num place">${r.place}</td>
            <td>${esc(r.swimmer)}${r.born ? ` <span class="muted small">${r.born}</span>` : ''}<small class="muted">${esc(r.club)}${view === 'all' && rounds.length > 1 ? ` · ${esc(roundLabel(r.round))}` : ''}</small></td>
            <td class="num"><b>${fmtTime(r.time)}</b><small class="muted">${r.points || ''}</small></td>
          </tr>`).join('')}</tbody></table>` : `<p class="muted">${esc(t('meetEmpty'))}</p>`}
        ${d.complete ? '' : `<p class="muted small">${esc(t('meetPartial', { n: d.results.length, total: d.total }))}</p>`}
        ${d.ambiguous ? `<p class="warn small">${esc(t('meetNoteMixed'))}</p>` : ''}`}
      <footer class="sheet-foot">
        ${m.id ? `<a href="${base}/competitions/swimming/${Number(m.id)}" target="_blank" rel="noopener">${esc(t('meetOnTempus'))} ↗</a>` : '<span></span>'}
        <button class="btn primary" data-action="close">${esc(t('done'))}</button>
      </footer>
    </div>`;
}

export function eventRow(s, r) {
  const open = state.openEvent === r.event;
  const q = (state.qualByEvent || {})[r.event];
  const qHtml = q ? `${q.best.map((x) => ' ' + qBadge(x.id)).join('')}${q.next && q.next.gap / q.result.time < 0.08 ? `<small class="qnext">${esc(t('toNext', { std: stdLabel(q.next.id), gap: fmtTime(q.next.gap) }))}</small>` : ''}` : '';
  const goal = s.goals?.[r.event];
  const gHtml = goal ? (r.pb && r.pb.time <= goal ? ` <span class="gbadge ok">✓ ${esc(t('goal'))}</span>` : `<small class="qnext">${esc(t('goal'))} ${fmtTime(goal)}${r.pb ? ' · ' + esc(t('goalLeft', { gap: fmtTime(r.pb.time - goal) })) : ''}</small>`) : '';
  return `
    <tr class="ev ${r.newPb ? 'pb' : ''} ${open ? 'open' : ''}" data-event="${r.event}" tabindex="0" aria-expanded="${open}">
      <td class="ev-name"><span class="chev" aria-hidden="true">›</span>${esc(eventLabel(r.event, state.lang, r.name)).replace(/^(\d+) m /, '$1\u00a0m ')}${r.newPb ? ` <span class="badge">${esc(t('newPb'))}${r.improve ? ' ' + fmtDiff(-r.improve) : ''}</span>` : ''}${qHtml}${gHtml}</td>
      <td class="num"><b>${r.pb ? fmtTime(r.pb.time) : '–'}</b><small>${esc(r.pb?.date || '')}</small></td>
      <td class="num">${r.period ? `${fmtTime(r.period.time)}<small class="${r.diff > 0 ? '' : 'good'}">${r.diff != null ? fmtDiff(r.diff) : ''}</small>` : '<span class="muted">–</span>'}</td>
      <td class="num metric-td" title="${esc(r.pb ? ptsTitle(s, r.pb) : '')}">${ptsOf(s, r.pb) || '<span class="muted">–</span>'}</td>
    </tr>
    ${open ? `<tr class="detail"><td colspan="4"><div id="eventDetail" class="event-detail"><p class="muted">${esc(t('loading'))}</p></div></td></tr>` : ''}`;
}

export async function fillEventDetail(s, code) {
  const box = $('#eventDetail');
  if (!box) return;
  try {
    const ev = await loadEvent(s, code);
    if (state.openEvent !== code || !$('#eventDetail')) return;
    const n = state.topN === 'all' ? ev.results.length : state.topN;
    const recent = state.topOrder === 'recent';
    const pbTime = ev.results[0]?.time;
    const ordered = recent ? [...ev.results].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.round === 'Final') - (a.round === 'Final')) : ev.results;
    const top = ordered.slice(0, n);
    $('#eventDetail').innerHTML = `
      ${goalEditor(s, code, ev.results[0]?.time)}
      <div class="detail-tools">
        <span class="muted small">${esc(t('swims', { n: ev.results.length }))}</span>
        <div class="seg small" role="group" aria-label="${esc(t('order'))}">
          ${['fast', 'recent'].map((k) => `<button data-toporder="${k}" aria-pressed="${state.topOrder === k}">${esc(t(k === 'fast' ? 'orderFast' : 'orderRecent'))}</button>`).join('')}
        </div>
        <div class="seg small" role="group" aria-label="${esc(t('topN'))}">
          ${[3, 5, 7, 10, 'all'].map((k) => `<button data-topn="${k}" aria-pressed="${state.topN === k}">${k === 'all' ? esc(t('all')) : k}</button>`).join('')}
        </div>
        <div class="metric-row"><span class="muted small">${esc(t('metricCompare'))}</span> ${metricPill(s, 'detail')}</div>
      </div>
      <ol class="top ${recent ? 'recent' : ''}">${top.map((r, i) => `
        <li><span class="pos">${recent ? '' : i + 1}</span><span class="time ${r.time === pbTime ? 'is-pb' : ''}">${fmtTime(r.time)}${r.time !== pbTime ? `<small class="muted" title="${esc(t('diffPbTitle', { gap: fmtTime(r.time - pbTime), pb: fmtTime(pbTime) }))}"> ${fmtDiff(r.time - pbTime)}</small>` : ''}</span>
        <span class="small"><span>${esc(r.date)}</span> · ${meetButton(r.meet, r.date, code, `${esc(r.meet)}${r.round ? ' · ' + esc(roundLabel(r.round)) : ''}`)}</span>
        <span class="small muted num" title="${esc(ptsTitle(s, r))}">${ptsOf(s, r) || '–'}</span></li>`).join('')}</ol>
      ${top.some((r) => r.time !== pbTime) ? `<p class="small muted top-legend">${esc(t('diffPbLegend', { pb: fmtTime(pbTime) }))}</p>` : ''}
      <div id="rankBox" class="rank-box">${rankRow(s, code) ? `<div class="rank-line"><span class="rank-num">…</span><span class="small muted">${esc(t('rankLoading'))}</span></div>` : ''}</div>
      ${prognosisLine(s, code, ev.results)}
      ${recordLine(s, ev.results[0])}
      ${ev.results.length > 1 ? `<h4 class="small muted">${esc(t('progression'))}</h4>${chart(ev.results, s.goals?.[code] || null, box.clientWidth - 24)}` : ''}
      ${seasonTable(ev.results)}`;
    fillRank(s, code);
  } catch (e) {
    box.innerHTML = `<p class="warn">${esc(errText(e.message))}</p><button class="btn small" data-retry-event="${code}">${esc(t('retry'))}</button>`;
  }
}

export function goalEditor(s, code, pb) {
  const goal = s.goals?.[code];
  const status = goal && pb ? (pb <= goal ? `<span class="goal-ok">✓ ${esc(t('goalReached'))}</span>` : `<span class="muted">${esc(t('goalLeft', { gap: fmtTime(pb - goal) }))}</span>`) : '';
  return `<div class="goal-edit">
    <label class="small"><span>${esc(t('goal'))}</span>
      <input id="goalInput" data-code="${code}" inputmode="decimal" autocomplete="off" placeholder="${esc(t('goalPlaceholder'))}" value="${goal ? esc(fmtTime(goal)) : ''}"></label>
    <button class="btn small" data-action="goalSave" data-code="${code}">${esc(t('goalSave'))}</button>
    ${goal ? `<button class="link small" data-action="goalClear" data-code="${code}">${esc(t('goalClear'))}</button>` : ''}
    <span class="small goal-status">${status}</span>
  </div>`;
}

export function setGoal(code, value) {
  const s = state.swimmers.find((x) => x.id === state.openId);
  if (!s) return;
  const goals = { ...(s.goals || {}) };
  if (value == null) delete goals[code];
  else goals[code] = value;
  s.goals = Object.keys(goals).length ? goals : undefined;
  hooks.save();
  scheduleNotifyUpdate();
  hooks.renderSwimmerDialog();
  hooks.renderMain();
}

// ---------------------------------------------------------------- keeping records current
// World records come from the API (refreshed daily from World Aquatics); the masters list ships with the app,
// and the API tells when World Aquatics has published a newer one.
export const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
export const mastersShipped = (() => { const m = String(MASTERS.asOf).match(/(\d{2}) (\w{3}) (\d{4})/); return m ? `${m[3]}-${MONTHS[m[2]]}-${m[1]}` : ''; })();
export const shortIso = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString(state.lang, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
export const recordStatus = () => {
  const r = state.records || {};
  return {
    wrDate: r.wr?.fetched || worldRecords().fetched || '',
    wrLive: !!r.wr,
    wrStale: !!r.wr && !r.wr.current,
    mastersDate: mastersShipped,
    mastersNewer: r.mastersAsOf && r.mastersAsOf > mastersShipped ? r.mastersAsOf : null,
  };
};

export function applyRecords(r) {
  state.records = r;
  if (r?.wr?.records) useWorldRecords({ fetched: r.wr.fetched, records: r.wr.records });
}

export async function loadRecords() {
  const cached = store.get('records', null);
  if (cached?.data) applyRecords(cached.data);
  if (cached?.at && Date.now() - cached.at < 12 * 3600e3) return;
  try {
    const data = await api('/api/records');
    store.set('records', { at: Date.now(), data });
    applyRecords(data);
    hooks.render();
  } catch {}
}

/** The PB against the world record, and for masters against the masters record of its age group. */
export function recordLine(s, pb) {
  if (!pb) return '';
  const w = wrPct(s, pb);
  const m = isMasters(s) ? mastersPct(s, pb) : null;
  if (!w && !m) return '';
  return `<p class="small muted record-line">${[
    w ? esc(t('wrLine', { record: fmtTime(w.record), pct: fmtPctPlain(w.pct) })) : '',
    m ? esc(t('mwrLine', { group: m.group, record: fmtTime(m.record), pct: fmtPctPlain(m.pct) })) : '',
    m && recordStatus().mastersNewer ? `<span class="warn">${esc(t('mastersNewer', { date: shortIso(recordStatus().mastersNewer), ours: shortIso(recordStatus().mastersDate) }))}</span>` : '',
  ].filter(Boolean).join('<br>')}</p>`;
}

export function prognosisLine(s, code, results) {
  const q = (state.qualByEvent || {})[code];
  if (!q?.next) return '';
  const p = prognosis(results, q.next.time);
  const label = stdLabel(q.next.id);
  if (!p) return `<p class="small muted prog">${esc(t('progNone', { std: label, gap: fmtTime(q.next.gap) }))}</p>`;
  const when = new Date(p.date + 'T12:00:00Z').toLocaleDateString(state.lang, { year: 'numeric', month: 'long' });
  return `<p class="small prog">${esc(t('progWhen', { std: label, when, gap: fmtTime(q.next.gap) }))}</p>`;
}

/** The period best a national rank can be worked out for, or null (no birth year, sex or a Finnish swimmer). */
export function rankRow(s, code) {
  const row = state.data[s.id]?.period?.bests?.find((b) => b.event === code);
  return row && s.born && sexOf(s.sex) && s.site === 'se' ? row : null;
}

// The rank box keeps the same height from "loading" to the answer, so nothing below it moves while it loads
// (a row that moves just as it is clicked would miss the click).
export const rankMsg = (text) => `<div class="rank-line"><span class="muted small">${esc(text)}</span></div>`;

export async function fillRank(s, code) {
  const box = () => (state.openEvent === code ? $('#rankBox') : null);
  const row = rankRow(s, code);
  const sex = sexOf(s.sex);
  if (!box() || !row) return;
  const { from, to } = periodRange(state.period);
  try {
    const key = `rank:${s.id}:${code}:${from}:${to}:${row.time}`;
    state.events[key] ||= api('/api/rank', { event: code, sex, born: s.born, from, to, time: row.time });
    const r = await state.events[key];
    if (!box()) return;
    if (!r.available) {
      box().innerHTML = rankMsg(t('rankTooYoung'));
      return;
    }
    const head = r.complete ? t('rankPlace', { place: r.rank }) : t('rankBeyond', { n: r.rank - 1 });
    box().innerHTML = `<div class="rank-line"><span class="rank-num">${esc(head)}</span>
      <span class="small muted">${esc(t('rankDetail', { year: s.born, period: periodName(), time: fmtTime(row.time) }))}${r.leader && r.rank > 1 ? ' · ' + esc(t('rankLeader', { time: fmtTime(r.leader) })) : ''}</span></div>`;
  } catch (e) {
    if (box()) box().innerHTML = rankMsg(errText(e.message));
  }
}

export function seasonTable(results) {
  const sb = seasonBests(results);
  if (sb.length < 2) return '';
  return `<h4 class="small muted">${esc(t('seasonBests'))}</h4>
    <table class="seasons"><thead><tr><th>${esc(t('season'))}</th><th class="num">${esc(t('time'))}</th><th class="num">${esc(t('change'))}</th><th class="num hide-sm">${esc(t('swimsCol'))}</th></tr></thead>
    <tbody>${sb.map((x) => `<tr><td>${esc(x.season)}</td><td class="num"><b>${fmtTime(x.best.time)}</b></td>
      <td class="num ${x.change < 0 ? 'good' : x.change > 0 ? 'muted' : ''}">${x.change == null ? '' : fmtDiff(x.change)}</td><td class="num hide-sm muted">${x.count}</td></tr>`).join('')}</tbody></table>`;
}

export function chart(results, goal = null, width = 320) {
  const pts = progression(results);
  // drawn at about its real width, so text and lines keep their size on wide screens too
  const W = Math.round(Math.min(720, Math.max(320, width || 320))), H = W > 480 ? 170 : 130, P = { l: 50, r: 8, t: 8, b: 20 };
  const ts = pts.map((p) => Date.parse(p.date));
  const x0 = Math.min(...ts), x1 = Math.max(...ts) || x0 + 1;
  const times = pts.map((p) => p.time).concat(goal ? [goal] : []);
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
    ${goal ? `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(goal).toFixed(1)}" y2="${Y(goal).toFixed(1)}" class="goal-line"/><text x="${W - P.r - 2}" y="${(Y(goal) - 3).toFixed(1)}" class="axis goal-label" text-anchor="end">${esc(t('goal'))} ${fmtTime(goal)}</text>` : ''}
    <path d="${step}" class="best"/>
    ${pts.map((p, i) => `<circle cx="${X(ts[i]).toFixed(1)}" cy="${Y(p.time).toFixed(1)}" r="${p.time === p.best ? 3 : 2.2}" class="${p.time === p.best ? 'dot pb' : 'dot'}"><title>${fmtTime(p.time)} · ${esc(p.date)}</title></circle>`).join('')}
  </svg>`;
}

