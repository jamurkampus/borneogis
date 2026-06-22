// app.js - Main Application Controller for BorneoGIS Explorer
'use strict';

// ============================================================
// WAYPOINT MANAGER
// ============================================================
const WaypointManager = (() => {
  let waypoints = [];

  async function loadWaypoints() {
    const project = ProjectManager.getCurrent();
    if (!project) return;
    waypoints = await Storage.getByIndex(Storage.STORES.WAYPOINTS, 'projectId', project.id);
    waypoints.forEach(wp => LayerManager.addWaypointLayer(wp));
    renderWaypointList();
  }

  function openDialog(position = null) {
    const modal = document.getElementById('waypoint-modal');
    if (!modal) return;

    document.getElementById('wp-lat').value = position ? position.lat.toFixed(8) : '';
    document.getElementById('wp-lng').value = position ? position.lng.toFixed(8) : '';
    document.getElementById('wp-alt').value = position ? (position.altitude || 0).toFixed(1) : '';
    document.getElementById('wp-name').value = `WP-${Date.now().toString().slice(-5)}`;
    document.getElementById('wp-category').value = 'General';
    document.getElementById('wp-notes').value = '';
    modal.style.display = 'flex';

    // Allow click on map if no position given
    if (!position) {
      modal.style.display = 'none';
      App.showToast('Klik lokasi pada peta untuk waypoint', 'info');
      MapManager.map.once('click', e => {
        document.getElementById('wp-lat').value = e.latlng.lat.toFixed(8);
        document.getElementById('wp-lng').value = e.latlng.lng.toFixed(8);
        modal.style.display = 'flex';
      });
    }
  }

  async function saveWaypoint() {
    const project = ProjectManager.getCurrent();
    const wp = {
      id: `wp_${Date.now()}`,
      projectId: project ? project.id : 'default',
      name: document.getElementById('wp-name').value || `WP-${Date.now()}`,
      category: document.getElementById('wp-category').value || 'General',
      notes: document.getElementById('wp-notes').value || '',
      lat: parseFloat(document.getElementById('wp-lat').value),
      lng: parseFloat(document.getElementById('wp-lng').value),
      altitude: parseFloat(document.getElementById('wp-alt').value) || 0,
      color: document.getElementById('wp-color')?.value || '#ff4757',
      timestamp: new Date().toISOString(),
      photos: []
    };

    if (isNaN(wp.lat) || isNaN(wp.lng)) {
      App.showToast('Koordinat tidak valid', 'error');
      return;
    }

    await Storage.put(Storage.STORES.WAYPOINTS, wp);
    waypoints.push(wp);
    LayerManager.addWaypointLayer(wp);
    renderWaypointList();
    document.getElementById('waypoint-modal').style.display = 'none';
    App.showToast(`Waypoint "${wp.name}" disimpan`, 'success');
  }

  async function deleteWaypoint(id) {
    await Storage.remove(Storage.STORES.WAYPOINTS, id);
    waypoints = waypoints.filter(w => w.id !== id);
    LayerManager.removeLayer(`wp_${id}`);
    renderWaypointList();
  }

  function renderWaypointList() {
    const container = document.getElementById('waypoint-list');
    if (!container) return;
    if (waypoints.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="icon-waypoint"></i><p>Belum ada waypoint</p></div>';
      return;
    }
    container.innerHTML = waypoints.map(wp => `
      <div class="wp-item" data-id="${wp.id}">
        <div class="wp-color-dot" style="background:${wp.color || '#ff4757'}"></div>
        <div class="wp-info">
          <div class="wp-name">${wp.name}</div>
          <div class="wp-meta">${wp.category} · ${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}</div>
        </div>
        <div class="wp-actions">
          <button onclick="MapManager.map.setView([${wp.lat},${wp.lng}],16)" title="Zoom ke Waypoint">⊕</button>
          <button onclick="WaypointManager.deleteWaypoint('${wp.id}')" title="Hapus">✕</button>
        </div>
      </div>`).join('');
  }

  function getAllWaypoints() { return waypoints; }

  return { loadWaypoints, openDialog, saveWaypoint, deleteWaypoint, renderWaypointList, getAllWaypoints };
})();

window.WaypointManager = WaypointManager;

