/**
 * measure.js — Click-to-measure distance & area
 */

let _map      = null;
let _mode     = null; // 'distance' | 'area' | null
let _points   = [];
let _markers  = [];
let _polyline = null;
let _polygon  = null;
let _onResult = null;
let _clickFn  = null;
let _dblClickFn = null;

export function initMeasure(map, onResultFn) {
  _map      = map;
  _onResult = onResultFn;
}

export function startMeasureDistance() {
  clearMeasure();
  _mode = 'distance';
  _map.getContainer().style.cursor = 'crosshair';
  _clickFn = (e) => addPoint(e.latlng);
  _dblClickFn = () => finishMeasure();
  _map.on('click', _clickFn);
  _map.on('dblclick', _dblClickFn);
  _map.doubleClickZoom.disable();
}

export function startMeasureArea() {
  clearMeasure();
  _mode = 'area';
  _map.getContainer().style.cursor = 'crosshair';
  _clickFn = (e) => addPoint(e.latlng);
  _dblClickFn = () => finishMeasure();
  _map.on('click', _clickFn);
  _map.on('dblclick', _dblClickFn);
  _map.doubleClickZoom.disable();
}

export function clearMeasure() {
  _mode = null;
  _points = [];
  _map.getContainer().style.cursor = '';

  if (_clickFn)    { _map.off('click', _clickFn);    _clickFn    = null; }
  if (_dblClickFn) { _map.off('dblclick', _dblClickFn); _dblClickFn = null; }

  _markers.forEach(m => _map.removeLayer(m));
  _markers = [];
  if (_polyline) { _map.removeLayer(_polyline); _polyline = null; }
  if (_polygon)  { _map.removeLayer(_polygon);  _polygon  = null; }

  _map.doubleClickZoom.enable();
  if (_onResult) _onResult(null);
}

// ---- INTERNAL ----

function addPoint(latlng) {
  _points.push(latlng);

  const dot = L.circleMarker(latlng, {
    radius: 5,
    fillColor: '#1565C0',
    color: '#fff',
    weight: 2,
    fillOpacity: 1
  }).addTo(_map);
  _markers.push(dot);

  updatePreview();
  computeResult();
}

function updatePreview() {
  const coords = _points;

  if (_mode === 'distance') {
    if (_polyline) _map.removeLayer(_polyline);
    if (coords.length >= 2) {
      _polyline = L.polyline(coords, {
        color: '#1565C0', weight: 2.5, dashArray: '6 4'
      }).addTo(_map);
    }
  }

  if (_mode === 'area') {
    if (_polygon) _map.removeLayer(_polygon);
    if (coords.length >= 3) {
      _polygon = L.polygon(coords, {
        color: '#1565C0', weight: 2,
        fillColor: '#1565C0', fillOpacity: .12,
        dashArray: '6 4'
      }).addTo(_map);
    }
  }
}

function computeResult() {
  if (_mode === 'distance') {
    let total = 0;
    for (let i = 1; i < _points.length; i++) {
      total += _points[i - 1].distanceTo(_points[i]);
    }
    if (_onResult) _onResult({ type: 'distance', metres: total });
  }

  if (_mode === 'area' && _points.length >= 3) {
    const area = computePolygonArea(_points);
    if (_onResult) _onResult({ type: 'area', sqMetres: area });
  }
}

function finishMeasure() {
  computeResult();
  _mode = null;
  _map.getContainer().style.cursor = '';
  _map.off('click', _clickFn);
  _map.off('dblclick', _dblClickFn);
  _map.doubleClickZoom.enable();
}

/**
 * Spherical excess formula for polygon area in m²
 */
function computePolygonArea(latlngs) {
  const R = 6371008.8; // Earth radius in metres
  const n = latlngs.length;
  let area = 0;

  for (let i = 0; i < n; i++) {
    const j    = (i + 1) % n;
    const lat1 = latlngs[i].lat * Math.PI / 180;
    const lat2 = latlngs[j].lat * Math.PI / 180;
    const dLng = (latlngs[j].lng - latlngs[i].lng) * Math.PI / 180;
    area += dLng * (2 + Math.sin(lat1) + Math.sin(lat2));
  }

  return Math.abs(area * R * R / 2);
}

// ---- FORMAT HELPERS ----

export function formatDistance(metres) {
  if (metres < 1000) return metres.toFixed(1) + ' m';
  return (metres / 1000).toFixed(3) + ' km';
}

export function formatArea(sqMetres) {
  if (sqMetres < 10000) return sqMetres.toFixed(1) + ' m²';
  const ha = sqMetres / 10000;
  if (ha < 100) return ha.toFixed(4) + ' ha';
  return ha.toFixed(2) + ' ha';
}

export function formatAreaSub(sqMetres) {
  const ha  = sqMetres / 10000;
  const sqKm = sqMetres / 1e6;
  return `${ha.toFixed(4)} ha · ${sqKm.toFixed(6)} km²`;
}
