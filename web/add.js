// Adding swimmers: search, paste a list, or pick them from a meet in Tempus.
import { state, store, t, $, esc, toast, errText, hooks, sexLabel } from './core.js';
import { api, pickSwimmer, refreshAll } from './api.js';
import { eventSortKey, eventLabel } from './lib.js';
import { parseList, rankCandidates } from './importer.js';



/** The Done button counts the swimmers added since the dialog opened. */
/** What the add, import and meet dialogs are working on. */
export const addState = { importState: null, meetImport: null, searchState: null, addStartIds: null };

export function updateAddDone() {
  const btn = $('#addDone');
  if (!btn || !addState.addStartIds) return;
  const n = state.swimmers.filter((s) => !addState.addStartIds.has(s.id)).length;
  btn.textContent = n ? t('doneAdded', { n }) : t('done');
}

export function openAdd() {
  addState.addStartIds = new Set(state.swimmers.map((s) => s.id));
  const dlg = $('#addDialog');
  dlg.innerHTML = `
    <form class="sheet" id="searchForm" method="dialog">
      <header class="sheet-head"><h2>${esc(t('searchTitle'))}</h2><button type="button" class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
      <div class="fields">
        <label><span>${esc(t('firstName'))}</span><input name="first" autocomplete="off"></label>
        <label><span>${esc(t('lastName'))}</span><input name="last" autocomplete="off"></label>
        <label class="wide"><span>${esc(t('club'))}</span><input name="club" autocomplete="off" placeholder="${esc(t('clubPlaceholder'))}"></label>
        <label class="check"><input type="checkbox" name="active" checked> <span>${esc(t('activeOnly'))}</span></label>
        <label class="select compact"><span class="sr">${esc(t('sexFilter'))}</span><select name="sex"><option value="">${esc(t('allSexes'))}</option><option value="W">${esc(t('women'))}</option><option value="M">${esc(t('men'))}</option></select></label>
      </div>
      <button class="btn primary" type="submit" id="doSearch">${esc(t('search'))}</button>
      <div id="hits" aria-live="polite"></div>
      <div class="paste import-cta">
        <span class="muted small">${esc(t('importCta'))}</span>
        <button type="button" class="btn small" data-action="importOpen">${esc(t('importOpen'))}</button>
      </div>
      <div class="paste import-cta">
        <span class="muted small">${esc(t('meetImportCta'))}</span>
        <button type="button" class="btn small" data-action="meetImport">${esc(t('meetImportOpen'))}</button>
      </div>
      <div class="paste">
        <label><span class="muted small">${esc(t('orPaste'))}</span>
          <div class="row"><input name="link" placeholder="${esc(t('pastePlaceholder'))}" inputmode="url"><button type="button" class="btn" id="addLink">${esc(t('addBtn'))}</button></div>
        </label>
      </div>
      <footer class="sheet-foot"><span></span><button type="button" class="btn" id="addDone" data-action="close">${esc(t('done'))}</button></footer>
    </form>`;
  dlg.showModal();
  $('input[name=last]', dlg).focus();
}



// ---------------------------------------------------------------- import from a pasted list



export function openImport() {
  addState.importState = addState.importState || { entries: [], groups: [], groupBy: 'club', status: new Map(), selected: new Set(), text: '' };
  renderImport();
}

