const CACHE = 'focus-finance-v8';

// Full app shell — precached on install so the app loads offline even after
// the browser evicts the dynamically-cached entries (iOS does this
// aggressively for standalone PWAs). Versioned query strings are kept so the
// cache keys match the requests the page actually makes.
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'css/base.css?v=2',
  'css/header.css?v=5',
  'css/finance.css?v=5',
  'css/banking.css',
  'css/modals.css?v=9',
  'css/mobile.css?v=3',
  'css/forms.css',
  'css/auth.css?v=1',
  'js/utils/date.js',
  'config.js',
  'js/idb.js',
  'js/db.js',
  'js/auth.js',
  'js/fx.js',
  'js/finance.js',
  'js/banking.js',
  'js/init.js',
];

function isNetworkFirst(url) {
  const p = url.pathname;
  return p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.html')
      || p === '/' || p.endsWith('/');
}

self.addEventListener('install', e => {
  self.skipWaiting();
  // Cache each shell item independently so one failure can't abort the rest.
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      // Caches are origin-wide — only clear this app's old versions,
      // never the other apps' caches.
      Promise.all(keys.filter(k => k.startsWith('focus-finance-') && k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (isNetworkFirst(url)) {
    // Bypass the browser HTTP cache so deployed updates are picked up at once.
    const freshReq = new Request(e.request.url, { cache: 'no-store' });
    e.respondWith(
      fetch(freshReq)
        .then(res => {
          if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
          return res;
        })
        .catch(() =>
          caches.match(e.request, { ignoreSearch: true })
            .then(r => r || caches.match('./index.html'))
            .then(r => r || caches.match('./'))
        )
    );
    return;
  }

  // Cache-first for images / other static assets
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
        return res;
      })
    )
  );
});
