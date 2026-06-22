/**
 * gps.js — Real-time GPS with accuracy, speed, heading
 */

let _map         = null;
let _watchId     = null;
let _following   = false;
let _lastPos     = null;
let _gpsMarker   = null;
let _accCircle   = null;
let _onUpdate    = null;
let _wakeLock    = null;

const ACCURACY_THRESHOLD = 50; // metres — warn if worse

export function initGPS(map, onUpdateFn) {
  _map      = map;
  _onUpdate = onUpdateFn;
}

export function startGPS() {
  if (!navigator.geolocation) return false;

  _watchId = navigator.geolocation.watchPosition(
    onPosition,
    onError,
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 2000
    }
  );

  acquireWakeLock();
  return true;
}

export function stopGPS() {
  if (_watchId !== null) {
    navigator.geolocation.clearWatch(_watchId);
    _watchId = null;
  }
  releaseWakeLock();
  removeMarkers();
  _lastPos   = null;
  _following = false;
  if (_onUpdate) _onUpdate(null);
}

export function setFollowing(val) {
  _following = val;
  if (_following && _lastPos) {
    _map.setView([_lastPos.lat, _lastPos.lng], Math.max(_map.getZoom(), 16));
  }
}

export function getLastPosition() { return _lastPos; }

export function isRunning() { return _watchId !== null; }

// ---- INTERNAL ----

function onPosition(pos) {
  const { latitude: lat, longitude: lng, accuracy, speed, heading } = pos.coords;
  _lastPos = { lat, lng, accuracy, speed, heading };

  updateMarkers(lat, lng, accuracy);

  if (_following) {
    _map.setView([lat, lng], Math.max(_map.getZoom(), 16), { animate: true, duration: 0.5 });
  }

  if (_onUpdate) _onUpdate(_lastPos);
}

function onError(err) {
  console.warn('GPS error:', err.message);
  if (_onUpdate) _onUpdate(null, err);
}

function updateMarkers(lat, lng, accuracy) {
  if (!_gpsMarker) {
    // Blue dot
    const icon = L.divIcon({
      className: '',
      html: '<div class="gps-marker-dot"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
    _gpsMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(_map);

    // Accuracy circle
    _accCircle = L.circle([lat, lng], {
      radius: accuracy,
      color: '#1565C0',
      fillColor: '#1565C0',
      fillOpacity: 0.08,
      weight: 1
    }).addTo(_map);
  } else {
    _gpsMarker.setLatLng([lat, lng]);
    _accCircle.setLatLng([lat, lng]);
    _accCircle.setRadius(accuracy);
  }
}

function removeMarkers() {
  if (_gpsMarker) { _map.removeLayer(_gpsMarker); _gpsMarker = null; }
  if (_accCircle) { _map.removeLayer(_accCircle); _accCircle = null; }
}

// ---- WAKE LOCK ----

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* permission denied — okay */ }
}

function releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release(); _wakeLock = null; }
}
