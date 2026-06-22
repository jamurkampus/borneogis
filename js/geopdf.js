/**
 * geopdf.js — Load & render GeoPDF onto Leaflet map
 *
 * Strategy:
 * 1. Use PDF.js to render each page to a canvas
 * 2. Extract geospatial metadata (viewport CRS info) when present
 * 3. Fall back to user-defined bounds if no GeoTIFF-style bbox found
 * 4. Display as Leaflet ImageOverlay
 */

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';

let pdfjsLib = null;

async function ensurePDFJS() {
  if (pdfjsLib) return pdfjsLib;
  if (window.pdfjsLib) { pdfjsLib = window.pdfjsLib; return pdfjsLib; }

  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_CDN;
    s.onload = () => {
      pdfjsLib = window.pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(pdfjsLib);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/**
 * Parse geospatial bbox from PDF metadata / viewport
 * Returns { minLat, minLng, maxLat, maxLng } or null
 */
function parseGeoBounds(pdfDoc, page) {
  try {
    // PDF viewport in user units
    const vp     = page.getViewport({ scale: 1 });
    const width  = vp.width;
    const height = vp.height;

    // Try to pull measure dictionary from page.ref via internal API
    // This works for GeoPDFs exported from QGIS / ArcGIS
    const pageObj = page._pageInfo;
    if (pageObj && pageObj.view) {
      // Some internal structures expose geo transform
    }

    // Fallback: attempt to read XMP / pdfmark metadata
    return null; // Will be handled by manual bounds input
  } catch {
    return null;
  }
}

/**
 * Render a PDF page to a canvas at given scale
 */
async function renderPageToCanvas(page, scale = 2) {
  const vp     = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width  = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d');

  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

/**
 * Main entry point: load a GeoPDF file (ArrayBuffer) and return layer info
 *
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 * @returns {Promise<{canvas, bounds, pageCount, suggestedBounds}>}
 */
export async function loadGeoPDF(buffer, filename) {
  const lib = await ensurePDFJS();

  const pdf  = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const page = await pdf.getPage(1);

  // Render at 2x for quality
  const canvas = await renderPageToCanvas(page, 2);

  // Try metadata extraction
  let metadata = null;
  try {
    metadata = await pdf.getMetadata();
  } catch { /* ignore */ }

  // Try to extract geo bounds from PDF ViewerPreferences / Measure dictionary
  let bounds = null;
  bounds = extractBoundsFromPage(page);

  return {
    canvas,
    bounds,      // null if not found → prompt user
    pageCount: pdf.numPages,
    metadata,
    filename
  };
}

/**
 * Attempt to extract LPTS / Measure from PDF internals
 * This covers QGIS-exported GeoPDF with /Measure dictionary
 */
function extractBoundsFromPage(page) {
  try {
    // PDF.js exposes page._pageInfo with raw PDF objects in some builds
    const info = page._pageInfo;
    if (!info) return null;

    // Walk through raw page dict for /VP (Viewport) with /Measure
    const vpArr = info.VP || (info.pageDict && info.pageDict.get && info.pageDict.get('VP'));
    if (!vpArr) return null;

    // Each viewport entry has /BBox and /Measure with /GPTS (geographic points)
    const first = Array.isArray(vpArr) ? vpArr[0] : vpArr;
    if (!first) return null;

    const measure = first.get ? first.get('Measure') : first.Measure;
    if (!measure) return null;

    const gpts = measure.get ? measure.get('GPTS') : measure.GPTS;
    if (!gpts || !gpts.length) return null;

    // GPTS is pairs of [lat, lng] for corners: [ll, ul, ur, lr]
    const lats = [], lngs = [];
    for (let i = 0; i < gpts.length; i += 2) {
      lats.push(gpts[i]);
      lngs.push(gpts[i + 1]);
    }

    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs)
    };
  } catch {
    return null;
  }
}

/**
 * Convert canvas to image URL for Leaflet overlay
 */
export function canvasToImageURL(canvas) {
  return canvas.toDataURL('image/png');
}

/**
 * Render page N (1-indexed) to canvas — used for multi-page navigation
 */
export async function renderPage(buffer, pageNum, scale = 2) {
  const lib  = await ensurePDFJS();
  const pdf  = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const page = await pdf.getPage(pageNum);
  return renderPageToCanvas(page, scale);
}
