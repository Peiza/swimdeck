// Sync a swimmer list between devices, without accounts.
//
// A list is identified by a random secret token (in the sync link). The KV key is the SHA-256
// of the token, so the stored keys alone cannot be used to read or change a list.
// Only what is needed to rebuild the list is stored: Tempus ids, site, order, para class and goals.

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const TTL = 400 * 24 * 60 * 60; // a list not written for ~13 months expires
const MAX_SWIMMERS = 200;

export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function keyFor(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return 'list:' + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/** Keep only well-formed fields; anything else is dropped. */
export function cleanList(input) {
  if (!input || !Array.isArray(input.swimmers)) throw bad('Missing swimmers');
  if (input.swimmers.length > MAX_SWIMMERS) throw bad('Too many swimmers');
  const seen = new Set();
  const swimmers = [];
  for (const s of input.swimmers) {
    const id = Number(s?.id);
    if (!Number.isInteger(id) || id <= 0 || id > 1e9 || seen.has(id)) continue;
    seen.add(id);
    const out = { id, site: s.site === 'fi' ? 'fi' : 'se' };
    if (s.para && typeof s.para === 'object') {
      const para = {};
      for (const k of ['S', 'SB', 'SM']) {
        const v = Number(s.para[k]);
        if (Number.isInteger(v) && v >= 1 && v <= 14) para[k] = v;
      }
      if (Object.keys(para).length) out.para = para;
    }
    if (s.goals && typeof s.goals === 'object') {
      const goals = {};
      for (const [k, v] of Object.entries(s.goals).slice(0, 60)) {
        const code = Number(k);
        const time = Number(v);
        if (Number.isInteger(code) && code >= 1 && code <= 99 && Number.isInteger(time) && time >= 100 && time <= 1e7) goals[code] = time;
      }
      if (Object.keys(goals).length) out.goals = goals;
    }
    swimmers.push(out);
  }
  return { swimmers };
}

export async function handleSync(request, env, path) {
  const kv = env.LISTS;
  if (!kv) throw bad('Sync is not configured', 503);
  if (path === '/api/sync' && request.method === 'POST') {
    const body = await readJson(request);
    const list = cleanList(body);
    const token = newToken();
    const updatedAt = Date.now();
    await kv.put(await keyFor(token), JSON.stringify({ ...list, updatedAt }), { expirationTtl: TTL });
    return { token, updatedAt };
  }
  const m = path.match(/^\/api\/sync\/([^/]+)$/);
  if (!m || !TOKEN.test(m[1])) throw bad('Not found', 404);
  const key = await keyFor(m[1]);
  if (request.method === 'GET') {
    const raw = await kv.get(key);
    if (!raw) throw bad('Not found', 404);
    return JSON.parse(raw);
  }
  if (request.method === 'PUT') {
    const raw = await kv.get(key);
    if (!raw) throw bad('Not found', 404);
    const list = cleanList(await readJson(request));
    const updatedAt = Date.now();
    await kv.put(key, JSON.stringify({ ...list, updatedAt }), { expirationTtl: TTL });
    return { updatedAt };
  }
  if (request.method === 'DELETE') {
    await kv.delete(key);
    return { deleted: true };
  }
  throw bad('Method not allowed', 405);
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 32 * 1024) throw bad('Too large', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw bad('Invalid JSON');
  }
}
