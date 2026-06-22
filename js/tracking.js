// tracking.js - Track Recorder for BorneoGIS
const TrackRecorder = (() => {
  let isRecording = false;
  let isPaused = false;
  let trackPoints = [];
  let trackSegments = [];
  let currentSegment = [];
  let trackPolyline = null;
  let startTime = null;
  let totalDistance = 0;
  let trackName = '';
  let gpsListener = null;
  let timerInterval = null;

  function start(name = '') {
    if (isRecording) return;
    trackName = name || `Track ${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString('id-ID')}`;
    isRecording = true;
    isPaused = false;
    trackPoints = [];
    trackSegments = [];
    currentSegment = [];
    totalDistance = 0;
    startTime = Date.now();

    gpsListener = pos => {
      if (!isPaused) addPoint(pos);
    };
    GPS.addListener(gpsListener);

    if (!GPS.isRunning()) GPS.start();

    startTimer();
    updateUI();
    App.showToast(`Rekaman dimulai: ${trackName}`, 'success');
  }

  function pause() {
    if (!isRecording || isPaused) return;
    isPaused = true;
    if (currentSegment.length > 0) {
      trackSegments.push([...currentSegment]);
      currentSegment = [];
    }
    clearInterval(timerInterval);
    updateUI();
    App.showToast('Rekaman dijeda', 'info');
  }

  function resume() {
    if (!isRecording || !isPaused) return;
    isPaused = false;
    startTimer();
    updateUI();
    App.showToast('Rekaman dilanjutkan', 'info');
  }

  function stop() {
    if (!isRecording) return;
    if (currentSegment.length > 0) trackSegments.push([...currentSegment]);
    isRecording = false;
    isPaused = false;
    clearInterval(timerInterval);

    if (gpsListener) {
      GPS.removeListener(gpsListener);
      gpsListener = null;
    }

    if (trackPoints.length < 2) {
      App.showToast('Track terlalu pendek', 'warning');
      updateUI();
      return;
    }

    saveTrack();
    updateUI();
    App.showToast('Track disimpan', 'success');
  }

  function addPoint(pos) {
    const pt = {
      lat: pos.lat, lng: pos.lng,
      alt: pos.altitude || 0,
      acc: pos.accuracy,
      time: new Date().toISOString(),
      speed: pos.speed || 0
    };

    // Filter bad accuracy
    if (pos.accuracy > 50) return;

    if (trackPoints.length > 0) {
      const last = trackPoints[trackPoints.length - 1];
      const d = turf.distance([last.lng, last.lat], [pt.lng, pt.lat], { units: 'meters' });
      if (d < 2) return; // Skip if < 2m movement
      totalDistance += d;
    }

    trackPoints.push(pt);
    currentSegment.push([pt.lat, pt.lng]);
    updatePolyline();
    updateStats();
  }

  function updatePolyline() {
    if (!MapManager.map) return;
    const allSegments = [...trackSegments, currentSegment].filter(s => s.length > 0);
    if (allSegments.length === 0) return;

    if (!trackPolyline) {
      trackPolyline = L.polyline([], { color: '#00d4ff', weight: 3, opacity: 0.8 }).addTo(MapManager.map);
    }
    trackPolyline.setLatLngs(allSegments);
  }

  function updateStats() {
    const elapsed = Date.now() - startTime;
    const elEl = document.getElementById('track-distance');
    const ptEl = document.getElementById('track-points');
    if (elEl) elEl.textContent = totalDistance >= 1000 ? `${(totalDistance/1000).toFixed(2)} km` : `${totalDistance.toFixed(0)} m`;
    if (ptEl) ptEl.textContent = trackPoints.length;
  }

  function startTimer() {
    timerInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const h = Math.floor(elapsed / 3600000);
      const m = Math.floor((elapsed % 3600000) / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      const el = document.getElementById('track-timer');
      if (el) el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }, 1000);
  }

  async function saveTrack() {
    const project = ProjectManager.getCurrent();
    const track = {
      id: `trk_${Date.now()}`,
      projectId: project ? project.id : 'default',
      name: trackName,
      points: trackPoints,
      segments: trackSegments,
      distance: totalDistance,
      duration: Date.now() - startTime,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date().toISOString()
    };
    await Storage.put(Storage.STORES.TRACKS, track);
    LayerManager.addTrackLayer(track);
    return track;
  }

  function updateUI() {
    const startBtn = document.getElementById('track-start');
    const pauseBtn = document.getElementById('track-pause');
    const stopBtn = document.getElementById('track-stop');
    const panel = document.getElementById('panel-tracks');

    if (startBtn) startBtn.style.display = isRecording ? 'none' : 'flex';
    if (pauseBtn) {
      pauseBtn.style.display = isRecording ? 'flex' : 'none';
      const span = pauseBtn.querySelector('span');
      if (span) span.textContent = isPaused ? 'Resume' : 'Pause';
    }
    if (stopBtn) stopBtn.style.display = isRecording ? 'flex' : 'none';
    if (panel) panel.classList.toggle('recording', isRecording);
  }

  function exportGPX(track) {
    const pts = track.points.map(p =>
      `<trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.alt}</ele><time>${p.time}</time></trkpt>`
    ).join('\n      ');

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BorneoGIS Explorer" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${track.name}</name><time>${track.startTime}</time></metadata>
  <trk>
    <name>${track.name}</name>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>`;
    downloadFile(gpx, `${track.name}.gpx`, 'application/gpx+xml');
  }

  function exportGeoJSON(track) {
    const coords = track.points.map(p => [p.lng, p.lat, p.alt]);
    const geojson = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {
          name: track.name,
          distance: track.distance,
          duration: track.duration,
          startTime: track.startTime,
          endTime: track.endTime
        }
      }]
    };
    downloadFile(JSON.stringify(geojson, null, 2), `${track.name}.geojson`, 'application/geo+json');
  }

  function exportKML(track) {
    const coords = track.points.map(p => `${p.lng},${p.lat},${p.alt}`).join(' ');
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>${track.name}</name>
    <Placemark><name>${track.name}</name>
      <LineString><altitudeMode>clampToGround</altitudeMode><coordinates>${coords}</coordinates></LineString>
    </Placemark>
  </Document>
</kml>`;
    downloadFile(kml, `${track.name}.kml`, 'application/vnd.google-earth.kml+xml');
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  async function loadAllTracks() {
    const project = ProjectManager.getCurrent();
    if (!project) return [];
    return Storage.getByIndex(Storage.STORES.TRACKS, 'projectId', project.id);
  }

  return { start, pause, resume, stop, exportGPX, exportGeoJSON, exportKML, loadAllTracks, isRecording: () => isRecording };
})();

window.TrackRecorder = TrackRecorder;
