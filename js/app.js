/* ============================================================
   app.js — Bootstraps modules, wires UI, search, dashboard,
   AI assistant (dummy), exports, theme, PWA registration
   ============================================================ */
const Toast = (() => {
  function show(msg, type = 'info') {
    const stack = document.getElementById('toastStack');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3600);
  }
  return { show };
})();

(function App() {
  let map, sidebarCollapsed = false, dashboardOpen = false;
  let lang = 'id';

  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    map = BGMap.init();
    LayerManager.init(map, renderLayerTree);
    GeoTools.init(map, renderMeasureResult);
    PDFViewerModule.init(map);

    const savedBasemap = await BGDB.getSetting('basemap', 'osm');
    BGMap.setBasemap(savedBasemap);
    document.getElementById('basemapSelect').value = savedBasemap;

    const savedTheme = await BGDB.getSetting('theme', 'dark');
    applyTheme(savedTheme);

    await LayerManager.restoreFromDB();
    wireLayerTreeChrome();
    renderLayerTree();

    wireTopbar();
    wireSidebarTabs();
    wireUpload();
    wireMeasure();
    wireDraw();
    wireAnalysis();
    wireGps();
    wireAi();
    wireDashboard();
    wirePdfControls();
    wireFabAndSheet();
    registerServiceWorker();

    setTimeout(() => document.getElementById('splash').classList.add('hide'), 600);
  }

  /* ---------------- THEME / TOPBAR ---------------- */
  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    document.querySelector('.i-sun').hidden = theme === 'light';
    document.querySelector('.i-moon').hidden = theme === 'dark';
    BGDB.setSetting('theme', theme);
  }

  function wireTopbar() {
    document.getElementById('btnSidebarToggle').onclick = () => {
      sidebarCollapsed = !sidebarCollapsed;
      document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
    };
    document.getElementById('btnTheme').onclick = () => {
      applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
    };
    document.getElementById('btnLang').onclick = () => {
      lang = lang === 'id' ? 'en' : 'id';
      document.getElementById('btnLang').textContent = lang.toUpperCase();
      Toast.show(lang === 'id' ? 'Bahasa: Indonesia' : 'Language: English', 'info');
    };
    document.getElementById('btnFullscreen').onclick = () => BGMap.toggleFullscreen();
    document.getElementById('basemapSelect').onchange = (e) => BGMap.setBasemap(e.target.value);

    wireSearch();
  }

  /* ---------------- SEARCH ---------------- */
  function wireSearch() {
    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');
    const clearBtn = document.getElementById('btnSearchClear');
    let debounce;

    input.addEventListener('input', () => {
      clearBtn.hidden = !input.value;
      clearTimeout(debounce);
      const q = input.value.trim();
      if (!q) { results.hidden = true; return; }

      const coordMatch = q.match(/^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]), lng = parseFloat(coordMatch[2]);
        renderSearchResults([{ label: `Koordinat: ${lat}, ${lng}`, sub: 'Lat, Lng', action: () => { map.setView([lat, lng], 16); dropSearchMarker(lat, lng); } }]);
        return;
      }

      // local feature/object search across all layers
      const localMatches = [];
      LayerManager.getAll().forEach(l => {
        if (!l.geojson) return;
        l.geojson.features.forEach(f => {
          const name = f.properties?.name || f.properties?.NAME || f.properties?.nama;
          if (name && name.toLowerCase().includes(q.toLowerCase())) {
            localMatches.push({
              label: name, sub: `Layer: ${l.name}`,
              action: () => {
                try {
                  const c = turf.centroid(f);
                  map.setView([c.geometry.coordinates[1], c.geometry.coordinates[0]], 16);
                  dropSearchMarker(c.geometry.coordinates[1], c.geometry.coordinates[0]);
                } catch (e) {}
              },
            });
          }
        });
      });

      debounce = setTimeout(async () => {
        let geoResults = [];
        try {
          const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`);
          const data = await resp.json();
          geoResults = data.map(d => ({
            label: d.display_name.split(',')[0], sub: d.display_name,
            action: () => { map.setView([parseFloat(d.lat), parseFloat(d.lon)], 14); dropSearchMarker(parseFloat(d.lat), parseFloat(d.lon)); },
          }));
        } catch (e) { /* offline: skip geocoding */ }
        renderSearchResults([...localMatches, ...geoResults]);
      }, 400);
    });

    clearBtn.onclick = () => { input.value = ''; clearBtn.hidden = true; results.hidden = true; };

    function renderSearchResults(items) {
      if (!items.length) { results.hidden = true; return; }
      results.innerHTML = items.map((it, i) => `<div class="sr-item" data-i="${i}"><span>${it.label}</span><small>${it.sub}</small></div>`).join('');
      results.hidden = false;
      [...results.children].forEach((el, i) => el.onclick = () => { items[i].action(); results.hidden = true; input.value = items[i].label; });
    }
  }

  let searchMarker;
  function dropSearchMarker(lat, lng) {
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: 'bg-divicon', html: `<div class="bg-marker-pin" style="background:#38BDF8"></div>`, iconSize: [14, 14] }),
    }).addTo(map);
  }

  /* ---------------- SIDEBAR TABS ---------------- */
  function wireSidebarTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.querySelector(`.panel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
        if (window.innerWidth <= 880) document.getElementById('sidebar').classList.remove('collapsed');
      };
    });
  }

  /* ---------------- UPLOAD ---------------- */
  function wireUpload() {
    const dz = document.getElementById('dropZone');
    const input = document.getElementById('fileInput');
    const queue = document.getElementById('uploadQueue');

    dz.onclick = () => input.click();
    input.onchange = () => processFiles(input.files);

    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files); });

    async function processFiles(fileList) {
      const items = {};
      Array.from(fileList).forEach(f => {
        const row = document.createElement('div');
        row.className = 'uq-item';
        row.innerHTML = `<div class="uq-name"><span>${f.name}</span><span class="uq-status">menunggu…</span></div><div class="uq-bar"><div class="uq-bar-fill"></div></div>`;
        queue.prepend(row);
        items[f.name] = row;
      });
      await LayerManager.handleFiles(fileList, (name, status, errMsg) => {
        const row = items[name] || items[Object.keys(items).find(k => name.startsWith(k.replace(/\.[^.]+$/, '')))];
        if (!row) return;
        const statusEl = row.querySelector('.uq-status');
        const bar = row.querySelector('.uq-bar-fill');
        if (status === 'processing') { statusEl.textContent = 'memproses…'; bar.style.width = '50%'; }
        if (status === 'done') { statusEl.textContent = 'berhasil ditambahkan'; statusEl.classList.add('ok'); bar.style.width = '100%'; }
        if (status === 'error') { statusEl.textContent = 'gagal: ' + errMsg; statusEl.classList.add('err'); bar.style.width = '100%'; bar.style.background = 'var(--danger)'; }
      });
    }
  }

  /* ---------------- LAYER TREE CHROME (registered once) ---------------- */
  function wireLayerTreeChrome() {
    const tree = document.getElementById('layerTree');
    tree.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = tree.querySelector('.dragging');
      if (!dragging) return;
      const after = [...tree.children].find(c => c !== dragging && e.clientY < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2);
      if (after) tree.insertBefore(dragging, after); else tree.appendChild(dragging);
    });
    document.addEventListener('click', () => document.querySelectorAll('.li-dropdown.open').forEach(d => d.classList.remove('open')));
  }

  /* ---------------- LAYER TREE RENDER ---------------- */
  function renderLayerTree() {
    const tree = document.getElementById('layerTree');
    const layers = LayerManager.getAll();
    document.getElementById('layerCount').textContent = layers.length;
    document.getElementById('layerEmptyHint').style.display = layers.length ? 'none' : 'block';
    tree.innerHTML = '';

    layers.forEach(l => {
      const li = document.createElement('li');
      li.className = 'layer-item' + (l.id === LayerManager.getActive()?.id ? ' selected' : '');
      li.draggable = true;
      li.dataset.id = l.id;
      const featCount = l.geojson ? l.geojson.features.length : '—';
      li.innerHTML = `
        <div class="li-row">
          <span class="li-swatch" style="background:${l.color}"></span>
          <span class="li-name" title="${l.name}">${l.name}</span>
          <span class="li-count">${featCount}</span>
          <button class="li-vis" title="Tampilkan/Sembunyikan">${visIcon(l.visible)}</button>
          <div class="li-menu">
            <button class="li-menu-btn">⋮</button>
            <div class="li-dropdown">
              <button data-act="rename">Ganti nama</button>
              <button data-act="zoom">Zoom ke layer</button>
              <button data-act="export-geojson">Export GeoJSON</button>
              <button data-act="export-kml">Export KML</button>
              <button data-act="export-gpx">Export GPX</button>
              <button data-act="export-csv">Export CSV</button>
              <button data-act="delete" style="color:var(--danger)">Hapus layer</button>
            </div>
          </div>
        </div>
        <div class="li-extra">
          <input type="range" min="0" max="1" step="0.05" value="${l.opacity}" />
          <span class="li-opacity-val">${Math.round(l.opacity * 100)}%</span>
        </div>`;

      li.querySelector('.li-row').addEventListener('click', (e) => {
        if (e.target.closest('.li-vis') || e.target.closest('.li-menu')) return;
        LayerManager.setActive(l.id);
        if (l.raster) PDFViewerModule.setActiveOverlayById(l);
      });
      li.querySelector('.li-vis').onclick = (e) => { e.stopPropagation(); LayerManager.toggleVisibility(l.id); };
      const menuBtn = li.querySelector('.li-menu-btn');
      const dropdown = li.querySelector('.li-dropdown');
      menuBtn.onclick = (e) => { e.stopPropagation(); document.querySelectorAll('.li-dropdown.open').forEach(d => d !== dropdown && d.classList.remove('open')); dropdown.classList.toggle('open'); };
      dropdown.querySelectorAll('button').forEach(b => b.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.remove('open');
        handleLayerAction(l, b.dataset.act);
      });
      li.querySelector('input[type=range]').addEventListener('input', (e) => {
        LayerManager.setOpacity(l.id, parseFloat(e.target.value));
        li.querySelector('.li-opacity-val').textContent = Math.round(e.target.value * 100) + '%';
      });

      // drag reorder
      li.addEventListener('dragstart', () => li.classList.add('dragging'));
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        const newOrder = [...tree.children].map(c => c.dataset.id);
        LayerManager.reorder(newOrder);
      });
      tree.appendChild(li);
    });

    updateDashboardStats();
  }

  function visIcon(visible) {
    return visible
      ? '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a21.6 21.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  }

  function handleLayerAction(l, action) {
    if (action === 'rename') {
      const name = prompt('Nama layer baru:', l.name);
      if (name) LayerManager.rename(l.id, name);
    } else if (action === 'zoom') {
      if (l.leafletLayer?.getBounds) map.fitBounds(l.leafletLayer.getBounds(), { maxZoom: 17, padding: [30, 30] });
    } else if (action === 'export-geojson') LayerManager.exportGeoJSON(l.id);
    else if (action === 'export-kml') LayerManager.exportKML(l.id);
    else if (action === 'export-gpx') LayerManager.exportGPX(l.id);
    else if (action === 'export-csv') { if (!LayerManager.exportCSV(l.id)) Toast.show('Layer ini tidak punya fitur titik untuk export CSV.', 'error'); }
    else if (action === 'delete') { if (confirm(`Hapus layer "${l.name}"?`)) LayerManager.removeLayer(l.id); }
  }

  /* ---------------- MEASURE ---------------- */
  function wireMeasure() {
    document.querySelectorAll('[data-measure]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-measure]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        GeoTools.startMeasure(btn.dataset.measure);
      };
    });
    document.getElementById('btnMeasureClear').onclick = () => {
      GeoTools.clearMeasure();
      document.querySelectorAll('[data-measure]').forEach(b => b.classList.remove('active'));
      document.getElementById('measureResult').hidden = true;
    };
  }

  function renderMeasureResult(r) {
    const box = document.getElementById('measureResult');
    box.hidden = false;
    if (r.type === 'distance') {
      box.innerHTML = `<b>Jarak:</b> ${r.km < 1 ? r.m.toFixed(1) + ' m' : r.km.toFixed(3) + ' km'}`;
    } else if (r.type === 'bearing') {
      box.innerHTML = `<b>Bearing:</b> ${r.bearing.toFixed(2)}°<br/><b>Azimuth:</b> ${r.azimuth.toFixed(2)}°<br/><b>Jarak:</b> ${r.km.toFixed(3)} km`;
    } else if (r.type === 'area') {
      box.innerHTML = `<b>Luas:</b> ${r.areaHa.toFixed(4)} ha (${r.areaM2.toFixed(1)} m²)<br/><b>Keliling:</b> ${r.perimeterKm.toFixed(3)} km`;
    } else if (r.type === 'perimeter') {
      box.innerHTML = `<b>Keliling:</b> ${r.perimeterKm.toFixed(3)} km<br/><b>Luas:</b> ${r.areaHa.toFixed(4)} ha`;
    }
  }

  /* ---------------- DRAW / DIGITIZE ---------------- */
  function wireDraw() {
    document.querySelectorAll('[data-draw]').forEach(btn => {
      btn.onclick = () => {
        const mode = btn.dataset.draw;
        document.querySelectorAll('[data-draw]').forEach(b => b.classList.remove('active'));
        if (mode === 'marker' || mode === 'polyline' || mode === 'polygon') {
          btn.classList.add('active');
          const target = LayerManager.ensureDigitizeTarget();
          GeoTools.enableDrawMode(mode, (gj) => {
            gj.properties = gj.properties || { name: '' };
            LayerManager.addFeatureToLayer(target.id, gj);
            Toast.show('Fitur ditambahkan ke layer "' + target.name + '".', 'success');
            btn.classList.remove('active');
          });
        } else if (mode === 'edit') {
          const active = LayerManager.getActive();
          if (!active?.leafletLayer) { Toast.show('Pilih layer di Layer Manager dulu.', 'error'); return; }
          GeoTools.enableEditMode(active.leafletLayer);
          Toast.show('Mode edit aktif — geser titik vertex pada peta.', 'info');
        } else if (mode === 'delete') {
          const active = LayerManager.getActive();
          if (active && confirm(`Hapus seluruh layer "${active.name}"?`)) LayerManager.removeLayer(active.id);
        } else if (mode === 'attr') {
          openAttributeModal();
        }
      };
    });
  }

  function openAttributeModal() {
    const active = LayerManager.getActive();
    if (!active || !active.geojson || !active.geojson.features.length) { Toast.show('Layer aktif tidak punya fitur untuk diedit.', 'error'); return; }
    const root = document.getElementById('modalRoot');
    const options = active.geojson.features.map((f, i) => `<option value="${i}">${f.properties?.name || 'Fitur ' + (i + 1)}</option>`).join('');
    root.innerHTML = `
      <div class="modal-overlay"><div class="modal-box">
        <div class="modal-head"><h3>Ubah Atribut</h3><button class="icon-btn-sm" id="attrClose">&times;</button></div>
        <div class="modal-body">
          <div class="field"><label>Pilih fitur</label><select id="attrFeatureSelect">${options}</select></div>
          <div id="attrRows"></div>
          <button class="btn-ghost-sm" id="attrAddRow">+ Tambah field</button>
        </div>
        <div class="modal-foot"><button class="btn-ghost-sm" id="attrCancel">Batal</button><button class="btn-primary-sm" id="attrSave">Simpan</button></div>
      </div></div>`;
    const close = () => root.innerHTML = '';
    document.getElementById('attrClose').onclick = close;
    document.getElementById('attrCancel').onclick = close;

    const select = document.getElementById('attrFeatureSelect');
    const rowsEl = document.getElementById('attrRows');
    function loadRows(idx) {
      const props = active.geojson.features[idx].properties || {};
      rowsEl.innerHTML = '';
      Object.entries(props).forEach(([k, v]) => addRow(k, v));
      if (!Object.keys(props).length) addRow('name', '');
    }
    function addRow(k = '', v = '') {
      const row = document.createElement('div');
      row.className = 'attr-row';
      row.innerHTML = `<input class="ak" value="${k}" placeholder="field" /><input class="av" value="${v}" placeholder="nilai" /><button>&times;</button>`;
      row.querySelector('button').onclick = () => row.remove();
      rowsEl.appendChild(row);
    }
    select.onchange = () => loadRows(select.value);
    loadRows(0);
    document.getElementById('attrAddRow').onclick = () => addRow();
    document.getElementById('attrSave').onclick = () => {
      const idx = parseInt(select.value);
      const props = {};
      rowsEl.querySelectorAll('.attr-row').forEach(r => {
        const k = r.querySelector('.ak').value.trim();
        const v = r.querySelector('.av').value;
        if (k) props[k] = v;
      });
      active.geojson.features[idx].properties = props;
      active.leafletLayer.clearLayers();
      active.leafletLayer.addData(active.geojson);
      LayerManager.updateFeatureProps(active.id, idx, props);
      Toast.show('Atribut disimpan.', 'success');
      close();
    };
  }

  /* ---------------- ANALYSIS ---------------- */
  function wireAnalysis() {
    document.getElementById('btnRunBuffer').onclick = () => {
      const active = LayerManager.getActive();
      if (!active?.geojson) { Toast.show('Pilih layer terlebih dahulu.', 'error'); return; }
      const dist = parseFloat(document.getElementById('bufferDist').value);
      const unit = document.getElementById('bufferUnit').value;
      try {
        const result = GeoTools.buffer(active.geojson, dist, unit);
        LayerManager.addGeoJSONLayer(`Buffer ${dist}${unit === 'meters' ? 'm' : 'km'} — ${active.name}`, result, 'analysis');
        showAnalysisResult(`Buffer berhasil dibuat dari "${active.name}".`);
      } catch (e) { Toast.show('Gagal buffer: ' + e.message, 'error'); }
    };

    document.querySelectorAll('[data-analysis]').forEach(btn => {
      btn.onclick = () => {
        const op = btn.dataset.analysis;
        const all = LayerManager.getAll().filter(l => l.geojson);
        try {
          if (['intersect', 'union', 'clip', 'nearest'].includes(op)) {
            if (all.length < 2) { Toast.show('Butuh minimal 2 layer vektor.', 'error'); return; }
            const [a, b] = all; // first two in current layer order
            let result;
            if (op === 'intersect') result = GeoTools.intersect(a.geojson, b.geojson);
            else if (op === 'union') result = GeoTools.union(a.geojson, b.geojson);
            else if (op === 'clip') result = GeoTools.clip(a.geojson, b.geojson);
            else if (op === 'nearest') {
              const pt = a.geojson.features.find(f => f.geometry?.type === 'Point') || turf.centroid(a.geojson);
              const nearestF = GeoTools.nearest(pt, b.geojson);
              result = { type: 'FeatureCollection', features: nearestF ? [nearestF] : [] };
            }
            if (!result.features.length) { Toast.show('Tidak ada hasil (kemungkinan tidak ada overlap).', 'info'); return; }
            LayerManager.addGeoJSONLayer(`${op} — ${a.name} & ${b.name}`, result, 'analysis');
            showAnalysisResult(`${op} selesai: ${result.features.length} fitur dihasilkan.`);
          } else if (op === 'dissolve') {
            const active = LayerManager.getActive();
            if (!active?.geojson) { Toast.show('Pilih layer.', 'error'); return; }
            const result = GeoTools.dissolve(active.geojson);
            LayerManager.addGeoJSONLayer(`Dissolve — ${active.name}`, result, 'analysis');
            showAnalysisResult(`Dissolve selesai: ${result.features.length} fitur.`);
          } else if (op === 'calcArea') {
            const active = LayerManager.getActive();
            if (!active?.geojson) { Toast.show('Pilih layer.', 'error'); return; }
            const m2 = GeoTools.calcArea(active.geojson);
            showAnalysisResult(`Total luas "${active.name}": ${(m2 / 10000).toFixed(4)} ha (${m2.toFixed(1)} m²)`);
          } else if (op === 'calcLength') {
            const active = LayerManager.getActive();
            if (!active?.geojson) { Toast.show('Pilih layer.', 'error'); return; }
            const km = GeoTools.calcLength(active.geojson);
            showAnalysisResult(`Total panjang "${active.name}": ${km.toFixed(3)} km`);
          }
        } catch (e) { Toast.show('Analisis gagal: ' + e.message, 'error'); }
      };
    });

    document.getElementById('btnRunQuery').onclick = () => {
      const active = LayerManager.getActive();
      if (!active?.geojson) { Toast.show('Pilih layer.', 'error'); return; }
      const field = document.getElementById('spatialQueryField').value || prompt('Nama field untuk query:');
      const op = document.getElementById('spatialQueryOp').value;
      const value = document.getElementById('spatialQueryValue').value;
      if (!field || !value) { Toast.show('Lengkapi field dan nilai.', 'error'); return; }
      const matches = GeoTools.spatialQuery(active.geojson, field, op, value);
      if (!matches.length) { showAnalysisResult('Tidak ada fitur yang cocok.'); return; }
      LayerManager.addGeoJSONLayer(`Query: ${field}${op}${value}`, { type: 'FeatureCollection', features: matches }, 'analysis');
      showAnalysisResult(`Ditemukan ${matches.length} fitur cocok.`);
    };

    // populate field selector when active layer changes — simple periodic sync
    setInterval(() => {
      const active = LayerManager.getActive();
      const sel = document.getElementById('spatialQueryField');
      if (!active?.geojson?.features?.length) return;
      const keys = Object.keys(active.geojson.features[0].properties || {});
      const existing = [...sel.options].map(o => o.value).join(',');
      if (keys.join(',') !== existing) {
        sel.innerHTML = '<option value="">field…</option>' + keys.map(k => `<option value="${k}">${k}</option>`).join('');
      }
    }, 1500);
  }

  function showAnalysisResult(text) {
    const box = document.getElementById('analysisResult');
    box.hidden = false;
    box.innerHTML = text;
  }

  /* ---------------- GPS ---------------- */
  function wireGps() {
    const statusEl = document.getElementById('gpsStatus');
    document.getElementById('btnGpsLocate').onclick = async () => {
      try {
        await BGMap.locateOnce();
        statusEl.innerHTML = '<span class="dot on"></span> Lokasi ditemukan';
      } catch (e) { Toast.show('Gagal mengambil lokasi: ' + e.message, 'error'); }
    };
    document.getElementById('fabLocate').onclick = () => document.getElementById('btnGpsLocate').click();

    document.getElementById('btnGpsTrack').onclick = (e) => {
      const btn = e.currentTarget;
      const trackInfo = document.getElementById('trackInfo');
      if (!BGMap.isTracking()) {
        BGMap.startTracking((data) => {
          if (data.error) { Toast.show('GPS error: ' + data.error, 'error'); return; }
          statusEl.innerHTML = '<span class="dot tracking"></span> Merekam perjalanan…';
          trackInfo.hidden = false;
          trackInfo.innerHTML = `<b>Jarak:</b> ${data.distanceKm.toFixed(3)} km<br/><b>Titik:</b> ${data.count}<br/><b>Durasi:</b> ${Math.round(data.durationMs / 1000)} dtk`;
        });
        btn.textContent = 'Hentikan Tracking';
        btn.classList.add('active');
        document.getElementById('btnTrackSave').disabled = true;
      } else {
        const { points } = BGMap.stopTracking();
        btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>Mulai Tracking';
        btn.classList.remove('active');
        statusEl.innerHTML = '<span class="dot on"></span> Tracking dihentikan';
        document.getElementById('btnTrackSave').disabled = points.length < 2;
        window.__lastTrack = points;
      }
    };

    document.getElementById('btnTrackSave').onclick = () => {
      const points = window.__lastTrack || [];
      if (points.length < 2) return;
      const line = turf.lineString(points.map(p => [p.lng, p.lat]));
      const fc = { type: 'FeatureCollection', features: [{ ...line, properties: { name: 'Track ' + new Date().toLocaleString('id-ID') } }] };
      LayerManager.addGeoJSONLayer('Track GPS — ' + new Date().toLocaleDateString('id-ID'), fc, 'track');
      Toast.show('Track tersimpan sebagai layer.', 'success');
      document.getElementById('btnTrackSave').disabled = true;
    };
  }

  /* ---------------- AI ASSISTANT (dummy local) ---------------- */
  function wireAi() {
    const send = () => {
      const input = document.getElementById('aiInput');
      const q = input.value.trim();
      if (!q) return;
      appendAiMsg(q, 'user');
      input.value = '';
      setTimeout(() => appendAiMsg(answerDummyAi(q), 'ai'), 350);
    };
    document.getElementById('btnAiSend').onclick = send;
    document.getElementById('aiInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  }

  function appendAiMsg(text, who) {
    const chat = document.getElementById('aiChat');
    const el = document.createElement('div');
    el.className = `ai-msg ${who}`;
    el.textContent = text;
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
  }

  function answerDummyAi(q) {
    const stats = LayerManager.computeStats();
    const qLower = q.toLowerCase();
    if (!stats.totalLayers) return 'Belum ada data di peta. Unggah layer terlebih dahulu dari tab Upload.';
    if (qLower.includes('total luas') || qLower.includes('luas semua')) {
      return `Total luas seluruh layer: ${stats.totalAreaHa.toFixed(4)} ha.`;
    }
    if (qLower.includes('total panjang')) {
      return `Total panjang seluruh layer: ${stats.totalLengthKm.toFixed(3)} km.`;
    }
    if (qLower.includes('fitur terbanyak') || qLower.includes('layer mana')) {
      const top = [...stats.perLayer].sort((a, b) => b.features - a.features)[0];
      return top ? `Layer dengan fitur terbanyak: "${top.name}" (${top.features} fitur).` : 'Tidak dapat menentukan.';
    }
    const matchLayer = stats.perLayer.find(l => qLower.includes(l.name.toLowerCase()));
    if (matchLayer) {
      return `Layer "${matchLayer.name}": ${matchLayer.features} fitur, luas ${matchLayer.areaHa.toFixed(4)} ha, panjang ${matchLayer.lengthKm.toFixed(3)} km.`;
    }
    if (qLower.includes('berapa layer') || qLower.includes('jumlah layer')) {
      return `Ada ${stats.totalLayers} layer dengan total ${stats.totalFeatures} fitur di peta Anda.`;
    }
    return `Saya menemukan ${stats.totalLayers} layer dan ${stats.totalFeatures} fitur di peta Anda. Coba tanyakan "total luas", "total panjang", atau sebutkan nama layer tertentu.`;
  }

  /* ---------------- DASHBOARD ---------------- */
  function wireDashboard() {
    document.getElementById('btnDashboard').onclick = () => toggleDashboard(true);
    document.getElementById('btnDashboardClose').onclick = () => toggleDashboard(false);
    document.getElementById('scrim').onclick = () => toggleDashboard(false);

    document.querySelectorAll('[data-export]').forEach(btn => {
      btn.onclick = () => {
        const type = btn.dataset.export;
        if (type === 'geojson') LayerManager.exportGeoJSON();
        else if (type === 'kml') LayerManager.exportKML();
        else if (type === 'gpx') LayerManager.exportGPX();
        else if (type === 'csv') { if (!LayerManager.exportCSV()) Toast.show('Tidak ada fitur titik untuk export CSV.', 'error'); }
        else if (type === 'png') exportMapPng();
        else if (type === 'pdf') exportMapPdf();
      };
    });
  }

  function toggleDashboard(open) {
    dashboardOpen = open;
    document.getElementById('dashboard').classList.toggle('open', open);
    document.getElementById('scrim').classList.toggle('show', open);
    if (open) updateDashboardStats();
  }

  function updateDashboardStats() {
    const stats = LayerManager.computeStats();
    document.getElementById('statLayers').textContent = stats.totalLayers;
    document.getElementById('statFeatures').textContent = stats.totalFeatures;
    document.getElementById('statArea').textContent = stats.totalAreaHa.toFixed(2);
    document.getElementById('statLength').textContent = stats.totalLengthKm.toFixed(2);
    const list = document.getElementById('dashLayerStats');
    list.innerHTML = stats.perLayer.map(l => `<div class="dl-row"><span>${l.name}</span><span>${l.features} ft · ${l.areaHa.toFixed(2)} ha</span></div>`).join('') || '<div class="dl-row"><span>Belum ada layer</span></div>';
  }

  function exportMapPng() {
    if (typeof leafletImage === 'undefined') { Toast.show('Modul export PNG tidak tersedia (offline).', 'error'); return; }
    leafletImage(map, (err, canvas) => {
      if (err) { Toast.show('Gagal export PNG: ' + err.message, 'error'); return; }
      canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'borneogis-map.png'; a.click();
      });
    });
  }

  function exportMapPdf() {
    Toast.show('Mengekspor peta sebagai PNG terlebih dahulu — gunakan "Print to PDF" browser pada gambar tersebut untuk hasil PDF.', 'info');
    exportMapPng();
  }

  /* ---------------- PDF OVERLAY CONTROLS ---------------- */
  function wirePdfControls() {
    document.getElementById('pdfOpacity').addEventListener('input', (e) => PDFViewerModule.setOpacity(e.target.value / 100));
    document.getElementById('pdfRotation').addEventListener('input', (e) => PDFViewerModule.setRotation(parseInt(e.target.value)));
    document.getElementById('pdfZoomIn').onclick = () => PDFViewerModule.zoomOverlay(0.9);
    document.getElementById('pdfZoomOut').onclick = () => PDFViewerModule.zoomOverlay(1.1);
    document.getElementById('pdfGeoreference').onclick = () => PDFViewerModule.startManualGeoref();
    document.getElementById('pdfControlsClose').onclick = () => PDFViewerModule.closeActiveOverlayControls();
  }

  /* ---------------- MOBILE FAB & BOTTOM SHEET ---------------- */
  function wireFabAndSheet() {
    document.getElementById('fabAdd').onclick = () => {
      document.getElementById('sidebar').classList.remove('collapsed');
      document.querySelector('.tab-btn[data-tab="upload"]').click();
    };
    document.getElementById('fabLayers').onclick = () => {
      document.getElementById('sidebar').classList.remove('collapsed');
      document.querySelector('.tab-btn[data-tab="layers"]').click();
    };
    const sheet = document.getElementById('bottomSheet');
    let startY = null;
    sheet.querySelector('.sheet-handle').addEventListener('click', () => sheet.classList.remove('open'));
    sheet.addEventListener('touchstart', (e) => startY = e.touches[0].clientY);
    sheet.addEventListener('touchend', (e) => {
      if (startY !== null && e.changedTouches[0].clientY - startY > 60) sheet.classList.remove('open');
      startY = null;
    });
    if (window.innerWidth <= 880) document.getElementById('sidebar').classList.add('collapsed');
  }

  /* ---------------- PWA / SERVICE WORKER ---------------- */
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {
        console.warn('Service worker registration failed (mungkin dijalankan dari file:// atau tanpa HTTPS).');
      });
    }
  }
})();
