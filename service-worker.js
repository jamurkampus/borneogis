/* ============================================================
   service-worker.js — App-shell precache + runtime tile caching
   for offline map viewing (PWA: installable on Android/Desktop)
   ============================================================ */
const SHELL_CACHE = 'bg-shell-v1';
const TILE_CACHE = 'bg-tiles-v1';
const RUNTIME_CACHE = 'bg-runtime-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/map.js',
  './js/layerManager.js',
  './js/geospatialTools.js',
  './js/pdfViewer.js',
  './js/app.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // don't block install if a CDN asset is unreachable
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL_CACHE, TILE_CACHE, RUNTIME_CACHE].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isTileRequest(url) {
  return /tile\.openstreetmap\.org|arcgisonline\.com|basemaps\.cartocdn\.com|tile\.opentopomap\.org|google\.com\/vt/.test(url);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // Map tiles: cache-first, store for offline viewing of previously seen areas
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return cached || new Response('', { status: 504 });
        }
      })
    );
    return;
  }

  // App shell + same-origin: cache-first with network fallback
  if (url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const resClone = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(req, resClone));
        return res;
      }).catch(() => cached))
    );
    return;
  }

  // CDN libraries (Leaflet, Turf, PDF.js, etc.): stale-while-revalidate
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
