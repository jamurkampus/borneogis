/* ============================================================
   db.js v2 — IndexedDB: layers, raster, settings, downloadedAreas
   ============================================================ */
const BGDB = (() => {
  const DB_NAME = 'borneogis_explorer';
  const DB_VERSION = 2; // bumped: adds downloadedAreas store
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('layers'))
          db.createObjectStore('layers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings'))
          db.createObjectStore('settings', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('raster'))
          db.createObjectStore('raster', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('downloadedAreas'))
          db.createObjectStore('downloadedAreas', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror  = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode) {
    const db = await open();
    return db.transaction(store, mode).objectStore(store);
  }

  function idbRequest(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  return {
    /* layers */
    async putLayer(l)       { return idbRequest((await tx('layers','readwrite')).put(l)); },
    async getAllLayers()     { return idbRequest((await tx('layers','readonly')).getAll()); },
    async deleteLayer(id)   { return idbRequest((await tx('layers','readwrite')).delete(id)); },

    /* raster (PDF overlays) */
    async putRaster(a)      { return idbRequest((await tx('raster','readwrite')).put(a)); },
    async getRaster(id)     { return idbRequest((await tx('raster','readonly')).get(id)); },
    async getAllRasters()    { return idbRequest((await tx('raster','readonly')).getAll()); },
    async deleteRaster(id)  { return idbRequest((await tx('raster','readwrite')).delete(id)); },

    /* settings */
    async setSetting(key, value) { return idbRequest((await tx('settings','readwrite')).put({ key, value })); },
    async getSetting(key, fallback = null) {
      try { const r = await idbRequest((await tx('settings','readonly')).get(key)); return r ? r.value : fallback; }
      catch (_) { return fallback; }
    },

    /* downloaded offline areas */
    async putDownloadedArea(area)    { return idbRequest((await tx('downloadedAreas','readwrite')).put(area)); },
    async getDownloadedArea(id)      { return idbRequest((await tx('downloadedAreas','readonly')).get(id)); },
    async getAllDownloadedAreas()    { return idbRequest((await tx('downloadedAreas','readonly')).getAll()); },
    async deleteDownloadedArea(id)  { return idbRequest((await tx('downloadedAreas','readwrite')).delete(id)); },
  };
})();
