/**
 * layers.js — Layer registry and Leaflet overlay management
 */

import { saveLayerBlob, loadLayerBlob, deleteLayerBlob } from './storage.js';
import { loadGeoPDF, canvasToImageURL } from './geopdf.js';
import { showToast } from './app.js';

let _map = null;
let _layers = [];  // [{ id, name, type, visible, opacity, leafletLayer, ... }]
let _onChangeCallback = null;

export function initLayers(map, onChangeFn) {
  _map = map;
  _onChangeCallback = onChangeFn;
}

export function getLayers() { return _layers; }

function notify() {
  if (_onChangeCallback) _onChangeCallback(_layers);
}

// ---- ADD LAYERS ----

/**
 * Add a GeoPDF layer
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 * @param {object|null} bounds {minLat, maxLat, minLng, maxLng}
 */
export async function addGeoPDFLayer(buffer, filename, bounds) {
  showToast('Memuat GeoPDF…', 'info');

  try {
    const result = await loadGeoPDF(buffer, filename);
    const useBounds = bounds || result.bounds;

    if (!useBounds) {
      // Return so caller can prompt user for bounds
      return { needsBounds: true, result, buffer, filename };
    }

    const imageUrl = canvasToImageURL(result.canvas);
    const leafletBounds = [
      [useBounds.minLat, useBounds.minLng],
      [useBounds.maxLat, useBounds.maxLng]
    ];

    const overlay = L.imageOverlay(imageUrl, leafletBounds, {
      opacity: 1,
      zIndex: 200
    });
    overlay.addTo(_map);
    _map.fitBounds(leafletBounds);

    const id = 'layer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    // Save to IndexedDB
    await saveLayerBlob({ id, type: 'pdf', filename, buffer, bounds: useBounds });

    const layer = {
      id,
      name: filename.replace(/\.[^.]+$/, ''),
      type: 'pdf',
      visible: true,
      opacity: 1,
      leafletLayer: overlay,
      bounds: useBounds,
      imageUrl
    };
    _layers.unshift(layer);
    notify();
    showToast(`${layer.name} dimuat`, 'success');
    return { ok: true, layer };
  } catch (err) {
    showToast('Gagal memuat GeoPDF: ' + err.message, 'error');
    return { ok: false, error: err.message };
  }
}

/**
 * Add a GeoPDF layer using a pre-rendered canvas + bounds that already
 * came from manual georeferencing (see georef.js). The canvas passed in
 * may already be warped to north-up if the transform included rotation,
 * so this does not call loadGeoPDF() again — it trusts the caller.
 *
 * @param {ArrayBuffer} buffer - original file bytes, kept for storage/reopen
 * @param {string} filename
 * @param {HTMLCanvasElement} canvas - already north-up aligned
 * @param {{minLat,maxLat,minLng,maxLng}} bounds
 * @param {object} meta - optional { transform, rmse } for reference/debugging
 */
export async function addGeoPDFLayerFromCanvas(buffer, filename, canvas, bounds, meta = {}) {
  try {
    const imageUrl = canvasToImageURL(canvas);
    const leafletBounds = [
      [bounds.minLat, bounds.minLng],
      [bounds.maxLat, bounds.maxLng]
    ];

    const overlay = L.imageOverlay(imageUrl, leafletBounds, {
      opacity: 1,
      zIndex: 200
    });
    overlay.addTo(_map);
    _map.fitBounds(leafletBounds);

    const id = 'layer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    await saveLayerBlob({ id, type: 'pdf', filename, buffer, bounds, georef: meta });

    const layer = {
      id,
      name: filename.replace(/\.[^.]+$/, ''),
      type: 'pdf',
      visible: true,
      opacity: 1,
      leafletLayer: overlay,
      bounds,
      imageUrl,
      georef: meta
    };
    _layers.unshift(layer);
    notify();

    const rmseNote = meta.rmse != null ? `, RMSE ${meta.rmse.toFixed(1)} m` : '';
    showToast(`${layer.name} dimuat (georeferensi manual${rmseNote})`, 'success');
    return { ok: true, layer };
  } catch (err) {
    showToast('Gagal memuat layer: ' + err.message, 'error');
    return { ok: false, error: err.message };
  }
}

