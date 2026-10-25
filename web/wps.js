// World Para Swimming points (WPS): the para counterpart of AQUA points, comparable across classes.
// Only long course (50 m) parameters are published, so 25 m swims get no WPS points.

import { WPS } from './wps-data.js';
import { eventInfo } from './lib.js';
import { paraClassFor, sexOf } from './qual.js';

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
