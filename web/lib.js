// Pure helpers: events, times, periods, stats. No DOM here, so it can be tested in Node.

import { STROKES } from './i18n.js';

// Tempus event codes: odd = 25 m pool, even = 50 m pool.
const BASE_EVENTS = [
  [25, 'free', 4], [25, 'breast', 5], [25, 'back', 6], [25, 'fly', 7],
  [50, 'free', 11], [100, 'free', 13], [200, 'free', 15], [400, 'free', 17], [800, 'free', 19], [1500, 'free', 21],
  [50, 'breast', 31], [100, 'breast', 33], [200, 'breast', 35],
  [50, 'back', 41], [100, 'back', 43], [200, 'back', 45],
  [50, 'fly', 51], [100, 'fly', 53], [200, 'fly', 55],
  [100, 'medley', 61], [200, 'medley', 63], [400, 'medley', 65],
];

const STROKE_ORDER = ['free', 'back', 'breast', 'fly', 'medley'];

export const EVENTS = {};
for (const [dist, stroke, code] of BASE_EVENTS) {
  EVENTS[code] = { code, dist, stroke, pool: 25 };
  if (code > 10) EVENTS[code + 1] = { code: code + 1, dist, stroke, pool: 50 };
}

const STROKE_WORDS = {
  free: /free|fri|vapaa/i,
  back: /back|rygg|selkä/i,
  breast: /breast|bröst|rinta/i,
  fly: /fly|butter|fjäril|perhos/i,
  medley: /medley|seka/i,
};

/** Describe an event from its code, falling back to parsing the Tempus name. */
export function eventInfo(code, name = '') {
  if (EVENTS[code]) return EVENTS[code];
  const dist = Number((String(name).match(/(\d+)\s*m/i) || [])[1]) || null;
  const stroke = Object.keys(STROKE_WORDS).find((s) => STROKE_WORDS[s].test(name)) || null;
  return { code, dist, stroke, pool: code % 2 ? 25 : 50, name };
}

export function eventLabel(code, lang, name = '') {
  const e = eventInfo(code, name);
  if (!e.dist || !e.stroke) return name || `#${code}`;
  return `${e.dist} m ${STROKES[e.stroke][lang] || STROKES[e.stroke].sv}`;
}

export function eventSortKey(code, name = '') {
  const e = eventInfo(code, name);
  return STROKE_ORDER.indexOf(e.stroke) * 10000 + (e.dist || 9999);
}

/** Hundredths of a second → "30.12" or "1:05.50". */
export function fmtTime(cs) {
  if (!Number.isFinite(cs) || cs <= 0) return '–';
  const total = Math.round(cs);
  const h = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  const hh = String(h).padStart(2, '0');
  return m ? `${m}:${String(s).padStart(2, '0')}.${hh}` : `${s}.${hh}`;
}

export function fmtDiff(cs) {
  if (!Number.isFinite(cs)) return '';
  if (cs === 0) return '±0.00';
  const sign = cs > 0 ? '+' : '−';
  return sign + fmtTime(Math.abs(cs)).replace(/^0\./, '0.');
}

// ---------------------------------------------------------------- periods

const iso = (d) => d.toISOString().slice(0, 10);

/** Swedish swimming seasons run September–August. */
export function seasonStart(today = new Date()) {
  const y = today.getUTCMonth() >= 8 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, 8, 1));
}

export function periodRange(kind, today = new Date()) {
  const start = seasonStart(today);
  if (kind === '12m') {
    const d = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate() + 1));
    return { from: iso(d), to: iso(today) };
  }
  if (kind === 'last') {
    const from = new Date(Date.UTC(start.getUTCFullYear() - 1, 8, 1));
    const to = new Date(Date.UTC(start.getUTCFullYear(), 7, 31));
    return { from: iso(from), to: iso(to) };
  }
  return { from: iso(start), to: iso(today) };
}

export function seasonLabel(kind, today = new Date()) {
  const { from, to } = periodRange(kind, today);
  if (kind === '12m') return `${from} – ${to}`;
  const y = Number(from.slice(0, 4));
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- stats

const key = (r) => `${r.pool}:${r.event}`;

/**
 * Merge all-time bests with bests inside a period into one row per event.
 * A "new PB" means the period best equals the all-time best.
 */
export function summarize(allTime, period) {
  const rows = new Map();
  for (const r of allTime?.bests || []) rows.set(key(r), { event: r.event, name: r.name, pool: r.pool, pb: r, period: null });
  for (const r of period?.bests || []) {
    const row = rows.get(key(r)) || { event: r.event, name: r.name, pool: r.pool, pb: null, period: null };
    row.period = r;
    rows.set(key(r), row);
  }
  const list = [...rows.values()].map((row) => ({
    ...row,
    newPb: !!(row.period && row.pb && row.period.time <= row.pb.time),
    diff: row.period && row.pb ? row.period.time - row.pb.time : null,
  }));
  list.sort((a, b) => a.pool - b.pool || eventSortKey(a.event, a.name) - eventSortKey(b.event, b.name));
  const inPeriod = list.filter((r) => r.period);
  const latest = inPeriod.reduce((acc, r) => (!acc || r.period.date > acc.date ? r.period : acc), null);
  const best = [...list]
    .filter((r) => r.pb && r.pb.points)
    .sort((a, b) => b.pb.points - a.pb.points)
    .slice(0, 3);
  return { rows: list, newPbs: list.filter((r) => r.newPb).length, latest, best, swumInPeriod: inPeriod.length };
}

/** Running best over time, for the progression chart. */
export function progression(results) {
  const byDate = [...results].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let best = Infinity;
  return byDate.map((r) => {
    best = Math.min(best, r.time);
    return { date: r.date, time: r.time, best };
  });
}

/** Parse a Tempus link or a bare id. */
export function parseTempusRef(text) {
  const s = String(text || '').trim();
  const m = s.match(/tempusopen\.(se|fi)\/swimmers\/(\d+)/i);
  if (m) return { site: m[1].toLowerCase(), id: Number(m[2]) };
  if (/^\d{1,9}$/.test(s)) return { site: 'se', id: Number(s) };
  return null;
}

export function rankings(swimmers, overviews, event, pool) {
  const out = [];
  for (const s of swimmers) {
    const o = overviews[s.id];
    const r = o?.bests?.find((b) => b.event === event && b.pool === pool);
    if (r) out.push({ swimmer: s, result: r });
  }
  out.sort((a, b) => a.result.time - b.result.time);
  return out;
}

/** Each swimmer's single best swim by AQUA points, across all events. */
export function rankingsByPoints(swimmers, overviews) {
  const out = [];
  for (const s of swimmers) {
    const best = (overviews[s.id]?.bests || []).reduce((acc, r) => (r.points > (acc?.points || 0) ? r : acc), null);
    if (best) out.push({ swimmer: s, result: best });
  }
  out.sort((a, b) => b.result.points - a.result.points);
  return out;
}
