/* Service Worker — hält die App offline lauffähig.
   Bei jeder Änderung an den Dateien die VERSION hochzählen. */

const VERSION = 'schule-v1';
const SCHALE = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SCHALE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Backend-Anfragen nie cachen
  if (url.hostname.indexOf('script.google') === 0 ||
      url.hostname.indexOf('script.googleusercontent') === 0 ||
      url.hostname.indexOf('googleusercontent') !== -1 ||
      url.hostname.indexOf('google.com') !== -1) {
    return;
  }
  if (e.request.method !== 'GET') return;

  // App-Schale: erst Netz, dann Cache (damit Updates ankommen)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const kopie = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, kopie)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
