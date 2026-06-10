const CACHE = 'focus-nutrition-v11';

const SHELL = [
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

function isNetworkFirst(url) {
  const p = url.pathname;
  return p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.html')
      || p === '/' || p.endsWith('/');
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (isNetworkFirst(url)) {
    // Bypass browser HTTP cache so deployed updates are always picked up immediately
    const freshReq = new Request(e.request.url, {
      method: e.request.method,
      headers: e.request.headers,
      cache: 'no-store',
    });
    e.respondWith(
      fetch(freshReq)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for images / other static assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
    })
  );
});
