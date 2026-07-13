/**
 * georef.js — Manual georeferencing via control-point (GCP) matching
 *
 * User clicks a point on the rendered PDF, then clicks the matching point
 * on a reference map (same idea as QGIS Georeferencer / Avenza's manual
 * calibration).
 *
 *   2 points  -> straight bounding box fit (no rotation)
 *   3+ points -> full 2D affine transform (rotation + independent X/Y
 *                scale), with RMSE reported in metres so the user knows
 *                how trustworthy the result is
 *
 * Output bounds/canvas plug straight into layers.js's
 * addGeoPDFLayerFromCanvas(), no changes needed to how layers are stored.
 */

import { showToast } from './app.js';

let _map = null;              // reference Leaflet map inside the modal
let _pdfCanvas = null;        // source canvas from geopdf.js loadGeoPDF()
let _points = [];             // [{ px, py, lat, lng }]
let _pendingPDFClick = null;
let _resolve = null;
let _pdfZoom = 1;

const MODAL_ID = 'modal-georef';

export function initGeoref() {
  if (document.getElementById(MODAL_ID)) return;
  injectStyles();
  buildModalDOM();
}

/**
 * Open the georeferencing UI for a loaded GeoPDF result.
 * @param {{canvas: HTMLCanvasElement}} result - from geopdf.js loadGeoPDF()
 * @returns {Promise<null|{fallbackManual:true}|{bounds, transform, rmse, warpedCanvas}>}
 *          null if the user cancelled outright.
 */
export function openGeoref(result) {
  return new Promise((resolve) => {
    _resolve = resolve;
    _points = [];
    _pdfCanvas = result.canvas;
    document.getElementById('georef-pdf-markers').innerHTML = '';
    renderPointList();
    updateAccuracy();
    document.getElementById('georef-apply').disabled = true;
    mountPdfPreview();
    mountReferenceMap();
    document.getElementById(MODAL_ID).classList.add('open');
  });
}

// ---- DOM SETUP ----

function buildModalDOM() {
  const div = document.createElement('div');
  div.id = MODAL_ID;
  div.className = 'modal-overlay georef-overlay';
  div.innerHTML = `
    <div class="modal georef-modal">
      <div class="modal-header">
        <h3>Georeferensi Manual</h3>
        <button data-georef-close>&times;</button>
      </div>
      <div class="modal-body georef-body">
        <p class="georef-hint">
          Klik titik yang mudah dikenali di PDF (kiri), lalu klik titik yang sama persis
          di peta (kanan). Minimal 2 titik untuk kotak lurus. Pakai 3 titik atau lebih
          kalau petanya agak miring, supaya rotasi ikut dihitung dan ada skor akurasi.
        </p>
        <div class="georef-panes">
          <div class="georef-pane">
            <div class="georef-pane-label">PDF</div>
            <div id="georef-pdf-viewport" class="georef-pdf-viewport">
              <canvas id="georef-pdf-canvas"></canvas>
              <div id="georef-pdf-markers" class="georef-pdf-markers"></div>
            </div>
            <div class="georef-zoom-controls">
              <button type="button" data-georef-zoom="-1">−</button>
              <button type="button" data-georef-zoom="1">+</button>
            </div>
          </div>
          <div class="georef-pane">
            <div class="georef-pane-label">Peta acuan</div>
            <div id="georef-ref-map" class="georef-ref-map"></div>
          </div>
        </div>
        <div class="georef-points-list" id="georef-points-list"></div>
        <div class="georef-accuracy" id="georef-accuracy"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" data-georef-manual>Input koordinat manual</button>
        <div style="flex:1"></div>
        <button type="button" class="btn-secondary" data-georef-close>Batal</button>
        <button type="button" class="btn-primary" id="georef-apply" disabled>Terapkan</button>
      </div>
    </div>
  `;
  document.body.appendChild(div);

  div.querySelectorAll('[data-georef-close]').forEach(btn => {
    btn.addEventListener('click', () => cancel());
  });
  div.addEventListener('click', (e) => { if (e.target === div) cancel(); });

  div.querySelectorAll('[data-georef-zoom]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = parseInt(btn.dataset.georefZoom, 10);
      _pdfZoom = Math.min(4, Math.max(0.2, _pdfZoom + dir * 0.25));
      applyPdfTransform();
    });
  });

  document.getElementById('georef-apply').addEventListener('click', applyResult);
  div.querySelector('[data-georef-manual]').addEventListener('click', () => {
    document.getElementById(MODAL_ID).classList.remove('open');
    teardownReferenceMap();
    if (_resolve) { _resolve({ fallbackManual: true }); _resolve = null; }
  });
}

