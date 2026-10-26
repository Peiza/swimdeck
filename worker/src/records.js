// Keeps the record tables current without anyone touching the app:
// - world records are read from World Aquatics' public records API once a day and stored in KV;
// - masters records are published as PDFs, so only their "as of" date is checked, and the app says when a
//   newer list exists than the one it ships with.

const WR_API = 'https://api.worldaquatics.com/fina/records/SW';
const MASTERS_PAGE = 'https://www.worldaquatics.com/masters/records';
const UA = 'SwimDeck/0.1 (+https://github.com/Peiza/swimdeck)';
const STROKE = { Freestyle: 'fr', Backstroke: 'ba', Breaststroke: 'br', Butterfly: 'fl', Medley: 'im' };
const DAY = 24 * 60 * 60 * 1000;

const toCs = (t) => {
  const m = String(t || '').match(/^(?:(\d+):)?(\d+)\.(\d{2})$/);
  return m ? (Number(m[1] || 0) * 60 + Number(m[2])) * 100 + Number(m[3]) : null;
};

/** Individual world records from one API page into { "LM100fr": hundredths }. */
export function parseWorldRecords(json, pool, sex) {
  const out = {};
  for (const r of json?.records || []) {
    const dist = String(r.disciplineDistance || '');
    const stroke = STROKE[r.disciplineGroup];
    const name = String(r.eventDisciplineName || '');
    if (r.isRelay || !/^\d+$/.test(dist) || !stroke || /relay|×|\dx\d/i.test(name)) continue;
    if (sex === 'W' ? !/^women/i.test(name) : !/^men/i.test(name)) continue;
    const t = toCs(r.timeFormatted);
    const key = `${pool[0]}${sex}${dist}${stroke}`;
    if (t && (!out[key] || t < out[key])) out[key] = t;
  }
  return out;
}

export async function fetchWorldRecords(fetchImpl = fetch) {
  const records = {};
  for (const [gender, sex] of [['M', 'M'], ['F', 'W']]) {
    for (const pool of ['LCM', 'SCM']) {
      const url = `${WR_API}?recordCode=WR&eventTypeId=&region=&countryId=&gender=${gender}&pool=${pool}`;
      const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`World Aquatics answered ${res.status}`);
      Object.assign(records, parseWorldRecords(await res.json(), pool, sex));
    }
  }
  // a sanity check, so a changed API never replaces good data with half a table
  if (Object.keys(records).length < 60) throw new Error(`Only ${Object.keys(records).length} world records found`);
  return records;
}

/** "01.09.2026" → "2026-09-01": the newest "as of" date on the masters records page. */
export function parseMastersAsOf(html) {
  const dates = [...String(html).matchAll(/as of (\d{2})\.(\d{2})\.(\d{4})/gi)].map((m) => `${m[3]}-${m[2]}-${m[1]}`);
  return dates.sort().at(-1) || null;
}

/** Called from the cron trigger: refresh at most once a day. Returns what was done. */
export async function refreshRecords(kv, fetchImpl = fetch, now = Date.now()) {
  const status = JSON.parse((await kv.get('records')) || '{}');
  if (status.checkedAt && now - status.checkedAt < 20 * 60 * 60 * 1000) return { skipped: true };
  const next = { ...status, checkedAt: now };
  try {
    next.wr = { records: await fetchWorldRecords(fetchImpl), fetchedAt: now };
    next.wrError = null;
  } catch (e) {
    next.wrError = String(e.message || e);
  }
  try {
    const res = await fetchImpl(MASTERS_PAGE, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok) throw new Error(`World Aquatics answered ${res.status}`);
    next.mastersAsOf = parseMastersAsOf(await res.text()) || status.mastersAsOf || null;
    next.mastersCheckedAt = now;
  } catch (e) {
    next.mastersError = String(e.message || e);
  }
  await kv.put('records', JSON.stringify(next));
  return { wr: next.wr ? Object.keys(next.wr.records).length : 0, mastersAsOf: next.mastersAsOf, wrError: next.wrError };
}

/** GET /api/records: the stored world records and the latest masters "as of" date. */
export async function getRecords(kv) {
  const s = JSON.parse((await kv?.get('records')) || '{}');
  const fresh = (t) => !!t && Date.now() - t < 3 * DAY;
  return {
    wr: s.wr ? { records: s.wr.records, fetched: new Date(s.wr.fetchedAt).toISOString().slice(0, 10), current: fresh(s.wr.fetchedAt) } : null,
    mastersAsOf: s.mastersAsOf || null,
    mastersChecked: s.mastersCheckedAt ? new Date(s.mastersCheckedAt).toISOString().slice(0, 10) : null,
    checkedAt: s.checkedAt || null,
  };
}
