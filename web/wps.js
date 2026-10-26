// World Para Swimming points (WPS): the para counterpart of AQUA points, comparable across classes.
// Only long course (50 m) parameters are published, so 25 m swims get no WPS points.

import { WPS } from './wps-data.js';
import { eventInfo } from './lib.js';
import { paraClassFor, sexOf } from './qual.js';
import { worldRecordFor } from './masters.js';

const STROKE = { free: 'Freestyle', back: 'Backstroke', breast: 'Breaststroke', fly: 'Butterfly', medley: 'Medley' };

export const hasPara = (s) => !!(s?.para && Object.values(s.para).some(Boolean));

/** Points for a time (hundredths) in one event, class and sex; null when the table has no row for it. */
export function wpsFor(code, cls, sex, timeCs, data = WPS) {
  const e = eventInfo(code);
  if (!e.dist || !e.stroke || !cls || !timeCs || code % 2) return null;
  const row = data.events[`${e.dist}_${STROKE[e.stroke]}`]?.[cls];
  if (!row) return null;
  const [b, c] = sex === 'W' ? [row[2], row[3]] : [row[0], row[1]];
  const p = timeCs / 100;
  return Math.floor(data.a * Math.exp(-Math.exp(b - c / p)));
}

/** WPS points for one of a swimmer's results ({ event, pool, time }), using their para classes. */
export function wpsPoints(swimmer, r) {
  if (!hasPara(swimmer) || !r || r.pool !== 50) return null;
  const sex = sexOf(swimmer.sex);
  if (!sex) return null;
  return wpsFor(r.event, paraClassFor(r.event, swimmer.para), sex, r.time);
}

/**
 * A suggestion for the missing para classes when one is known (classes 1–10, physical impairment).
 * The common pattern is SB one class lower than S (SB only goes to 9) and SM the same as S; individual
 * classifications can differ, so this is only offered as a suggestion to confirm. Returns the missing
 * classes, or null when there is nothing to suggest.
 */
export function suggestPara(para) {
  const p = para || {};
  const n = (k) => Number(p[k]) || null;
  if ([n('S'), n('SB'), n('SM')].some((x) => x && x >= 11)) return null; // 11–14 are filled in together
  let S = n('S');
  let SB = n('SB');
  let SM = n('SM');
  if (!S && !SB && !SM) return null;
  if (S) {
    SB = SB || Math.max(1, Math.min(9, S - 1));
    SM = SM || S;
  } else if (SB) {
    S = Math.min(10, SB + 1);
    SM = SM || S;
  } else {
    S = SM;
    SB = Math.max(1, Math.min(9, SM - 1));
  }
  const out = {};
  if (!n('S')) out.S = S;
  if (!n('SB')) out.SB = SB;
  if (!n('SM')) out.SM = SM;
  return Object.keys(out).length ? out : null;
}

/**
 * An unofficial WPS estimate for a 25 m swim: the time is scaled to a 50 m pool by the ratio between the
 * long and short course world records in the event, then scored with the long course table.
 */
export function wpsEstimate(swimmer, r) {
  if (!hasPara(swimmer) || !r || r.pool !== 25 || r.event < 11 || r.event % 2 === 0) return null;
  const sex = sexOf(swimmer.sex);
  const long = r.event + 1;
  const w25 = worldRecordFor(r.event, sex);
  const w50 = worldRecordFor(long, sex);
  if (!sex || !w25 || !w50) return null;
  return wpsFor(long, paraClassFor(long, swimmer.para), sex, Math.round((r.time * w50) / w25));
}