export function renderImport() {
  const dlg = $('#addDialog');
  const st = addState.importState;
  const found = st.entries.filter((e) => st.status.get(e.key)?.pick);
  dlg.innerHTML = `
    <div class="sheet import-sheet">
      <header class="sheet-head"><div><h2>${esc(t('importTitle2'))}</h2><p class="muted small">${esc(t('importHint'))}</p></div>
        <button type="button" class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>
      ${!st.entries.length ? `
        <textarea id="importText" rows="10" placeholder="${esc(t('importPlaceholder'))}">${esc(st.text)}</textarea>
        <div class="row"><button type="button" class="btn primary" data-action="importParse">${esc(t('importFind'))}</button>
          <button type="button" class="link" data-action="add">${esc(t('back'))}</button></div>
        <p class="muted small">${esc(t('importPrivacy'))}</p>`
      : `
        <div class="row wrap import-tools">
          <span class="small muted">${esc(t('importFound', { n: st.entries.length, m: found.length }))}</span>
          ${st.entries.some(selectable) ? `<button type="button" class="link small" data-action="importAll">${esc(t(st.entries.filter(selectable).every((e) => st.selected.has(e.key)) ? 'importNone' : 'importAll'))}</button>` : ''}
          <span class="spacer"></span>
          ${st.groups.length ? `<div class="seg small" role="group">${['club', 'group'].map((k) => `<button type="button" data-igroup="${k}" aria-pressed="${st.groupBy === k}">${esc(t(k === 'club' ? 'club' : 'event'))}</button>`).join('')}</div>` : ''}
        </div>
        <div class="import-list">${importGroups().map(([label, list]) => `
          <section class="igroup">
            <label class="igroup-head"><input type="checkbox" data-igroup-all="${esc(label)}" ${list.every((e) => !selectable(e) || st.selected.has(e.key)) && list.some(selectable) ? 'checked' : ''} ${list.some(selectable) ? '' : 'disabled'}>
              <b>${esc(label || t('importNoGroup'))}</b> <span class="muted small">${list.length}</span></label>
            ${list.map(importRow).join('')}
          </section>`).join('')}</div>
        ${st.entries.some((e) => e.para) ? `<label class="check small import-para"><input type="checkbox" data-iparaopt ${st.usePara !== false ? 'checked' : ''}> <span>${esc(t('importParaUse'))}</span></label>` : ''}
        <div class="row end wrap import-foot">
          <button type="button" class="link" data-action="importReset">${esc(t('importAgain'))}</button>
          ${st.usePara !== false && paraUpdates().length ? `<button type="button" class="btn" data-action="importParaUpdate">${esc(t('importParaUpdate', { n: paraUpdates().length }))}</button>` : ''}
          <button type="button" class="btn primary" data-action="importAdd" ${st.selected.size ? '' : 'disabled'}>${esc(t('importAdd', { n: st.selected.size }))}</button>
        </div>`}
    </div>`;
  if (!dlg.open) dlg.showModal();
  $('#importText')?.focus();
}

export function selectable(e) {
  const pick = addState.importState.status.get(e.key)?.pick;
  return !!pick && !state.swimmers.some((s) => s.id === pick.id);
}

export function importGroups() {
  const st = addState.importState;
  const map = new Map();
  for (const e of st.entries) {
    const labels = st.groupBy === 'group' ? (e.groups.length ? e.groups : ['']) : [e.club || ''];
    for (const l of labels) {
      if (!map.has(l)) map.set(l, []);
      map.get(l).push(e);
    }
  }
  return [...map.entries()].sort((a, b) => (st.groupBy === 'group' ? 0 : a[0].localeCompare(b[0], state.lang)));
}

export function importRow(e) {
  const st = addState.importState.status.get(e.key) || { state: 'wait' };
  const pick = st.pick;
  const inList = pick && state.swimmers.some((s) => s.id === pick.id);
  const meta = [e.born, e.club].filter(Boolean).join(' · ');
  let right;
  if (st.state === 'wait') right = `<span class="muted small">${esc(t('searching'))}</span>`;
  else if (inList) right = `<span class="muted small">${esc(t('alreadyInList'))}</span>`;
  else if (!st.candidates?.length) right = `<span class="warn small">${esc(t('importNotFound'))}</span>`;
  else if (st.candidates.length > 1 && !st.sure)
    right = `<select class="ipick" data-ipick="${esc(e.key)}"><option value="">${esc(t('importChoose'))}</option>${st.candidates.slice(0, 6).map((c) => `<option value="${c.id}" ${pick?.id === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc([c.born, c.club].filter(Boolean).join(' · '))}</option>`).join('')}</select>`;
  else right = `<span class="small ok-match">✓ ${esc([pick.born, pick.club].filter(Boolean).join(' · '))}</span>`;
  return `<label class="irow ${selectable(e) ? '' : 'off'}">
    <input type="checkbox" data-isel="${esc(e.key)}" ${addState.importState.selected.has(e.key) ? 'checked' : ''} ${selectable(e) ? '' : 'disabled'}>
    <span class="iname"><b>${esc(e.first)} ${esc(e.last)}</b>${e.para ? ` <span class="q q-paraB">${esc(Object.entries(e.para).map(([k, v]) => k + v).join(' · '))}</span>` : ''}<span class="muted small">${esc(meta)}</span></span>
    <span class="iright">${right}</span></label>`;
}

