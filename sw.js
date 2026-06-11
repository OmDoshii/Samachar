const CACHE = 'samachar-v1';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll([
      '/',
      '/index.html',
      '/manifest.json',
      '/icon.svg',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
    ]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip external requests entirely — let the browser handle fonts/CDN normally.
  // The CSP (connect-src 'self') blocks the SW from fetching cross-origin URLs,
  // so we must not intercept them.
  if (url.origin !== self.location.origin) return;

  // News API: network first so data is always fresh; fall back to cache when offline
  if (url.pathname === '/api/news') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else: cache first (app shell, fonts)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
