// Shared by every part of the app: the one state object, local storage, the translator and small helpers.
import { CONFIG } from './config.js';
import { makeT, detectLang } from './i18n.js';

export const TRASH_DAYS = 30;

export const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem('swimdeck.' + k);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('swimdeck.' + k, JSON.stringify(v));
    } catch {}
  },
};

export const state = {
  lang: detectLang(),
  period: store.get('period', 'season'),
  view: 'deck',
  topN: store.get('topN', 5),
  topOrder: store.get('topOrder', 'fast'), // fast | recent
  cardParts: { stats: true, recent: true, latest: true, improve: true, qual: true, goals: true, best: true, para: false, ...store.get('cardParts', {}) },
  swimmers: store.get('swimmers', []),
  sort: store.get('sort', 'manual'),
  collapsed: store.get('collapsed', []), // ids of minimised cards
  trash: store.get('trash', []).filter((x) => Date.now() - x.removedAt < TRASH_DAYS * 86400000), // { swimmer, removedAt, index }
  data: store.get('data', {}), // id -> { all, period, periodKey, fetchedAt, error }
  events: {}, // `${site}:${id}:${code}` -> event payload (memory only)
  busy: null, // { done, total }
  rankEvent: store.get('rankEvent2', 'both:11'),
  rankSortPool: store.get('rankSortPool', 25),
  helpOpen: {},
  theme: store.get('theme', 'auto'),
  metric: store.get('metric', 'aqua'),
  near: store.get('near', 3),
  compareMetric: store.get('compareMetric', 'time'),
  menu: null,
  eventData: {},
  paraLookup: {},
  rankSex: store.get('rankSex', ''),
  rankBasis: store.get('rankBasis', 'pb'),
  rankYear: store.get('rankYear', ''),
  openId: null,
  openPool: 25,
  openEvent: null,
  openTab: 'events', // events | meets
  meetsShown: 5,
  compareIds: store.get('compareIds', []),
  comparePool: store.get('comparePool', 25),
  qComp: store.get('qView', 'done'),
  qSex: store.get('qSex', 'W'),
  qPool: store.get('qPool', 25),
  qClass: store.get('qClass', 9),
  seen: store.get('seen', {}), // id -> snapshot of PBs the user has seen
};

/** The translator. Imported as a live binding, so every module sees the current language. */
export let t = makeT(state.lang);
export function setLang(lang) {
  state.lang = lang;
  t = makeT(lang);
}

export const API = (CONFIG.api ?? '').replace(/\/$/, '');
export const STALE_MS = 6 * 60 * 60 * 1000;
export const FEEDBACK_URL = 'https://github.com/Peiza/swimdeck/issues/new/choose';

export const $ = (sel, root = document) => root.querySelector(sel);
export const sexLabel = (x) => (/^(wo|fe|kvin|dam|nai|flick|tyt)/i.test(x || '') ? t('women') : x ? t('men') : '');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

