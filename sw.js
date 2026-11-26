/* PDF Werkstatt – Offline-Speicher. Die App funktioniert nach dem ersten Laden auch ohne Internet. */
const VERSION = 'pdfw-v6';
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './vendor/pdf-lib.min.js', './vendor/Sortable.min.js', './vendor/jszip.min.js',
  './pdf.min.js', './pdf.worker.min.js', './worker.js', './gs.js', './scan-core.js',
  './fonts/archivo.woff2', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Seite selbst: zuerst online (für Updates), sonst aus dem Speicher
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Alles andere (inkl. der 16-MB-Engine beim ersten Komprimieren): aus dem Speicher, sonst laden und merken
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
