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
    place: r.event_position ?? null,
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
export async function searchSwimmers(base, { first = '', last = '', club = '' }, fetchImpl = fetch) {
  const { page, res } = await getPage(base, '/swimmers', fetchImpl);
  const cookies = cookieHeader(res);
  const xsrf = decodeURIComponent((cookies.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
  const post = await fetchImpl(base + '/swimmers', {
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
    body: JSON.stringify({ first_name: first, last_name: last, club, category: '1', class: '', status: '' }),
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
