// Web Push notifications for new personal bests.
//
// - Subscriptions (browser endpoint + keys, watched swimmer ids, language) live in KV under
//   "push:<sha256(endpoint)>". Nothing else about the person is stored.
// - A scheduled run (cron) reads each watched swimmer's bests from Tempus Open, compares them with
//   the last snapshot ("snap:<id>") and sends a notification for every new personal best.
// - VAPID keys are generated on first use and kept in KV ("vapid"), so no manual setup is needed.
// - Messages are encrypted as RFC 8291 (aes128gcm) and signed with VAPID (RFC 8292), using WebCrypto.

const TTL = 400 * 24 * 60 * 60;
const MAX_SWIMMERS = 200;
const enc = new TextEncoder();

// ---------------------------------------------------------------- encoding helpers

export const b64u = {
  encode(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

async function sha256hex(text) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// ---------------------------------------------------------------- VAPID

export async function vapidKeys(kv) {
  const raw = await kv.get('vapid');
  if (raw) return JSON.parse(raw);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = b64u.encode(await crypto.subtle.exportKey('raw', pair.publicKey));
  const keys = { jwk, pub };
  await kv.put('vapid', JSON.stringify(keys));
  return keys;
}

export async function vapidHeader(endpoint, keys, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64u.encode(sig)}, k=${keys.pub}`;
}

// ---------------------------------------------------------------- RFC 8291 payload encryption

export async function encryptPayload(subscription, plaintext, { salt = crypto.getRandomValues(new Uint8Array(16)), serverKeys = null } = {}) {
  const uaPublic = b64u.decode(subscription.keys.p256dh);
  const authSecret = b64u.decode(subscription.keys.auth);
  const local = serverKeys || (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export async function sendPush(subscription, message, keys, subject, fetchImpl = fetch) {
  const body = await encryptPayload(subscription, JSON.stringify(message));
  return fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(subscription.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
}

// ---------------------------------------------------------------- subscriptions API

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function cleanSubscription(input) {
  const s = input?.subscription;
  if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) throw bad('Bad subscription');
  const p256dh = String(s.keys?.p256dh || '');
  const auth = String(s.keys?.auth || '');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) throw bad('Bad subscription keys');
  const ids = [...new Set((input.swimmers || []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 1e9))].slice(0, MAX_SWIMMERS);
  const lang = ['sv', 'en', 'fi', 'nb'].includes(input.lang) ? input.lang : 'sv';
  return { subscription: { endpoint: s.endpoint, keys: { p256dh, auth } }, swimmers: ids, lang };
}

export async function handlePush(request, env, path) {
  const kv = env.LISTS;
  if (!kv) throw bad('Push is not configured', 503);
  if (path === '/api/push/key' && request.method === 'GET') return { key: (await vapidKeys(kv)).pub };
  if (path === '/api/push' && (request.method === 'POST' || request.method === 'PUT')) {
    const sub = cleanSubscription(await readJson(request));
    await kv.put('push:' + (await sha256hex(sub.subscription.endpoint)), JSON.stringify({ ...sub, updatedAt: Date.now() }), { expirationTtl: TTL });
    return { ok: true, swimmers: sub.swimmers.length };
  }
  if (path === '/api/push/test' && request.method === 'POST') {
    // Sends a test notification to a subscription that is already stored (never to arbitrary addresses).
    const body = await readJson(request);
    if (typeof body?.endpoint !== 'string') throw bad('Missing endpoint');
    const key = 'push:' + (await sha256hex(body.endpoint));
    const raw = await kv.get(key);
    if (!raw) throw bad('Not subscribed', 404);
    const sub = JSON.parse(raw);
    if (Date.now() - (sub.testedAt || 0) < 60000) throw bad('Wait a minute between tests', 429);
    await kv.put(key, JSON.stringify({ ...sub, testedAt: Date.now() }), { expirationTtl: TTL });
    const T = { sv: ['SwimDeck', 'Testnotis: notiserna fungerar! 🏊'], en: ['SwimDeck', 'Test notification: notifications work! 🏊'], fi: ['SwimDeck', 'Testi-ilmoitus: ilmoitukset toimivat! 🏊'], nb: ['SwimDeck', 'Testvarsel: varslene fungerer! 🏊'] }[sub.lang] || ['SwimDeck', 'Test'];
    const res = await (env.__send || sendPush)(sub.subscription, { title: T[0], body: T[1], tag: 'test', url: env.APP_URL || 'https://peiza.github.io/swimdeck/' }, await vapidKeys(kv), env.APP_URL || 'https://peiza.github.io/swimdeck/');
    if (res.status === 404 || res.status === 410) {
      await kv.delete(key);
      throw bad('Subscription expired', 410);
    }
    return { sent: res.ok, status: res.status };
  }
  if (path === '/api/push' && request.method === 'DELETE') {
    const body = await readJson(request);
    if (typeof body?.endpoint !== 'string') throw bad('Missing endpoint');
    await kv.delete('push:' + (await sha256hex(body.endpoint)));
    return { deleted: true };
  }
  throw bad('Not found', 404);
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 16 * 1024) throw bad('Too large', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw bad('Invalid JSON');
  }
}

// ---------------------------------------------------------------- scheduled check

const TEXT = {
  sv: { title: 'Nytt PB: {name}', body: '{event} {pool} m: {time}', more: '{n} nya PB', bodyMore: '{list}' },
  en: { title: 'New PB: {name}', body: '{event} {pool} m: {time}', more: '{n} new PBs', bodyMore: '{list}' },
  fi: { title: 'Uusi SE: {name}', body: '{event} {pool} m: {time}', more: '{n} uutta ennätystä', bodyMore: '{list}' },
  nb: { title: 'Ny pers: {name}', body: '{event} {pool} m: {time}', more: '{n} nye pers', bodyMore: '{list}' },
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

export function fmtTime(cs) {
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  const h = cs % 100;
  return (m ? `${m}:${String(s).padStart(2, '0')}` : String(s)) + '.' + String(h).padStart(2, '0');
}

/** New personal bests compared with a snapshot { "pool:event": time }. 25 m events are skipped. */
export function diffBests(snapshot, bests) {
  const out = [];
  for (const b of bests || []) {
    const k = `${b.pool}:${b.event}`;
    const was = snapshot?.[k];
    if (was != null && b.time < was && !(b.event >= 4 && b.event <= 7)) out.push(b);
  }
  return out;
}

export const snapshotOf = (bests) => Object.fromEntries((bests || []).map((b) => [`${b.pool}:${b.event}`, b.time]));

export function messageFor(swimmer, news, lang) {
  const T = TEXT[lang] || TEXT.sv;
  const name = swimmer?.name || '';
  if (news.length === 1) {
    const b = news[0];
    return { title: fill(T.title, { name }), body: fill(T.body, { event: b.name, pool: b.pool, time: fmtTime(b.time) }), tag: `pb-${swimmer.id}` };
  }
  return {
    title: fill(T.title, { name }),
    body: news.slice(0, 4).map((b) => `${b.name} ${b.pool} m: ${fmtTime(b.time)}`).join('\n') + (news.length > 4 ? '\n…' : ''),
    tag: `pb-${swimmer.id}`,
  };
}

/**
 * The cron job. `fetchBests(id)` returns { swimmer, bests } for a Tempus swimmer id.
 * Returns a small report for logging and tests.
 */
export async function runCheck(env, fetchBests, { appUrl, send = sendPush, maxSwimmers = 150 } = {}) {
  const kv = env.LISTS;
  const subs = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: 'push:', cursor });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (raw) subs.push({ key: k.name, ...JSON.parse(raw) });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const watched = [...new Set(subs.flatMap((s) => s.swimmers))].slice(0, maxSwimmers);
  if (!watched.length) return { subs: subs.length, swimmers: 0, news: 0, sent: 0 };

  const news = new Map(); // id -> { swimmer, news }
  for (const id of watched) {
    let data;
    try {
      data = await fetchBests(id);
    } catch {
      continue;
    }
    const raw = await kv.get('snap:' + id);
    const snap = raw ? JSON.parse(raw) : null;
    const next = snapshotOf(data.bests);
    if (snap) {
      const fresh = diffBests(snap, data.bests);
      if (fresh.length) news.set(id, { swimmer: data.swimmer || { id }, news: fresh });
    }
    if (!snap || JSON.stringify(snap) !== JSON.stringify(next)) await kv.put('snap:' + id, JSON.stringify(next), { expirationTtl: TTL });
  }

  let sent = 0;
  if (news.size) {
    const keys = await vapidKeys(kv);
    for (const sub of subs) {
      for (const id of sub.swimmers) {
        const n = news.get(id);
        if (!n) continue;
        const msg = { ...messageFor({ ...n.swimmer, id }, n.news, sub.lang), url: appUrl };
        try {
          const res = await send(sub.subscription, msg, keys, appUrl);
          if (res.status === 404 || res.status === 410) {
            await kv.delete(sub.key);
            break;
          }
          if (res.ok) sent++;
        } catch {}
      }
    }
  }
  return { subs: subs.length, swimmers: watched.length, news: news.size, sent };
}
