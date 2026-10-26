// World records: a swim as a percentage of the current world record (any age), and for masters
// a swim as a percentage of the World Aquatics masters world record for the swimmer's age group.
// Masters age is the age reached during the calendar year of the swim (year of swim minus birth year), from 25.

import { MASTERS } from './masters-data.js';
import { WR } from './wr-data.js';
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
  const i = ageGroupIndex(age, data);
  const key = recordKey(code, sex);
  if (i < 0 || !key) return null;
  return data.records[key]?.[i] ?? null;
}

/** "LW100fr": pool (from the event code), sex and event, the key both record tables use. */
export function recordKey(code, sex) {
  const e = eventInfo(code);
  if (!e.dist || !e.stroke || !sex) return null;
  return `${code % 2 ? 'S' : 'L'}${sex}${e.dist}${STROKE[e.stroke]}`;
}

/** Current world record (hundredths) for an event code and sex 'W'/'M'. */
export const worldRecordFor = (code, sex, data = WR) => data.records[recordKey(code, sex)] ?? null;

/** { pct, record } for a swim against the current world record, any age. */
export function wrPct(swimmer, r, data = WR) {
  if (!r?.time) return null;
  const record = worldRecordFor(r.event, sexOf(swimmer?.sex), data);
  return record ? { pct: (record / r.time) * 100, record } : null;
}

/** { pct, record, group } for one of a swimmer's results ({ event, time, date }), or null. */
export function mastersPct(swimmer, r, data = MASTERS) {
  if (!swimmer?.born || !r?.time || !r.date) return null;
  const age = Number(String(r.date).slice(0, 4)) - swimmer.born;
  const record = recordFor(r.event, sexOf(swimmer.sex), age, data);
  if (!record) return null;
  return { pct: (record / r.time) * 100, record, group: ageGroupLabel(ageGroupIndex(age, data), data) };
}
