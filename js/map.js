/* ============================================================
   map.js — Core Leaflet map: basemaps, GPS, fullscreen, readout
   ============================================================ */
const BGMap = (() => {
  let map, currentBasemapLayer, gpsMarker, gpsCircle, watchId = null;
  let tracking = false, trackPoints = [], trackLine = null, trackStartTs = null;

  const BASEMAPS = {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }),
    esri: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Esri World Imagery'
    }),
    'carto-dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap, &copy; CARTO'
    }),
    'carto-light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap, &copy; CARTO'
    }),
    otm: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '&copy; OpenStreetMap, SRTM | OpenTopoMap'
    }),
    gsat: L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: 'Google Satellite'
    }),
  };

  function init() {
    map = L.map('map', {
      center: [0.4, 117.15], // East Kalimantan
      zoom: 9,
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);

    setBasemap('osm');

    map.on('mousemove', (e) => {
      const el = document.getElementById('coordReadout');
      if (el) el.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    });
    map.on('click', (e) => {
      const el = document.getElementById('coordReadout');
      if (el) el.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    });

    return map;
  }

  function setBasemap(key) {
    if (currentBasemapLayer) map.removeLayer(currentBasemapLayer);
    currentBasemapLayer = BASEMAPS[key] || BASEMAPS.osm;
    currentBasemapLayer.addTo(map);
    currentBasemapLayer.bringToBack();
    BGDB.setSetting('basemap', key);
  }

  function locateOnce() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation tidak didukung browser ini.'));
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        placeGpsMarker(latitude, longitude, accuracy);
        map.setView([latitude, longitude], 17);
        resolve(pos.coords);
      }, (err) => reject(err), { enableHighAccuracy: true, timeout: 12000 });
    });
  }

  function placeGpsMarker(lat, lng, accuracy) {
    const latlng = [lat, lng];
    if (!gpsMarker) {
      gpsMarker = L.marker(latlng, {
        icon: L.divIcon({ className: 'bg-divicon', html: '<div class="bg-gps-pulse"></div>', iconSize: [16, 16] }),
        zIndexOffset: 1000,
      }).addTo(map);
      gpsCircle = L.circle(latlng, { radius: accuracy || 10, color: '#38BDF8', weight: 1, fillOpacity: 0.08 }).addTo(map);
    } else {
      gpsMarker.setLatLng(latlng);
      gpsCircle.setLatLng(latlng);
      gpsCircle.setRadius(accuracy || 10);
    }
  }

  function startTracking(onTick) {
    if (tracking) return;
    if (!navigator.geolocation) { onTick && onTick({ error: 'unsupported' }); return; }
    tracking = true;
    trackPoints = [];
    trackStartTs = Date.now();
    trackLine = L.polyline([], { color: '#F59E0B', weight: 4, opacity: 0.9 }).addTo(map);
    watchId = navigator.geolocation.watchPosition((pos) => {
      const { latitude, longitude, accuracy, speed } = pos.coords;
      trackPoints.push({ lat: latitude, lng: longitude, t: Date.now(), accuracy, speed });
      placeGpsMarker(latitude, longitude, accuracy);
      trackLine.addLatLng([latitude, longitude]);
      const distKm = trackPoints.length > 1 ? turf.length(turf.lineString(trackPoints.map(p => [p.lng, p.lat])), { units: 'kilometers' }) : 0;
      onTick && onTick({ point: { latitude, longitude, accuracy }, distanceKm: distKm, durationMs: Date.now() - trackStartTs, count: trackPoints.length });
    }, (err) => {
      onTick && onTick({ error: err.message });
    }, { enableHighAccuracy: true, maximumAge: 1000 });
  }

  function stopTracking() {
    tracking = false;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    return { points: trackPoints, line: trackLine };
  }

  function isTracking() { return tracking; }

  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  return {
    init, get instance() { return map; }, setBasemap, locateOnce, startTracking, stopTracking,
    isTracking, toggleFullscreen, BASEMAPS,
  };
})();
