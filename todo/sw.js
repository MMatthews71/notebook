const CACHE = 'focus-todo-v2';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/base.css',
  './css/header.css',
  './css/items.css',
  './css/modals.css',
  './css/calendar.css',
  './css/graph.css',
  './css/cascade.css',
  './css/calendar-tab.css',
  './css/mobile.css',
  './css/schedule.css',
  './css/templates.css',
  './css/forms.css',
  './css/desktop.css',
  './css/auth.css',
  './js/utils/date.js',
  './js/idb.js',
  './js/db.js',
  './js/auth.js',
  './js/state.js',
  './js/fx.js',
  './js/nav.js',
  './js/modals.js',
  './js/goals.js',
  './js/habits.js',
  './js/todos.js',
  './js/desktop.js',
  './js/speech.js',
  './js/analysis.js',
  './js/calendar.js',
  './js/init.js',
];

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
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
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