/**
 * Add GeoJSON / KML / GPX overlay
 */
export async function addVectorLayer(text, filename) {
  const ext  = filename.split('.').pop().toLowerCase();
  let geoJson = null;

  try {
    if (ext === 'geojson' || ext === 'json') {
      geoJson = JSON.parse(text);
    } else if (ext === 'kml') {
      geoJson = kmlToGeoJSON(text);
    } else if (ext === 'gpx') {
      geoJson = gpxToGeoJSON(text);
    } else {
      showToast('Format tidak didukung: ' + ext, 'error');
      return;
    }
  } catch (err) {
    showToast('Gagal parse file: ' + err.message, 'error');
    return;
  }

  const type    = ext === 'geojson' || ext === 'json' ? 'json' : ext;
  const color   = type === 'json' ? '#2E7D32' : type === 'kml' ? '#7B1FA2' : '#0277BD';

  const leafletLayer = L.geoJSON(geoJson, {
    style: { color, weight: 2, fillOpacity: .25, fillColor: color },
    pointToLayer: (feat, latlng) => {
      return L.circleMarker(latlng, {
        radius: 6,
        fillColor: color,
        color: '#fff',
        weight: 2,
        fillOpacity: .9
      });
    },
    onEachFeature: (feat, layer) => {
      if (feat.properties && Object.keys(feat.properties).length) {
        const rows = Object.entries(feat.properties)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => `<tr><td style="font-weight:600;padding-right:10px">${k}</td><td>${v}</td></tr>`)
          .join('');
        layer.bindPopup(`<table style="font-size:12px">${rows}</table>`);
      }
    }
  });

  leafletLayer.addTo(_map);

  try {
    const bounds = leafletLayer.getBounds();
    if (bounds.isValid()) _map.fitBounds(bounds);
  } catch { /* empty layer */ }

  const id = 'layer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  await saveLayerBlob({ id, type, filename, text });

  const layer = {
    id,
    name: filename.replace(/\.[^.]+$/, ''),
    type,
    visible: true,
    opacity: 1,
    leafletLayer
  };
  _layers.unshift(layer);
  notify();
  showToast(`${layer.name} ditambahkan`, 'success');
}

// ---- CONTROL ----

export function toggleLayer(id) {
  const layer = _layers.find(l => l.id === id);
  if (!layer) return;
  layer.visible = !layer.visible;
  if (layer.visible) {
    if (!_map.hasLayer(layer.leafletLayer)) layer.leafletLayer.addTo(_map);
  } else {
    if (_map.hasLayer(layer.leafletLayer)) _map.removeLayer(layer.leafletLayer);
  }
  notify();
}

export function setLayerOpacity(id, opacity) {
  const layer = _layers.find(l => l.id === id);
  if (!layer) return;
  layer.opacity = opacity;
  if (layer.leafletLayer.setOpacity) {
    layer.leafletLayer.setOpacity(opacity);
  } else if (layer.leafletLayer.setStyle) {
    layer.leafletLayer.setStyle({ opacity, fillOpacity: opacity * 0.5 });
  }
  notify();
}

export async function removeLayer(id) {
  const idx = _layers.findIndex(l => l.id === id);
  if (idx === -1) return;
  const layer = _layers[idx];
  if (_map.hasLayer(layer.leafletLayer)) _map.removeLayer(layer.leafletLayer);
  _layers.splice(idx, 1);
  await deleteLayerBlob(id);
  notify();
}

