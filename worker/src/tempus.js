// Helpers for reading Tempus Open (Laravel + Inertia) pages and
// turning them into a small, stable JSON shape for the SwimDeck app.

export const SITES = {
  se: 'https://www.tempusopen.se',
  fi: 'https://www.tempusopen.fi',
};

const UA = 'SwimDeck/0.1 (+https://github.com/Peiza/swimdeck)';

// ---------------------------------------------------------------- parsing

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#039': "'", '#39': "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Extract the Inertia page object from the data-page attribute of an HTML document. */
export function parseInertiaPage(html) {
  const m = html.match(/data-page="([^"]*)"/) || html.match(/data-page='([^']*)'/);
  if (!m) throw new Error('No Inertia page found');
  return JSON.parse(decodeEntities(m[1]));
}

const list = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.data) ? x.data : x ? Object.values(x) : []);

// ---------------------------------------------------------------- normalising

export function poolOf(r, fallback) {
  const n = String(r.pool_type_name || '').match(/(25|50)/);
  if (n) return Number(n[1]);
  return fallback ?? null;
}

/** One swim, in the shape the app uses. Time is in hundredths of a second. */
export function normResult(r, pool) {
  return {
    id: r.id ?? null,
    event: Number(r.event_code),
    name: r.event_name ?? '',
    pool: poolOf(r, pool),
    time: Number(r.result_time),
    display: String(r.swim_time ?? '').trim(),
    date: r.result_date ?? null,
    meet: r.competition_name ?? '',
    round: r.round_type_name ?? '',
    points: r.aqua_points ?? null,
    club: r.club_name ?? '',
  };
}

export const isValid = (r) => Number.isFinite(r.time) && r.time > 0;

/**
 * Tempus sometimes stores the same swim twice, on consecutive dates.
 * Treat swims with identical time, meet and round within one day as duplicates.
 */
export function dedupe(results) {
  const sorted = [...results].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const kept = [];
  for (const r of sorted) {
    const dup = kept.find(
      (k) =>
        k.time === r.time &&
        k.meet === r.meet &&
        k.round === r.round &&
        k.event === r.event &&
        Math.abs(dayDiff(k.date, r.date)) <= 1,
    );
    if (!dup) kept.push(r);
  }
  return kept;
}

function dayDiff(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return (tb - ta) / 86400000;
}

export function normSwimmer(s) {
  if (!s) return null;
  return {
    id: Number(s.id ?? s.swimmer_id),
    name: s.name || [s.first_name, s.last_name].filter(Boolean).join(' '),
    firstName: s.first_name ?? '',
    lastName: s.last_name ?? '',
    born: s.birth_year ? Number(s.birth_year) : null,
    club: s.club_name ?? '',
    sex: s.class_name ?? '',
  };
}

/** Swimmer overview page: personal bests for 25 m and 50 m pools. */
export function shapeOverview(props) {
  const short = list(props.results_short).map((r) => normResult(r, 25)).filter(isValid);
  const long = list(props.results_long).map((r) => normResult(r, 50)).filter(isValid);
  return {
    swimmer: normSwimmer(props.swimmer),
    from: props.from_date ?? null,
    to: props.to_date ?? null,
    bests: [...short, ...long],
  };
}

/** Event page: every swim in one event, fastest first. */
export function shapeEvent(props, code = null) {
  const all = list(props.all_results ?? props.results).map((r) => normResult(r)).filter(isValid);
  const results = dedupe(all).sort((a, b) => a.time - b.time || String(a.date).localeCompare(String(b.date)));
  return {
    swimmer: normSwimmer(props.swimmer),
    // swim_event.id is an internal id, not the event code; take the code from the rows instead.
    event: { code: results[0]?.event ?? (code != null ? Number(code) : null), name: props.swim_event?.name ?? results[0]?.name ?? '' },
    pool: poolOf(props.pool_type || {}, results[0]?.pool ?? null),
    results,
  };
}

export function shapeSearch(props) {
  const s = props.swimmers || {};
  return {
    total: s.meta?.total ?? list(s).length,
    page: s.meta?.current_page ?? 1,
    lastPage: s.meta?.last_page ?? 1,
    swimmers: list(s).map(normSwimmer),
  };
}

// ---------------------------------------------------------------- fetching

