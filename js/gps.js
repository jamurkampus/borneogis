// gps.js - GPS Survey Mode for BorneoGIS
const GPS = (() => {
  let watchId = null;
  let currentPosition = null;
  let positionHistory = [];
  let isActive = false;
  let listeners = [];
  let locationMarker = null;
  let accuracyCircle = null;
  let compassHeading = 0;

  const ACCURACY_THRESHOLD = 20; // meters

  function onPosition(pos) {
    const { latitude, longitude, altitude, accuracy, heading, speed } = pos.coords;
    currentPosition = {
      lat: latitude,
      lng: longitude,
      altitude: altitude || 0,
      accuracy,
      heading: heading || compassHeading,
      speed: speed || 0,
      timestamp: pos.timestamp
    };
    positionHistory.push({ ...currentPosition });
    if (positionHistory.length > 1000) positionHistory.shift();
    updateMarker();
    updatePanel();
    listeners.forEach(fn => fn(currentPosition));
  }

  function onError(err) {
    console.warn('GPS Error:', err.message);
    const panel = document.getElementById('gps-error');
    if (panel) {
      panel.textContent = err.code === 1 ? 'Akses GPS ditolak' :
                          err.code === 2 ? 'Posisi tidak tersedia' :
                          'GPS timeout';
      panel.style.display = 'block';
    }
  }

  function start() {
    if (!navigator.geolocation) {
      App.showToast('GPS tidak didukung browser ini', 'error');
      return;
    }
    isActive = true;
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });
    startCompass();
    document.getElementById('gps-panel').classList.add('active');
    document.getElementById('gps-btn').classList.add('active');
    App.showToast('GPS aktif', 'success');
  }

  function stop() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    isActive = false;
    stopCompass();
    removeMarker();
    document.getElementById('gps-panel').classList.remove('active');
    document.getElementById('gps-btn').classList.remove('active');
    App.showToast('GPS dimatikan', 'info');
  }

  function toggle() {
    isActive ? stop() : start();
  }

  function centerMap() {
    if (!currentPosition) { App.showToast('Menunggu sinyal GPS...', 'warning'); return; }
    MapManager.map.setView([currentPosition.lat, currentPosition.lng], 16, { animate: true });
  }

  function updateMarker() {
    if (!currentPosition || !MapManager.map) return;
    const latlng = [currentPosition.lat, currentPosition.lng];

    if (!locationMarker) {
      const pulseIcon = L.divIcon({
        className: '',
        html: `<div class="gps-marker"><div class="gps-pulse"></div><div class="gps-dot"></div></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      locationMarker = L.marker(latlng, { icon: pulseIcon, zIndexOffset: 1000 }).addTo(MapManager.map);
      accuracyCircle = L.circle(latlng, { radius: currentPosition.accuracy, className: 'gps-accuracy-circle' }).addTo(MapManager.map);
    } else {
      locationMarker.setLatLng(latlng);
      accuracyCircle.setLatLng(latlng).setRadius(currentPosition.accuracy);
    }
  }

  function removeMarker() {
    if (locationMarker) { locationMarker.remove(); locationMarker = null; }
    if (accuracyCircle) { accuracyCircle.remove(); accuracyCircle = null; }
  }

  function updatePanel() {
    if (!currentPosition) return;
    const p = currentPosition;
    const el = id => document.getElementById(id);

    if (el('gps-lat')) el('gps-lat').textContent = p.lat.toFixed(8);
    if (el('gps-lng')) el('gps-lng').textContent = p.lng.toFixed(8);
    if (el('gps-alt')) el('gps-alt').textContent = `${p.altitude.toFixed(1)} m`;
    if (el('gps-acc')) {
      el('gps-acc').textContent = `±${p.accuracy.toFixed(1)} m`;
      el('gps-acc').className = p.accuracy <= 5 ? 'gps-value excellent' :
                                 p.accuracy <= 15 ? 'gps-value good' :
                                 p.accuracy <= 30 ? 'gps-value fair' : 'gps-value poor';
    }
    if (el('gps-speed')) el('gps-speed').textContent = `${(p.speed * 3.6).toFixed(1)} km/h`;
    if (el('gps-heading')) {
      const deg = p.heading || 0;
      el('gps-heading').textContent = `${deg.toFixed(0)}°`;
      const compass = document.getElementById('compass-needle');
      if (compass) compass.style.transform = `rotate(${deg}deg)`;
    }
    if (el('gps-dms')) el('gps-dms').textContent = toDMS(p.lat, p.lng);
  }

  function toDMS(lat, lng) {
    const fmt = (val, dirs) => {
      const d = Math.floor(Math.abs(val));
      const m = Math.floor((Math.abs(val) - d) * 60);
      const s = ((Math.abs(val) - d) * 3600 - m * 60).toFixed(2);
      return `${d}°${m}'${s}" ${val >= 0 ? dirs[0] : dirs[1]}`;
    };
    return `${fmt(lat, ['N','S'])} ${fmt(lng, ['E','W'])}`;
  }

  function startCompass() {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().then(state => {
        if (state === 'granted') window.addEventListener('deviceorientation', handleOrientation);
      });
    } else {
      window.addEventListener('deviceorientation', handleOrientation);
    }
  }

  function stopCompass() {
    window.removeEventListener('deviceorientation', handleOrientation);
  }

  function handleOrientation(e) {
    compassHeading = e.webkitCompassHeading || Math.abs(e.alpha - 360);
    const needle = document.getElementById('compass-needle');
    if (needle) needle.style.transform = `rotate(${compassHeading}deg)`;
  }

  function addWaypoint() {
    if (!currentPosition) { App.showToast('GPS belum aktif', 'warning'); return; }
    WaypointManager.openDialog(currentPosition);
  }

  function addListener(fn) { listeners.push(fn); }
  function removeListener(fn) { listeners = listeners.filter(l => l !== fn); }
  function getPosition() { return currentPosition; }
  function getLastPosition() { return currentPosition; }
  function getLastHeading() { return compassHeading || null; }
  function isRunning() { return isActive; }

  return { start, stop, toggle, centerMap, addWaypoint, addListener, removeListener, getPosition, getLastPosition, getLastHeading, isRunning, updatePanel };
})();

window.GPS = GPS;
