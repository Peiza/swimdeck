// Parse a pasted start list or result list into swimmer entries.
//
// Works on plain text copied from Swimify, PDFs, Excel or e-mail. Each swimmer line is expected to
// contain a name and usually a birth year and a club, in any of these common layouts:
//   "4  ANDERSSON Anna        2012  Örebro Simallians   1:05.23"
//   "Andersson, Anna (2012) Örebro Simallians"
//   "Anna Andersson\t12\tÖrebro Simallians"
// Lines that look like event headings ("Gren 3 – 100m frisim flickor", "Event 12 Women 50m Free")
// become the group label for the swimmers that follow.

const YEAR = /(?:^|[\s(,;\t])((?:19|20)\d{2})(?=$|[\s),;\t])/;
const SHORT_YEAR = /(?:^|[\s\t])(\d{2})(?=[\s\t])/; // "12" as birth year in some lists
const TIME = /\b\d{1,2}[:.]\d{2}[.,]\d{2}\b|\b\d{2}[.,]\d{2}\b|\bNT\b|\bDNS\b|\bDSQ\b|\bDQ\b/gi;
const HEADING = /^(gren|event|lopp|øvelse|laji)\s*\d|\b\d{2,4}\s?m\b.*\b(fri|rygg|bröst|fjäril|medley|free|back|breast|fly|butterfly|im|vapaa|selkä|rinta|perho|seka)/i;
const NOISE = /^(bana|lane|heat|försök|final|pos|plac|place|rank|namn|name|klubb|club|född|born|tid|time|anm|entry|seed|erä)\b/i;
const NAME_WORD = /^[\p{L}][\p{L}'’.-]*$/u;

const cap = (w) => w.charAt(0).toLocaleUpperCase('sv') + w.slice(1).toLocaleLowerCase('sv');
const isUpperWord = (w) => w.length > 1 && w === w.toLocaleUpperCase('sv') && /\p{L}/u.test(w);

/** Split "ANDERSSON Anna", "Andersson, Anna" or "Anna Andersson" into first and last name. */
export function splitName(raw) {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.includes(',')) {
    const [last, first] = text.split(',').map((s) => s.trim());
    if (last && first) return { first, last };
  }
  const words = text.split(' ').filter(Boolean);
  if (words.length < 2 || !words.every((w) => NAME_WORD.test(w))) return null;
  // Surname written in capitals first (common in result systems): "VON ESSEN Anna Maria"
  const upper = [];
  for (const w of words) {
    if (isUpperWord(w)) upper.push(w);
    else break;
  }
  if (upper.length && upper.length < words.length) {
    return { first: words.slice(upper.length).join(' '), last: upper.map(cap).join(' ') };
  }
  return { first: words.slice(0, -1).join(' '), last: words[words.length - 1] };
}

// Para sport classes printed next to the name in para heat and result lists: "S14", "SB9", "SM10", "S9/SB8/SM9"
const PARA = /(?:^|[\s,/(])(S|SB|SM)([1-9]\d?)(?=$|[\s,/)])/g;
// Record lines at the top of each event in heat lists: "SWE 4:27.80 Name 1994 Club (SWE) 2021-12-03"
const RECORD_LINE = /^[A-Z]{3}\s+(\d{1,2}:)?\d{2}[.,]\d{2}\b/;

