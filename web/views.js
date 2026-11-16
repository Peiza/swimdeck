// The four main views (swimmers, top list, compare, qualifying) and the swimmer cards.
import { state, store, t, $, esc, toast, errText, hooks, sexLabel } from './core.js';
import { loadEvent, recentMeet } from './api.js';
import { compareTable, eventInfo, eventLabel, eventShort, eventSortKey, fmtDiff, fmtTime, goalStatus, headToHead, rankings, rankingsBothPools, rankingsByImprovement, rankingsByPoints, shortNames, sortSwimmers, summarize } from './lib.js';
import { isMasters, mastersPct, wrPct } from './masters.js';
import { recordStatus, roundLabel, shortIso } from './meets.js';
import { ICON, newFor, qBadge, qualRows, stdLabel } from './parts.js';
import { QUAL } from './qual-data.js';
import { ORDER, qualCounts, sexOf } from './qual.js';
import { METRICS, compareMetrics, downloadCsv, fmtMetric, fmtPct, fmtPctPlain, metricName, metricValue, nearPill, nearShare, periodName, pill } from './viewkit.js';
import { hasPara, wpsPoints } from './wps.js';
import { loadAllEvents } from './api.js';
import { fillEventDetail } from './meets.js';
import { markSeen } from './parts.js';
/**
 * Qualifying cards: spread them over as many columns as fit, each card going to the currently shortest column.
 * The order reads left to right, row by row, like the Swimmers tab, and short cards leave no gaps.
 */
