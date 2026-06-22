/* ============================================================
   offlineTiles.js — Offline tile pre-download + storage manager
   Talks to service-worker.js via MessageChannel for tile caching.
   Tracks downloaded areas in IndexedDB for listing + deletion.
   ============================================================ */
const OfflineTiles = (() => {
  const TILE_SERVERS = {
    osm:         (z,x,y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    'carto-dark': (z,x,y) => `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`,
    'carto-light':(z,x,y) => `https://a.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`,
    otm:         (z,x,y) => `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`,
  };

  /* ---- Tile math ---- */
  function lonToX(lon, z) { return Math.floor((lon + 180) / 360 * (1 << z)); }
  function latToY(lat, z) {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z));
  }

  function getTileList(bounds, minZ, maxZ, server) {
    const fn = TILE_SERVERS[server] || TILE_SERVERS.osm;
    const urls = [];
    for (let z = minZ; z <= maxZ; z++) {
      const x1 = lonToX(bounds.getWest(), z),  x2 = lonToX(bounds.getEast(), z);
      const y1 = latToY(bounds.getNorth(), z), y2 = latToY(bounds.getSouth(), z);
      for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++)
          urls.push(fn(z, x, y));
    }
    return urls;
  }

  function estimate(bounds, minZ, maxZ) {
    let count = 0;
    for (let z = minZ; z <= maxZ; z++) {
      const x1 = lonToX(bounds.getWest(), z),  x2 = lonToX(bounds.getEast(), z);
      const y1 = latToY(bounds.getNorth(), z), y2 = latToY(bounds.getSouth(), z);
      count += (x2 - x1 + 1) * (y2 - y1 + 1);
    }
    const mb = (count * 18) / 1024; // ~18KB per tile average
    return { count, mb: mb.toFixed(1) };
  }

  /* ---- Download via Service Worker ---- */
  function download(areaName, bounds, minZ, maxZ, basemap, onProgress) {
    return new Promise(async (resolve, reject) => {
      const sw = await navigator.serviceWorker.ready.catch(() => null);
      if (!sw?.active) { reject(new Error('Service Worker tidak aktif. Buka app dari server (bukan file://).')); return; }

      const urls = getTileList(bounds, minZ, maxZ, basemap);
      if (!urls.length) { reject(new Error('Tidak ada tile dalam area ini.')); return; }
      if (urls.length > 8000) { reject(new Error(`Terlalu banyak tile (${urls.length}). Perkecil area atau kurangi level zoom maksimal.`)); return; }

      const batchId = 'batch_' + Date.now();
      const channel = new MessageChannel();

      channel.port1.onmessage = async (e) => {
        const { type, done, failed, total } = e.data;
        onProgress && onProgress({ done, failed, total, pct: Math.round(done / total * 100) });
        if (type === 'COMPLETE') {
          // Save area metadata to IndexedDB
          await BGDB.putDownloadedArea({
            id: batchId, name: areaName,
            bounds: { w: bounds.getWest(), e: bounds.getEast(), n: bounds.getNorth(), s: bounds.getSouth() },
            minZ, maxZ, basemap, count: urls.length,
            failedCount: failed, downloadedAt: new Date().toISOString(),
            urls, // stored so we can delete them later
          }).catch(() => {});
          resolve({ count: urls.length, failed });
        }
      };

      sw.active.postMessage({ type: 'PRECACHE_TILES', urls, batchId }, [channel.port2]);
    });
  }

  async function deleteArea(id) {
    const area = await BGDB.getDownloadedArea(id);
    if (!area) return;
    const sw = await navigator.serviceWorker.ready.catch(() => null);
    if (sw?.active && area.urls) {
      sw.active.postMessage({ type: 'DELETE_TILE_AREA', urls: area.urls });
    }
    await BGDB.deleteDownloadedArea(id);
  }

  async function listAreas() {
    return BGDB.getAllDownloadedAreas();
  }

  async function getStorageEstimate() {
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return { usageMB: (usage / 1024 / 1024).toFixed(1), quotaMB: (quota / 1024 / 1024).toFixed(0) };
    }
    return { usageMB: '?', quotaMB: '?' };
  }

  function supportedBasemaps() { return Object.keys(TILE_SERVERS); }

  return { estimate, download, deleteArea, listAreas, getStorageEstimate, supportedBasemaps };
})();