/** { S: 9, SB: 8 } from the class tokens in a line, or null. */
export function paraFrom(text) {
  const out = {};
  for (const m of String(text).matchAll(PARA)) {
    const n = Number(m[2]);
    if (n >= 1 && n <= 14 && !(m[1] === 'SB' && n === 10)) out[m[1]] = n;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Club names in heat lists are followed by remark codes ("Kungsbacka Simsällskap 2, 4, 12, A, 1,",
 * "Osby Simsällskap L A", "Simklubben Elfsborg +", "Simklubben S02"). Drop trailing tokens that are
 * numbers, single letters, + or short codes, so one club is one club.
 */
export function cleanClub(text) {
  let words = String(text).replace(/[()]/g, ' ').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const code = (w) => /^(\d{1,3}|\p{Lu}|[+*#]|[A-ZÅÄÖ]\d{1,3}|[A-ZÅÄÖ]{1,2}\d{2})$/u.test(w);
  while (words.length > 1 && code(words[words.length - 1])) words.pop();
  return words.join(' ').replace(/^[–-]+|[–-]+$/g, '').trim();
}

function parseLine(line, thisYear) {
  const para = paraFrom(line);
  if (para) line = line.replace(PARA, ' ');
  let rest = ` ${line.replace(TIME, ' ')} `;
  let born = null;
  let m = rest.match(YEAR);
  if (m) {
    born = Number(m[1]);
    if (born > thisYear || born < thisYear - 100) born = null;
  }
  let before;
  let after;
  if (m && born) {
    before = rest.slice(0, m.index + m[0].indexOf(m[1]));
    after = rest.slice(m.index + m[0].indexOf(m[1]) + 4);
  } else if ((m = rest.match(SHORT_YEAR)) && rest.includes('\t')) {
    born = 2000 + Number(m[1]);
    if (born > thisYear) born -= 100;
    before = rest.slice(0, m.index);
    after = rest.slice(m.index + m[0].length);
  } else {
    // No year: "Name<TAB>Club" or "Name – Club"
    const parts = rest.split(/\t+| [–-] | {3,}/).map((s) => s.trim()).filter(Boolean);
    before = parts[0] || '';
    after = parts.slice(1).join(' ');
  }
  // Drop leading lane/place numbers and punctuation from the name part.
  before = before.replace(/^[\s\d.):#-]+/, '').replace(/[()]/g, ' ').trim();
  before = before.split(/\t| {3,}/)[0].trim();
  const name = splitName(before);
  if (!name) return null;
  const club = cleanClub(after);
  return { ...name, born, club, ...(para ? { para } : {}) };
}

// Relay events ("4x50m Medley", "4 x 100 m frisim") list teams, not swimmers
const RELAY = /\b\d\s*[x×]\s*\d{2,3}\s*m?\b|lagkapp|relay|viesti|stafett/i;
// A "name" that is really a club ("Spårvägen Simförening")
const CLUB_WORD = /\b(sim\w*|simförening|simsällskap|simklubb\w*|simallians|sällskap|förening|parasport\w*|SK|SS|SLS|ASS|IF|IK)\b/i;
const JUNK = /^flag\b|\blogo$|^(image|bild)\b/i;
const ONLY_YEAR = /^(?:19|20)\d{2}$/;
const ONLY_NUM_OR_TIME = /^(\d{1,3}\.?|\d{1,2}[:.]\d{2}[.,]\d{2}|\d{2}[.,]\d{2}|NT|DNS|DSQ|DQ|DNF)$/i;
// "SelmaWalterdahl" – first and last name run together where the page used separate elements
const RUN_TOGETHER = /^(\p{Lu}[\p{Ll}'’-]+)(\p{Lu}.*)$/u;

/**
 * Some pages (Swimify among them) copy as one value per line:
 *   7 / SelmaWalterdahl / 2011 / Örebro Simallians / 2:45.59
 * Rebuild one line per swimmer: "Walterdahl, Selma 2011 Örebro Simallians".
 */
export function joinVertical(lines) {
  const clean = lines.map((l) => l.trim()).filter((l) => l && !JUNK.test(l));
  const years = clean.filter((l) => ONLY_YEAR.test(l)).length;
  if (years < 2 || years < clean.length / 8) return clean;
  const out = [];
  const used = new Set();
  clean.forEach((l, i) => {
    if (!ONLY_YEAR.test(l)) return;
    const name = clean[i - 1];
    if (!name || ONLY_NUM_OR_TIME.test(name) || ONLY_YEAR.test(name) || HEADING.test(name)) return;
    const next = clean[i + 1];
    const club = next && !ONLY_NUM_OR_TIME.test(next) && !ONLY_YEAR.test(next) && !HEADING.test(next) ? next : '';
    const m = name.match(RUN_TOGETHER);
    const who = m && !/\s/.test(m[1]) ? `${m[2].trim()}, ${m[1]}` : name;
    out.push(`${who} ${l} ${club}`.trim());
    used.add(i - 1).add(i);
    if (club) used.add(i + 1);
  });
  // keep event headings in place for grouping
  const merged = [];
  let k = 0;
  clean.forEach((l, i) => {
    if (ONLY_YEAR.test(l) && used.has(i)) merged.push(out[k++]);
    else if (!used.has(i) && HEADING.test(l)) merged.push(l); // other leftovers (club banners etc.) are dropped
  });
  return merged;
}

/**
 * Parse pasted text. Returns { entries, groups } where each entry is
 * { key, first, last, born, club, groups: [heading…] } and duplicates are merged.
 */
export function parseList(text, thisYear = new Date().getFullYear()) {
  const byKey = new Map();
  const groups = [];
  let group = '';
  let relay = false;
  for (const raw of joinVertical(String(text || '').split(/\r?\n/))) {
    const line = raw.trim();
    if (!line || JUNK.test(line)) continue;
    if (NOISE.test(line) && !YEAR.test(` ${line} `)) continue;
    if (RECORD_LINE.test(line)) continue;
    if (HEADING.test(line) && !YEAR.test(` ${line} `.replace(TIME, ' '))) {
      group = line.replace(/\s+/g, ' ').slice(0, 80);
      relay = RELAY.test(group);
      if (!groups.includes(group)) groups.push(group);
      continue;
    }
    if (relay) continue; // relay teams are clubs, not swimmers
    const e = parseLine(line, thisYear);
    if (!e || CLUB_WORD.test(`${e.first} ${e.last}`)) continue;
    const key = `${e.first} ${e.last}|${e.born || ''}`.toLocaleLowerCase('sv');
    const prev = byKey.get(key);
    if (prev) {
      if (group && !prev.groups.includes(group)) prev.groups.push(group);
      if (!prev.club && e.club) prev.club = e.club;
      if (e.para) prev.para = { ...(prev.para || {}), ...e.para };
    } else {
      byKey.set(key, { key, ...e, groups: group ? [group] : [] });
    }
  }
  return { entries: [...byKey.values()], groups };
}

const norm = (s) => String(s || '').toLocaleLowerCase('sv').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Words that say "swimming club" rather than which club: "Simklubben Lödde" and "Simklubben Vänersborg" differ
const GENERIC = new Set(['simklubben', 'simklubb', 'simsallskap', 'simforening', 'simallians', 'sallskap', 'forening', 'klubb', 'sk', 'ss', 'sls', 'ass', 'if', 'ik', 'sf', 'simning', 'swim', 'swimming', 'club', 'team', 'parasportforening']);
function sameClub(a, b) {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const wa = a.split(' ').filter((w) => !GENERIC.has(w));
  const wb = new Set(b.split(' ').filter((w) => !GENERIC.has(w)));
  return wa.some((w) => wb.has(w));
}

/** Score how well a Tempus swimmer matches a parsed entry (higher is better, < 2 is not a match). */
export function matchScore(entry, sw) {
  let score = 0;
  const [ef, el] = [norm(entry.first), norm(entry.last)];
  const [sf, sl] = [norm(sw.firstName || sw.name?.split(' ')[0]), norm(sw.lastName || sw.name?.split(' ').slice(1).join(' '))];
  if (sl === el) score += 2;
  else if (sl.includes(el) || el.includes(sl)) score += 1;
  else return 0;
  if (sf === ef) score += 2;
  else if (sf.split(' ')[0] === ef.split(' ')[0]) score += 1.5;
  else if (sf.startsWith(ef) || ef.startsWith(sf)) score += 1;
  if (entry.born && sw.born) score += entry.born === sw.born ? 2 : -3;
  if (entry.club && sw.club) {
    const [ec, sc] = [norm(entry.club), norm(sw.club)];
    // a matching club counts for, a different one against: it tells namesakes born the same year apart
    if (ec && sc) score += sameClub(ec, sc) ? 1.5 : -1.5;
  }
  return score;
}

/** Best candidates for an entry, best first; `sure` when one stands clearly above the rest. */
export function rankCandidates(entry, swimmers) {
  const scored = swimmers.map((s) => ({ s, score: matchScore(entry, s) })).filter((x) => x.score >= 3.5).sort((a, b) => b.score - a.score);
  const sure = scored.length === 1 || (scored.length > 1 && scored[0].score - scored[1].score >= 2);
  return { candidates: scored.map((x) => x.s), sure: sure && scored.length > 0 };
}