// ============================================================
// MAIN APP CONTROLLER
// ============================================================
const App = (() => {
  let activePanel = null;
  let darkMode = true;
  let contextMenuEl = null;

  async function init() {
    // Init storage first
    await Storage.init();

    // Init map
    MapManager.init();

    // Init PWA
    await PWAManager.init();
    PWAManager.setupOfflineIndicator();

    // Load or create default project
    await initProject();

    // Setup UI events
    setupUI();
    setupDragDrop();
    setupSearch();

    // Load saved data
    await WaypointManager.loadWaypoints();
    if (window.PhotoMapping) await PhotoMapping.loadPhotos();

    // Set theme
    const savedTheme = await Storage.getSetting('theme', 'dark');
    setTheme(savedTheme);

    // Handle URL actions
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'gps') GPS.start();
    if (params.get('action') === 'new-survey') openPanel('project');

    console.log('BorneoGIS Explorer v1.0.0 ready');
  }

  async function initProject() {
    let projects = await ProjectManager.getAllProjects();
    if (projects.length === 0) {
      await ProjectManager.createProject('Proyek Default');
    } else {
      // Load most recent
      const latest = projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
      await ProjectManager.openProject(latest.id);
    }
    updateProjectHeader();
  }

  function updateProjectHeader() {
    const p = ProjectManager.getCurrent();
    const el = document.getElementById('project-name');
    if (el && p) el.textContent = p.name;
  }

  function setupUI() {
    // Panel toggles
    document.querySelectorAll('[data-panel]').forEach(btn => {
      btn.addEventListener('click', () => togglePanel(btn.dataset.panel));
    });

    // Basemap buttons
    document.querySelectorAll('.basemap-btn').forEach(btn => {
      btn.addEventListener('click', () => MapManager.switchBasemap(btn.dataset.basemap));
    });

    // GPS button
    document.getElementById('gps-btn')?.addEventListener('click', GPS.toggle.bind(GPS));
    document.getElementById('gps-center-btn')?.addEventListener('click', GPS.centerMap.bind(GPS));

    // Track buttons
    document.getElementById('track-start')?.addEventListener('click', () => {
      const name = prompt('Nama track (kosong untuk auto):') || '';
      TrackRecorder.start(name);
    });
    document.getElementById('track-pause')?.addEventListener('click', () => {
      TrackRecorder.isRecording() ? TrackRecorder.pause() : TrackRecorder.resume();
    });
    document.getElementById('track-stop')?.addEventListener('click', TrackRecorder.stop.bind(TrackRecorder));

    // Waypoint
    document.getElementById('add-waypoint-btn')?.addEventListener('click', () => WaypointManager.openDialog());
    document.getElementById('gps-waypoint-btn')?.addEventListener('click', GPS.addWaypoint.bind(GPS));
    document.getElementById('wp-save-btn')?.addEventListener('click', WaypointManager.saveWaypoint.bind(WaypointManager));
    document.getElementById('wp-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('waypoint-modal').style.display = 'none';
    });

    // Draw tools
    document.querySelectorAll('[data-draw]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-draw]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        MapManager.startDraw(btn.dataset.draw);
      });
    });

    // Measure tools
    document.querySelector('[data-measure="distance"]')?.addEventListener('click', () => MapManager.startMeasure('distance'));
    document.querySelector('[data-measure="area"]')?.addEventListener('click', () => MapManager.startMeasure('area'));

    // Install button
    document.getElementById('install-btn')?.addEventListener('click', PWAManager.promptInstall.bind(PWAManager));
    document.getElementById('install-banner-btn')?.addEventListener('click', PWAManager.promptInstall.bind(PWAManager));
    document.getElementById('install-banner-close')?.addEventListener('click', () => {
      document.getElementById('install-banner').style.display = 'none';
    });

    // Update modal
    document.getElementById('update-now-btn')?.addEventListener('click', PWAManager.applyUpdate.bind(PWAManager));
    document.getElementById('update-later-btn')?.addEventListener('click', PWAManager.dismissUpdate.bind(PWAManager));

    // Export
    document.getElementById('export-all-geojson')?.addEventListener('click', () => ExportManager.exportGeoJSON(null, 'borneogis_export'));
    document.getElementById('export-all-kml')?.addEventListener('click', () => ExportManager.exportKML(null, 'borneogis_export'));
    document.getElementById('export-map-png')?.addEventListener('click', () => ExportManager.exportMapPNG());
    document.getElementById('export-waypoints-csv')?.addEventListener('click', () =>
      ExportManager.exportWaypointsCSV(WaypointManager.getAllWaypoints()));

    // Theme toggle
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

    // Analysis modal close
    document.getElementById('analysis-result-close')?.addEventListener('click', () => {
      document.getElementById('analysis-result-modal').style.display = 'none';
    });

    // Feature attr modal
    document.getElementById('attr-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('feature-attr-modal').style.display = 'none';
    });

    // Export modal close
    document.getElementById('export-modal-close')?.addEventListener('click', () => {
      document.getElementById('export-modal').style.display = 'none';
    });

    // Analysis panel buttons
    document.getElementById('analysis-area-btn')?.addEventListener('click', () => {
      const layers = LayerManager.getAll().filter(l => l.type !== 'geopdf');
      if (layers.length === 0) { showToast('Tidak ada layer untuk dianalisis', 'warning'); return; }
      Analysis.calculateArea(layers[0].id);
    });
    document.getElementById('analysis-length-btn')?.addEventListener('click', () => {
      const layers = LayerManager.getAll().filter(l => l.type !== 'geopdf');
      if (layers.length === 0) { showToast('Tidak ada layer', 'warning'); return; }
      Analysis.calculateLength(layers[0].id);
    });
    document.getElementById('analysis-buffer-btn')?.addEventListener('click', () => {
      const layers = LayerManager.getAll().filter(l => l.type !== 'geopdf');
      if (layers.length === 0) { showToast('Tidak ada layer', 'warning'); return; }
      const dist = parseFloat(prompt('Jarak buffer (meter):'));
      if (!isNaN(dist) && dist > 0) Analysis.runBuffer(layers[0].id, dist);
    });

    // Project panel buttons
    document.getElementById('new-project-btn')?.addEventListener('click', newProject);
    document.getElementById('save-project-btn')?.addEventListener('click', saveCurrentProject);

    // Close panels on escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeAllPanels();
        hideContextMenu();
      }
    });

    // Context menu
    contextMenuEl = document.getElementById('context-menu');
    document.addEventListener('click', e => {
      if (!e.target.closest('#context-menu')) hideContextMenu();
    });

    // Map right click
    MapManager.map.on('contextmenu', e => {
      showMapContextMenu(e);
    });

    // File upload via input
    document.getElementById('file-upload-input')?.addEventListener('change', e => {
      Array.from(e.target.files).forEach(f => MapManager.loadSpatialFile(f));
      e.target.value = '';
    });
  }

  function setupDragDrop() {
    const mapEl = document.getElementById('map');
    mapEl.addEventListener('dragover', e => { e.preventDefault(); mapEl.classList.add('drag-over-map'); });
    mapEl.addEventListener('dragleave', () => mapEl.classList.remove('drag-over-map'));
    mapEl.addEventListener('drop', e => {
      e.preventDefault();
      mapEl.classList.remove('drag-over-map');
      Array.from(e.dataTransfer.files).forEach(f => MapManager.loadSpatialFile(f));
    });
  }

  function setupSearch() {
    const input = document.getElementById('search-input');
    const btn = document.getElementById('search-btn');
    const search = () => {
      const q = input?.value?.trim();
      if (q) MapManager.search(q);
    };
    btn?.addEventListener('click', search);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  }

  function togglePanel(name) {
    const panel = document.getElementById(`panel-${name}`);
    if (!panel) return;
    const isOpen = panel.classList.contains('open');
    closeAllPanels();
    if (!isOpen) {
      panel.classList.add('open');
      activePanel = name;
      // Update panel content
      if (name === 'layers') LayerManager.renderLayerTree();
      if (name === 'waypoints') WaypointManager.renderWaypointList();
      if (name === 'project') renderProjectList();
      if (name === 'tracks') renderTrackList();
    } else {
      activePanel = null;
    }
  }

  function openPanel(name) {
    closeAllPanels();
    const panel = document.getElementById(`panel-${name}`);
    if (panel) { panel.classList.add('open'); activePanel = name; }
  }

  function closeAllPanels() {
    document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));
    activePanel = null;
  }

  function showMapContextMenu(e) {
    const { lat, lng } = e.latlng;
    const menu = document.getElementById('context-menu');
    menu.innerHTML = `
      <div class="ctx-header">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
      <div class="ctx-item" onclick="WaypointManager.openDialog({lat:${lat},lng:${lng},altitude:0,accuracy:0}); App.hideContextMenu()">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
        Tambah Waypoint di sini
      </div>
      <div class="ctx-item" onclick="navigator.clipboard.writeText('${lat.toFixed(8)}, ${lng.toFixed(8)}'); App.hideContextMenu(); App.showToast('Koordinat disalin','info')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        Salin Koordinat
      </div>
      <div class="ctx-item" onclick="MapManager.map.setView([${lat},${lng}],18); App.hideContextMenu()">
        Zoom ke Sini
      </div>
    `;
    showContextMenu(menu, e.originalEvent);
  }

  function showContextMenu(menu, event) {
    const x = event.clientX;
    const y = event.clientY;
    menu.style.display = 'block';
    menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 150)}px`;
  }

  function hideContextMenu() {
    if (contextMenuEl) contextMenuEl.style.display = 'none';
  }

  async function newProject() {
    const name = prompt('Nama proyek baru:');
    if (!name) return;
    await ProjectManager.createProject(name);
    updateProjectHeader();
    renderProjectList();
    showToast(`Proyek "${name}" dibuat`, 'success');
  }

  async function saveCurrentProject() {
    await ProjectManager.saveProject({
      mapCenter: MapManager.map.getCenter(),
      mapZoom: MapManager.map.getZoom()
    });
    showToast('Proyek disimpan', 'success');
  }

  async function renderProjectList() {
    const container = document.getElementById('project-list');
    if (!container) return;
    const projects = await ProjectManager.getAllProjects();
    const current = ProjectManager.getCurrent();

    container.innerHTML = projects.sort((a,b) => new Date(b.updatedAt)-new Date(a.updatedAt)).map(p => `
      <div class="project-item ${current && p.id === current.id ? 'active' : ''}">
        <div class="project-icon">📁</div>
        <div class="project-info">
          <div class="project-name">${p.name}</div>
          <div class="project-meta">${new Date(p.updatedAt).toLocaleDateString('id-ID')}</div>
        </div>
        <div class="project-actions">
          <button onclick="ProjectManager.openProject('${p.id}').then(()=>{ App.updateProjectHeader(); App.showToast('Proyek dibuka','success'); })" title="Buka">📂</button>
          <button onclick="ProjectManager.backupProject('${p.id}')" title="Backup">💾</button>
          <button onclick="ProjectManager.deleteProject('${p.id}').then(()=>{ App.renderProjectList(); App.showToast('Dihapus','info'); })" title="Hapus">🗑</button>
        </div>
      </div>`).join('');
  }

  async function renderTrackList() {
    const container = document.getElementById('track-list');
    if (!container) return;
    const tracks = await TrackRecorder.loadAllTracks();

    container.innerHTML = tracks.length === 0 ? '<div class="empty-state"><p>Belum ada track</p></div>' :
      tracks.map(t => `
        <div class="track-item">
          <div class="track-info">
            <div class="track-name">${t.name}</div>
            <div class="track-meta">
              ${t.distance >= 1000 ? (t.distance/1000).toFixed(2)+'km' : t.distance.toFixed(0)+'m'} · 
              ${t.points.length} titik
            </div>
          </div>
          <div class="track-actions">
            <button onclick="TrackRecorder.exportGPX(${JSON.stringify(t).replace(/"/g,'&quot;')})" title="GPX">GPX</button>
            <button onclick="TrackRecorder.exportGeoJSON(${JSON.stringify(t).replace(/"/g,'&quot;')})" title="GeoJSON">JSON</button>
          </div>
        </div>`).join('');
  }

  function setTheme(theme) {
    darkMode = theme === 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    Storage.setSetting('theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = darkMode ? '☀️' : '🌙';
  }

  function toggleTheme() {
    setTheme(darkMode ? 'light' : 'dark');
  }

  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}</span>
      <span class="toast-message">${message}</span>
    `;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function showLoading(text = 'Memuat...') {
    const el = document.getElementById('loading-overlay');
    if (el) {
      el.querySelector('.loading-text').textContent = text;
      el.style.display = 'flex';
    }
  }

  function hideLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = 'none';
  }

  return {
    init, showToast, showLoading, hideLoading,
    showContextMenu, hideContextMenu, togglePanel, openPanel, closeAllPanels,
    updateProjectHeader, renderProjectList, setTheme
  };
})();

window.App = App;
window.addEventListener('load', App.init.bind(App));
