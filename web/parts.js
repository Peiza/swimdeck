// Small pieces shared by several views: qualification labels, the new-since-last-visit helpers and icons.
import { state, store, t, esc } from './core.js';
import { qualify } from './qual.js';
import { newSince, bestsSnapshot } from './lib.js';

export const STD_LABEL = { smA: 'SM A', smB: 'SM B', usm: 'USM', paraA: 'Para-SM A', paraB: 'Para-SM B' };
export const stdLabel = (id) => STD_LABEL[id] || id;
// Compact labels for the overview table, so every pill is about as wide and they line up in a column.
export const SHORT_LABEL = { paraA: 'Para A', paraB: 'Para B' };
export const qBadge = (id, extra = '', short = false) => `<span class="q q-${id}" ${short ? `title="${esc(stdLabel(id))}"` : ''}>${esc(short ? SHORT_LABEL[id] || stdLabel(id) : stdLabel(id))}${extra}</span>`;

export function newFor(s) {
  return newSince(state.data[s.id]?.all?.bests, state.seen[s.id]);
}

export function markSeen(ids) {
  for (const id of ids) {
    const b = state.data[id]?.all?.bests;
    if (b) state.seen[id] = bestsSnapshot(b);
  }
  store.set('seen', state.seen);
}

export function qualRows(s) {
  return qualify(s, state.data[s.id]?.qual?.bests || []);
}

export const ICON = {
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

