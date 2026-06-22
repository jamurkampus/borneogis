/**
 * tracking.js — Record GPS tracks, export GPX / GeoJSON
 */

import { getLastPosition } from './gps.js';

let _map         = null;
let _recording   = false;
let _paused      = false;
let _points      = [];   // [{lat, lng, alt, time, speed}]
let _polyline    = null;
let _intervalId  = null;
let _startTime   = null;
let _elapsedMs   = 0;
let _pauseStart  = null;
let _onUpdate    = null;

const SAMPLE_INTERVAL = 3000; // ms between samples

export function initTracking(map, onUpdateFn) {
  _map      = map;
  _onUpdate = onUpdateFn;
}

export function startTrack() {
  if (_recording) return;
  _recording  = true;
  _paused     = false;
  _points     = [];
  _startTime  = Date.now();
  _elapsedMs  = 0;

  _polyline = L.polyline([], {
    color: '#E65100',
    weight: 3,
    opacity: .85
  }).addTo(_map);

  _intervalId = setInterval(samplePosition, SAMPLE_INTERVAL);
  samplePosition(); // Immediate first sample
  notify();
}

export function pauseTrack() {
  if (!_recording || _paused) return;
  _paused     = true;
  _pauseStart = Date.now();
  clearInterval(_intervalId);
  _intervalId = null;
  notify();
}

export function resumeTrack() {
  if (!_recording || !_paused) return;
  _paused    = false;
  _elapsedMs += Date.now() - _pauseStart;
  _pauseStart = null;
  _intervalId = setInterval(samplePosition, SAMPLE_INTERVAL);
  notify();
}

export function stopTrack() {
  if (!_recording) return;
  clearInterval(_intervalId);
  _intervalId = null;

  if (_paused && _pauseStart) {
    _elapsedMs += Date.now() - _pauseStart;
  }

  _recording = false;
  _paused    = false;
  notify();
}

export function clearTrack() {
  stopTrack();
  _points    = [];
  _startTime = null;
  _elapsedMs = 0;
  if (_polyline) { _map.removeLayer(_polyline); _polyline = null; }
  notify();
}

export function isRecording() { return _recording && !_paused; }
export function isPaused()    { return _recording && _paused; }
export function isStopped()   { return !_recording; }

export function getElapsedSeconds() {
  if (!_startTime) return 0;
  const now = Date.now();
  let elapsed = _elapsedMs;
  if (_recording && !_paused) elapsed += now - _startTime - _elapsedMs;
  // Simpler: just track running total
  return Math.floor(getRunningElapsed() / 1000);
}

function getRunningElapsed() {
  if (!_startTime) return 0;
  if (_paused) return _elapsedMs + (Date.now() - (_pauseStart || Date.now()));
  return Date.now() - _startTime;
}

export function formatElapsed() {
  const s = getElapsedSeconds();
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
}

export function getDistance() {
  let dist = 0;
  for (let i = 1; i < _points.length; i++) {
    dist += L.latLng(_points[i - 1].lat, _points[i - 1].lng)
              .distanceTo(L.latLng(_points[i].lat, _points[i].lng));
  }
  return dist; // metres
}

export function getPointCount() { return _points.length; }

// ---- SAMPLE ----

function samplePosition() {
  const pos = getLastPosition();
  if (!pos) return;

  const pt = {
    lat: pos.lat,
    lng: pos.lng,
    alt: null,
    time: new Date().toISOString(),
    speed: pos.speed || null
  };
  _points.push(pt);

  if (_polyline) {
    _polyline.addLatLng([pt.lat, pt.lng]);
  }
  notify();
}

function notify() {
  if (_onUpdate) _onUpdate({
    recording: _recording,
    paused:    _paused,
    points:    _points.length,
    elapsed:   formatElapsed(),
    distance:  getDistance()
  });
}

// ---- EXPORT ----

export function exportGPX() {
  const now     = new Date().toISOString();
  const trkPts  = _points.map(p =>
    `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">\n` +
    (p.time ? `      <time>${p.time}</time>\n` : '') +
    (p.speed ? `      <speed>${p.speed.toFixed(2)}</speed>\n` : '') +
    `    </trkpt>`
  ).join('\n');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BorneoGIS GeoPDF Explorer"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <time>${now}</time>
    <name>BorneoGIS Track</name>
  </metadata>
  <trk>
    <name>Track ${now.slice(0, 10)}</name>
    <trkseg>
${trkPts}
    </trkseg>
  </trk>
</gpx>`;
  downloadBlob(gpx, 'track_' + now.slice(0, 10) + '.gpx', 'application/gpx+xml');
}

export function exportGeoJSON() {
  const coords = _points.map(p => [p.lng, p.lat]);
  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        name: 'BorneoGIS Track',
        distance_m: getDistance().toFixed(1),
        points: _points.length,
        recorded: new Date().toISOString()
      },
      geometry: { type: 'LineString', coordinates: coords }
    }]
  };
  downloadBlob(
    JSON.stringify(geojson, null, 2),
    'track_' + new Date().toISOString().slice(0, 10) + '.geojson',
    'application/geo+json'
  );
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
