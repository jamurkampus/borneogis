const APP_VERSION = '1.0.0';
const CACHE_NAME = `borneogis-v${APP_VERSION}`;
const TILE_CACHE = `borneogis-tiles-v${APP_VERSION}`;

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/map.js',
  '/js/gps.js',
  '/js/tracking.js',
  '/js/layerManager.js',
  '/js/geopdf.js',
  '/js/analysis.js',
  '/js/storage.js',
  '/js/export.js',
  '/js/projectManager.js',
  '/js/pwa.js',
  '/js/photoMapping.js',
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs'
];

const RELEASE_NOTES = {
  '1.0.0': [
    'GeoPDF Engine dengan dukungan multi-layer',
    'GPS Survey Mode realtime',
    'Track Recorder dengan export GPX/KML',
    'Waypoint Manager dengan foto geotagged',
    'GIS Analysis berbasis Turf.js',
    'Project Manager offline penuh',
    'PWA - Install sebagai aplikasi native',
    'Offline basemap tile caching'
  ]
};

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(CORE_ASSETS.filter(url => !url.startsWith('http') || url.includes('unpkg') || url.includes('jsdelivr') || url.includes('cdnjs')));
    }).then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME && key !== TILE_CACHE)
            .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch strategy
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Tile caching - cache first, network fallback
  if (url.hostname.includes('tile') || url.pathname.includes('/tiles/') ||
      url.hostname.includes('openstreetmap') || url.hostname.includes('arcgisonline') ||
      url.hostname.includes('opentopomap') || url.hostname.includes('basemaps.cartocdn')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // Core assets - cache first
  if (CORE_ASSETS.some(a => event.request.url.includes(a.replace('/', '')))) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // Everything else - network first, cache fallback
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});

// Message handler
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'GET_VERSION') {
    event.source.postMessage({
      type: 'VERSION',
      version: APP_VERSION,
      releaseNotes: RELEASE_NOTES[APP_VERSION] || []
    });
  }
  if (event.data === 'CLEAR_TILE_CACHE') {
    caches.delete(TILE_CACHE).then(() => {
      event.source.postMessage({ type: 'TILE_CACHE_CLEARED' });
    });
  }
});
