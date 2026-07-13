/**
 * app.js — BorneoGIS GeoPDF Explorer — Main Controller
 */

import { initPWA, triggerInstall, dismissInstall, applyUpdate, dismissUpdate } from './pwa.js';
import { initLayers, getLayers, addGeoPDFLayer, addVectorLayer, toggleLayer, setLayerOpacity, removeLayer, reorderLayers } from './layers.js';
import { initPdfViewer, showPdfOnly } from './pdfViewer.js';
import { initGPS, startGPS, stopGPS, setFollowing, getLastPosition, isRunning as gpsRunning } from './gps.js';
import { initTracking, startTrack, pauseTrack, resumeTrack, stopTrack, clearTrack, isRecording, isPaused, isStopped, formatElapsed, getDistance, getPointCount, exportGPX, exportGeoJSON } from './tracking.js';
import { initMeasure, startMeasureDistance, startMeasureArea, clearMeasure, formatDistance, formatArea, formatAreaSub } from './measure.js';
import { initProjectManager, createProject, saveCurrentProject, openProject, removeProject, getAllProjects, refreshList, formatDate, getCurrentProjectId } from './projectManager.js';
import { saveSetting, loadSetting } from './storage.js';

// ---- STATE ----
let map;
let baseLayers  = {};
let activeBase  = 'osm';
let gpsActive   = false;
let followGPS   = false;
let trackTimer  = null;
let dragSrcIdx  = null;

// ---- BOOT ----
document.addEventListener('DOMContentLoaded', async () => {
  initPWA();
  initMap();
  initPdfViewer();
  initSidebar();
  initUpload();
  initGPSPanel();
  initTrackPanel();
  initMeasurePanel();
  initSearchPanel();
  initProjectPanel();
  initBasemapPanel();
  initExportPanel();
  initModals();
  initCoordBar();
  await restoreState();
  hideLoading();
});

