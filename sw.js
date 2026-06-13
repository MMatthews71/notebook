// Self-destructing service worker.
// The old combined "Focus" app lived at the site root; it has been split into
// the standalone apps in /todo, /notes, /journal, /nutrition and /finance.
// This SW replaces the old one on devices that still have it, wipes its
// caches, unregisters itself, and reloads any open clients so they get the
// new hub page straight from the network.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Caches are origin-wide: only remove the old root app's caches
    // ('focus-v*'), never the sub-apps' ('focus-todo-v*', 'focus-notes-v*', …).
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => /^focus-v\d+$/.test(k)).map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url));
  })());
});
