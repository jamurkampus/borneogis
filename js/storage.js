/**
 * storage.js — IndexedDB wrapper
 * Stores: projects, layers (file blobs), map state
 */

const DB_NAME    = 'borneogis';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        const ps = db.createObjectStore('projects', { keyPath: 'id' });
        ps.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('layers')) {
        db.createObjectStore('layers', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => {
    const t     = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    return { t, store };
  });
}

function promisify(req) {
  return new Promise((res, rej) => {
    req.onsuccess = (e) => res(e.target.result);
    req.onerror   = (e) => rej(e.target.error);
  });
}

// ---- PROJECTS ----

export async function saveProject(project) {
  const { store } = await tx('projects', 'readwrite');
  project.updatedAt = Date.now();
  return promisify(store.put(project));
}

export async function loadProject(id) {
  const { store } = await tx('projects');
  return promisify(store.get(id));
}

export async function listProjects() {
  const { store } = await tx('projects');
  return promisify(store.getAll());
}

export async function deleteProject(id) {
  const { store } = await tx('projects', 'readwrite');
  return promisify(store.delete(id));
}

// ---- LAYERS (blobs) ----

export async function saveLayerBlob(layerRecord) {
  const { store } = await tx('layers', 'readwrite');
  return promisify(store.put(layerRecord));
}

export async function loadLayerBlob(id) {
  const { store } = await tx('layers');
  return promisify(store.get(id));
}

export async function deleteLayerBlob(id) {
  const { store } = await tx('layers', 'readwrite');
  return promisify(store.delete(id));
}

export async function listLayerBlobs() {
  const { store } = await tx('layers');
  return promisify(store.getAll());
}

// ---- SETTINGS ----

export async function saveSetting(key, value) {
  const { store } = await tx('settings', 'readwrite');
  return promisify(store.put({ key, value }));
}

export async function loadSetting(key, defaultValue = null) {
  try {
    const { store } = await tx('settings');
    const rec = await promisify(store.get(key));
    return rec ? rec.value : defaultValue;
  } catch {
    return defaultValue;
  }
}
