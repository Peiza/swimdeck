import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64u, vapidKeys, vapidHeader, encryptPayload, cleanSubscription, handlePush, diffBests, snapshotOf, messageFor, runCheck, fmtTime } from '../src/push.js';

function memoryKv() {
  const store = new Map();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
    list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

// A browser-side subscription with real keys, so we can decrypt what the server sends.
async function fakeBrowser() {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = b64u.encode(await crypto.subtle.exportKey('raw', ua.publicKey));
  return { ua, auth, subscription: { endpoint: 'https://push.example.net/send/abc', keys: { p256dh, auth: b64u.encode(auth) } } };
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// RFC 8291 decryption, as the browser does it.
async function decrypt(body, browser) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', browser.ua.publicKey));
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, browser.ua.privateKey, 256));
  const te = new TextEncoder();
  const ikm = await hkdf(browser.auth, ecdh, new Uint8Array([...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic]), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
  assert.equal(plain.at(-1), 2); // last-record delimiter
  return { rs, text: new TextDecoder().decode(plain.slice(0, -1)) };
}

test('payload encryption follows RFC 8291 and round-trips', async () => {
  const browser = await fakeBrowser();
  const body = await encryptPayload(browser.subscription, '{"title":"Nytt PB"}');
  const { rs, text } = await decrypt(body, browser);
  assert.equal(rs, 4096);
  assert.equal(text, '{"title":"Nytt PB"}');
});

test('VAPID keys are created once and the JWT verifies', async () => {
  const kv = memoryKv();
  const keys = await vapidKeys(kv);
  assert.deepEqual(await vapidKeys(kv), keys);
  assert.equal(b64u.decode(keys.pub).length, 65);
  const h = await vapidHeader('https://push.example.net/send/abc', keys, 'https://app.example/', Date.UTC(2026, 9, 25));
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.pub);
  const [hd, pl, sig] = jwt.split('.');
  const payload = JSON.parse(new TextDecoder().decode(b64u.decode(pl)));
  assert.equal(payload.aud, 'https://push.example.net');
  assert.equal(payload.sub, 'https://app.example/');
  const pub = await crypto.subtle.importKey('raw', b64u.decode(keys.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64u.decode(sig), new TextEncoder().encode(`${hd}.${pl}`)));
});

test('subscriptions are validated, stored hashed and can be removed', async () => {
  const kv = memoryKv();
  const env = { LISTS: kv };
  const browser = await fakeBrowser();
  const req = (method, body) => new Request('https://api.example/api/push', { method, body: JSON.stringify(body) });
  assert.throws(() => cleanSubscription({ subscription: { endpoint: 'http://x' } }), /Bad subscription/);
  const r = await handlePush(req('POST', { subscription: browser.subscription, swimmers: [1, 2, 2, 'x'], lang: 'en' }), env, '/api/push');
  assert.equal(r.swimmers, 2);
  const keys = [...kv.store.keys()].filter((k) => k.startsWith('push:'));
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes('push.example'));
  assert.match((await handlePush(new Request('https://api.example/api/push/key'), env, '/api/push/key')).key, /^[A-Za-z0-9_-]{87}$/);
  await handlePush(req('DELETE', { endpoint: browser.subscription.endpoint }), env, '/api/push');
  assert.equal([...kv.store.keys()].filter((k) => k.startsWith('push:')).length, 0);
});

test('new bests are found against the snapshot, 25 m events ignored', () => {
  const snap = snapshotOf([{ pool: 25, event: 13, time: 6000 }, { pool: 25, event: 4, time: 1300 }, { pool: 50, event: 12, time: 3000 }]);
  const fresh = diffBests(snap, [{ pool: 25, event: 13, time: 5950, name: '100m Freestyle' }, { pool: 25, event: 4, time: 1200, name: '25m Freestyle' }, { pool: 50, event: 12, time: 3000 }, { pool: 25, event: 41, time: 3500 }]);
  assert.deepEqual(fresh.map((b) => b.event), [13]);
  assert.equal(fmtTime(5950), '59.50');
  assert.equal(fmtTime(6550), '1:05.50');
  const m = messageFor({ id: 7, name: 'Anna A' }, fresh, 'sv');
  assert.equal(m.title, 'Nytt PB: Anna A');
  assert.equal(m.body, '100m Freestyle 25 m: 59.50');
});

test('the scheduled check snapshots first, then notifies watchers and drops dead subscriptions', async () => {
  const kv = memoryKv();
  const env = { LISTS: kv };
  const a = await fakeBrowser();
  const b = await fakeBrowser();
  b.subscription.endpoint = 'https://push.example.net/send/gone';
  await handlePush(new Request('https://x/api/push', { method: 'POST', body: JSON.stringify({ subscription: a.subscription, swimmers: [1, 2] }) }), env, '/api/push');
  await handlePush(new Request('https://x/api/push', { method: 'POST', body: JSON.stringify({ subscription: b.subscription, swimmers: [1] }) }), env, '/api/push');
  let times = { 1: 6000, 2: 3000 };
  const fetchBests = async (id) => ({ swimmer: { id, name: 'Swimmer ' + id }, bests: [{ pool: 25, event: 13, time: times[id], name: '100m Freestyle' }] });
  const sent = [];
  const send = async (sub, msg) => {
    sent.push({ to: sub.endpoint, msg });
    return { ok: !sub.endpoint.endsWith('gone'), status: sub.endpoint.endsWith('gone') ? 410 : 201 };
  };
  let r = await runCheck(env, fetchBests, { appUrl: 'https://app.example/', send });
  assert.deepEqual(r, { subs: 2, swimmers: 2, news: 0, sent: 0 }); // first run only snapshots
  times = { 1: 5900, 2: 3000 };
  r = await runCheck(env, fetchBests, { appUrl: 'https://app.example/', send });
  assert.equal(r.news, 1);
  assert.equal(r.sent, 1);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].msg.title, 'Nytt PB: Swimmer 1');
  assert.equal(sent[0].msg.url, 'https://app.example/');
  // the 410 subscription was removed
  assert.equal([...kv.store.keys()].filter((k) => k.startsWith('push:')).length, 1);
  r = await runCheck(env, fetchBests, { appUrl: 'https://app.example/', send });
  assert.equal(r.news, 0);
});

test('test notifications go only to stored subscriptions, at most once a minute', async () => {
  const kv = memoryKv();
  const sent = [];
  const env = { LISTS: kv, __send: async (sub, msg) => (sent.push({ sub, msg }), { ok: true, status: 201 }) };
  const a = await fakeBrowser();
  const req = (path, body) => new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) });
  await assert.rejects(handlePush(req('/api/push/test', { endpoint: a.subscription.endpoint }), env, '/api/push/test'), (e) => e.status === 404);
  await handlePush(req('/api/push', { subscription: a.subscription, swimmers: [1], lang: 'sv' }), env, '/api/push');
  const r = await handlePush(req('/api/push/test', { endpoint: a.subscription.endpoint }), env, '/api/push/test');
  assert.equal(r.sent, true);
  assert.match(sent[0].msg.body, /Testnotis/);
  await assert.rejects(handlePush(req('/api/push/test', { endpoint: a.subscription.endpoint }), env, '/api/push/test'), (e) => e.status === 429);
});
