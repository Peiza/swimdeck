// Helpers for the views: the points column choice, menus, period names and other small formatters.
import { state, t, esc, hooks, $ } from './core.js';
import { store } from './core.js';
import { fmtTime, seasonLabel, toCsv } from './lib.js';
import { isMasters, mastersPct, wrPct } from './masters.js';
import { scheduleNotifyUpdate } from './notify.js';
import { schedulePush } from './sync.js';
import { hasPara, wpsEstimate, wpsPoints } from './wps.js';


// AQUA points, % of the world record, % of the masters record (from 25) or WPS (para class, 50 m).
export const usesWps = (s, pool) => hasPara(s) && pool === 50;
export const fmtPctPlain = (v) => `${v.toLocaleString(state.lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;
export const METRICS = ['aqua', 'wr', 'masters', 'wps'];
export const metricsFor = (s) => METRICS.filter((m) => m === 'aqua' || m === 'wr' || (m === 'masters' && isMasters(s)) || (m === 'wps' && hasPara(s)));
export const metricFor = (s) => (metricsFor(s).includes(state.metric) ? state.metric : 'aqua');
export const metricName = (m) => t({ aqua: 'metricAqua', wr: 'metricWr', masters: 'metricMasters', wps: 'metricWps' }[m]);
export const ptsOf = (s, r, m = metricFor(s)) => {
  if (!r) return '';
  if (m === 'wps') { if (usesWps(s, r.pool)) return wpsPoints(s, r) || ''; const e = wpsEstimate(s, r); return e ? `≈ ${e}` : ''; }
  if (m === 'masters') { const x = mastersPct(s, r); return x ? fmtPctPlain(x.pct) : ''; }
  if (m === 'wr') { const x = wrPct(s, r); return x ? fmtPctPlain(x.pct) : ''; }
  return r.points || '';
};
export const ptsTitle = (s, r, m = metricFor(s)) => {
  if (m === 'masters') { const x = mastersPct(s, r); return x ? t('mastersSwimTitle', { group: x.group, record: fmtTime(x.record) }) : t('metricMastersNone'); }
  if (m === 'wr') { const x = wrPct(s, r); return x ? t('wrSwimTitle', { record: fmtTime(x.record) }) : ''; }
  if (m === 'wps' && r.pool !== 50) return wpsEstimate(s, r) ? t('wpsEstimateTitle') : t('wpsLongOnly');
  if (m === 'wps') return wpsPoints(s, r) ? t('wpsSwimTitle') : '';
  if (m === 'aqua') return r.points ? t('aquaSwimTitle') : '';
  return '';
};
export const ptsLabel = (s) => metricName(metricFor(s));

/** The metric as a number (higher is better), for comparing; null when it cannot be worked out. WPS on 25 m is an estimate. */
export function metricValue(s, r, m) {
  if (!r) return null;
  if (m === 'aqua') return r.points || null;
  if (m === 'wr') return wrPct(s, r)?.pct ?? null;
  if (m === 'masters') return mastersPct(s, r)?.pct ?? null;
  if (m === 'wps') return (r.pool === 50 ? wpsPoints(s, r) : wpsEstimate(s, r)) || null;
  return null;
}
export const fmtMetric = (v, m, r) => (v == null ? '–' : m === 'aqua' ? String(v) : m === 'wps' ? `${r?.pool === 25 ? '≈ ' : ''}${v}` : fmtPctPlain(v));

/** What the compare table can show: times, or a metric every chosen swimmer has. */
export const compareMetrics = (chosen) => ['time', ...METRICS.filter((m) => chosen.length && chosen.every((s) => metricsFor(s).includes(m)))];

/**
 * A small rounded "pill" that opens a menu of choices: used for what the points column compares with and
 * for how close counts as close to a qualifying time. `id` names the menu, `kind` the setting it changes.
 */
export function pill(id, kind, current, items, note = '', title = '') {
  const open = state.menu === id;
  const cur = items.find((x) => x.value === current) || items[0];
  return `<span class="metric-wrap">
    <button type="button" class="metric-pill" data-menu="${id}" aria-haspopup="menu" aria-expanded="${open}" title="${esc(title)}">${esc(cur.label)}<span aria-hidden="true"> ▾</span></button>
    ${open ? `<span class="metric-menu" role="menu">${items.map((x) => `<button type="button" role="menuitemradio" aria-checked="${x.value === cur.value}" data-choose="${kind}" data-value="${esc(x.value)}">
      <span class="mm-check" aria-hidden="true">${x.value === cur.value ? '✓' : ''}</span><b>${esc(x.label)}</b><span class="muted small">${esc(x.desc || '')}</span></button>`).join('')}${note ? `<span class="mm-note muted small">${esc(note)}</span>` : ''}</span>` : ''}
  </span>`;
}

/** The points column heading: what to compare with (AQUA, % of world record, masters %, WPS). */
export const metricPill = (s, where) => pill(`metric:${where}`, 'metric', metricFor(s), metricsFor(s).map((k) => ({ value: k, label: metricName(k), desc: t('metricDesc_' + k) })), metricsFor(s).includes('masters') ? t('mastersOnlyMeets') : '', t('metricCompare'));

/** How close counts as "close to a qualifying time", in percent of the swimmer's time. */
export const NEAR_CHOICES = [1, 2, 3, 5];
export const nearShare = () => (NEAR_CHOICES.includes(state.near) ? state.near : 3) / 100;
export const nearPill = (where) => pill(`near:${where}`, 'near', String(nearShare() * 100), NEAR_CHOICES.map((n) => ({ value: String(n), label: t('nearWithin', { n }), desc: t('nearDesc_' + n) })), '', t('nearTitle'));

export function closeMenu() {
  state.menu = null;
  hooks.renderMain();
  if ($('#swimmerDialog').open) hooks.renderSwimmerDialog();
}

export const periodName = (p = state.period) => seasonLabel(p) || t('periodAllShort');
export const periodOptionLabel = (p) => p === 'season' ? `${t('periodSeason')} · ${seasonLabel(p)}` : p === '12m' ? t('period12') : p === '24m' ? t('period24') : p === 'last' ? `${t('periodLast')} · ${seasonLabel(p)}` : p === 'all' ? t('periodAll') : `${t('periodSeasonOf')} ${seasonLabel(p)}`;
export function oldestSwimYear() {
  let y = Infinity;
  for (const s of state.swimmers) {
    // Competitive swimming usually starts around age 8; PB dates alone would hide earlier seasons.
    if (s.born) y = Math.min(y, s.born + 8);
    for (const b of state.data[s.id]?.all?.bests || []) if (b.date) y = Math.min(y, Number(b.date.slice(0, 4)));
  }
  return Number.isFinite(y) ? y : null;
}
export const shortDate = (iso) => {
  const d = new Date(iso + 'T12:00:00Z');
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString(state.lang, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' });
};
export const fmtPct = (p) => `−${p.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

export function downloadCsv(name, rows) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function save() {
  store.set('swimmers', state.swimmers);
  store.set('data', state.data);
  store.set('collapsed', state.collapsed);
  store.set('trash', state.trash);
  store.set('compareIds', state.compareIds);
  store.set('comparePool', state.comparePool);
  for (const k of ['qSex', 'qPool', 'qClass']) store.set(k, state[k]);
  store.set('qView', state.qComp);
  store.set('seen', state.seen);
  schedulePush();
  scheduleNotifyUpdate();
}

