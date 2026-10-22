/* Minimal service worker: cache the board shell so Add to Home Screen feels like an app. */
const CACHE = 'elme-board-v2';
const SHELL = [
  '/board/db-shim.js',
  '/board/logic.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Never cache API — board data must be live.
  if (url.pathname.startsWith('/api/')) return;
  // HTML always network-first so phone gets UI fixes without a hard cache wipe.
  if (url.pathname.endsWith('.html') || url.pathname === '/board/' || url.pathname === '/board/index.html') {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => caches.match(event.request)),
    );
    return;
  }
  if (url.pathname.startsWith('/board/') || url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        }).catch(() => cached);
        return fetchPromise.catch(() => cached);
      }),
    );
  }
});