export const importCache = new Map();
export const IMPORT_PRESELECT = 15; // longer pasted lists start with nothing ticked
export async function importSearch(first, last) {
  const k = `${first}|${last}`.toLocaleLowerCase('sv');
  if (!importCache.has(k)) importCache.set(k, api('/api/search', { first, last }).then((r) => r.swimmers).catch(() => []));
  return importCache.get(k);
}

export async function runImport(text) {
  const { entries, groups } = parseList(text);
  const MAX = 80;
  addState.importState = { entries: entries.slice(0, MAX), groups, groupBy: groups.length > 1 ? 'group' : 'club', status: new Map(), selected: new Set(), text, truncated: entries.length > MAX };
  if (!entries.length) {
    toast(t('importNothing'));
    addState.importState.entries = [];
    return renderImport();
  }
  if (addState.importState.truncated) toast(t('importMax', { n: MAX }));
  renderImport();
  const queue = addState.importState.entries.slice();
  const work = async () => {
    while (queue.length) {
      const e = queue.shift();
      let list = await importSearch(e.first.split(' ')[0], e.last);
      if (!list.length) list = await importSearch('', e.last);
      const { candidates, sure } = rankCandidates(e, list);
      const pick = candidates.length && (sure || candidates.length === 1) ? candidates[0] : null;
      addState.importState.status.set(e.key, { state: 'done', candidates, sure, pick });
      if (pick && !state.swimmers.some((s) => s.id === pick.id) && addState.importState.entries.length <= IMPORT_PRESELECT) addState.importState.selected.add(e.key);
      if ($('#addDialog').open && $('.import-sheet')) renderImportKeepScroll();
    }
  };
  await Promise.all([work(), work(), work()]);
}

export function renderImportKeepScroll() {
  const box = $('.import-list');
  const top = box ? box.scrollTop : 0;
  renderImport();
  const nb = $('.import-list');
  if (nb) nb.scrollTop = top;
}

/** Para classes from a heat list, merged into a swimmer (11–14 are the same in every stroke). Only fills what is missing. */
export function mergePara(current, found) {
  // fill all three only when every class found is the same 11–14 class; mixed lists (a likely misread) stay as they are
  const vals = [...new Set(Object.values(found))];
  const add = vals.length === 1 && vals[0] >= 11 ? { S: vals[0], SB: vals[0], SM: vals[0] } : found;
  const out = { ...(current || {}) };
  for (const [k, n] of Object.entries(add)) if (!out[k]) out[k] = n;
  return out;
}

/** Swimmers already in the list whose class the pasted list would fill in. */
export function paraUpdates() {
  if (!addState.importState) return [];
  return addState.importState.entries.flatMap((e) => {
    const pick = addState.importState.status.get(e.key)?.pick;
    const sw = e.para && pick && state.swimmers.find((x) => x.id === pick.id);
    if (!sw) return [];
    const merged = mergePara(sw.para, e.para);
    return JSON.stringify(merged) !== JSON.stringify(sw.para || {}) ? [{ sw, merged }] : [];
  });
}

export function addImported() {
  const picks = addState.importState.entries.filter((e) => addState.importState.selected.has(e.key)).map((e) => addState.importState.status.get(e.key)?.pick).filter(Boolean);
  const added = [];
  const usePara = addState.importState.usePara !== false;
  const paraOf = new Map(addState.importState.entries.filter((e) => e.para).map((e) => [addState.importState.status.get(e.key)?.pick?.id, e.para]));
  for (const p of picks) {
    const sw = addSwimmer({ ...p, site: 'se' }, { load: false });
    if (sw && usePara && paraOf.get(sw.id)) sw.para = mergePara(sw.para, paraOf.get(sw.id));
    if (sw) added.push(sw);
  }
  if (usePara) for (const { sw, merged } of paraUpdates()) sw.para = merged;
  hooks.save();
  addState.importState = null;
  $('#addDialog').close();
  hooks.render();
  if (added.length) refreshAll({ only: added });
  toast(t('importDone', { n: added.length }));
}

// ---------------------------------------------------------------- import from a meet in Tempus


