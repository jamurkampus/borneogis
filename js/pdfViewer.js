/* ============================================================
   pdfViewer.js v2 — Avenza-style PDF Maps Library
   - Library: store/load/delete PDFs in IndexedDB
   - Thumbnails: 160×100 preview cards
   - GeoPDF detection: decimal + DMS + UTM hints
   - GPS overlay on PDF (opacity, rotation, zoom)
   - Active map concept: one PDF "is" the map
   ============================================================ */
const PDFViewerModule = (() => {
  let map;
  let activeOverlay = null; // { id, name, imageOverlay, bounds, dataUrl, thumbUrl, rotationDeg, opacity }
  let onLibraryChange = () => {};

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://unpkg.com/[email protected]/build/pdf.worker.min.js';

  function init(leafletMap, libChangeCb) {
    map = leafletMap;
    onLibraryChange = libChangeCb || (() => {});
  }

  /* ============================================================
     LOAD & RENDER
     ============================================================ */
  async function loadPdfFile(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);

    // Render full resolution
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const dataUrl = canvas.toDataURL('image/png');

    // Thumbnail 200×130
    const thumb = document.createElement('canvas');
    thumb.width = 200; thumb.height = 130;
    thumb.getContext('2d').drawImage(canvas, 0, 0, 200, 130);
    const thumbUrl = thumb.toDataURL('image/jpeg', 0.75);

    // Detect coordinates
    const textContent = await page.getTextContent();
    const allText = textContent.items.map(i => i.str).join(' ');
    const bounds = detectCoordinates(allText, page);

    const id = 'pdf_' + Date.now().toString(36);
    const entry = {
      id, name: file.name.replace(/\.[^.]+$/, ''),
      dataUrl, thumbUrl,
      bounds: bounds || null,
      autoDetected: !!bounds,
      storedAt: new Date().toISOString(),
    };

    await BGDB.putRaster(entry);
    onLibraryChange();

    if (bounds) {
      activateFromEntry(entry);
      Toast.show('✅ GeoPDF — koordinat terdeteksi otomatis.', 'success');
    } else {
      activateFromEntry(entry);
      Toast.show('⚠️ Koordinat tidak terdeteksi. Gunakan tombol Georef untuk mengatur posisi.', 'info');
    }
    return entry;
  }

  /* ============================================================
     COORDINATE DETECTION (decimal + DMS + grid hints)
     ============================================================ */
  function detectCoordinates(text, page) {
    // 1. Try DMS: e.g. "1°23'45"N" or "1°23'45.6"N" or "1 23 45 N"
    const dmsRe = /(\d{1,3})[°\s](\d{1,2})['\s](\d{1,2}(?:\.\d+)?)["\s]?\s*([NSns])[,;\s]+(\d{1,3})[°\s](\d{1,2})['\s](\d{1,2}(?:\.\d+)?)["\s]?\s*([EWew])/g;
    const dmsMatches = [...text.matchAll(dmsRe)];
    if (dmsMatches.length >= 2) {
      const pts = dmsMatches.map(m => {
        const lat = dms(m[1], m[2], m[3], m[4]);
        const lng = dms(m[5], m[6], m[7], m[8]);
        return [lng, lat];
      }).filter(([lng, lat]) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
      if (pts.length >= 2) return boundsFromPts(pts);
    }

    // 2. Try decimal pairs: "116.5123 1.2345" or "116.5123, 1.2345"
    const decRe = /(-?\d{1,3}\.\d{3,8})[,\s]+(-?\d{1,3}\.\d{3,8})/g;
    const decMatches = [...text.matchAll(decRe)];
    if (decMatches.length >= 2) {
      // Classify which is lat and which is lng (lat ≤ 90, lng > 90 for Kalimantan)
      const pts = decMatches.map(m => {
        const a = parseFloat(m[1]), b = parseFloat(m[2]);
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && Math.abs(b) > Math.abs(a))
          return [b, a]; // [lng, lat]
        if (Math.abs(b) <= 90 && Math.abs(a) <= 180)
          return [a, b]; // already [lng, lat]
        return null;
      }).filter(Boolean);
      if (pts.length >= 2) {
        const b = boundsFromPts(pts);
        if (b) return b;
      }
    }

    // 3. Try simple decimal numbers near compass words
    const compassRe = /(?:North|Utara|N)[:\s]*(-?\d{1,3}\.\d{2,8})|(-?\d{1,3}\.\d{2,8})[°\s]*N/gi;
    // (basic fallback — if two very close decimals bracket a reasonable area)
    const anyNums = [...text.matchAll(/(-?\d{2,3}\.\d{4,8})/g)].map(m => parseFloat(m[1]));
    if (anyNums.length >= 4) {
      const inLat = anyNums.filter(n => n >= -90 && n <= 90);
      const inLng = anyNums.filter(n => n > 90 || n < -90).concat(anyNums.filter(n => n > 90 && n <= 180));
      if (inLat.length >= 2 && inLng.length >= 2) {
        const latMin = Math.min(...inLat), latMax = Math.max(...inLat);
        const lngMin = Math.min(...inLng), lngMax = Math.max(...inLng);
        if (latMax - latMin > 0.001 && lngMax - lngMin > 0.001 &&
            latMax - latMin < 5 && lngMax - lngMin < 5) {
          return [[latMin, lngMin], [latMax, lngMax]];
        }
      }
    }

    return null;
  }

  function dms(d, m, s, dir) {
    const dec = parseFloat(d) + parseFloat(m) / 60 + parseFloat(s) / 3600;
    return /[SW]/i.test(dir) ? -dec : dec;
  }

  function boundsFromPts(pts) {
    const lats = pts.map(p => p[1]), lngs = pts.map(p => p[0]);
    const sw = [Math.min(...lats), Math.min(...lngs)];
    const ne = [Math.max(...lats), Math.max(...lngs)];
    if (sw[0] === ne[0] || sw[1] === ne[1]) return null;
    return [sw, ne];
  }

  /* ============================================================
     ACTIVATE A PDF AS ACTIVE MAP
     ============================================================ */
  function activateFromEntry(entry) {
    // Remove previous overlay
    if (activeOverlay?.imageOverlay) map.removeLayer(activeOverlay.imageOverlay);

    const bounds = entry.bounds || defaultBounds();
    const imageOverlay = L.imageOverlay(entry.dataUrl, bounds, {
      opacity: 0.92, interactive: true, zIndex: 200,
    }).addTo(map);
    map.fitBounds(bounds, { maxZoom: 18, padding: [10, 10] });

    activeOverlay = {
      id: entry.id, name: entry.name, imageOverlay,
      bounds, dataUrl: entry.dataUrl, thumbUrl: entry.thumbUrl,
      rotationDeg: 0, opacity: 0.92,
    };
    updateActivePdfUI();
  }

  async function activateById(id) {
    const entry = await BGDB.getRaster(id);
    if (!entry) { Toast.show('PDF tidak ditemukan di library.', 'error'); return; }
    activateFromEntry(entry);
  }

  function defaultBounds() {
    const c = map.getCenter();
    return [[c.lat - 0.01, c.lng - 0.015], [c.lat + 0.01, c.lng + 0.015]];
  }

  function closeActive() {
    if (activeOverlay?.imageOverlay) map.removeLayer(activeOverlay.imageOverlay);
    activeOverlay = null;
    updateActivePdfUI();
  }

  /* ============================================================
     ACTIVE MAP UI UPDATES
     ============================================================ */
  function updateActivePdfUI() {
    const card = document.getElementById('activePdfCard');
    const hint = document.getElementById('noActivePdf');
    if (!card) return;
    if (!activeOverlay) {
      card.hidden = true; hint.hidden = false; return;
    }
    card.hidden = false; hint.hidden = true;
    document.getElementById('activePdfName').textContent = activeOverlay.name;
    const img = document.getElementById('activePdfThumb');
    if (img && activeOverlay.thumbUrl) img.src = activeOverlay.thumbUrl;
    const b = activeOverlay.bounds;
    if (b) {
      document.getElementById('activePdfCoords').textContent =
        `SW ${b[0][0].toFixed(4)},${b[0][1].toFixed(4)} — NE ${b[1][0].toFixed(4)},${b[1][1].toFixed(4)}`;
    } else {
      document.getElementById('activePdfCoords').textContent = 'Koordinat belum diatur';
    }
  }

  /* ============================================================
     CONTROLS
     ============================================================ */
  function setOpacity(val) {
    if (!activeOverlay) return;
    activeOverlay.opacity = val;
    activeOverlay.imageOverlay.setOpacity(val);
  }

  function setRotation(deg) {
    if (!activeOverlay) return;
    activeOverlay.rotationDeg = deg;
    applyRotation();
    if (!activeOverlay._rotHooked) {
      activeOverlay._rotHooked = true;
      map.on('zoomend moveend', applyRotation);
    }
  }
  function applyRotation() {
    const el = activeOverlay?.imageOverlay?.getElement();
    if (el) el.style.transform += ` rotate(${activeOverlay.rotationDeg}deg)`;
  }

  function zoomIn()  { _scaleOverlay(0.85); }
  function zoomOut() { _scaleOverlay(1.18); }
  function _scaleOverlay(f) {
    if (!activeOverlay) return;
    const b = activeOverlay.imageOverlay.getBounds(), c = b.getCenter();
    const sw = b.getSouthWest(), ne = b.getNorthEast();
    const nb = L.latLngBounds(
      [c.lat + (sw.lat - c.lat) * f, c.lng + (sw.lng - c.lng) * f],
      [c.lat + (ne.lat - c.lat) * f, c.lng + (ne.lng - c.lng) * f]
    );
    activeOverlay.imageOverlay.setBounds(nb);
    activeOverlay.bounds = [[nb.getSouth(), nb.getWest()],[nb.getNorth(), nb.getEast()]];
  }

  function fitBounds() {
    if (activeOverlay?.bounds) map.fitBounds(activeOverlay.bounds, { maxZoom: 18 });
  }

  /* ============================================================
     GEOREF MODAL
     ============================================================ */
  function openGeorefModal() {
    if (!activeOverlay) { Toast.show('Tidak ada PDF aktif.', 'error'); return; }
    const b = activeOverlay.imageOverlay.getBounds();
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-overlay"><div class="modal-box">
        <div class="modal-head"><h3>📍 Georeferensi Manual</h3><button class="icon-btn-sm" id="gClose">&times;</button></div>
        <div class="modal-body">
          <p style="font-size:12px;color:var(--text-dim);line-height:1.6;margin-bottom:14px">
            Masukkan koordinat pojok Bawah-Kiri (SW) dan Atas-Kanan (NE) peta PDF ini.<br>
            <strong>Tips:</strong> lihat legenda koordinat di tepi lembar peta.
          </p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="field"><label>SW Latitude</label><input id="gSwLat" type="number" step="any" value="${b.getSouth().toFixed(6)}" /></div>
            <div class="field"><label>SW Longitude</label><input id="gSwLng" type="number" step="any" value="${b.getWest().toFixed(6)}" /></div>
            <div class="field"><label>NE Latitude</label><input id="gNeLat" type="number" step="any" value="${b.getNorth().toFixed(6)}" /></div>
            <div class="field"><label>NE Longitude</label><input id="gNeLng" type="number" step="any" value="${b.getEast().toFixed(6)}" /></div>
          </div>
          <p style="font-size:11px;color:var(--text-faint);margin-top:10px">
            Klik pada peta untuk mendapatkan koordinat yang tepat (lihat readout pojok kiri bawah).
          </p>
        </div>
        <div class="modal-foot">
          <button class="btn-ghost-sm" id="gCancel">Batal</button>
          <button class="btn-primary-sm" id="gApply">✔ Terapkan</button>
        </div>
      </div></div>`;
    const close = () => root.innerHTML = '';
    document.getElementById('gClose').onclick = close;
    document.getElementById('gCancel').onclick = close;
    document.getElementById('gApply').onclick = async () => {
      const sw = [parseFloat(document.getElementById('gSwLat').value), parseFloat(document.getElementById('gSwLng').value)];
      const ne = [parseFloat(document.getElementById('gNeLat').value), parseFloat(document.getElementById('gNeLng').value)];
      if ([...sw, ...ne].some(isNaN)) { Toast.show('Lengkapi semua koordinat.', 'error'); return; }
      const newBounds = [sw, ne];
      activeOverlay.imageOverlay.setBounds(newBounds);
      activeOverlay.bounds = newBounds;
      map.fitBounds(newBounds, { maxZoom: 18 });
      // Update stored entry
      const stored = await BGDB.getRaster(activeOverlay.id).catch(() => null);
      if (stored) { stored.bounds = newBounds; await BGDB.putRaster(stored).catch(() => {}); }
      updateActivePdfUI();
      Toast.show('✅ Georeferensi diterapkan dan disimpan.', 'success');
      close();
    };
  }

  /* ============================================================
     LIBRARY
     ============================================================ */
  async function getLibrary() {
    const all = await BGDB.getAllRasters().catch(() => []);
    return all.sort((a, b) => (b.storedAt || '').localeCompare(a.storedAt || ''));
  }

  async function deleteFromLibrary(id) {
    if (activeOverlay?.id === id) closeActive();
    await BGDB.deleteRaster(id).catch(() => {});
    onLibraryChange();
  }

  function getActiveOverlay() { return activeOverlay; }

  return {
    init, loadPdfFile, activateById, closeActive,
    setOpacity, setRotation, zoomIn, zoomOut, fitBounds,
    openGeorefModal, getLibrary, deleteFromLibrary, getActiveOverlay,
    updateActivePdfUI,
  };
})();
