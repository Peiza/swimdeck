// Masters: a swim as a percentage of the World Aquatics masters world record for the swimmer's age group.
// Masters age is the age reached during the calendar year of the swim (year of swim minus birth year), from 25.

import { MASTERS } from './masters-data.js';
import { eventInfo } from './lib.js';
import { sexOf } from './qual.js';

const STROKE = { free: 'fr', back: 'ba', breast: 'br', fly: 'fl', medley: 'im' };

/** "40-44" style age group index for an age, or -1 below 25. */
export function ageGroupIndex(age, data = MASTERS) {
  if (!Number.isFinite(age) || age < data.ages[0]) return -1;
  return Math.min(data.ages.length - 1, Math.floor((age - data.ages[0]) / 5));
}

export const ageGroupLabel = (i, data = MASTERS) => (i < 0 ? '' : `${data.ages[i]}–${data.ages[i] + 4}`);

/** Swimmer counts as a masters swimmer from the year they turn 25. */
export const isMasters = (s, year = new Date().getFullYear()) => !!s?.born && year - s.born >= MASTERS.ages[0];

/** World record (hundredths) for an event code (pool from the code), sex 'W'/'M' and age; null if none. */
export function recordFor(code, sex, age, data = MASTERS) {
  const e = eventInfo(code);
  const i = ageGroupIndex(age, data);
  if (!e.dist || !e.stroke || i < 0 || !sex) return null;
  const key = `${code % 2 ? 'S' : 'L'}${sex}${e.dist}${STROKE[e.stroke]}`;
  return data.records[key]?.[i] ?? null;
}

/** { pct, record, group } for one of a swimmer's results ({ event, time, date }), or null. */
export function mastersPct(swimmer, r, data = MASTERS) {
  if (!swimmer?.born || !r?.time || !r.date) return null;
  const age = Number(String(r.date).slice(0, 4)) - swimmer.born;
  const record = recordFor(r.event, sexOf(swimmer.sex), age, data);
  if (!record) return null;
  return { pct: (record / r.time) * 100, record, group: ageGroupLabel(ageGroupIndex(age, data), data) };
}
