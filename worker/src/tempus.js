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
