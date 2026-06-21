/* ============================================================
   pdfViewer.js — Renders PDF/GeoPDF pages via PDF.js, attempts
   automatic coordinate detection from embedded text, supports
   manual 4-point georeferencing, and exposes opacity/rotation/
   zoom controls as a draggable raster overlay on the Leaflet map.
   ============================================================ */
const PDFViewerModule = (() => {
  let map;
  let activeOverlay = null; // { id, imageOverlay, rotationDeg, opacity, canvas }
  let georefState = null; // { canvas, points: [{x,y,lat,lng}], pdfPage }

  function init(leafletMap) { map = leafletMap; }

  async function loadPdfFile(file) {
    const buf = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/[email protected]/build/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);

    // try auto-detect geo info from text content (common on BIG/Ina-Geoportal GeoPDF sheets:
    // corner coordinates printed as DMS or decimal near map neatline)
    const textContent = await page.getTextContent();
    const fullText = textContent.items.map(i => i.str).join(' ');
    const autoCoords = detectCoordinates(fullText);

    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/png');

    if (autoCoords) {
      placeOverlay(file.name, dataUrl, autoCoords.bounds, canvas);
      Toast.show(`GeoPDF terdeteksi otomatis — koordinat ditemukan dalam dokumen.`, 'success');
    } else {
      // fall back: place roughly at current map center, then prompt manual georeferencing
      const c = map.getCenter();
      const halfLat = 0.01, halfLng = 0.01 * (canvas.width / canvas.height);
      const bounds = [[c.lat - halfLat, c.lng - halfLng], [c.lat + halfLat, c.lng + halfLng]];
      placeOverlay(file.name, dataUrl, bounds, canvas);
      Toast.show('Koordinat tidak terdeteksi otomatis. Gunakan "Georeferensi Manual (4 titik)" untuk menempatkan PDF dengan presisi.', 'info');
    }
  }

  function detectCoordinates(text) {
    // Look for decimal-degree pairs e.g. "116.5123, 1.2345" or DMS patterns near "Koordinat"/"Coordinate"
    const decimalPairRe = /(-?\d{1,3}\.\d{3,8})[,\s]+(-?\d{1,3}\.\d{3,8})/g;
    const matches = [...text.matchAll(decimalPairRe)];
    if (matches.length < 2) return null;
    const pts = matches.map(m => [parseFloat(m[1]), parseFloat(m[2])])
      .filter(([a, b]) => Math.abs(a) <= 180 && Math.abs(b) <= 90);
    if (pts.length < 2) return null;
    const lats = pts.map(p => p[1]), lngs = pts.map(p => p[0]);
    const bounds = [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
    if (bounds[0][0] === bounds[1][0] || bounds[0][1] === bounds[1][1]) return null;
    return { bounds };
  }

  function placeOverlay(name, dataUrl, bounds, canvas) {
    if (activeOverlay) map.removeLayer(activeOverlay.imageOverlay);
    const imageOverlay = L.imageOverlay(dataUrl, bounds, { opacity: 0.85, interactive: true }).addTo(map);
    const id = 'pdf_' + Date.now().toString(36);
    activeOverlay = { id, name, imageOverlay, rotationDeg: 0, opacity: 0.85, canvas, dataUrl, bounds };
    map.fitBounds(bounds, { maxZoom: 18 });

    BGDB.putRaster({ id, dataUrl, bounds, name }).catch(() => {});
    LayerManager.addRasterLayerRecord({
      id, name, type: 'pdf-raster', geojson: null, raster: true,
      leafletLayer: imageOverlay, color: '#A78BFA', opacity: 0.85, visible: true, group: null,
    });

    showPdfControls(name);
  }

  function showPdfControls(name) {
    const panel = document.getElementById('pdfControls');
    document.getElementById('pdfControlsName').textContent = name;
    panel.hidden = false;
  }
  function hidePdfControls() {
    document.getElementById('pdfControls').hidden = true;
  }

  function setOpacity(val) {
    if (!activeOverlay) return;
    activeOverlay.opacity = val;
    activeOverlay.imageOverlay.setOpacity(val);
  }

  function setRotation(deg) {
    if (!activeOverlay) return;
    activeOverlay.rotationDeg = deg;
    const el = activeOverlay.imageOverlay.getElement();
    if (el) el.style.transform += ` rotate(${deg}deg)`;
    // Leaflet re-applies its own transform on move/zoom, so we hook into that:
    if (!activeOverlay._rotateHook) {
      activeOverlay._rotateHook = true;
      activeOverlay.imageOverlay.on('add', applyRotation);
      map.on('zoomend moveend', applyRotation);
    }
    applyRotation();
  }
  function applyRotation() {
    if (!activeOverlay) return;
    const el = activeOverlay.imageOverlay.getElement();
    if (el) el.style.transform += ` rotate(${activeOverlay.rotationDeg}deg)`;
  }

  function zoomOverlay(factor) {
    if (!activeOverlay) return;
    const b = activeOverlay.imageOverlay.getBounds();
    const center = b.getCenter();
    const sw = b.getSouthWest(), ne = b.getNorthEast();
    const newSw = L.latLng(center.lat + (sw.lat - center.lat) * factor, center.lng + (sw.lng - center.lng) * factor);
    const newNe = L.latLng(center.lat + (ne.lat - center.lat) * factor, center.lng + (ne.lng - center.lng) * factor);
    const newBounds = L.latLngBounds(newSw, newNe);
    activeOverlay.imageOverlay.setBounds(newBounds);
    activeOverlay.bounds = newBounds;
  }

  /* ---------------- MANUAL 4-POINT GEOREFERENCING ---------------- */
  function startManualGeoref() {
    if (!activeOverlay) { Toast.show('Tidak ada layer PDF aktif.', 'error'); return; }
    georefState = { points: [] };
    Toast.show('Klik 2 titik pada PETA yang berkorespondensi dengan sudut kiri-bawah lalu kanan-atas raster, ikuti dialog.', 'info');
    openGeorefModal();
  }

  function openGeorefModal() {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-overlay" id="georefOverlay">
        <div class="modal-box">
          <div class="modal-head"><h3>Georeferensi Manual</h3><button class="icon-btn-sm" id="georefClose">&times;</button></div>
          <div class="modal-body">
            <p style="font-size:12.5px;color:var(--text-dim);line-height:1.6;">
              Masukkan koordinat sudut kiri-bawah (SW) dan kanan-atas (NE) raster secara manual,
              atau klik langsung pada peta lalu salin nilainya ke kolom di bawah.
            </p>
            <div class="field"><label>SW Latitude</label><input id="gSwLat" type="number" step="any" /></div>
            <div class="field"><label>SW Longitude</label><input id="gSwLng" type="number" step="any" /></div>
            <div class="field"><label>NE Latitude</label><input id="gNeLat" type="number" step="any" /></div>
            <div class="field"><label>NE Longitude</label><input id="gNeLng" type="number" step="any" /></div>
          </div>
          <div class="modal-foot">
            <button class="btn-ghost-sm" id="georefCancel">Batal</button>
            <button class="btn-primary-sm" id="georefApply">Terapkan</button>
          </div>
        </div>
      </div>`;
    const close = () => root.innerHTML = '';
    document.getElementById('georefClose').onclick = close;
    document.getElementById('georefCancel').onclick = close;
    if (activeOverlay) {
      const b = activeOverlay.imageOverlay.getBounds();
      document.getElementById('gSwLat').value = b.getSouthWest().lat.toFixed(6);
      document.getElementById('gSwLng').value = b.getSouthWest().lng.toFixed(6);
      document.getElementById('gNeLat').value = b.getNorthEast().lat.toFixed(6);
      document.getElementById('gNeLng').value = b.getNorthEast().lng.toFixed(6);
    }
    document.getElementById('georefApply').onclick = async () => {
      const swLat = parseFloat(document.getElementById('gSwLat').value);
      const swLng = parseFloat(document.getElementById('gSwLng').value);
      const neLat = parseFloat(document.getElementById('gNeLat').value);
      const neLng = parseFloat(document.getElementById('gNeLng').value);
      if ([swLat, swLng, neLat, neLng].some(isNaN)) { Toast.show('Lengkapi semua koordinat.', 'error'); return; }
      const newBounds = [[swLat, swLng], [neLat, neLng]];
      activeOverlay.imageOverlay.setBounds(newBounds);
      activeOverlay.bounds = newBounds;
      map.fitBounds(newBounds, { maxZoom: 18 });
      // preserve the original raster image — only overwrite bounds, never lose dataUrl
      const existing = await BGDB.getRaster(activeOverlay.id).catch(() => null);
      const dataUrl = activeOverlay.dataUrl || existing?.dataUrl || null;
      BGDB.putRaster({ id: activeOverlay.id, dataUrl, bounds: newBounds, name: activeOverlay.name }).catch(() => {});
      Toast.show('Georeferensi diterapkan.', 'success');
      close();
    };
  }

  function closeActiveOverlayControls() {
    activeOverlay = null;
    hidePdfControls();
  }

  function getActiveOverlay() { return activeOverlay; }
  async function setActiveOverlayById(entry) {
    const stored = await BGDB.getRaster(entry.id).catch(() => null);
    activeOverlay = { id: entry.id, name: entry.name, imageOverlay: entry.leafletLayer, rotationDeg: 0, opacity: entry.opacity, dataUrl: stored?.dataUrl || null, bounds: entry.leafletLayer.getBounds() };
    showPdfControls(entry.name);
  }

  return {
    init, loadPdfFile, setOpacity, setRotation, zoomOverlay, startManualGeoref,
    closeActiveOverlayControls, getActiveOverlay, setActiveOverlayById, showPdfControls, hidePdfControls,
  };
})();