// ---- MAP SETUP ----
function initMap() {
  map = L.map('map', {
    center: [0.5, 117.5],
    zoom: 7,
    zoomControl: true
  });

  map.zoomControl.setPosition('bottomright');

  baseLayers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  });

  baseLayers.satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri',
    maxZoom: 19
  });

  baseLayers.topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenTopoMap',
    maxZoom: 17
  });

  baseLayers.osm.addTo(map);

  // Update coord bar on mouse move
  map.on('mousemove', (e) => {
    document.getElementById('coord-cursor').textContent =
      `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
  });
  map.on('zoomend moveend', saveMapState);

  initLayers(map, renderLayerList);
  initGPS(map, onGPSUpdate);
  initTracking(map, onTrackUpdate);
  initMeasure(map, onMeasureResult);
}

// ---- SIDEBAR ----
function initSidebar() {
  const tabs   = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });
}

// ---- UPLOAD ----
function initUpload() {
  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });

  input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });
}

async function handleFiles(fileList) {
  for (const file of fileList) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      const buf = await file.arrayBuffer();
      const res = await addGeoPDFLayer(buf, file.name, null);
      if (res && res.needsBounds) {
        // No embedded georeferencing found — just show the PDF, like Avenza
        // does with an unreferenced map. Placing it on the map is optional,
        // triggered by the "Tempatkan di Peta" button inside the viewer.
        showPdfOnly(res.result.canvas, res.filename);
      }
    } else if (['geojson', 'json', 'kml', 'gpx'].includes(ext)) {
      const text = await file.text();
      await addVectorLayer(text, file.name);
    } else {
      showToast('Format tidak didukung: ' + file.name, 'error');
    }
  }
}

// ---- GPS ----
function initGPSPanel() {
  document.getElementById('btn-gps-toggle').addEventListener('click', toggleGPS);
  document.getElementById('btn-my-location').addEventListener('click', flyToGPS);
  document.getElementById('btn-follow-gps').addEventListener('click', toggleFollow);
}

function toggleGPS() {
  if (gpsActive) {
    stopGPS();
    gpsActive = false;
    document.getElementById('gps-dot').classList.remove('active');
    document.getElementById('gps-status-text').textContent = 'GPS tidak aktif';
    document.getElementById('btn-gps-toggle').textContent = 'Aktifkan GPS';
    document.getElementById('btn-gps-toggle').classList.remove('btn-danger');
    document.getElementById('btn-gps-toggle').classList.add('btn-success');
  } else {
    const ok = startGPS();
    if (!ok) { showToast('GPS tidak tersedia di perangkat ini', 'error'); return; }
    gpsActive = true;
    document.getElementById('gps-dot').classList.add('active');
    document.getElementById('gps-status-text').textContent = 'Menunggu sinyal…';
    document.getElementById('btn-gps-toggle').textContent = 'Nonaktifkan GPS';
    document.getElementById('btn-gps-toggle').classList.remove('btn-success');
    document.getElementById('btn-gps-toggle').classList.add('btn-danger');
  }
}

function flyToGPS() {
  const pos = getLastPosition();
  if (!pos) { showToast('Aktifkan GPS terlebih dahulu', 'info'); return; }
  map.setView([pos.lat, pos.lng], 17, { animate: true });
}

function toggleFollow() {
  followGPS = !followGPS;
  setFollowing(followGPS);
  const btn = document.getElementById('btn-follow-gps');
  btn.classList.toggle('following', followGPS);
  btn.title = followGPS ? 'Berhenti ikuti GPS' : 'Ikuti GPS';
  showToast(followGPS ? 'Mengikuti posisi GPS' : 'Mengikuti dihentikan', 'info');
}

function onGPSUpdate(pos, err) {
  if (err || !pos) {
    if (err) {
      document.getElementById('gps-status-text').textContent = 'Error: ' + err.message;
    }
    return;
  }

  document.getElementById('gps-status-text').textContent = 'Aktif';
  setCardValue('gps-lat',  pos.lat.toFixed(7));
  setCardValue('gps-lng',  pos.lng.toFixed(7));
  setCardValue('gps-acc',  pos.accuracy ? pos.accuracy.toFixed(0) + ' m' : '—');
  setCardValue('gps-spd',  pos.speed != null ? (pos.speed * 3.6).toFixed(1) + ' km/h' : '—');
  setCardValue('gps-head', pos.heading != null ? pos.heading.toFixed(0) + '°' : '—');

  document.getElementById('coord-gps').textContent =
    `GPS ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`;

  saveSetting('lastGPS', { lat: pos.lat, lng: pos.lng });
}

function setCardValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ---- TRACK ----
function initTrackPanel() {
  document.getElementById('btn-track-start').addEventListener('click', () => {
    if (!gpsActive) { showToast('Aktifkan GPS terlebih dahulu', 'info'); return; }
    startTrack();
    updateTrackButtons();
    startTrackTimer();
  });
  document.getElementById('btn-track-pause').addEventListener('click', () => {
    pauseTrack();
    updateTrackButtons();
  });
  document.getElementById('btn-track-resume').addEventListener('click', () => {
    resumeTrack();
    updateTrackButtons();
  });
  document.getElementById('btn-track-stop').addEventListener('click', () => {
    stopTrack();
    updateTrackButtons();
    stopTrackTimer();
  });
  document.getElementById('btn-track-clear').addEventListener('click', () => {
    clearTrack();
    updateTrackButtons();
    stopTrackTimer();
    document.getElementById('track-timer').textContent = '00:00:00';
    document.getElementById('track-dist').textContent = '0 m';
    document.getElementById('track-pts').textContent  = '0';
  });
  document.getElementById('btn-export-gpx').addEventListener('click', () => {
    if (getPointCount() === 0) { showToast('Belum ada data track', 'info'); return; }
    exportGPX();
    showToast('Track diekspor sebagai GPX', 'success');
  });
  document.getElementById('btn-export-track-json').addEventListener('click', () => {
    if (getPointCount() === 0) { showToast('Belum ada data track', 'info'); return; }
    exportGeoJSON();
    showToast('Track diekspor sebagai GeoJSON', 'success');
  });
}

function startTrackTimer() {
  stopTrackTimer();
  trackTimer = setInterval(() => {
    document.getElementById('track-timer').textContent = formatElapsed();
    const d = getDistance();
    document.getElementById('track-dist').textContent = d < 1000
      ? d.toFixed(0) + ' m'
      : (d / 1000).toFixed(2) + ' km';
    document.getElementById('track-pts').textContent = getPointCount();
  }, 1000);
}

function stopTrackTimer() {
  if (trackTimer) { clearInterval(trackTimer); trackTimer = null; }
}

function onTrackUpdate(info) {
  if (!info) return;
  document.getElementById('track-timer').textContent = info.elapsed;
  const d = info.distance;
  document.getElementById('track-dist').textContent = d < 1000
    ? d.toFixed(0) + ' m'
    : (d / 1000).toFixed(2) + ' km';
  document.getElementById('track-pts').textContent = info.points;
}

function updateTrackButtons() {
  document.getElementById('btn-track-start').style.display  = isStopped() ? '' : 'none';
  document.getElementById('btn-track-pause').style.display  = isRecording() ? '' : 'none';
  document.getElementById('btn-track-resume').style.display = isPaused() ? '' : 'none';
  document.getElementById('btn-track-stop').style.display   = (!isStopped()) ? '' : 'none';
}

// ---- MEASURE ----
function initMeasurePanel() {
  document.getElementById('btn-measure-dist').addEventListener('click', () => {
    startMeasureDistance();
    document.getElementById('measure-hint').textContent = 'Klik peta untuk menambah titik. Klik ganda untuk selesai.';
    document.getElementById('measure-result').classList.remove('visible');
    showToast('Mode ukur jarak aktif', 'info');
  });
  document.getElementById('btn-measure-area').addEventListener('click', () => {
    startMeasureArea();
    document.getElementById('measure-hint').textContent = 'Klik peta untuk menambah titik (min 3). Klik ganda untuk selesai.';
    document.getElementById('measure-result').classList.remove('visible');
    showToast('Mode ukur luas aktif', 'info');
  });
  document.getElementById('btn-measure-clear').addEventListener('click', () => {
    clearMeasure();
    document.getElementById('measure-hint').textContent = 'Pilih mode pengukuran di atas.';
    document.getElementById('measure-result').classList.remove('visible');
  });
}

function onMeasureResult(result) {
  const el = document.getElementById('measure-result');
  if (!result) { el.classList.remove('visible'); return; }

  el.classList.add('visible');
  if (result.type === 'distance') {
    document.getElementById('measure-value').textContent = formatDistance(result.metres);
    document.getElementById('measure-sub').textContent =
      result.metres >= 1 ? (result.metres / 1000).toFixed(4) + ' km' : '';
    document.getElementById('measure-label').textContent = 'Jarak';
  } else {
    document.getElementById('measure-value').textContent = formatArea(result.sqMetres);
    document.getElementById('measure-sub').textContent   = formatAreaSub(result.sqMetres);
    document.getElementById('measure-label').textContent = 'Luas';
  }
}

// ---- SEARCH ----
function initSearchPanel() {
  document.getElementById('btn-search-coord').addEventListener('click', searchCoordinate);
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchCoordinate();
  });
}

function searchCoordinate() {
  const raw = document.getElementById('search-input').value.trim();
  if (!raw) return;

  // Try lat,lng
  const latLngMatch = raw.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
  if (latLngMatch) {
    const lat = parseFloat(latLngMatch[1]);
    const lng = parseFloat(latLngMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      flyToCoord(lat, lng);
      return;
    }
  }

  // Try UTM (zone easting northing) — basic
  const utmMatch = raw.match(/^(\d{1,2}[NS]?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i);
  if (utmMatch) {
    showToast('Konversi UTM belum didukung langsung. Masukkan Lat, Lng.', 'info');
    return;
  }

  showToast('Format tidak dikenali. Contoh: -1.234, 116.789', 'error');
}

function flyToCoord(lat, lng) {
  map.flyTo([lat, lng], 15, { duration: 1.2 });
  const marker = L.marker([lat, lng]).addTo(map);
  marker.bindPopup(`<b>Koordinat</b><br>${lat.toFixed(7)}, ${lng.toFixed(7)}`).openPopup();
  setTimeout(() => map.removeLayer(marker), 8000);
  showToast(`Pindah ke ${lat.toFixed(5)}, ${lng.toFixed(5)}`, 'success');
}

// ---- PROJECT ----
function initProjectPanel() {
  initProjectManager(renderProjectList);

  document.getElementById('btn-new-project').addEventListener('click', () => {
    openModal('modal-new-project');
  });
  document.getElementById('btn-save-project').addEventListener('click', async () => {
    const id = getCurrentProjectId();
    if (!id) { showToast('Buat project baru terlebih dahulu', 'info'); return; }
    const center = map.getCenter();
    const mapState = { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
    const layerIds = getLayers().map(l => l.id);
    await saveCurrentProject(mapState, layerIds);
    showToast('Project disimpan', 'success');
  });

  refreshList();
}

async function renderProjectList(projects) {
  const container = document.getElementById('project-list');
  container.innerHTML = '';

  if (!projects.length) {
    container.innerHTML = '<p class="empty-layers">Belum ada project.<br>Buat project pertama Anda.</p>';
    return;
  }

  projects.forEach((proj) => {
    const item = document.createElement('div');
    item.className = 'project-item' + (proj.id === getCurrentProjectId() ? ' active' : '');
    item.innerHTML = `
      <svg class="project-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h6l2 3h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>
      <div class="project-info">
        <div class="project-name">${escapeHTML(proj.name)}</div>
        <div class="project-meta">${formatDate(proj.updatedAt)}</div>
      </div>
      <div class="project-actions">
        <button title="Hapus" data-id="${proj.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    `;

    // Open on click
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.project-actions')) return;
      const p = await openProject(proj.id);
      if (p && p.mapState) {
        map.setView([p.mapState.lat, p.mapState.lng], p.mapState.zoom);
      }
      renderProjectList(await getAllProjects());
      showToast(`Project "${proj.name}" dibuka`, 'success');
    });

    // Delete
    item.querySelector('button').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Hapus project "${proj.name}"?`)) return;
      await removeProject(proj.id);
      showToast('Project dihapus', 'info');
    });

    container.appendChild(item);
  });
}

// ---- BASEMAP ----
function initBasemapPanel() {
  document.querySelectorAll('.basemap-item').forEach((item) => {
    item.addEventListener('click', () => {
      const name = item.dataset.basemap;
      switchBasemap(name);
    });
  });
}

function switchBasemap(name) {
  if (!baseLayers[name]) return;
  Object.values(baseLayers).forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
  baseLayers[name].addTo(map);
  activeBase = name;

  document.querySelectorAll('.basemap-item').forEach(item => {
    item.classList.toggle('active', item.dataset.basemap === name);
  });
  saveSetting('basemap', name);
}

// ---- LAYER LIST ----
function renderLayerList(layers) {
  const container = document.getElementById('layer-list');
  container.innerHTML = '';

  if (!layers.length) {
    container.innerHTML = '<p class="empty-layers">Belum ada layer.<br>Upload GeoPDF, GeoJSON, KML, atau GPX.</p>';
    return;
  }

  layers.forEach((layer, idx) => {
    const item = document.createElement('div');
    item.className = 'layer-item';
    item.draggable = true;
    item.dataset.idx = idx;

    const typeLabel = layer.type === 'pdf' ? 'PDF'
      : layer.type === 'json' ? 'JSON'
      : layer.type.toUpperCase();
    const badgeClass = `badge-${layer.type === 'json' ? 'json' : layer.type}`;

    item.innerHTML = `
      <span class="layer-drag" title="Geser untuk mengubah urutan">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/></svg>
      </span>
      <span class="layer-name" title="${escapeHTML(layer.name)}">${escapeHTML(layer.name)}</span>
      <span class="layer-type-badge ${badgeClass}">${typeLabel}</span>
      <div class="layer-actions">
        <button class="active-toggle ${layer.visible ? 'on' : ''}" title="${layer.visible ? 'Sembunyikan' : 'Tampilkan'}" data-id="${layer.id}">
          ${layer.visible
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'}
        </button>
        <button class="opacity-btn" title="Transparansi" data-id="${layer.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20" opacity=".3"/></svg>
        </button>
        <button class="delete-layer" title="Hapus layer" data-id="${layer.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    `;

    // Opacity row
    const opRow = document.createElement('div');
    opRow.className = 'opacity-row';
    opRow.innerHTML = `<label>Transparansi <span>${Math.round(layer.opacity * 100)}%</span></label>
      <input type="range" min="0" max="1" step="0.05" value="${layer.opacity}">`;
    opRow.querySelector('input').addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      opRow.querySelector('span').textContent = Math.round(val * 100) + '%';
      setLayerOpacity(layer.id, val);
    });

    // Events
    item.querySelector('.active-toggle').addEventListener('click', () => toggleLayer(layer.id));
    item.querySelector('.opacity-btn').addEventListener('click', () => opRow.classList.toggle('open'));
    item.querySelector('.delete-layer').addEventListener('click', async () => {
      await removeLayer(layer.id);
    });

    // Drag to reorder
    item.addEventListener('dragstart', (e) => {
      dragSrcIdx = idx;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragSrcIdx !== null && dragSrcIdx !== idx) {
        reorderLayers(dragSrcIdx, idx);
        dragSrcIdx = null;
      }
    });

    container.appendChild(item);
    container.appendChild(opRow);
  });
}

