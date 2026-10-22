// Pure helpers: events, times, periods, stats. No DOM here, so it can be tested in Node.

import { STROKES, STROKES_SHORT } from './i18n.js';

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

/** Compact label, e.g. "100 rygg". */
export function eventShort(code, lang, name = '') {
  const e = eventInfo(code, name);
  if (!e.dist || !e.stroke) return name || `#${code}`;
  return `${e.dist} ${STROKES_SHORT[e.stroke][lang] || STROKES_SHORT[e.stroke].sv}`;
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
export function summarize(allTime, period, before = null) {
  const rows = new Map();
  for (const r of allTime?.bests || []) rows.set(key(r), { event: r.event, name: r.name, pool: r.pool, pb: r, period: null, prev: null });
  for (const r of period?.bests || []) {
    const row = rows.get(key(r)) || { event: r.event, name: r.name, pool: r.pool, pb: null, period: null, prev: null };
    row.period = r;
    rows.set(key(r), row);
  }
  for (const r of before?.bests || []) {
    const row = rows.get(key(r));
    if (row) row.prev = r;
  }
  const list = [...rows.values()].map((row) => {
    const newPb = !!(row.period && row.pb && row.period.time <= row.pb.time);
    // 25 m events are mostly swum by young children years apart, so they would dominate "improvement".
    const counts = (eventInfo(row.event, row.name).dist || 0) > 25;
    const improve = counts && row.period && row.prev && row.period.time < row.prev.time ? row.prev.time - row.period.time : null;
    return {
      ...row,
      newPb,
      firstSwim: !!(row.period && before && !row.prev),
      diff: row.period && row.pb ? row.period.time - row.pb.time : null,
      improve,
      improvePct: improve != null ? (improve / row.prev.time) * 100 : null,
    };
  });
  list.sort((a, b) => a.pool - b.pool || eventSortKey(a.event, a.name) - eventSortKey(b.event, b.name));
  const inPeriod = list.filter((r) => r.period);
  const latest = inPeriod.reduce((acc, r) => (!acc || r.period.date > acc.date ? r.period : acc), null);
  const best = [...list]
    .filter((r) => r.pb && r.pb.points)
    .sort((a, b) => b.pb.points - a.pb.points)
    .slice(0, 4);
  const topImprove = list.filter((r) => r.improve != null).sort((a, b) => b.improvePct - a.improvePct)[0] || null;
  return { rows: list, newPbs: list.filter((r) => r.newPb).length, latest, best, swumInPeriod: inPeriod.length, topImprove };
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

/**
 * Order swimmers for the deck. 'manual' keeps the saved order.
 * `info(id)` returns { newPbs, latest } (latest = ISO date of the latest season best) or null.
 */
export function sortSwimmers(swimmers, mode, info = () => null, lang = 'sv') {
  const list = [...swimmers];
  const name = (a, b) => (a.name || '').localeCompare(b.name || '', lang);
  const by = {
    name,
    born: (a, b) => (a.born || 9999) - (b.born || 9999) || name(a, b),
    club: (a, b) => (a.club || '\uffff').localeCompare(b.club || '\uffff', lang) || name(a, b),
    newPbs: (a, b) => (info(b.id)?.newPbs || 0) - (info(a.id)?.newPbs || 0) || name(a, b),
    recent: (a, b) => String(info(b.id)?.latest || '').localeCompare(String(info(a.id)?.latest || '')) || name(a, b),
  }[mode];
  return by ? list.sort(by) : list;
}

// ---------------------------------------------------------------- seasons, meets, comparisons

/** Season label for a date, seasons running September–August: "2025/26". */
export function seasonOf(date) {
  const y = Number(String(date).slice(0, 4));
  const m = Number(String(date).slice(5, 7));
  const start = m >= 9 ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Best time per season for one event, newest season first, with change vs the season before. */
export function seasonBests(results) {
  const by = new Map();
  for (const r of results) {
    const k = seasonOf(r.date);
    const cur = by.get(k);
    if (!cur) by.set(k, { season: k, best: r, count: 1 });
    else {
      cur.count++;
      if (r.time < cur.best.time) cur.best = r;
    }
  }
  const list = [...by.values()].sort((a, b) => a.season.localeCompare(b.season));
  list.forEach((x, i) => {
    x.change = i ? x.best.time - list[i - 1].best.time : null;
  });
  return list.reverse();
}

/**
 * All swims from several events grouped by meet, newest first.
 * Each swim gets `pb` (faster than every earlier swim in that event and pool)
 * or `first` (the swimmer's first swim in that event and pool).
 */
export function meets(eventPayloads) {
  const swims = [];
  for (const ev of eventPayloads) {
    const sorted = [...(ev?.results || [])].sort(
      (a, b) => String(a.date).localeCompare(String(b.date)) || (a.round === 'Final' ? 1 : 0) - (b.round === 'Final' ? 1 : 0),
    );
    let best = Infinity;
    sorted.forEach((r, i) => {
      swims.push({ ...r, pool: r.pool ?? ev.pool, first: i === 0, pb: i > 0 && r.time < best, prevBest: i > 0 ? best : null });
      best = Math.min(best, r.time);
    });
  }
  const groups = new Map();
  for (const w of swims) {
    const k = `${w.meet}|${seasonOf(w.date)}`;
    const g = groups.get(k) || { meet: w.meet, from: w.date, to: w.date, swims: [] };
    g.swims.push(w);
    if (w.date < g.from) g.from = w.date;
    if (w.date > g.to) g.to = w.date;
    groups.set(k, g);
  }
  const list = [...groups.values()];
  for (const g of list) {
    g.swims.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.pool - b.pool || eventSortKey(a.event, a.name) - eventSortKey(b.event, b.name));
    g.pbs = g.swims.filter((w) => w.pb).length;
  }
  return list.sort((a, b) => b.to.localeCompare(a.to) || b.from.localeCompare(a.from));
}

/** Event-by-swimmer table of personal bests for one pool length. */
export function compareTable(swimmers, overviews, pool) {
  const events = new Map();
  for (const s of swimmers) {
    for (const b of overviews[s.id]?.bests || []) if (b.pool === pool) events.set(b.event, b.name);
  }
  return [...events.entries()]
    .sort((a, b) => eventSortKey(a[0], a[1]) - eventSortKey(b[0], b[1]))
    .map(([event, name]) => {
      const cells = swimmers.map((s) => overviews[s.id]?.bests?.find((b) => b.event === event && b.pool === pool) || null);
      const fastest = Math.min(...cells.filter(Boolean).map((c) => c.time));
      return { event, name, cells, fastest };
    });
}

/** Each swimmer's largest improvement in the period (percent), optionally in one event. */
export function rankingsByImprovement(swimmers, summaries, event = null, pool = null) {
  const out = [];
  for (const s of swimmers) {
    const rows = (summaries[s.id]?.rows || []).filter(
      (r) => r.improve != null && (event == null || (r.event === event && r.pool === pool)),
    );
    const top = rows.sort((a, b) => b.improvePct - a.improvePct)[0];
    if (top) out.push({ swimmer: s, row: top });
  }
  return out.sort((a, b) => b.row.improvePct - a.row.improvePct);
}

/** Semicolon-separated CSV with a BOM, which Excel opens correctly in Swedish locales. */
export function toCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
