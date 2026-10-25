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

function parseLine(line, thisYear) {
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
  const club = after.replace(/[()]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;–-]+|[\s,;–-]+$/g, '').replace(/\s\d+$/, '').trim();
  return { ...name, born, club };
}

/**
 * Parse pasted text. Returns { entries, groups } where each entry is
 * { key, first, last, born, club, groups: [heading…] } and duplicates are merged.
 */
export function parseList(text, thisYear = new Date().getFullYear()) {
  const byKey = new Map();
  const groups = [];
  let group = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (NOISE.test(line) && !YEAR.test(` ${line} `)) continue;
    if (HEADING.test(line) && !YEAR.test(` ${line} `.replace(TIME, ' '))) {
      group = line.replace(/\s+/g, ' ').slice(0, 80);
      if (!groups.includes(group)) groups.push(group);
      continue;
    }
    const e = parseLine(line, thisYear);
    if (!e) continue;
    const key = `${e.first} ${e.last}|${e.born || ''}`.toLocaleLowerCase('sv');
    const prev = byKey.get(key);
    if (prev) {
      if (group && !prev.groups.includes(group)) prev.groups.push(group);
      if (!prev.club && e.club) prev.club = e.club;
    } else {
      byKey.set(key, { key, ...e, groups: group ? [group] : [] });
    }
  }
  return { entries: [...byKey.values()], groups };
}

const norm = (s) => String(s || '').toLocaleLowerCase('sv').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

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
    if (ec && sc && (ec === sc || ec.includes(sc) || sc.includes(ec) || ec.split(' ')[0] === sc.split(' ')[0])) score += 1.5;
  }
  return score;
}

/** Best candidates for an entry, best first; `sure` when one stands clearly above the rest. */
export function rankCandidates(entry, swimmers) {
  const scored = swimmers.map((s) => ({ s, score: matchScore(entry, s) })).filter((x) => x.score >= 3.5).sort((a, b) => b.score - a.score);
  const sure = scored.length === 1 || (scored.length > 1 && scored[0].score - scored[1].score >= 2);
  return { candidates: scored.map((x) => x.s), sure: sure && scored.length > 0 };
}