// ---- EXPORT ----
function initExportPanel() {
  document.getElementById('btn-export-png').addEventListener('click', exportMapPNG);
  document.getElementById('btn-export-zip').addEventListener('click', exportProjectZIP);
}

function exportMapPNG() {
  showToast('Mengekspor peta sebagai PNG…', 'info');
  const mapEl = document.getElementById('map');
  // Use html2canvas or leaflet-image if available
  // Fallback: screenshot instructions
  showToast('Gunakan screenshot perangkat untuk menyimpan peta', 'info');
}

function exportProjectZIP() {
  showToast('Ekspor ZIP belum tersedia di versi ini', 'info');
}

// ---- MODALS ----
function initModals() {
  // New project
  document.getElementById('btn-create-project-confirm').addEventListener('click', async () => {
    const name = document.getElementById('new-project-name').value.trim();
    if (!name) { showToast('Masukkan nama project', 'error'); return; }
    await createProject(name);
    closeModal('modal-new-project');
    document.getElementById('new-project-name').value = '';
    showToast(`Project "${name}" dibuat`, 'success');
  });

  // Bounds modal
  document.getElementById('btn-bounds-confirm').addEventListener('click', applyManualBounds);

  // Close buttons
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Update banner
  document.getElementById('btn-update-now').addEventListener('click', () => { applyUpdate(); });
  document.getElementById('btn-update-later').addEventListener('click', () => { dismissUpdate(); });

  // Install banner
  document.getElementById('btn-install-app').addEventListener('click', triggerInstall);
  document.getElementById('btn-dismiss-install').addEventListener('click', dismissInstall);
}