function cancel() {
  document.getElementById(MODAL_ID).classList.remove('open');
  teardownReferenceMap();
  if (_resolve) { _resolve(null); _resolve = null; }
}

// ---- PDF PREVIEW ----

function mountPdfPreview() {
  const viewport = document.getElementById('georef-pdf-viewport');
  const canvasEl = document.getElementById('georef-pdf-canvas');
  const ctx = canvasEl.getContext('2d');

  canvasEl.width  = _pdfCanvas.width;
  canvasEl.height = _pdfCanvas.height;
  ctx.drawImage(_pdfCanvas, 0, 0);

  _pdfZoom = Math.min(
    viewport.clientWidth / _pdfCanvas.width,
    viewport.clientHeight / _pdfCanvas.height
  ) || 1;
  applyPdfTransform();

  canvasEl.onclick = (e) => {
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    beginPointFromPDF(px, py);
  };
}

function applyPdfTransform() {
  const canvasEl = document.getElementById('georef-pdf-canvas');
  canvasEl.style.transform = `scale(${_pdfZoom})`;
  canvasEl.style.transformOrigin = 'top left';
  const markers = document.getElementById('georef-pdf-markers');
  markers.style.transform = `scale(${_pdfZoom})`;
  markers.style.transformOrigin = 'top left';
}

function beginPointFromPDF(px, py) {
  if (_pendingPDFClick) {
    showToast('Klik dulu titik yang sama di peta sebelum menandai titik baru', 'info');
    return;
  }
  _pendingPDFClick = { px, py };
  showToast('Titik PDF ditandai. Sekarang klik titik yang sama di peta.', 'info');
  dropMarker(px, py, _points.length + 1, true);
}

function dropMarker(px, py, label, pending) {
  const layer = document.getElementById('georef-pdf-markers');
  const dot = document.createElement('div');
  dot.className = 'georef-marker' + (pending ? ' pending' : '');
  dot.style.left = px + 'px';
  dot.style.top  = py + 'px';
  dot.textContent = label;
  layer.appendChild(dot);
}

// ---- REFERENCE MAP ----

function mountReferenceMap() {
  const el = document.getElementById('georef-ref-map');
  el.innerHTML = '';
  _map = L.map(el, { zoomControl: true }).setView([0.5, 117.5], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(_map);

  _map.on('click', (e) => {
    if (!_pendingPDFClick) {
      showToast('Klik titik di PDF dulu, baru klik titik yang sama di peta', 'info');
      return;
    }
    addControlPoint(_pendingPDFClick, e.latlng);
    _pendingPDFClick = null;
  });

  setTimeout(() => _map && _map.invalidateSize(), 50);
}

function teardownReferenceMap() {
  if (_map) { _map.remove(); _map = null; }
  _pendingPDFClick = null;
}

// ---- CONTROL POINTS ----

function addControlPoint(pdfPt, latlng) {
  _points.push({ px: pdfPt.px, py: pdfPt.py, lat: latlng.lat, lng: latlng.lng });

  L.marker(latlng).addTo(_map)
    .bindTooltip(String(_points.length), { permanent: true, direction: 'top' });

  const pending = document.querySelector('#georef-pdf-markers .pending');
  if (pending) pending.classList.remove('pending');

  renderPointList();
  updateAccuracy();
  document.getElementById('georef-apply').disabled = _points.length < 2;
}

function removeControlPoint(idx) {
  _points.splice(idx, 1);

  // Simplest correct way to keep both panes in sync: rebuild markers
  document.getElementById('georef-pdf-markers').innerHTML = '';
  _points.forEach((p, i) => dropMarker(p.px, p.py, i + 1, false));

  mountReferenceMap();
  _points.forEach((p) => {
    L.marker([p.lat, p.lng]).addTo(_map)
      .bindTooltip(String(_points.indexOf(p) + 1), { permanent: true, direction: 'top' });
  });

  renderPointList();
  updateAccuracy();
  document.getElementById('georef-apply').disabled = _points.length < 2;
}

function renderPointList() {
  const container = document.getElementById('georef-points-list');
  if (!container) return;
  container.innerHTML = '';
  _points.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'georef-point-row';
    row.innerHTML = `
      <span>#${i + 1}</span>
      <span>PDF (${p.px.toFixed(0)}, ${p.py.toFixed(0)})</span>
      <span>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</span>
      <button type="button" data-remove="${i}">Hapus</button>
    `;
    row.querySelector('button').addEventListener('click', () => removeControlPoint(i));
    container.appendChild(row);
  });
}

