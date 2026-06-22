/* ============================================================
   map.js v2 — Leaflet map, basemaps, GPS + compass heading,
   wake lock (keep screen on during navigation), track stats
   ============================================================ */
const BGMap = (() => {
  let map, currentBasemapLayer, gpsMarker, gpsCircle, gpsHeadingEl;
  let watchId = null, compassWatchId = null;
  let tracking = false, trackPoints = [], trackLine = null, trackStartTs = null;
  let wakeLock = null;

  const BASEMAPS = {
    osm: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }),
    esri: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Esri World Imagery'
    }),
    'carto-dark': () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap, &copy; CARTO'
    }),
    'carto-light': () => L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap, &copy; CARTO'
    }),
    otm: () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '&copy; OpenStreetMap, SRTM | OpenTopoMap'
    }),
    gsat: () => L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      maxZoom: 20, subdomains: ['mt0','mt1','mt2','mt3'], attribution: 'Google Satellite'
    }),
  };

  function init() {
    map = L.map('map', {
      center: [0.4, 117.15],
      zoom: 9,
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);
    setBasemap('osm');

    map.on('mousemove click', (e) => {
      const el = document.getElementById('coordReadout');
      if (el) el.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    });

    return map;
  }

  function setBasemap(key) {
    if (currentBasemapLayer) map.removeLayer(currentBasemapLayer);
    const factory = BASEMAPS[key] || BASEMAPS.osm;
    currentBasemapLayer = factory();
    currentBasemapLayer.addTo(map);
    currentBasemapLayer.bringToBack();
    BGDB.setSetting('basemap', key).catch(() => {});
  }

  /* ---- GPS marker with compass arrow ---- */
  function _gpsMarkerHtml(heading) {
    const arrow = (heading !== null && heading !== undefined)
      ? `<div class="bg-gps-arrow" style="transform:rotate(${heading}deg)">▲</div>`
      : '';
    return `<div class="bg-gps-dot">${arrow}</div>`;
  }

  function placeGpsMarker(lat, lng, accuracy, heading) {
    const latlng = [lat, lng];
    const html = _gpsMarkerHtml(heading);
    if (!gpsMarker) {
      gpsMarker = L.marker(latlng, {
        icon: L.divIcon({ className: 'bg-divicon', html, iconSize: [22, 22], iconAnchor: [11, 11] }),
        zIndexOffset: 1000,
      }).addTo(map);
      gpsCircle = L.circle(latlng, { radius: accuracy || 5, color: '#38BDF8', weight: 1, fillOpacity: 0.08 }).addTo(map);
    } else {
      gpsMarker.setLatLng(latlng);
      gpsMarker.setIcon(L.divIcon({ className: 'bg-divicon', html, iconSize: [22, 22], iconAnchor: [11, 11] }));
      gpsCircle.setLatLng(latlng);
      gpsCircle.setRadius(Math.max(accuracy || 5, 5));
    }
  }

  /* ---- Wake Lock (keep screen on during navigation) ---- */
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); }
    catch (e) {}
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && wakeLock?.released) requestWakeLock();
    });
  }
  async function releaseWakeLock() {
    try { await wakeLock?.release(); wakeLock = null; } catch (e) {}
  }

  /* ---- Compass (device orientation) ---- */
  let _heading = null;
  function startCompass() {
    const handler = (e) => {
      _heading = e.webkitCompassHeading ?? (e.alpha !== null ? (360 - e.alpha) : null);
      if (gpsMarker && _heading !== null) {
        gpsMarker.setIcon(L.divIcon({ className: 'bg-divicon', html: _gpsMarkerHtml(_heading), iconSize: [22, 22], iconAnchor: [11, 11] }));
      }
    };
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(r => {
        if (r === 'granted') window.addEventListener('deviceorientation', handler);
      }).catch(() => {});
    } else {
      window.addEventListener('deviceorientation', handler);
    }
    compassWatchId = handler;
  }
  function stopCompass() {
    if (compassWatchId) window.removeEventListener('deviceorientation', compassWatchId);
    compassWatchId = null; _heading = null;
  }

  /* ---- Locate once ---- */
  function locateOnce() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation tidak didukung.'));
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude, accuracy, heading } = pos.coords;
        placeGpsMarker(latitude, longitude, accuracy, heading ?? _heading);
        map.setView([latitude, longitude], 17);
        resolve(pos.coords);
      }, reject, { enableHighAccuracy: true, timeout: 15000 });
    });
  }

  /* ---- GPS Tracking ---- */
  function startTracking(onTick) {
    if (tracking) return;
    if (!navigator.geolocation) { onTick?.({ error: 'unsupported' }); return; }
    tracking = true;
    trackPoints = [];
    trackStartTs = Date.now();
    trackLine = L.polyline([], { color: '#F59E0B', weight: 4, opacity: 0.9 }).addTo(map);
    requestWakeLock();
    startCompass();

    watchId = navigator.geolocation.watchPosition((pos) => {
      const { latitude, longitude, accuracy, speed, altitude, heading } = pos.coords;
      // Filter jitter: skip point if accuracy > 50m AND we already have points
      if (trackPoints.length > 0 && accuracy > 50) return;
      trackPoints.push({ lat: latitude, lng: longitude, t: Date.now(), accuracy, speed, altitude });
      placeGpsMarker(latitude, longitude, accuracy, heading ?? _heading);
      trackLine.addLatLng([latitude, longitude]);
      _maybeFollow(latitude, longitude);
      const distKm = trackPoints.length > 1
        ? turf.length(turf.lineString(trackPoints.map(p => [p.lng, p.lat])), { units: 'kilometers' })
        : 0;
      onTick?.({
        point: { latitude, longitude, accuracy, speed, altitude },
        distanceKm: distKm,
        durationMs: Date.now() - trackStartTs,
        count: trackPoints.length,
        speedKmh: speed ? (speed * 3.6).toFixed(1) : null,
        altM: altitude ? altitude.toFixed(0) : null,
      });
    }, (err) => onTick?.({ error: err.message }),
    { enableHighAccuracy: true, maximumAge: 1500, timeout: 20000 });
  }

  function stopTracking() {
    tracking = false;
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    releaseWakeLock();
    stopCompass();
    return { points: trackPoints, line: trackLine };
  }

  function isTracking() { return tracking; }
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
  let _following = false, _followCb = null;

  function enableFollow(cb) { _following = true; _followCb = cb; }
  function disableFollow() { _following = false; _followCb = null; }
  function isFollowing() { return _following; }

  // Call this from startTracking tick to auto-pan
  function _maybeFollow(lat, lng) {
    if (_following) { map.setView([lat, lng], map.getZoom(), { animate: true }); _followCb?.(); }
  }

  function getBounds() { return map.getBounds(); }
  function getZoom() { return map.getZoom(); }

  return {
    init, get instance() { return map; }, setBasemap, locateOnce,
    startTracking, stopTracking, isTracking, toggleFullscreen,
    enableFollow, disableFollow, isFollowing,
    getBounds, getZoom, BASEMAPS,
  };
})();
