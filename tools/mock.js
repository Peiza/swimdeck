// Invented swimmers and results for offline development. Same JSON shape as the real API.

const NAMES = [
  ['Alva', 'Strand', 'Woman'], ['Elis', 'Bergvik', 'Man'], ['Saga', 'Lindqvist', 'Woman'], ['Noah', 'Ekberg', 'Man'],
  ['Ines', 'Holmén', 'Woman'], ['Leo', 'Sjöberg', 'Man'], ['Mira', 'Dahl', 'Woman'], ['Otto', 'Nyström', 'Man'],
  ['Ella', 'Vik', 'Woman'], ['Hugo', 'Falk', 'Man'], ['Juni', 'Ahlgren', 'Woman'], ['Malte', 'Rask', 'Man'],
];
const CLUBS = ['Exempelstadens SS', 'Simklubben Vågen', 'Havsörnarna SK'];

// event code -> base time in hundredths for a strong 15-year-old
const EVENTS = {
  11: 2700, 13: 5900, 15: 13000, 17: 27500, 31: 3400, 33: 7400, 41: 3100, 43: 6600, 51: 2900, 53: 6400, 61: 6700, 63: 14500,
  12: 2780, 14: 6050, 16: 13300, 34: 7600, 44: 6800, 52: 3000, 54: 6600, 64: 14900,
};
const NAMES_EN = { free: 'Freestyle', breast: 'Breaststroke', back: 'Backstroke', fly: 'Butterfly', medley: 'Medley' };
const STROKE = (c) => ({ 1: 'free', 3: 'breast', 4: 'back', 5: 'fly', 6: 'medley' })[String(c).length === 2 ? Math.floor(c / 10) : 1];
const DIST = { 11: 50, 12: 50, 13: 100, 14: 100, 15: 200, 16: 200, 17: 400, 31: 50, 33: 100, 34: 100, 41: 50, 43: 100, 44: 100, 51: 50, 52: 50, 53: 100, 54: 100, 61: 100, 63: 200, 64: 200 };
const MEETS = ['Höstsimiaden', 'Vintercupen', 'Distriktsmästerskapen', 'Vårsimmet', 'Sommarspelen', 'Klubbmästerskapen'];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const fmt = (cs) => {
  const m = Math.floor(cs / 6000), s = Math.floor(cs / 100) % 60, h = cs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(h).padStart(2, '0')}`;
};

function swimmer(id) {
  const i = (id - 5000) % NAMES.length;
  const [first, last, sex] = NAMES[Math.abs(i)];
  return { id, name: `${first} ${last}`, firstName: first, lastName: last, born: 2008 + (id % 6), club: CLUBS[id % 3], sex };
}

function results(id, code) {
  const r = rng(id * 1000 + code);
  if (r() < 0.25 && ![11, 13, 51].includes(code)) return [];
  // one fast swimmer so qualifying badges show up in development
  const base = EVENTS[code] * (id === 5001 ? 0.86 : 1 + (id % 7) * 0.025 + (swimmer(id).sex === 'Woman' ? 0.08 : 0));
  const n = 3 + Math.floor(r() * 25);
  const out = [];
  for (let k = 0; k < n; k++) {
    const daysAgo = Math.floor(r() * 365 * 5);
    const date = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    const ageFactor = 1 + daysAgo / 365 * 0.035; // faster over time
    const time = Math.round(base * ageFactor * (1 + (r() - 0.3) * 0.04));
    out.push({
      id: id * 100000 + code * 100 + k, event: code, name: `${DIST[code]}m ${NAMES_EN[STROKE(code)]}`,
      pool: code % 2 ? 25 : 50, time, display: fmt(time), date, meet: `${MEETS[Math.floor(r() * MEETS.length)]} ${date.slice(0, 4)}`,
      round: r() < 0.6 ? 'Final' : 'Heat', points: Math.round(800 * (EVENTS[code] / time) ** 3), club: swimmer(id).club,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

const delay = () => new Promise((r) => setTimeout(r, 150 + Math.random() * 300));

export const mockApi = {
  async search(_base, q) {
    await delay();
    const needle = [q.get('first'), q.get('last'), q.get('club')].filter(Boolean).join(' ').toLowerCase();
    let all = NAMES.map((_, i) => swimmer(5000 + i));
    const sex = q.get('sex');
    if (sex) all = all.filter((s) => (sex === 'W') === (s.sex === 'Woman'));
    const hits = all.filter((s) => `${s.name} ${s.club}`.toLowerCase().includes(needle.split(' ')[0] || ''));
    const per = 5;
    const page = Number(q.get('page') || 1);
    return { total: hits.length, page, lastPage: Math.max(1, Math.ceil(hits.length / per)), swimmers: hits.slice((page - 1) * per, page * per) };
  },
  async swimmer(_base, id, q) {
    await delay();
    id = Number(id);
    if (!(id >= 5000 && id < 5000 + NAMES.length)) throw Object.assign(new Error('Not found'), { status: 404 });
    const from = q.get('from') || '0000';
    const to = q.get('to') || '9999';
    const bests = Object.keys(EVENTS)
      .map((c) => results(id, Number(c)).filter((r) => r.date >= from && r.date <= to)[0])
      .filter(Boolean);
    return { swimmer: swimmer(id), from: q.get('from'), to: q.get('to'), bests };
  },
  async rank(_base, q) {
    await delay();
    const born = Number(q.get('born'));
    if (Number(q.get('to').slice(0, 4)) - born < 13) return { available: false, reason: 'age' };
    const time = Number(q.get('time'));
    const rank = 1 + (Math.round(time / 7) % 140);
    return { available: true, rank, complete: rank < 120, leader: Math.round(time * 0.9), scanned: 300, totalAllAges: 2400 };
  },
  async meets(_base, q) {
    await delay();
    const name = (q.get('name') || '').toLowerCase();
    const all = MEETS.map((m, i) => ({ id: 100 + i, name: `${m} 2026`, location: 'Exempelstaden', organizer: CLUBS[i % 3], date: `2026-${String(10 - i).padStart(2, '0')}-12`, pool: i % 2 ? 50 : 25 }));
    return { meets: all.filter((m) => m.name.toLowerCase().includes(name)), page: 1, lastPage: 1 };
  },
  async meetSwimmers(_base, id, q) {
    await delay();
    const meet = { id: Number(id), name: 'Höstsimiaden 2026', location: 'Exempelstaden', date: '2026-10-12', pool: 25 };
    const clubs = CLUBS.map((name, i) => ({ id: i + 1, name }));
    const club = q.get('club');
    if (!club) return { meet, clubs, total: 300, allowAll: true };
    const pick = club === 'all' ? null : CLUBS[Number(club) - 1];
    const swimmers = NAMES.map((_, i) => swimmer(5000 + i)).filter((s) => !pick || s.club === pick).map((s) => ({ id: s.id, name: s.name, born: s.born, club: s.club, sex: s.sex, events: [11, 13, 31, 51].filter((c, k) => (s.id + k) % 3) }));
    return { meet, clubs, total: 300, allowAll: true, club, complete: true, swimmers };
  },
  async meet(_base, q) {
    await delay();
    const code = Number(q.get('code'));
    const name = q.get('name') || '';
    const date = q.get('date') || '';
    const sex = q.get('sex') || '';
    if (!EVENTS[code]) throw Object.assign(new Error('Unknown event'), { status: 400 });
    const rows = [];
    for (let i = 0; i < NAMES.length; i++) {
      const sw = swimmer(5000 + i);
      if (sex && (sex === 'W') !== (sw.sex === 'Woman')) continue;
      for (const r of results(sw.id, code)) if (r.meet === name && r.date === date) rows.push({ swimmerId: sw.id, swimmer: sw.name, born: sw.born, club: sw.club, event: code, time: r.time, date, round: r.round, points: r.points });
    }
    const r = rng(code * 7 + name.length);
    const ref = rows[0]?.time || EVENTS[code] * 1.1;
    for (let k = 0; k < 14; k++) {
      const time = Math.round(ref * (0.94 + r() * 0.16));
      rows.push({ swimmerId: 90000 + k, swimmer: `Simmare ${String.fromCharCode(65 + k)}`, born: 2008 + Math.floor(r() * 6), club: CLUBS[k % 3], event: code, time, date, round: rows[0]?.round || 'Final', points: Math.round(800 * (EVENTS[code] / time) ** 3) });
    }
    // a heat for everyone and a final for the eight fastest
    const heats = rows.map((x) => ({ ...x, round: 'Heat' }));
    const finals = [...heats].sort((a, b) => a.time - b.time).slice(0, 8).map((x, k) => ({ ...x, round: 'Final', time: Math.round(x.time * (0.985 + ((k * 37) % 30) / 1000)) }));
    const { placeRows, overallRows } = await import('../worker/src/tempus.js');
    const placed = placeRows([...finals, ...heats]);
    return { meet: { id: 1, name, location: 'Exempelstaden', date, pool: code % 2 ? 25 : 50 }, code, sex, events: [], total: rows.length * 2, complete: true, results: placed, overall: overallRows(placed), ambiguous: false };
  },
  async event(_base, id, code) {
    await delay();
    id = Number(id);
    code = Number(code);
    return { swimmer: swimmer(id), event: { code, name: '' }, pool: code % 2 ? 25 : 50, results: results(id, code) };
  },
};