let _pendingBoundsData = null;

function openBoundsModal(data) {
  _pendingBoundsData = data;
  openModal('modal-bounds');
}

async function applyManualBounds() {
  const minLat = parseFloat(document.getElementById('bounds-min-lat').value);
  const maxLat = parseFloat(document.getElementById('bounds-max-lat').value);
  const minLng = parseFloat(document.getElementById('bounds-min-lng').value);
  const maxLng = parseFloat(document.getElementById('bounds-max-lng').value);

  if ([minLat, maxLat, minLng, maxLng].some(isNaN)) {
    showToast('Isi semua koordinat batas peta', 'error');
    return;
  }

  closeModal('modal-bounds');
  const { buffer, filename } = _pendingBoundsData;
  await addGeoPDFLayer(buffer, filename, { minLat, maxLat, minLng, maxLng });
  _pendingBoundsData = null;
}

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

// ---- COORD BAR ----
function initCoordBar() {
  document.getElementById('coord-cursor').textContent = 'Gerakkan kursor';
  document.getElementById('coord-gps').textContent    = 'GPS —';
  document.getElementById('coord-zoom').textContent   = 'Z' + map.getZoom();
  map.on('zoomend', () => {
    document.getElementById('coord-zoom').textContent = 'Z' + map.getZoom();
  });
}

// ---- RESTORE STATE ----
async function restoreState() {
  const basemap  = await loadSetting('basemap', 'osm');
  const mapState = await loadSetting('mapState', null);
  const lastGPS  = await loadSetting('lastGPS', null);

  switchBasemap(basemap);

  if (mapState) {
    map.setView([mapState.lat, mapState.lng], mapState.zoom);
  } else if (lastGPS) {
    map.setView([lastGPS.lat, lastGPS.lng], 14);
  }
}

async function saveMapState() {
  const center = map.getCenter();
  await saveSetting('mapState', { lat: center.lat, lng: center.lng, zoom: map.getZoom() });
}

// ---- HELPERS ----
function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 400);
  }
}

export function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHTML(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
