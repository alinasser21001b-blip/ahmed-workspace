/* App-shell cache. API responses are never cached: financial data must always
   come from the server or be explicitly held as an offline draft. */
const SHELL = 'tt-shell-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/health')) return; // network only
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (url.pathname === '/' || url.pathname.startsWith('/assets/'))) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? caches.match('/'))),
  );
});