export const MEET_IMPORT_MAX = 80;

export function openMeetImport() {
  addState.meetImport = { step: 'pick', q: '', meets: null, busy: true, error: '', sex: '', born: '', groupBy: 'born', selected: new Set() };
  renderMeetImport();
  findMeets();
}

export async function findMeets() {
  const mi = addState.meetImport;
  mi.busy = true;
  mi.error = '';
  renderMeetImport();
  try {
    const r = await api('/api/meets', { name: mi.q });
    if (addState.meetImport !== mi) return;
    mi.meets = r.meets;
  } catch (e) {
    mi.error = errText(e.message);
  }
  mi.busy = false;
  renderMeetImport();
}

export async function pickMeet(id) {
  const mi = addState.meetImport;
  Object.assign(mi, { step: 'swimmers', meet: (mi.meets || []).find((m) => m.id === id) || { id }, clubs: null, club: '', data: null, busy: true, error: '', selected: new Set() });
  renderMeetImport();
  try {
    const head = await api(`/api/meet/${id}/swimmers`, {});
    if (addState.meetImport !== mi) return;
    mi.meet = head.meet || mi.meet;
    mi.clubs = head.clubs;
    mi.allowAll = head.allowAll;
    // start with the club most swimmers in the list belong to, when it took part
    const counts = {};
    for (const s of state.swimmers) if (s.club) counts[s.club] = (counts[s.club] || 0) + 1;
    const mine = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c]) => head.clubs.find((x) => x.name === c)).find(Boolean);
    mi.busy = false;
    if (mine) return loadMeetClub(String(mine.id));
    if (head.allowAll && !head.clubs.length) return loadMeetClub('all');
  } catch (e) {
    mi.error = errText(e.message);
    mi.busy = false;
  }
  renderMeetImport();
}

export async function loadMeetClub(club) {
  const mi = addState.meetImport;
  Object.assign(mi, { club, data: null, busy: !!club, error: '', born: '' });
  renderMeetImport();
  if (!club) return;
  try {
    const r = await api(`/api/meet/${mi.meet.id}/swimmers`, { club });
    if (addState.meetImport !== mi || mi.club !== club) return;
    mi.data = r;
  } catch (e) {
    mi.error = errText(e.message);
  }
  mi.busy = false;
  renderMeetImport();
}

export const inList = (id) => state.swimmers.some((s) => s.id === id);

export function meetImportShown() {
  const mi = addState.meetImport;
  return (mi.data?.swimmers || []).filter((s) => (!mi.sex || (mi.sex === 'W') === (s.sex === 'Woman')) && (!mi.born || String(s.born) === mi.born));
}