async function getPage(base, path, fetchImpl) {
  const res = await fetchImpl(base + path, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en' },
    redirect: 'follow',
  });
  if (res.status === 404) throw httpError(404, 'Not found');
  if (!res.ok) throw httpError(502, `Tempus answered ${res.status}`);
  const html = await res.text();
  return { page: parseInertiaPage(html), res };
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function fetchOverview(base, id, { from, to } = {}, fetchImpl = fetch) {
  const q = new URLSearchParams();
  if (from && DATE.test(from)) q.set('from_date', from);
  if (to && DATE.test(to)) q.set('to_date', to);
  const qs = q.toString();
  const { page } = await getPage(base, `/swimmers/${id}/swimming${qs ? '?' + qs : ''}`, fetchImpl);
  return shapeOverview(page.props);
}

export async function fetchEvent(base, id, code, fetchImpl = fetch) {
  const { page } = await getPage(base, `/swimmers/${id}/events/${code}`, fetchImpl);
  return shapeEvent(page.props, code);
}

/** Collect cookies from a response into a "name=value; ..." header string. */
export function cookieHeader(res) {
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') || '').split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  return raw
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

/**
 * Search needs Laravel's session + XSRF cookies, so first GET the search page,
 * then POST the form the same way the site's own JavaScript does.
 */
export async function searchSwimmers(base, { first = '', last = '', club = '', active = false, sex = '', page: wanted = 1 }, fetchImpl = fetch) {
  const { page, res } = await getPage(base, '/swimmers', fetchImpl);
  const cookies = cookieHeader(res);
  const xsrf = decodeURIComponent((cookies.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
  const pageNo = Math.max(1, Math.min(50, Number(wanted) || 1));
  const post = await fetchImpl(base + '/swimmers' + (pageNo > 1 ? `?page=${pageNo}` : ''), {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      Accept: 'text/html, application/xhtml+xml',
      'X-Inertia': 'true',
      'X-Inertia-Version': page.version ?? '',
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': xsrf,
      Cookie: cookies,
    },
    body: JSON.stringify({ first_name: first, last_name: last, club, category: '1', class: sex === 'M' ? '1' : sex === 'W' ? '2' : '', status: active ? '1' : '' }),
  });
  if (!post.ok) throw httpError(502, `Tempus search answered ${post.status}`);
  const json = await post.json();
  return shapeSearch(json.props || {});
}

// ---------------------------------------------------------------- national ranking

// Tempus statistics use their own event ids (not the event codes on swimmer pages).
const STAT_EVENT = {
  free: { 25: 1, 50: 5, 100: 6, 200: 7, 400: 8, 800: 9, 1500: 10 },
  breast: { 25: 2, 50: 15, 100: 16, 200: 17 },
  back: { 25: 3, 50: 20, 100: 21, 200: 22 },
  fly: { 25: 4, 50: 25, 100: 26, 200: 27 },
  medley: { 100: 30, 200: 31, 400: 32 },
};
const CODE_EVENT = {};
for (const [stroke, base] of Object.entries({ free: [[25, 4], [50, 11], [100, 13], [200, 15], [400, 17], [800, 19], [1500, 21]], breast: [[25, 5], [50, 31], [100, 33], [200, 35]], back: [[25, 6], [50, 41], [100, 43], [200, 45]], fly: [[25, 7], [50, 51], [100, 53], [200, 55]], medley: [[100, 61], [200, 63], [400, 65]] })) {
  for (const [dist, code] of base) {
    CODE_EVENT[code] = { stroke, dist, pool: 25 };
    if (code > 10) CODE_EVENT[code + 1] = { stroke, dist, pool: 50 };
  }
}

/** Tempus statistics event id and pool type (1 = 25 m, 2 = 50 m) for an event code. */
export function statEvent(code) {
  const e = CODE_EVENT[code];
  if (!e) return null;
  return { id: STAT_EVENT[e.stroke][e.dist], pool: e.pool === 25 ? 1 : 2 };
}

/**
 * Rank among Swedish swimmers born the same year, by each swimmer's best time in [from, to].
 * Tempus filters on age = calendar year of the swim minus birth year, so we ask for the ages the
 * birth year can have in that period and keep only that birth year. Pages are read until the
 * given time is passed, at most `maxPages` pages of 100.
 */
export async function nationalRank(base, { code, sex, born, from, to, time }, fetchImpl = fetch, maxPages = 5) {
  const ev = statEvent(code);
  if (!ev || !born || !DATE.test(from) || !DATE.test(to)) throw httpError(400, 'Bad ranking request');
  const minAge = Number(from.slice(0, 4)) - born;
  const maxAge = Number(to.slice(0, 4)) - born;
  if (maxAge < 13) return { available: false, reason: 'age' };
  const { page, res } = await getPage(base, '/statistics/swimming', fetchImpl);
  const cookies = cookieHeader(res);
  const xsrf = decodeURIComponent((cookies.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
  const body = {
    from_date: from,
    to_date: to,
    class: sex === 'W' ? '2' : '1',
    swim_event: ev.id,
    pool_type: ev.pool,
    competition_group: '',
    best_time_only: true,
    best_result_mode: 1,
    from_age: Math.max(13, minAge),
    to_age: maxAge,
    district: '',
    club: '',
    filter: { age_filter: true, best_time_only: true },
    limit: 100,
  };
  const seen = new Set();
  const cohort = [];
  let pages = 0;
  let total = 0;
  for (let p = 1; p <= maxPages; p++) {
    const post = await fetchImpl(`${base}/statistics/swimming${p > 1 ? `?page=${p}` : ''}`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        Accept: 'text/html, application/xhtml+xml',
        'X-Inertia': 'true',
        'X-Inertia-Version': page.version ?? '',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': xsrf,
        Cookie: cookies,
      },
      body: JSON.stringify(body),
    });
    if (!post.ok) throw httpError(502, `Tempus statistics answered ${post.status}`);
    const json = await post.json();
    const results = json.props?.results || {};
    const rows = Array.isArray(results.data) ? results.data : [];
    pages = p;
    total = results.meta?.total ?? rows.length;
    for (const r of rows) {
      if (Number(r.swimmer_birth_year) !== born || seen.has(r.swimmer_id)) continue;
      seen.add(r.swimmer_id);
      cohort.push({ id: r.swimmer_id, time: Number(r.result_time) });
    }
    const last = rows.at(-1);
    if (!rows.length || !results.meta || p >= (results.meta.last_page || 1) || (last && Number(last.result_time) > time)) break;
  }
  const faster = cohort.filter((c) => c.time < time).length;
  const complete = pages < maxPages || cohort.some((c) => c.time > time);
  return {
    available: true,
    rank: faster + 1,
    complete,
    leader: cohort[0]?.time ?? null,
    scanned: cohort.length,
    totalAllAges: total,
  };
}

// ---------------------------------------------------------------- meet results

/** A Laravel session (cookies + XSRF token + Inertia version) taken from one GET. */
async function session(base, path, fetchImpl) {
  const { page, res } = await getPage(base, path, fetchImpl);
  const cookies = cookieHeader(res);
  const xsrf = decodeURIComponent((cookies.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
  return { base, cookies, xsrf, version: page.version ?? '', page };
}

async function inertiaPost(sess, path, body, fetchImpl) {
  const res = await fetchImpl(sess.base + path, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      Accept: 'text/html, application/xhtml+xml',
      'X-Inertia': 'true',
      'X-Inertia-Version': sess.version,
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': sess.xsrf,
      Cookie: sess.cookies,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 404) throw httpError(404, 'Not found');
  if (!res.ok) throw httpError(502, `Tempus answered ${res.status}`);
  return (await res.json()).props || {};
}

const shiftDate = (iso, days) => new Date(Date.parse(iso) + days * 86400000).toISOString().slice(0, 10);
const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function normMeet(c) {
  return c ? { id: Number(c.id), name: String(c.name || '').trim(), location: c.location ?? '', organizer: c.organizer ?? '', date: c.competition_date ?? null, pool: poolOf(c, null) } : null;
}

/** Pick the competition a swim belongs to: same name, starting on or before the swim date, closest first. */
export function pickMeet(competitions, name, date) {
  const want = normName(name);
  const cands = list(competitions).map(normMeet).filter((c) => c && (!date || !c.date || c.date <= date));
  cands.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return cands.find((c) => normName(c.name) === want) || cands.find((c) => normName(c.name).includes(want) || want.includes(normName(c.name))) || null;
}

/**
 * Places within each round: ties share a place. Tempus often labels both heats and finals "Final",
 * so each swimmer counts once per round, with their fastest swim.
 * Rows come back grouped by round, fastest first.
 */
export function placeRows(rows) {
  const byRound = new Map();
  for (const r of rows) {
    const k = r.round || '';
    if (!byRound.has(k)) byRound.set(k, new Map());
    const g = byRound.get(k);
    const id = r.swimmerId || r.swimmer;
    const prev = g.get(id);
    // the same swim is sometimes listed twice (once per championship in a combined meet); count distinct swims
    if (prev && prev.date === r.date && prev.time === r.time) continue;
    if (!prev || r.time < prev.time) g.set(id, { ...r, swims: (prev?.swims || 0) + 1 });
    else prev.swims += 1;
  }
  for (const [k, g] of byRound) byRound.set(k, [...g.values()]);
  const order = roundOrder;
  const out = [];
  for (const k of [...byRound.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
    const g = byRound.get(k).sort((a, b) => a.time - b.time);
    g.forEach((r, i) => out.push({ ...r, place: i > 0 && g[i - 1].time === r.time ? out.at(-1).place : i + 1, of: g.length }));
  }
  return out;
}

const roundOrder = (k) => (/^final$/i.test(k || '') ? 0 : /final/i.test(k || '') ? 1 : /semi/i.test(k || '') ? 2 : 3);

/**
 * Overall result: each swimmer once, placed by the furthest round they reached (final before semifinal before
 * heats), then by their time in that round. Someone who did not reach the final never ranks above a finalist.
 * Input is the output of placeRows.
 */
export function overallRows(placed) {
  const best = new Map();
  for (const r of placed) {
    const id = r.swimmerId || r.swimmer;
    const prev = best.get(id);
    if (!prev || roundOrder(r.round) < roundOrder(prev.round) || (roundOrder(r.round) === roundOrder(prev.round) && r.time < prev.time)) best.set(id, r);
  }
  const g = [...best.values()].sort((a, b) => roundOrder(a.round) - roundOrder(b.round) || a.time - b.time);
  const out = [];
  g.forEach((r, i) => {
    const tie = i > 0 && g[i - 1].time === r.time && roundOrder(g[i - 1].round) === roundOrder(r.round);
    out.push({ ...r, roundPlace: r.place, roundOf: r.of, place: tie ? out.at(-1).place : i + 1, of: g.length });
  });
  return out;
}

/**
 * Result list for one event (and sex) at one meet. Finds the meet by name and date when no id is given.
 * At most `maxPages` pages of 20 rows are read.
 */
export async function fetchMeet(base, { id, name, date, code, sex }, fetchImpl = fetch, maxPages = 15) {
  const ev = statEvent(Number(code));
  if (!ev) throw httpError(400, 'Unknown event');
  const sess = await session(base, '/competitions/swimming', fetchImpl);
  let meetId = Number(id) || null;
  if (!meetId) {
    if (!name || !DATE.test(date || '')) throw httpError(400, 'Need meet id, or name and date');
    const props = await inertiaPost(sess, '/competitions/swimming', { name: String(name).slice(0, 80), organizer: '', location: '', pool_type: '', competition_group: '', from_date: shiftDate(date, -21), to_date: date }, fetchImpl);
    const m = pickMeet(props.competitions, name, date);
    if (!m) throw httpError(404, 'Meet not found');
    meetId = m.id;
  }
  const cls = sex === 'W' ? '2' : sex === 'M' ? '1' : '';
  let meet = null;
  let events = [];
  const rows = [];
  let total = 0;
  let pages = 0;
  for (let p = 1; p <= maxPages; p++) {
    const props = await inertiaPost(sess, `/competitions/swimming/${meetId}`, { swim_event: ev.id, class: cls, club: '', page: p }, fetchImpl);
    meet = meet || normMeet(props.competition);
    if (!events.length) events = list(props.swim_events).map((e) => ({ id: Number(e.id), name: e.name }));
    const res = props.results || {};
    const data = list(res.data ?? res);
    total = res.meta?.total ?? data.length;
    pages = p;
    for (const r of data) {
      const x = normResult(r, meet?.pool);
      if (!isValid(x)) continue;
      rows.push({ swimmerId: Number(r.swimmer_id), swimmer: r.swimmer_name ?? '', born: r.swimmer_birth_year ? Number(r.swimmer_birth_year) : null, club: x.club, event: x.event, time: x.time, date: x.date, round: x.round, points: x.points });
    }
    if (!data.length || p >= (res.meta?.last_page || 1)) break;
  }
  return {
    meet: meet || { id: meetId },
    code: Number(code),
    sex: cls ? sex : '',
    events: events.map((e) => e.name),
    total,
    complete: rows.length >= total || pages < maxPages,
    ...(() => {
      const results = placeRows(rows);
      // Some meets label heats and finals alike; then a swimmer shows up twice in one round and the order is a guess.
      return { results, overall: overallRows(results), ambiguous: results.some((r) => r.swims > 1) };
    })(),
  };
}