// ---- MATH: affine transform + accuracy ----

/**
 * Least-squares affine fit mapping PDF pixel space -> lat/lng.
 *   lat = a*px + b*py + c
 *   lng = d*px + e*py + f
 * Exact with 3 points, best-fit with more.
 */
function solveAffine(points) {
  function solveFor(target) {
    let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sxt = 0, syt = 0, st = 0;
    const n = points.length;
    points.forEach(p => {
      const x = p.px, y = p.py, t = target(p);
      sxx += x * x; sxy += x * y; sx += x;
      syy += y * y; sy += y;
      sxt += x * t; syt += y * t; st += t;
    });
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
    const B = [sxt, syt, st];
    return solve3x3(A, B);
  }
  const [a, b, c] = solveFor(p => p.lat);
  const [d, e, f] = solveFor(p => p.lng);
  return { a, b, c, d, e, f };
}

function solve3x3(A, B) {
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  const D = det(A);
  if (Math.abs(D) < 1e-9) return [0, 0, 0]; // degenerate (points collinear)

  const replaceCol = (m, col, vec) => m.map((row, i) => row.map((v, j) => (j === col ? vec[i] : v)));

  return [
    det(replaceCol(A, 0, B)) / D,
    det(replaceCol(A, 1, B)) / D,
    det(replaceCol(A, 2, B)) / D
  ];
}

function applyAffine(t, px, py) {
  return { lat: t.a * px + t.b * py + t.c, lng: t.d * px + t.e * py + t.f };
}

function computeRMSE(t, points) {
  let sumSq = 0;
  points.forEach(p => {
    const pred = applyAffine(t, p.px, p.py);
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(p.lat * Math.PI / 180);
    const dyM = (pred.lat - p.lat) * mPerDegLat;
    const dxM = (pred.lng - p.lng) * mPerDegLng;
    sumSq += dxM * dxM + dyM * dyM;
  });
  return Math.sqrt(sumSq / points.length); // metres
}

function updateAccuracy() {
  const el = document.getElementById('georef-accuracy');
  if (!el) return;
  if (_points.length < 3) {
    el.textContent = _points.length === 2
      ? 'Mode 2 titik: hasil berupa kotak lurus, rotasi tidak dihitung.'
      : '';
    return;
  }
  const t = solveAffine(_points);
  const rmse = computeRMSE(t, _points);
  let label = 'baik';
  if (rmse > 50) label = 'kurang akurat, coba pilih titik yang lebih presisi';
  else if (rmse > 15) label = 'cukup';
  el.textContent = `Perkiraan akurasi (RMSE): ${rmse.toFixed(1)} m — ${label}`;
}

/**
 * Warp the source PDF canvas into a north-up canvas covering an
 * axis-aligned lat/lng bounding box, using the inverse affine transform.
 * This lets rotated GeoPDFs still work with Leaflet's plain ImageOverlay,
 * no rotation plugin required.
 */
