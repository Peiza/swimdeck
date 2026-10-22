// Qualifying times: which standards apply to a swimmer, and which they have reached.

import { QUAL } from './qual-data.js';
import { eventInfo } from './lib.js';

/** Most demanding first. A swim is shown at the first standard it reaches. */
export const ORDER = ['smA', 'smB', 'usm', 'paraA', 'paraB'];

export const sexOf = (x) => (/^(wo|fe|kvin|dam|nai|flick|tyt)/i.test(x || '') ? 'W' : x ? 'M' : null);

/** Para class for an event: S for free/back/fly, SB for breaststroke, SM for medley. */
export function paraClassFor(code, para) {
  if (!para) return null;
  const stroke = eventInfo(code).stroke;
  const prefix = stroke === 'breast' ? 'SB' : stroke === 'medley' ? 'SM' : 'S';
  return para[prefix] ? `${prefix}${para[prefix]}` : null;
}

export function usmAgeGroup(born, qual = QUAL) {
  if (!born) return null;
  const age = qual.year - born;
  return qual.standards.find((s) => s.id === 'usm').ages.find(([a, b]) => age >= a && age <= b) || null;
}

/** Qualifying times that apply to this swimmer in one event, most demanding first. */
export function standardsFor(swimmer, code, qual = QUAL) {
  const sex = sexOf(swimmer.sex);
  if (!sex) return [];
  const out = [];
  for (const std of qual.standards) {
    let row;
    if (std.comp === 'sm') row = std.rows.find((r) => r[0] === sex && r[1] === code);
    else if (std.comp === 'usm') {
      const group = usmAgeGroup(swimmer.born, qual);
      if (group) row = std.rows.find((r) => r[0] === sex && r[1] === group[0] && r[2] === code);
    } else if (std.comp === 'para') {
      const cls = paraClassFor(code, swimmer.para);
      if (cls) row = std.rows.find((r) => r[0] === sex && r[1] === cls && r[2] === code);
    }
    if (row) out.push({ id: std.id, time: row[row.length - 1] });
  }
  return out.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

/**
 * For each event the swimmer has swum in the qualifying window: the standards reached,
 * the highest one, and the closest one not yet reached (with the gap in hundredths).
 */
export function qualify(swimmer, windowBests, qual = QUAL) {
  const out = [];
  for (const r of windowBests || []) {
    const stds = standardsFor(swimmer, r.event, qual);
    if (!stds.length) continue;
    const reached = stds.filter((s) => r.time <= s.time);
    const missing = stds.filter((s) => r.time > s.time).sort((a, b) => b.time - a.time);
    // Show one SM/USM standard and one Para standard at most.
    const top = (list, para) => list.find((s) => s.id.startsWith('para') === para) || null;
    out.push({
      event: r.event,
      pool: r.pool,
      result: r,
      reached,
      best: [top(reached, false), top(reached, true)].filter(Boolean),
      next: missing[0] ? { ...missing[0], gap: r.time - missing[0].time } : null,
    });
  }
  return out;
}

/** Number of events per highest standard reached, e.g. { smB: 2, usm: 3 }. */
export function qualCounts(rows) {
  const counts = {};
  for (const row of rows) for (const s of row.best) counts[s.id] = (counts[s.id] || 0) + 1;
  return counts;
}