export function reorderLayers(fromIdx, toIdx) {
  const [moved] = _layers.splice(fromIdx, 1);
  _layers.splice(toIdx, 0, moved);
  // Re-apply z-index for image overlays
  _layers.forEach((layer, i) => {
    if (layer.leafletLayer.setZIndex) {
      layer.leafletLayer.setZIndex(100 + (_layers.length - i));
    } else if (layer.leafletLayer.options) {
      layer.leafletLayer.options.zIndex = 100 + (_layers.length - i);
    }
  });
  notify();
}

// ---- RESTORE FROM DB ----

export async function restoreLayersFromStorage() {
  // Restore is handled per-project by projectManager
}

// ---- KML / GPX PARSERS ----

function kmlToGeoJSON(kmlText) {
  const parser = new DOMParser();
  const kml    = parser.parseFromString(kmlText, 'application/xml');
  const feats  = [];

  kml.querySelectorAll('Placemark').forEach((pm) => {
    const name = pm.querySelector('name')?.textContent || '';
    const desc = pm.querySelector('description')?.textContent || '';

    // Point
    const pt = pm.querySelector('Point coordinates');
    if (pt) {
      const [lng, lat] = pt.textContent.trim().split(',').map(Number);
      feats.push({
        type: 'Feature',
        properties: { name, description: desc },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      });
    }

    // LineString
    const ls = pm.querySelector('LineString coordinates');
    if (ls) {
      const coords = ls.textContent.trim().split(/\s+/).map(c => {
        const [lng, lat] = c.split(',').map(Number);
        return [lng, lat];
      });
      feats.push({
        type: 'Feature',
        properties: { name, description: desc },
        geometry: { type: 'LineString', coordinates: coords }
      });
    }

    // Polygon
    const poly = pm.querySelector('Polygon outerBoundaryIs LinearRing coordinates');
    if (poly) {
      const coords = poly.textContent.trim().split(/\s+/).map(c => {
        const [lng, lat] = c.split(',').map(Number);
        return [lng, lat];
      });
      feats.push({
        type: 'Feature',
        properties: { name, description: desc },
        geometry: { type: 'Polygon', coordinates: [coords] }
      });
    }
  });

  return { type: 'FeatureCollection', features: feats };
}

function gpxToGeoJSON(gpxText) {
  const parser = new DOMParser();
  const gpx    = parser.parseFromString(gpxText, 'application/xml');
  const feats  = [];

  // Waypoints
  gpx.querySelectorAll('wpt').forEach((wpt) => {
    const lat  = parseFloat(wpt.getAttribute('lat'));
    const lng  = parseFloat(wpt.getAttribute('lon'));
    const name = wpt.querySelector('name')?.textContent || '';
    feats.push({
      type: 'Feature',
      properties: { name },
      geometry: { type: 'Point', coordinates: [lng, lat] }
    });
  });

  // Tracks
  gpx.querySelectorAll('trk').forEach((trk) => {
    const name = trk.querySelector('name')?.textContent || 'Track';
    trk.querySelectorAll('trkseg').forEach((seg) => {
      const coords = Array.from(seg.querySelectorAll('trkpt')).map((tp) => [
        parseFloat(tp.getAttribute('lon')),
        parseFloat(tp.getAttribute('lat'))
      ]);
      if (coords.length) {
        feats.push({
          type: 'Feature',
          properties: { name },
          geometry: { type: 'LineString', coordinates: coords }
        });
      }
    });
  });

  // Routes
  gpx.querySelectorAll('rte').forEach((rte) => {
    const name   = rte.querySelector('name')?.textContent || 'Route';
    const coords = Array.from(rte.querySelectorAll('rtept')).map((rp) => [
      parseFloat(rp.getAttribute('lon')),
      parseFloat(rp.getAttribute('lat'))
    ]);
    if (coords.length) {
      feats.push({
        type: 'Feature',
        properties: { name },
        geometry: { type: 'LineString', coordinates: coords }
      });
    }
  });

  return { type: 'FeatureCollection', features: feats };
}