function warpToNorthUp(t, bounds, srcCanvas, outW = 2000) {
  const { minLat, maxLat, minLng, maxLng } = bounds;
  const aspect = (maxLat - minLat) / (maxLng - minLng);
  const outH = Math.max(1, Math.round(outW * aspect));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');

  const det = t.a * t.e - t.b * t.d;
  const inv = { a: t.e / det, b: -t.b / det, d: -t.d / det, e: t.a / det };

  const src = srcCanvas.getContext('2d');
  const srcData = src.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const outData = ctx.createImageData(outW, outH);

  for (let oy = 0; oy < outH; oy++) {
    const lat = maxLat - (oy / outH) * (maxLat - minLat);
    for (let ox = 0; ox < outW; ox++) {
      const lng = minLng + (ox / outW) * (maxLng - minLng);

      const dLat = lat - t.c;
      const dLng = lng - t.f;
      const px = Math.round(inv.a * dLat + inv.b * dLng);
      const py = Math.round(inv.d * dLat + inv.e * dLng);

      const outIdx = (oy * outW + ox) * 4;
      if (px >= 0 && px < srcCanvas.width && py >= 0 && py < srcCanvas.height) {
        const srcIdx = (py * srcCanvas.width + px) * 4;
        outData.data[outIdx]     = srcData.data[srcIdx];
        outData.data[outIdx + 1] = srcData.data[srcIdx + 1];
        outData.data[outIdx + 2] = srcData.data[srcIdx + 2];
        outData.data[outIdx + 3] = srcData.data[srcIdx + 3];
      } else {
        outData.data[outIdx + 3] = 0; // transparent outside the PDF's extent
      }
    }
  }

  ctx.putImageData(outData, 0, 0);
  return out;
}

function applyResult() {
  if (_points.length < 2) return;

  let bounds, warpedCanvas, transform = null, rmse = null;

  if (_points.length === 2) {
    const lats = _points.map(p => p.lat);
    const lngs = _points.map(p => p.lng);
    bounds = {
      minLat: Math.min(...lats), maxLat: Math.max(...lats),
      minLng: Math.min(...lngs), maxLng: Math.max(...lngs)
    };
    warpedCanvas = _pdfCanvas; // no rotation info with only 2 points
  } else {
    transform = solveAffine(_points);
    rmse = computeRMSE(transform, _points);

    const corners = [
      { px: 0, py: 0 },
      { px: _pdfCanvas.width, py: 0 },
      { px: 0, py: _pdfCanvas.height },
      { px: _pdfCanvas.width, py: _pdfCanvas.height }
    ].map(c => applyAffine(transform, c.px, c.py));

    bounds = {
      minLat: Math.min(...corners.map(c => c.lat)),
      maxLat: Math.max(...corners.map(c => c.lat)),
      minLng: Math.min(...corners.map(c => c.lng)),
      maxLng: Math.max(...corners.map(c => c.lng))
    };

    warpedCanvas = warpToNorthUp(transform, bounds, _pdfCanvas);
  }

  document.getElementById(MODAL_ID).classList.remove('open');
  teardownReferenceMap();

  const result = { bounds, transform, rmse, warpedCanvas };
  if (_resolve) { _resolve(result); _resolve = null; }
}

// ---- STYLES (injected once so no edits to style.css are required) ----

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .georef-modal { width: min(1100px, 95vw); max-width: 1100px; }
    .georef-hint { font-size: 13px; color: #555; margin: 0 0 12px; }
    .georef-panes { display: flex; gap: 12px; height: 380px; }
    .georef-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .georef-pane-label { font-size: 12px; font-weight: 600; color: #777; margin-bottom: 4px; }
    .georef-pdf-viewport { position: relative; flex: 1; overflow: auto; background: #ddd; border: 1px solid #ccc; border-radius: 4px; }
    .georef-pdf-viewport canvas { display: block; cursor: crosshair; }
    .georef-pdf-markers { position: absolute; top: 0; left: 0; pointer-events: none; }
    .georef-marker { position: absolute; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; background: #1565C0; color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.4); }
    .georef-marker.pending { background: #F9A825; animation: georef-pulse 1s infinite; }
    @keyframes georef-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.2); } }
    .georef-ref-map { flex: 1; border: 1px solid #ccc; border-radius: 4px; }
    .georef-zoom-controls { display: flex; gap: 6px; margin-top: 6px; }
    .georef-zoom-controls button { width: 28px; height: 28px; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; }
    .georef-points-list { margin-top: 12px; max-height: 110px; overflow-y: auto; font-size: 12px; }
    .georef-point-row { display: grid; grid-template-columns: 24px 1fr 1fr 60px; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid #eee; }
    .georef-point-row button { font-size: 11px; color: #c62828; background: none; border: none; cursor: pointer; }
    .georef-accuracy { margin-top: 8px; font-size: 13px; font-weight: 600; color: #1565C0; }
  `;
  document.head.appendChild(style);
}