export function meetImportGroups() {
  const mi = addState.meetImport;
  const list = meetImportShown();
  if (mi.groupBy === 'event') {
    const map = new Map();
    for (const s of list) for (const c of s.events) {
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(s);
    }
    return [...map.entries()].sort((a, b) => a[0] % 2 - b[0] % 2 || eventSortKey(a[0]) - eventSortKey(b[0])).map(([c, l]) => [`e${c}`, `${eventLabel(c, state.lang)} · ${c % 2 ? 25 : 50} m`, l]);
  }
  const map = new Map();
  for (const s of list) {
    const k = String(s.born || '');
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return [...map.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([k, l]) => [`b${k}`, k ? t('born', { year: k }) : '–', l]);
}

export function renderMeetImport() {
  const mi = addState.meetImport;
  const dlg = $('#addDialog');
  const head = `<header class="sheet-head"><div><h2>${esc(mi.step === 'pick' ? t('meetImportTitle') : mi.meet?.name || '')}</h2>
      <p class="muted small">${esc(mi.step === 'pick' ? t('meetImportHint') : [mi.meet?.location, mi.meet?.date, mi.meet?.pool ? mi.meet.pool + ' m' : ''].filter(Boolean).join(' · '))}</p></div>
    <button type="button" class="icon" data-action="close" aria-label="${esc(t('close'))}">✕</button></header>`;
  let body;
  if (mi.step === 'pick') {
    body = `
      <form class="row" id="meetSearchForm"><input name="q" value="${esc(mi.q)}" placeholder="${esc(t('meetSearchPlaceholder'))}" autocomplete="off"><button class="btn">${esc(t('search'))}</button></form>
      ${mi.error ? `<p class="warn small">${esc(mi.error)}</p>` : ''}
      ${mi.busy ? `<p class="muted">${esc(t('loading'))}</p>` : !mi.meets?.length ? `<p class="muted">${esc(t('meetNoneFound'))}</p>` : `
        <p class="muted small">${esc(mi.q ? t('meetHits', { n: mi.meets.length }) : t('meetRecent'))}</p>
        <ul class="meet-pick">${mi.meets.map((m) => `<li><button type="button" data-mpick="${m.id}"><b>${esc(m.name)}</b><span class="muted small">${esc([m.date, m.location, m.pool ? m.pool + ' m' : ''].filter(Boolean).join(' · '))}</span></button></li>`).join('')}</ul>`}
      <div class="row"><button type="button" class="link" data-action="add">${esc(t('back'))}</button></div>`;
  } else {
    const shown = meetImportShown();
    const years = [...new Set((mi.data?.swimmers || []).map((s) => s.born).filter(Boolean))].sort((a, b) => b - a);
    const groups = mi.data ? meetImportGroups() : [];
    const free = (l) => l.filter((s) => !inList(s.id));
    body = `
      <div class="row wrap import-tools">
        <label class="select compact"><span class="sr">${esc(t('club'))}</span><select id="miClub">
          <option value="">${esc(t('meetChooseClub'))}</option>
          ${mi.allowAll ? `<option value="all" ${mi.club === 'all' ? 'selected' : ''}>${esc(t('meetAllClubs'))}</option>` : ''}
          ${(mi.clubs || []).map((c) => `<option value="${c.id}" ${String(c.id) === mi.club ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>
        ${mi.data ? `
          <div class="seg small" role="group">${[['', t('allSexes')], ['W', t('women')], ['M', t('men')]].map(([k, v]) => `<button type="button" data-misex="${k}" aria-pressed="${mi.sex === k}">${esc(v)}</button>`).join('')}</div>
          ${years.length > 1 ? `<label class="select compact"><span class="sr">${esc(t('birthYear'))}</span><select id="miBorn"><option value="">${esc(t('allYears'))}</option>${years.map((y) => `<option value="${y}" ${mi.born === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select></label>` : ''}
          <div class="seg small" role="group">${[['born', t('birthYear')], ['event', t('event')]].map(([k, v]) => `<button type="button" data-migroup="${k}" aria-pressed="${mi.groupBy === k}">${esc(v)}</button>`).join('')}</div>` : ''}
      </div>
      ${mi.error ? `<p class="warn small">${esc(mi.error)}</p>` : ''}
      ${mi.busy ? `<p class="muted">${esc(t('loading'))}</p>` : !mi.club ? `<p class="muted">${esc(mi.allowAll ? t('meetPickClubOrAll') : t('meetPickClub'))}</p>` : !mi.data ? '' : `
        <p class="muted small">${esc(t('meetSwimmersFound', { n: shown.length }))}${mi.data.complete ? '' : ' · ' + esc(t('meetPartialShort'))}</p>
        <div class="import-list">${groups.map(([key, label, list]) => `
          <section class="igroup">
            <label class="igroup-head"><input type="checkbox" data-migroup-all="${key}" ${free(list).length && free(list).every((s) => mi.selected.has(s.id)) ? 'checked' : ''} ${free(list).length ? '' : 'disabled'}>
              <b>${esc(label)}</b> <span class="muted small">${list.length}</span></label>
            ${list.map((s) => `<label class="irow ${inList(s.id) ? 'off' : ''}">
              <input type="checkbox" data-misel="${s.id}" ${mi.selected.has(s.id) ? 'checked' : ''} ${inList(s.id) ? 'disabled' : ''}>
              <span class="iname"><b>${esc(s.name)}</b><span class="muted small">${esc([s.born, s.club].filter(Boolean).join(' · '))}</span></span>
              <span class="iright small muted">${inList(s.id) ? esc(t('alreadyInList')) : esc(t('meetSwims', { n: s.events.length }))}</span></label>`).join('')}
          </section>`).join('')}</div>`}
      <div class="row end wrap import-foot">
        <button type="button" class="link" data-action="meetImportBack">${esc(t('meetOtherMeet'))}</button>
        <button type="button" class="btn primary" data-action="meetImportAdd" ${mi.selected.size ? '' : 'disabled'}>${esc(t('importAdd', { n: mi.selected.size }))}</button>
      </div>`;
  }
  const box = $('.import-list');
  const top = box ? box.scrollTop : 0;
  dlg.innerHTML = `<div class="sheet import-sheet meet-import">${head}${body}</div>`;
  if (!dlg.open) dlg.showModal();
  const nb = $('.import-list');
  if (nb) nb.scrollTop = top;
}

export function addFromMeet() {
  const mi = addState.meetImport;
  const picks = (mi.data?.swimmers || []).filter((s) => mi.selected.has(s.id) && !inList(s.id)).slice(0, MEET_IMPORT_MAX);
  if (mi.selected.size > MEET_IMPORT_MAX) toast(t('importMax', { n: MEET_IMPORT_MAX }));
  const added = picks.map((p) => addSwimmer({ id: p.id, name: p.name, born: p.born, club: p.club, sex: p.sex, site: 'se' }, { load: false })).filter(Boolean);
  addState.meetImport = null;
  $('#addDialog').close();
  hooks.render();
  if (added.length) refreshAll({ only: added });
  toast(t('importDone', { n: added.length }));
}

export async function doSearch(form, page = 1) {
  const f = new FormData(form);
  const params = {
    first: f.get('first').trim(),
    last: f.get('last').trim(),
    club: f.get('club').trim(),
    active: f.get('active') ? 1 : '',
    sex: f.get('sex') || '',
  };
  if (!params.first && !params.last && !params.club) return;
  const hits = $('#hits');
  if (page === 1) {
    addState.searchState = { params, swimmers: [], total: 0, page: 0, lastPage: 1 };
    hits.innerHTML = `<p class="muted">${esc(t('searching'))}</p>`;
  }
  try {
    const r = await api('/api/search', { ...params, page });
    addState.searchState.swimmers.push(...r.swimmers);
    Object.assign(addState.searchState, { total: r.total, page: r.page || page, lastPage: r.lastPage || 1 });
    renderHits();
  } catch (e) {
    hits.innerHTML = `<p class="warn">${esc(errText(e.message))}</p>`;
  }
}

export function renderHits() {
  const hits = $('#hits');
  if (!hits || !addState.searchState) return;
  const list = addState.searchState.swimmers;
  if (!list.length) return (hits.innerHTML = `<p class="muted">${esc(t('noHits'))}</p>`);
  const notAdded = list.filter((s) => !state.swimmers.some((x) => x.id === s.id));
  hits.innerHTML = `
    <div class="hits-head"><p class="muted small">${esc(t('hitsShown', { n: list.length, total: addState.searchState.total }))}</p>
      ${notAdded.length > 1 ? `<button type="button" class="btn small" data-action="addAll">${esc(t('addAll', { n: Math.min(notAdded.length, 30) }))}</button>` : ''}</div>
    <ul class="hits">${list.map((s) => {
      const has = state.swimmers.some((x) => x.id === s.id);
      return `<li><span><b>${esc(s.name)}</b><span class="muted small">${esc([s.born, s.club, sexLabel(s.sex)].filter(Boolean).join(' · '))}</span></span>
        <button type="button" class="btn small ${has ? '' : 'primary'}" data-add='${esc(JSON.stringify(pickSwimmer(s, 'se')))}' ${has ? 'disabled' : ''}>${esc(has ? t('added') : t('addBtn'))}</button></li>`;
    }).join('')}</ul>
    ${addState.searchState.page < addState.searchState.lastPage ? `<button type="button" class="btn small more" data-action="moreHits">${esc(t('showMore'))}</button>` : ''}`;
}

export function addSwimmer(s, { load = true } = {}) {
  if (state.swimmers.some((x) => x.id === s.id)) return null;
  state.trash = state.trash.filter((x) => x.swimmer.id !== s.id);
  const sw = { id: s.id, site: s.site || 'se', name: s.name || '', born: s.born ?? null, club: s.club || '', sex: s.sex || '' };
  state.swimmers.push(sw);
  hooks.save();
  hooks.render();
  if (load) refreshAll({ only: [sw] });
  return sw;
}

