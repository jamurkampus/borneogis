/**
 * pdfViewer.js — Standalone PDF viewer (Avenza-style)
 *
 * When a PDF has no embedded georeferencing, we don't force the user
 * through a map-matching flow. We just show the PDF, pannable and
 * zoomable, exactly as-is. Placing it on the map becomes an optional
 * action the user can trigger later via "Tempatkan di Peta", not a
 * required step on upload.
 */

const MODAL_ID = 'modal-pdf-viewer';

let _canvas = null;
let _zoom = 1;
let _panX = 0;
let _panY = 0;
let _dragging = false;
let _dragStart = null;
let _onPlaceOnMap = null;

export function initPdfViewer() {
  if (document.getElementById(MODAL_ID)) return;
  injectStyles();
  buildModalDOM();
}

/**
 * Show a PDF canvas standalone, no map involved.
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 */
export function showPdfOnly(canvas, filename) {
  _canvas = canvas;
  _zoom = 1; _panX = 0; _panY = 0;

  document.getElementById('pdf-viewer-title').textContent = filename;
  const target = document.getElementById('pdf-viewer-canvas');
  target.width = canvas.width;
  target.height = canvas.height;
  target.getContext('2d').drawImage(canvas, 0, 0);
  applyTransform();

  document.getElementById(MODAL_ID).classList.add('open');
}

function buildModalDOM() {
  const div = document.createElement('div');
  div.id = MODAL_ID;
  div.className = 'modal-overlay pdf-viewer-overlay';
  div.innerHTML = `
    <div class="modal pdf-viewer-modal">
      <div class="modal-header">
        <h3 id="pdf-viewer-title">PDF</h3>
        <button data-pdf-close>&times;</button>
      </div>
      <div class="modal-body pdf-viewer-body">
        <div id="pdf-viewer-viewport" class="pdf-viewer-viewport">
          <canvas id="pdf-viewer-canvas"></canvas>
        </div>
        <div class="pdf-viewer-controls">
          <button type="button" data-pdf-zoom="-1">−</button>
          <button type="button" data-pdf-zoom="1">+</button>
          <button type="button" data-pdf-reset>Reset</button>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" data-pdf-close>Tutup</button>
      </div>
    </div>
  `;
  document.body.appendChild(div);

  div.querySelectorAll('[data-pdf-close]').forEach(btn => {
    btn.addEventListener('click', () => div.classList.remove('open'));
  });
  div.addEventListener('click', (e) => { if (e.target === div) div.classList.remove('open'); });

  div.querySelectorAll('[data-pdf-zoom]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = parseInt(btn.dataset.pdfZoom, 10);
      _zoom = Math.min(6, Math.max(0.15, _zoom + dir * 0.25));
      applyTransform();
    });
  });
  div.querySelector('[data-pdf-reset]').addEventListener('click', () => {
    _zoom = 1; _panX = 0; _panY = 0;
    applyTransform();
  });

  const viewport = document.getElementById('pdf-viewer-viewport');
  viewport.addEventListener('mousedown', (e) => {
    _dragging = true;
    _dragStart = { x: e.clientX - _panX, y: e.clientY - _panY };
  });
  window.addEventListener('mousemove', (e) => {
    if (!_dragging) return;
    _panX = e.clientX - _dragStart.x;
    _panY = e.clientY - _dragStart.y;
    applyTransform();
  });
  window.addEventListener('mouseup', () => { _dragging = false; });

  // Basic touch support
  let touchStart = null;
  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStart = { x: e.touches[0].clientX - _panX, y: e.touches[0].clientY - _panY };
    }
  });
  viewport.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && touchStart) {
      _panX = e.touches[0].clientX - touchStart.x;
      _panY = e.touches[0].clientY - touchStart.y;
      applyTransform();
    }
  }, { passive: true });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    _zoom = Math.min(6, Math.max(0.15, _zoom + (e.deltaY < 0 ? 0.15 : -0.15)));
    applyTransform();
  }, { passive: false });
}

function applyTransform() {
  const canvasEl = document.getElementById('pdf-viewer-canvas');
  if (!canvasEl) return;
  canvasEl.style.transform = `translate(${_panX}px, ${_panY}px) scale(${_zoom})`;
  canvasEl.style.transformOrigin = 'top left';
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .pdf-viewer-modal { width: min(900px, 95vw); }
    .pdf-viewer-viewport { position: relative; height: 460px; overflow: hidden; background: #333; border-radius: 4px; cursor: grab; touch-action: none; }
    .pdf-viewer-viewport:active { cursor: grabbing; }
    .pdf-viewer-viewport canvas { position: absolute; top: 0; left: 0; }
    .pdf-viewer-controls { display: flex; gap: 6px; margin-top: 8px; }
    .pdf-viewer-controls button { width: 32px; height: 32px; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; }
    .pdf-viewer-controls button[data-pdf-reset] { width: auto; padding: 0 10px; }
  `;
  document.head.appendChild(style);
}
