// Focus PWA — Service Worker
// Caches the app shell (HTML, CSS, JS) for fast load & offline launch.
// Data (Supabase) always goes to the network.

const CACHE = 'focus-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './js/idb.js?v=1',
  // Icons
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  // CSS
  './css/base.css?v=2',
  './css/header.css?v=4',
  './css/notes.css?v=7',
  './css/items.css?v=9',
  './css/modals.css?v=7',
  './css/calendar.css?v=2',
  './css/graph.css?v=116',
  './css/cascade.css?v=36',
  './css/calendar-tab.css?v=15',
  './css/mobile.css?v=3',
  './css/schedule.css',
  './css/templates.css',
  './css/forms.css',
  './css/desktop.css?v=13',
  './css/nutrition.css?v=7',
  './css/finance.css?v=4',
  './css/auth.css?v=1',
  // JS
  './js/utils/date.js?v=6',
  './js/db.js?v=13',
  './js/auth.js?v=1',
  './js/state.js?v=9',
  './js/fx.js?v=7',
  './js/journal.js?v=9',
  './js/nav.js?v=11',
  './js/modals.js?v=7',
  './js/goals.js?v=119',
  './js/habits.js?v=23',
  './js/todos.js?v=10',
  './js/desktop.js?v=24',
  './js/speech.js?v=7',
  './js/analysis.js?v=6',
  './js/nutrition.js?v=12',
  './js/finance.js?v=1',
  './js/calendar.js?v=22',
  './js/init.js?v=20',
];

// Install: cache the app shell
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})
  );
});

// Activate: clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

// Fetch: cache-first for same-origin assets, network-only for Supabase/external
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Let Supabase, Google Fonts, and other external requests go straight to network
  if (url.origin !== self.location.origin) return;

  // For navigation requests, always try network first so fresh HTML loads
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for all other same-origin assets (CSS, JS, images)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
