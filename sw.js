// SwimTracker Pro Service Worker
// Sube la versión cuando cambies la app para forzar la actualización del cache.
const CACHE = 'swimtracker-v7-6';
const APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Nunca cachear Firebase: los datos deben ir siempre en vivo.
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firebasedatabase.app') ||
      url.hostname.includes('googleapis.com') || url.hostname.includes('firebase')) {
    return;
  }

  // App shell (mismo origen): network-first con respaldo al cache (offline).
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
    );
    return;
  }

  // CDN (Chart.js, jsPDF, xlsx, fuentes): cache-first con respaldo a red.
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => cached))
  );
});
