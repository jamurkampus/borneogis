// storage.js - IndexedDB abstraction for BorneoGIS Explorer
const Storage = (() => {
  const DB_NAME = 'BorneoGIS';
  const DB_VERSION = 1;
  let db = null;

  const STORES = {
    PROJECTS: 'projects',
    LAYERS: 'layers',
    WAYPOINTS: 'waypoints',
    TRACKS: 'tracks',
    PHOTOS: 'photos',
    SETTINGS: 'settings',
    ANALYSIS: 'analysis'
  };

  async function init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORES.PROJECTS)) {
          const ps = d.createObjectStore(STORES.PROJECTS, { keyPath: 'id' });
          ps.createIndex('name', 'name');
          ps.createIndex('updatedAt', 'updatedAt');
        }
        if (!d.objectStoreNames.contains(STORES.LAYERS)) {
          const ls = d.createObjectStore(STORES.LAYERS, { keyPath: 'id' });
          ls.createIndex('projectId', 'projectId');
        }
        if (!d.objectStoreNames.contains(STORES.WAYPOINTS)) {
          const ws = d.createObjectStore(STORES.WAYPOINTS, { keyPath: 'id' });
          ws.createIndex('projectId', 'projectId');
          ws.createIndex('category', 'category');
        }
        if (!d.objectStoreNames.contains(STORES.TRACKS)) {
          const ts = d.createObjectStore(STORES.TRACKS, { keyPath: 'id' });
          ts.createIndex('projectId', 'projectId');
        }
        if (!d.objectStoreNames.contains(STORES.PHOTOS)) {
          const phs = d.createObjectStore(STORES.PHOTOS, { keyPath: 'id' });
          phs.createIndex('projectId', 'projectId');
          phs.createIndex('waypointId', 'waypointId');
        }
        if (!d.objectStoreNames.contains(STORES.SETTINGS)) {
          d.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
        }
        if (!d.objectStoreNames.contains(STORES.ANALYSIS)) {
          const as = d.createObjectStore(STORES.ANALYSIS, { keyPath: 'id' });
          as.createIndex('projectId', 'projectId');
        }
      };

      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  function getStore(storeName, mode = 'readonly') {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  async function put(storeName, data) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName, 'readwrite').put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function get(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function getAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function getByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName).index(indexName).getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function remove(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName, 'readwrite').delete(key);
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  async function clearStore(storeName) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  async function getSetting(key, defaultVal = null) {
    const record = await get(STORES.SETTINGS, key);
    return record ? record.value : defaultVal;
  }

  async function setSetting(key, value) {
    return put(STORES.SETTINGS, { key, value });
  }

  return {
    init,
    STORES,
    put,
    get,
    getAll,
    getByIndex,
    remove,
    clearStore,
    getSetting,
    setSetting
  };
})();

window.Storage = Storage;
