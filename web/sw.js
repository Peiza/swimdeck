// SwimDeck service worker: keeps the app itself available offline.
// Network first for the app's own files, falling back to the last cached copy.
// API calls (another origin) are not cached here; the app keeps its data in localStorage.
const CACHE = 'swimdeck-app-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

// Keep one copy per file: the ?v= cache-busting suffix changes every deploy.
async function store(request, response) {
  const cache = await caches.open(CACHE);
  const path = new URL(request.url).pathname;
  for (const old of await cache.keys()) {
    if (new URL(old.url).pathname === path) await cache.delete(old);
  }
  await cache.put(request, response);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(store(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('./index.html', { ignoreSearch: true }) : Response.error()))),
  );
});

// Push notifications for new personal bests (sent by the SwimDeck API).
self.addEventListener('push', (e) => {
  let msg = {};
  try {
    msg = e.data ? e.data.json() : {};
  } catch {
    msg = { title: 'SwimDeck', body: e.data?.text() || '' };
  }
  e.waitUntil(
    self.registration.showNotification(msg.title || 'SwimDeck', {
      body: msg.body || '',
      tag: msg.tag,
      icon: 'icon.svg',
      badge: 'icon.svg',
      data: { url: msg.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
