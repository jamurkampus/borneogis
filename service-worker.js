/* ============================================================
   service-worker.js v2 — App shell + tile cache + pre-download
   Supports PRECACHE_TILES message for offline area downloads
   ============================================================ */
const SHELL_CACHE = 'bg-shell-v2';
const TILE_CACHE  = 'bg-tiles-v2';
const RUNTIME_CACHE = 'bg-runtime-v2';

const SHELL_ASSETS = [
  './', './index.html', './css/style.css',
  './js/db.js', './js/map.js', './js/layerManager.js',
  './js/geospatialTools.js', './js/pdfViewer.js',
  './js/offlineTiles.js', './js/app.js', './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()).catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => ![SHELL_CACHE, TILE_CACHE, RUNTIME_CACHE].includes(k))
        .map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isTile(url) {
  return /tile\.openstreetmap\.org|arcgisonline\.com|basemaps\.cartocdn\.com|tile\.opentopomap\.org|google\.com\/vt/.test(url);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  if (isTile(url)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (_) {
          // Offline and not cached: return blank transparent tile
          return new Response(BLANK_TILE_B64, {
            headers: { 'Content-Type': 'image/png' }
          });
        }
      })
    );
    return;
  }

  if (url.startsWith(self.location.origin)) {
    e.respondWith(
      caches.match(req).then(cached =>
        cached || fetch(req).then(res => {
          caches.open(SHELL_CACHE).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => cached || new Response('offline', { status: 503 }))
      )
    );
    return;
  }

  e.respondWith(
    caches.open(RUNTIME_CACHE).then(async cache => {
      const cached = await cache.match(req);
      const net = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || await net || new Response('', { status: 504 });
    })
  );
});

/* ---- Pre-download tiles on demand ---- */
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'PRECACHE_TILES') return;
  const { urls, batchId } = e.data;
  const port = e.ports[0];
  let done = 0, failed = 0;

  const CONCURRENCY = 4;
  const queue = [...urls];
  let active = 0;

  function next() {
    if (!queue.length && active === 0) {
      port.postMessage({ type: 'COMPLETE', batchId, done, failed, total: urls.length });
      return;
    }
    while (active < CONCURRENCY && queue.length) {
      const url = queue.shift();
      active++;
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(url);
        if (cached) { done++; } else {
          try {
            const res = await fetch(url, { mode: 'cors' });
            if (res.ok) { await cache.put(url, res); done++; } else { failed++; }
          } catch (_) { failed++; }
        }
        active--;
        port.postMessage({ type: 'PROGRESS', batchId, done, failed, total: urls.length });
        next();
      });
    }
  }
  next();
});

/* ---- Delete cached area by URL prefix ---- */
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'DELETE_TILE_AREA') return;
  const { urls } = e.data;
  caches.open(TILE_CACHE).then(async cache => {
    for (const url of urls) await cache.delete(url).catch(() => {});
  });
});

/* ---- 1x1 transparent PNG as placeholder for missing offline tiles ---- */
const BLANK_TILE_B64 = (() => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
})();