export const QUAL_CARD_MIN = 360;
export const QUAL_GAP = 12;
export function packQualCards() {
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

export const SORTS = { manual: 'sortManual', fresh: 'sortFresh', name: 'sortName', born: 'sortBorn', club: 'sortClub', newPbs: 'sortNewPbs', recent: 'sortRecent' };

export function cardInfo(id) {
  const d = state.data[id];
  if (!d?.all) return null;
  const sum = summarize(d.all, d.period, d.before);
  return { newPbs: sum.newPbs, latest: sum.latest?.date || '' };
}

/** The swimmers in the order chosen under "Sort by" on the Swimmers tab; other views follow it. */
export function sortedSwimmers() {
  return state.sort === 'fresh'
    ? [...state.swimmers].sort((a, b) => newFor(b).length - newFor(a).length)
    : sortSwimmers(state.swimmers, state.sort, cardInfo, state.lang);
}

export function deckView() {
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

export const CARD_PARTS = ['stats', 'recent', 'latest', 'improve', 'qual', 'goals', 'best', 'para'];

export function openCustomize() {
  const dlg = $('#confirmDialog');
  dlg.innerHTML = `<form method="dialog" class="sheet small-sheet">
    <header class="sheet-head"><h2>${esc(t('customizeTitle'))}</h2><button type="button" class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
    <p class="small muted">${esc(t('customizeHint'))}</p>
    <div class="parts">${CARD_PARTS.map((k) => `<label class="check"><input type="checkbox" data-part="${k}" ${state.cardParts[k] ? 'checked' : ''}> <span>${esc(t('part_' + k))}</span></label>`).join('')}</div>
    <div class="row end"><button class="btn primary" value="ok">${esc(t('done'))}</button></div></form>`;
  dlg.onclose = null;
  dlg.showModal();
}

export function trashLink() {
  return `<button class="link muted-link" data-action="trash">${ICON.trash}<span>${esc(state.trash.length ? t('trashCount', { n: state.trash.length }) : t('trash'))}</span></button>`;
}

/** Best events for the card: by WPS (50 m) for para swimmers who have them, otherwise by AQUA. */
export function bestFor(s, sum) {
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

export function cardView(s) {
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

export function newBlock(s) {
  const list = newFor(s);
  if (!list.length) return '';
  return `<div class="new-block"><span class="new-tag">${esc(t('newSince', { n: list.length }))}</span>
    ${list.slice(0, 3).map((b) => `<div class="small"><b>${esc(eventLabel(b.event, state.lang, b.name))}</b> <span class="pool">${b.pool} m</span> <b class="time">${fmtTime(b.time)}</b>${b.prev ? ` <span class="good">${fmtDiff(b.time - b.prev)}</span>` : ` <span class="muted">${esc(t('firstSwim'))}</span>`}</div>`).join('')}
    ${list.length > 3 ? `<div class="small muted">${esc(t('andMore', { n: list.length - 3 }))}</div>` : ''}</div>`;
}

export function goalChip(s) {
  const g = goalStatus(s.goals, state.data[s.id]?.all?.bests);
  if (!g.length) return '';
  const done = g.filter((x) => x.reached).length;
  const near = g.filter((x) => !x.reached && x.gap != null).sort((a, b) => a.gap / a.goal - b.gap / b.goal)[0];
  return `<div class="goal-card small"><span class="gbadge ${done === g.length ? 'ok' : ''}">${esc(t('goalsCard', { done, n: g.length }))}</span>
    ${near ? `<span class="muted">${esc(t('goalNearest', { event: eventLabel(near.event, state.lang), pool: near.pool, gap: fmtTime(near.gap) }))}</span>` : ''}</div>`;
}

export function qualChips(s) {
  const counts = qualCounts(qualRows(s));
  const ids = ORDER.filter((id) => counts[id]);
  if (!ids.length) return '';
  return `<div class="qual-block"><span class="muted small">${esc(t('qualTitle', { year: QUAL.year }))}</span>
    <div class="qchips">${ids.map((id) => qBadge(id, ` <b>×${counts[id]}</b>`)).join('')}</div></div>`;
}

export const baseCode = (code) => (code > 10 && code % 2 === 0 ? code - 1 : code);

export function rankView() {
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
        loadEvent(sw, swimsCode).then((d) => { state.eventData[k] = d; }, () => { state.eventData[k] = null; }).then(() => state.view === 'rank' && hooks.renderMain());
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

export function rankCsv() {
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

export function compareSelection() {
  const ids = state.compareIds.filter((id) => state.swimmers.some((s) => s.id === id));
  return ids.length ? ids : state.swimmers.slice(0, Math.min(3, state.swimmers.length)).map((s) => s.id);
}

export function compareView() {
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

export async function fillH2h() {
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

export function compareCsv() {
  const ids = compareSelection();
  const chosen = ids.map((id) => state.swimmers.find((s) => s.id === id));
  const overviews = Object.fromEntries(state.swimmers.map((s) => [s.id, state.data[s.id]?.all]));
  const table = compareTable(chosen, overviews, state.comparePool);
  const head = [t('event'), t('pool'), ...chosen.map((s) => s.name)];
  const lines = table.map((row) => [eventLabel(row.event, state.lang, row.name), state.comparePool, ...row.cells.map((c) => (c ? fmtTime(c.time) : ''))]);
  downloadCsv(`swimdeck-${t('compare').toLowerCase()}.csv`, [head, ...lines]);
}

export const qualTabs = () => `<div class="seg" role="group">${[['done', t('qualDone')], ['sm', 'SM / U21-SM'], ['usm', 'USM'], ['para', 'Para-SM']].map(([k, v]) => `<button data-qcomp="${k}" aria-pressed="${state.qComp === k}">${esc(v)}</button>`).join('')}</div>`;

/** The highest SM standard, USM and the highest Para-SM standard reached (SM A implies SM B, so B is left out). */
export const qualHighlights = (reached) => {
  const ids = reached.map((x) => x.id);
  return [ids.includes('smA') ? 'smA' : ids.includes('smB') ? 'smB' : null, ids.includes('usm') ? 'usm' : null, ids.includes('paraA') ? 'paraA' : ids.includes('paraB') ? 'paraB' : null].filter(Boolean);
};

/** Overview: every qualifying time the swimmers in the list have reached, all championships and pools. */

export function qualDoneView() {
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

export function qualView() {
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

/** Clicks that belong here. Returns true when it handled the click. */
export function onViewsClick(el, e) {
  if (el.dataset.sortpool) {
    state.rankSortPool = Number(el.dataset.sortpool);
    store.set('rankSortPool', state.rankSortPool);
    hooks.renderMain();
    return true;
  }
  if (el.dataset.basis) {
    state.rankBasis = el.dataset.basis;
    store.set('rankBasis', state.rankBasis);
    hooks.renderMain();
    return true;
  }
  if (el.dataset.sex !== undefined && el.closest('.rank-controls')) {
    state.rankSex = el.dataset.sex;
    store.set('rankSex', state.rankSex);
    hooks.renderMain();
    return true;
  }
  if (el.dataset.pick) {
    const id = Number(el.dataset.pick);
    const cur = compareSelection();
    state.compareIds = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 4);
    if (!state.compareIds.length) state.compareIds = [id];
    hooks.save();
    hooks.renderMain();
    return true;
  }
  if (el.dataset.cpool) {
    state.comparePool = Number(el.dataset.cpool);
    hooks.save();
    hooks.renderMain();
    return true;
  }
  if (el.dataset.qcomp) {
    state.qComp = el.dataset.qcomp;
    hooks.save();
    hooks.renderMain();
    return true;
  }
  if (el.dataset.qsex) {
    state.qSex = el.dataset.qsex;
    hooks.save();
    hooks.renderMain();
    return true;
  }
  if (el.dataset.qpool) {
    state.qPool = Number(el.dataset.qpool);
    hooks.save();
    hooks.renderMain();
    return true;
  }
  if (el.dataset.action === 'seenAll') {
    markSeen(state.swimmers.map((s) => s.id));
    hooks.renderMain();
    return true;
  }
  if (el.dataset.action === 'csvRank') {
    rankCsv();
    return true;
  }
  if (el.dataset.action === 'h2h') {
    fillH2h();
    return true;
  }
  if (el.dataset.action === 'csvCompare') {
    compareCsv();
    return true;
  }
  if (el.dataset.collapse) {
    const id = Number(el.dataset.collapse);
    state.collapsed = state.collapsed.includes(id) ? state.collapsed.filter((x) => x !== id) : [...state.collapsed, id];
    hooks.save();
    hooks.renderMain();
    return true;
  }
  if (el.dataset.action === 'collapseAll' || el.dataset.action === 'expandAll') {
    state.collapsed = el.dataset.action === 'collapseAll' ? state.swimmers.map((s) => s.id) : [];
    hooks.save();
    hooks.renderMain();
    return true;
  }
  if (el.dataset.toporder) {
    state.topOrder = el.dataset.toporder;
    store.set('topOrder', state.topOrder);
    const s = state.swimmers.find((x) => x.id === state.openId);
    fillEventDetail(s, state.openEvent);
    return true;
  }
  if (el.dataset.topn) {
    state.topN = el.dataset.topn === 'all' ? 'all' : Number(el.dataset.topn);
    store.set('topN', state.topN);
    const s = state.swimmers.find((x) => x.id === state.openId);
    fillEventDetail(s, state.openEvent);
    return true;
  }
  return false;
}
