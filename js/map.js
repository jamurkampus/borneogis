// map.js - Core Map Manager for BorneoGIS Explorer
const MapManager = (() => {
  let map = null;
  let currentBasemap = 'osm';
  let basemapLayers = {};
  let drawControl = null;
  let drawingLayer = null;
  let measureMode = null;
  let measureLayer = null;
  let measurePoints = [];
  let tooltipEl = null;

  const BASEMAPS = {
    osm: {
      name: 'OpenStreetMap',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    },
    satellite: {
      name: 'Esri Satellite',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '© Esri, DigitalGlobe',
      maxZoom: 19
    },
    topo: {
      name: 'OpenTopoMap',
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      attribution: '© OpenTopoMap',
      maxZoom: 17
    },
    carto: {
      name: 'CartoDB Dark',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '© CARTO',
      maxZoom: 19
    },
    terrain: {
      name: 'Stamen Terrain',
      url: 'https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg',
      attribution: '© Stamen Design',
      maxZoom: 18
    }
  };

  function init() {
    map = L.map('map', {
      center: [-0.7893, 113.9213],
      zoom: 6,
      zoomControl: false,
      attributionControl: true
    });

    // Custom zoom position
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Load default basemap
    switchBasemap('osm');

    // Setup draw layer
    drawingLayer = new L.FeatureGroup().addTo(map);

    // Setup draw control (hidden, triggered programmatically)
    setupDrawControl();

    // Map events
    map.on('click', onMapClick);
    map.on('mousemove', onMapMouseMove);
    map.on('moveend', saveMapState);
    map.on('zoomend', updateZoomDisplay);

    // Restore last map state
    restoreMapState();

    // Coordinates display
    setupCoordinateDisplay();

    // Scale bar
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

    return map;
  }

  function setupDrawControl() {
    drawControl = new L.Control.Draw({
      edit: { featureGroup: drawingLayer, remove: true },
      draw: {
        polyline: { shapeOptions: { color: '#00d4ff', weight: 2 } },
        polygon: { allowIntersection: false, shapeOptions: { color: '#00d4ff', weight: 2, fillOpacity: 0.2 } },
        circle: false,
        rectangle: { shapeOptions: { color: '#00d4ff', weight: 2 } },
        marker: { icon: createWaypointIcon('#00d4ff') },
        circlemarker: false
      }
    });

    map.on(L.Draw.Event.CREATED, e => {
      const layer = e.layer;
      drawingLayer.addLayer(layer);

      // Store as a named layer
      const geom = e.layerType;
      const id = `draw_${Date.now()}`;
      const props = {};

      // Show attribute dialog for new features
      showFeatureAttributeDialog(layer, geom, id);
    });

    map.on(L.Draw.Event.EDITED, e => {
      e.layers.eachLayer(l => {
        // Update stored feature
      });
    });

    map.on(L.Draw.Event.DELETED, e => {
      e.layers.eachLayer(l => {
        // Remove from storage
      });
    });
  }

  function showFeatureAttributeDialog(layer, geomType, id) {
    const modal = document.getElementById('feature-attr-modal');
    if (!modal) {
      // Quick add as layer
      const featureGroup = L.featureGroup([layer]);
      LayerManager.addLayer({
        name: `${geomType} ${new Date().toLocaleTimeString('id-ID')}`,
        type: 'digitize',
        leafletLayer: featureGroup,
        color: '#00d4ff'
      });
      return;
    }
    document.getElementById('attr-geom-type').textContent = geomType;
    modal.style.display = 'flex';
    document.getElementById('attr-save-btn').onclick = () => {
      const name = document.getElementById('attr-name').value || `${geomType}_${Date.now()}`;
      const desc = document.getElementById('attr-desc').value;
      const cat = document.getElementById('attr-category').value;
      if (layer.bindPopup) {
        layer.bindPopup(`<b>${name}</b><br>${cat ? `Kategori: ${cat}<br>` : ''}${desc || ''}`);
      }
      const featureGroup = L.featureGroup([layer]);
      LayerManager.addLayer({ name, type: 'digitize', leafletLayer: featureGroup, color: '#00d4ff' });
      modal.style.display = 'none';
    };
  }

  function startDraw(type) {
    if (!drawControl._map) drawControl.addTo(map);
    let handler;
    switch (type) {
      case 'point': handler = new L.Draw.Marker(map, drawControl.options.draw.marker); break;
      case 'line': handler = new L.Draw.Polyline(map, drawControl.options.draw.polyline); break;
      case 'polygon': handler = new L.Draw.Polygon(map, drawControl.options.draw.polygon); break;
      case 'rectangle': handler = new L.Draw.Rectangle(map, drawControl.options.draw.rectangle); break;
    }
    if (handler) handler.enable();
  }

  function stopDraw() {
    map.off(L.Draw.Event.CREATED);
    drawingLayer.clearLayers();
  }

  function startMeasure(mode) {
    measureMode = mode;
    measurePoints = [];
    if (measureLayer) { map.removeLayer(measureLayer); measureLayer = null; }
    measureLayer = L.featureGroup().addTo(map);
    map.getContainer().style.cursor = 'crosshair';
    document.getElementById('measure-tooltip').style.display = 'block';
    document.getElementById('measure-tooltip').textContent = mode === 'distance' ? 'Klik untuk mengukur jarak' : 'Klik untuk mengukur area';

    map.on('click', onMeasureClick);
    map.on('dblclick', stopMeasure);
    App.showToast(`Mode ukur ${mode === 'distance' ? 'jarak' : 'area'} aktif. Klik peta, dblclick untuk selesai.`, 'info');
  }

  function onMeasureClick(e) {
    measurePoints.push(e.latlng);
    L.circleMarker(e.latlng, { radius: 4, color: '#ff4757', fillColor: '#ff4757', fillOpacity: 1 }).addTo(measureLayer);

    if (measurePoints.length >= 2) {
      L.polyline(measurePoints, { color: '#ff4757', weight: 2, dashArray: '6,4' }).addTo(measureLayer);
    }

    const tooltip = document.getElementById('measure-tooltip');
    if (measureMode === 'distance' && measurePoints.length >= 2) {
      const dist = Analysis.measureDistance(measurePoints);
      tooltip.textContent = dist >= 1000 ? `${(dist/1000).toFixed(3)} km` : `${dist.toFixed(1)} m`;
    } else if (measureMode === 'area' && measurePoints.length >= 3) {
      const area = Analysis.measureArea(measurePoints);
      tooltip.textContent = area >= 10000 ? `${(area/10000).toFixed(4)} Ha` : `${area.toFixed(2)} m²`;
    }
  }

  function stopMeasure() {
    measureMode = null;
    map.off('click', onMeasureClick);
    map.off('dblclick', stopMeasure);
    map.getContainer().style.cursor = '';
    setTimeout(() => {
      if (measureLayer) { map.removeLayer(measureLayer); measureLayer = null; }
      document.getElementById('measure-tooltip').style.display = 'none';
    }, 2000);
  }

  function onMapClick(e) {
    if (measureMode) return;
    document.getElementById('coord-display').textContent = `${e.latlng.lat.toFixed(8)}, ${e.latlng.lng.toFixed(8)}`;
  }

  function onMapMouseMove(e) {
    const el = document.getElementById('mouse-coords');
    if (el) el.textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
  }

  function setupCoordinateDisplay() {
    const display = L.control({ position: 'bottomleft' });
    display.onAdd = () => {
      const div = L.DomUtil.create('div', 'coord-control');
      div.id = 'mouse-coords';
      div.textContent = '0.000000, 0.000000';
      return div;
    };
    display.addTo(map);
  }

  function switchBasemap(key) {
    if (basemapLayers[currentBasemap]) {
      map.removeLayer(basemapLayers[currentBasemap]);
    }

    if (!basemapLayers[key]) {
      const cfg = BASEMAPS[key];
      basemapLayers[key] = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        maxZoom: cfg.maxZoom,
        crossOrigin: true
      });
    }

    basemapLayers[key].addTo(map);
    basemapLayers[key].bringToBack();
    currentBasemap = key;

    // Update UI
    document.querySelectorAll('.basemap-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.basemap === key);
    });

    Storage.setSetting('lastBasemap', key);
  }

  function saveMapState() {
    if (!map) return;
    Storage.setSetting('mapState', {
      center: map.getCenter(),
      zoom: map.getZoom()
    });
  }

  async function restoreMapState() {
    const state = await Storage.getSetting('mapState');
    if (state) {
      map.setView([state.center.lat, state.center.lng], state.zoom);
    }
    const basemap = await Storage.getSetting('lastBasemap', 'osm');
    switchBasemap(basemap);
  }

  function updateZoomDisplay() {
    const el = document.getElementById('zoom-display');
    if (el) el.textContent = `Zoom: ${map.getZoom()}`;
  }

  function createWaypointIcon(color = '#00d4ff') {
    return L.divIcon({
      className: '',
      html: `<div class="wp-marker" style="background:${color}"><svg viewBox="0 0 24 24" width="14" height="14" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></div>`,
      iconSize: [32, 40],
      iconAnchor: [16, 40],
      popupAnchor: [0, -40]
    });
  }

  async function loadSpatialFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    App.showLoading(`Memuat ${file.name}...`);

    try {
      switch (ext) {
        case 'geojson':
        case 'json':
          await loadGeoJSON(file);
          break;
        case 'kml':
          await loadKML(file);
          break;
        case 'gpx':
          await loadGPX(file);
          break;
        case 'csv':
          await loadCSV(file);
          break;
        case 'pdf':
          await GeoPDFEngine.loadGeoPDF(file);
          break;
        case 'zip':
          await loadShapefile(file);
          break;
        default:
          App.showToast(`Format ${ext} belum didukung`, 'warning');
      }
    } catch (e) {
      App.showToast(`Gagal memuat ${file.name}: ${e.message}`, 'error');
      console.error(e);
    }
    App.hideLoading();
  }

  async function loadGeoJSON(file) {
    const text = await file.text();
    const geojson = JSON.parse(text);
    const count = geojson.features ? geojson.features.length : 1;

    const leafletLayer = L.geoJSON(geojson, {
      style: f => ({ color: '#00d4ff', weight: 2, opacity: 0.8, fillOpacity: 0.2 }),
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, fillColor: '#00d4ff', color: '#fff', weight: 1, fillOpacity: 0.9 }),
      onEachFeature: (f, l) => {
        if (f.properties) {
          const content = Object.entries(f.properties)
            .filter(([k,v]) => v !== null)
            .map(([k,v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`)
            .join('');
          l.bindPopup(`<table class="popup-table">${content}</table>`, { maxWidth: 300 });
        }
      }
    });

    const id = LayerManager.addLayer({
      name: file.name.replace('.geojson', '').replace('.json', ''),
      type: 'geojson',
      leafletLayer,
      color: '#00d4ff'
    });

    if (leafletLayer.getBounds().isValid()) {
      map.fitBounds(leafletLayer.getBounds(), { padding: [20, 20] });
    }
    App.showToast(`GeoJSON dimuat: ${count} fitur`, 'success');
  }

  async function loadKML(file) {
    const text = await file.text();
    const parser = new DOMParser();
    const kmlDoc = parser.parseFromString(text, 'text/xml');

    // Simple KML parser
    const placemarks = kmlDoc.querySelectorAll('Placemark');
    const features = [];

    placemarks.forEach(pm => {
      const name = pm.querySelector('name')?.textContent || '';
      const desc = pm.querySelector('description')?.textContent || '';
      const point = pm.querySelector('Point coordinates');
      const line = pm.querySelector('LineString coordinates');
      const poly = pm.querySelector('Polygon outerBoundaryIs LinearRing coordinates');

      if (point) {
        const [lng, lat, alt] = point.textContent.trim().split(',').map(Number);
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat, alt||0] }, properties: { name, description: desc } });
      } else if (line) {
        const coords = line.textContent.trim().split(/\s+/).map(c => c.split(',').map(Number));
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { name, description: desc } });
      } else if (poly) {
        const coords = poly.textContent.trim().split(/\s+/).map(c => c.split(',').map(Number));
        features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: { name, description: desc } });
      }
    });

    if (features.length === 0) throw new Error('Tidak ada fitur valid dalam KML');

    const geojson = { type: 'FeatureCollection', features };
    const leafletLayer = L.geoJSON(geojson, {
      style: { color: '#f39c12', weight: 2, fillOpacity: 0.2 },
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, fillColor: '#f39c12', color: '#fff', weight: 1, fillOpacity: 0.9 }),
      onEachFeature: (f, l) => {
        if (f.properties?.name) l.bindPopup(`<b>${f.properties.name}</b><br>${f.properties.description || ''}`);
      }
    });

    LayerManager.addLayer({ name: file.name.replace('.kml', ''), type: 'geojson', leafletLayer, color: '#f39c12' });
    if (leafletLayer.getBounds().isValid()) map.fitBounds(leafletLayer.getBounds(), { padding: [20,20] });
    App.showToast(`KML dimuat: ${features.length} fitur`, 'success');
  }

  async function loadGPX(file) {
    const text = await file.text();
    const parser = new DOMParser();
    const gpxDoc = parser.parseFromString(text, 'text/xml');
    const tracks = gpxDoc.querySelectorAll('trk');
    const waypoints = gpxDoc.querySelectorAll('wpt');
    const features = [];

    tracks.forEach(trk => {
      const name = trk.querySelector('name')?.textContent || 'Track';
      const segments = trk.querySelectorAll('trkseg');
      segments.forEach(seg => {
        const pts = seg.querySelectorAll('trkpt');
        const coords = Array.from(pts).map(pt => [
          parseFloat(pt.getAttribute('lon')),
          parseFloat(pt.getAttribute('lat')),
          parseFloat(pt.querySelector('ele')?.textContent || 0)
        ]);
        if (coords.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { name } });
      });
    });

    waypoints.forEach(wpt => {
      const lat = parseFloat(wpt.getAttribute('lat'));
      const lon = parseFloat(wpt.getAttribute('lon'));
      const name = wpt.querySelector('name')?.textContent || 'Waypoint';
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name } });
    });

    const geojson = { type: 'FeatureCollection', features };
    const leafletLayer = L.geoJSON(geojson, {
      style: { color: '#2ecc71', weight: 2 },
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 5, fillColor: '#2ecc71', color: '#fff', weight: 1, fillOpacity: 0.9 })
        .bindPopup(`<b>${f.properties?.name}</b>`)
    });

    LayerManager.addLayer({ name: file.name.replace('.gpx', ''), type: 'geojson', leafletLayer, color: '#2ecc71' });
    if (leafletLayer.getBounds().isValid()) map.fitBounds(leafletLayer.getBounds(), { padding: [20,20] });
    App.showToast(`GPX dimuat: ${features.length} fitur`, 'success');
  }

  async function loadCSV(file) {
    const text = await file.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const latKey = headers.find(h => ['lat','latitude','y'].includes(h));
    const lngKey = headers.find(h => ['lon','lng','longitude','x'].includes(h));

    if (!latKey || !lngKey) throw new Error('Kolom latitude/longitude tidak ditemukan');

    const latIdx = headers.indexOf(latKey);
    const lngIdx = headers.indexOf(lngKey);
    const features = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const lat = parseFloat(vals[latIdx]);
      const lng = parseFloat(vals[lngIdx]);
      if (isNaN(lat) || isNaN(lng)) continue;
      const props = {};
      headers.forEach((h, j) => { props[h] = vals[j]; });
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props });
    }

    const geojson = { type: 'FeatureCollection', features };
    const leafletLayer = L.geoJSON(geojson, {
      pointToLayer: (f, ll) => {
        const name = f.properties?.name || f.properties?.NAME || f.properties?.id || `Titik ${features.indexOf(f)+1}`;
        return L.circleMarker(ll, { radius: 6, fillColor: '#e74c3c', color: '#fff', weight: 1, fillOpacity: 0.9 })
          .bindPopup(`<b>${name}</b>`);
      }
    });

    LayerManager.addLayer({ name: file.name.replace('.csv',''), type: 'geojson', leafletLayer, color: '#e74c3c' });
    if (leafletLayer.getBounds().isValid()) map.fitBounds(leafletLayer.getBounds(), { padding: [20,20] });
    App.showToast(`CSV dimuat: ${features.length} titik`, 'success');
  }

  async function loadShapefile(file) {
    // Shapefile requires shpjs library
    if (typeof shp === 'undefined') {
      App.showToast('Library shapefile tidak tersedia. Gunakan GeoJSON atau KML.', 'warning');
      return;
    }
    const arrayBuffer = await file.arrayBuffer();
    const geojson = await shp(arrayBuffer);
    const leafletLayer = L.geoJSON(geojson, { style: { color: '#9b59b6', weight: 2, fillOpacity: 0.2 } });
    LayerManager.addLayer({ name: file.name.replace('.zip',''), type: 'geojson', leafletLayer, color: '#9b59b6' });
    if (leafletLayer.getBounds().isValid()) map.fitBounds(leafletLayer.getBounds(), { padding: [20,20] });
    App.showToast(`Shapefile dimuat`, 'success');
  }

  function search(query) {
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`)
      .then(r => r.json())
      .then(results => {
        if (results.length === 0) { App.showToast('Lokasi tidak ditemukan', 'warning'); return; }
        const r = results[0];
        map.setView([parseFloat(r.lat), parseFloat(r.lon)], 14, { animate: true });
        L.popup().setLatLng([parseFloat(r.lat), parseFloat(r.lon)]).setContent(`<b>${r.display_name}</b>`).openOn(map);
      })
      .catch(() => App.showToast('Pencarian gagal (offline?)', 'error'));
  }

  return {
    get map() { return map; },
    init, switchBasemap, startDraw, stopDraw, startMeasure, stopMeasure,
    loadSpatialFile, search, createWaypointIcon, BASEMAPS
  };
})();

window.MapManager = MapManager;
