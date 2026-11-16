// Talking to the SwimDeck API: loading swimmers, refreshing the list and one event.
import { CONFIG } from './config.js';
import { QUAL } from './qual-data.js';
import { periodRange, eventSortKey, bestsSnapshot } from './lib.js';
import { state, store, t, API, STALE_MS, toast, errText, hooks } from './core.js';

// While anything is being fetched the logo's wave flows (html.loading, see style.css). It stops at the end
// of a wave, not mid-movement; the timer is for when no animation runs (reduced motion).
let pending = 0;
let loadingTimer = 0;
let lastEnd = 0;
// Stop only when nothing has been loading for a moment, so a list of swimmers loaded one after another keeps one smooth animation.
export const loadingStop = () => pending === 0 && Date.now() - lastEnd >= 600 && document.documentElement.classList.remove('loading');
export function loadingStart() {
  pending++;
  clearTimeout(loadingTimer);
  document.documentElement.classList.add('loading');
}
export function loadingEnd() {
  pending = Math.max(0, pending - 1);
  lastEnd = Date.now();
  if (pending === 0) loadingTimer = setTimeout(loadingStop, 1500);
}
document.addEventListener('animationiteration', (e) => e.animationName === 'logo-flow' && loadingStop());

export async function api(path, params = {}) {
  if (CONFIG.api == null) throw new Error(t('apiMissing'));
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  loadingStart();
  let res;
  let body = null;
  try {
    res = await fetch(`${API}${path}${q.toString() ? '?' + q : ''}`);
    try {
      body = await res.json();
    } catch {}
  } finally {
    loadingEnd();
  }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

export const periodKey = () => {
  const { from, to } = periodRange(state.period);
  return `${from}_${to}`;
};

export const RECENT_DAYS = 60;

/** The swimmer's latest meet in the last 60 days: its name, dates and the swims there, each against the PB. */
export function recentMeet(d) {
  const bests = d?.recent?.bests || [];
  if (!bests.length) return null;
  const lastDate = bests.reduce((m, b) => (b.date > m ? b.date : m), '');
  const last = bests.find((b) => b.date === lastDate);
  const swims = bests.filter((b) => b.meet === last.meet && Math.abs(Date.parse(b.date) - Date.parse(lastDate)) < 5 * 86400000);
  const pbOf = (b) => (d.all?.bests || []).find((x) => x.event === b.event && x.pool === b.pool)?.time;
  return {
    meet: last.meet,
    date: lastDate,
    swims: swims.sort((a, b) => a.pool - b.pool || eventSortKey(a.event, a.name) - eventSortKey(b.event, b.name)).map((b) => ({ ...b, pb: pbOf(b) })),
  };
}

export async function loadSwimmer(s, { fresh = false } = {}) {
  const { from, to } = periodRange(state.period);
  const refresh = fresh ? 1 : '';
  const dayBefore = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  // the last 60 days: one extra request that gives every event swum recently (best time per event)
  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  // one request for all date ranges (the worker caches each range on its own)
  const ranges = ['_', `${from}_${to}`, `1990-01-01_${dayBefore}`, `${QUAL.windowStart}_`];
  if (state.cardParts.recent) ranges.push(`${recentFrom}_`);
  const q = new URLSearchParams({ site: s.site });
  if (refresh) q.set('refresh', '1');
  for (const r of ranges) q.append('r', r);
  const parts = await api(`/api/swimmer/${s.id}/bundle?${q}`);
  const [all, period, before, qual, recent = null] = parts.map((p, i) => {
    if (p?.error && i < 4) throw new Error(p.error);
    return p?.error ? null : p;
  });
  if (all.swimmer) Object.assign(s, pickSwimmer(all.swimmer, s.site));
  if (!state.seen[s.id]) state.seen[s.id] = bestsSnapshot(all.bests);
  state.data[s.id] = { all, period, before, qual, recent, periodKey: periodKey(), fetchedAt: Date.now(), error: null };
}

export function pickSwimmer(sw, site) {
  return { id: sw.id, site, name: sw.name, born: sw.born, club: sw.club, sex: sw.sex };
}

let pendingLoad = [];

export async function refreshAll({ fresh = false, only = null } = {}) {
  if (state.busy) {
    // Queue swimmers added while a refresh is running; they load right after it.
    pendingLoad.push(...(only || state.swimmers));
    return;
  }
  const list = (only || state.swimmers).slice();
  if (!list.length) return;
  state.busy = { done: 0, total: list.length };
  hooks.renderHeader();
  const queue = list.slice();
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      try {
        await loadSwimmer(s, { fresh });
      } catch (e) {
        state.data[s.id] = { ...(state.data[s.id] || {}), error: e.message };
      }
      state.busy.done++;
      hooks.renderHeader();
      hooks.renderMain();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  state.busy = null;
  hooks.save();
  hooks.render();
  if (pendingLoad.length) {
    const next = [...new Map(pendingLoad.map((s) => [s.id, s])).values()].filter((s) => state.swimmers.includes(s));
    pendingLoad = [];
    if (next.length) refreshAll({ only: next });
  }
}

export function needsLoad(s) {
  const d = state.data[s.id];
  return !d || !d.all || !d.before || !d.qual || (state.cardParts.recent && d.recent === undefined) || d.periodKey !== periodKey() || Date.now() - (d.fetchedAt || 0) > STALE_MS;
}

export async function loadEvent(s, code) {
  const k = `${s.site}:${s.id}:${code}`;
  if (!state.events[k]) state.events[k] = api(`/api/swimmer/${s.id}/event/${code}`, { site: s.site });
  try {
    return await state.events[k];
  } catch (e) {
    delete state.events[k];
    throw e;
  }
}

/** Load every event page for a swimmer (cached per session), reporting progress. */
export async function loadAllEvents(s, onProgress = () => {}, codes = null) {
  const d = state.data[s.id];
  codes = codes || [...new Set((d?.all?.bests || []).map((b) => b.event))];
  let done = 0;
  onProgress(done, codes.length);
  const queue = codes.slice();
  const results = [];
  let failed = null;
  const worker = async () => {
    while (queue.length) {
      const code = queue.shift();
      try {
        results.push(await loadEvent(s, code));
      } catch (e) {
        failed = e;
      }
      done++;
      onProgress(done, codes.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { results, failed };
}
