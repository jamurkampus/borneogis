/* ============================================================
   db.js — IndexedDB persistence layer (no server, no login)
   Stores: layers (geojson + style + meta), tracks, settings
   ============================================================ */
const BGDB = (() => {
  const DB_NAME = 'borneogis_explorer';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('layers')) {
          db.createObjectStore('layers', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('raster')) {
          // large binary assets (PDF page renders, georeferenced images)
          db.createObjectStore('raster', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode) {
    const db = await open();
    return db.transaction(store, mode).objectStore(store);
  }

  return {
    async putLayer(layer) {
      const store = await tx('layers', 'readwrite');
      return new Promise((res, rej) => {
        const r = store.put(layer);
        r.onsuccess = () => res(layer);
        r.onerror = () => rej(r.error);
      });
    },
    async getAllLayers() {
      const store = await tx('layers', 'readonly');
      return new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => rej(r.error);
      });
    },
    async deleteLayer(id) {
      const store = await tx('layers', 'readwrite');
      return new Promise((res, rej) => {
        const r = store.delete(id);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    async putRaster(asset) {
      const store = await tx('raster', 'readwrite');
      return new Promise((res, rej) => {
        const r = store.put(asset);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    async getRaster(id) {
      const store = await tx('raster', 'readonly');
      return new Promise((res, rej) => {
        const r = store.get(id);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
      });
    },
    async deleteRaster(id) {
      const store = await tx('raster', 'readwrite');
      return new Promise((res) => {
        const r = store.delete(id);
        r.onsuccess = () => res();
        r.onerror = () => res();
      });
    },
    async setSetting(key, value) {
      const store = await tx('settings', 'readwrite');
      return new Promise((res, rej) => {
        const r = store.put({ key, value });
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    async getSetting(key, fallback = null) {
      const store = await tx('settings', 'readonly');
      return new Promise((res) => {
        const r = store.get(key);
        r.onsuccess = () => res(r.result ? r.result.value : fallback);
        r.onerror = () => res(fallback);
      });
    },
  };
})();
