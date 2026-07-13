/**
 * geopdf.js — Load & render GeoPDF onto Leaflet map
 *
 * Strategy:
 * 1. Scan raw PDF bytes for /Measure /GPTS /LPTS (GeoPDF georeferencing
 *    dictionary). PDF.js does not expose these through its public API,
 *    so this is done via direct byte scanning before rendering.
 * 2. Use PDF.js to render each page to a canvas
 * 3. Fall back to user-defined bounds only if no Measure dictionary found
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
 * Convert an ArrayBuffer to a binary-safe string (1 char per byte).
 * We deliberately avoid TextDecoder('utf-8') here because PDF structure
 * bytes are not UTF-8 and must map 1:1 so indexOf/slice offsets stay valid.
 */
function bytesToLatin1String(buffer) {
  const bytes = new Uint8Array(buffer);
  let result = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    result += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return result;
}

/**
 * Given text and the index right after an opening '[', read numbers up to
 * the matching ']'.
 */
function extractNumbersFromArray(text, startIdx) {
  const end = text.indexOf(']', startIdx);
  if (end === -1) return null;
  const raw = text.slice(startIdx, end);
  const nums = raw.match(/-?\d+\.?\d*(?:[eE][-+]?\d+)?/g);
  return nums ? nums.map(Number) : null;
}

/**
 * Scan raw PDF bytes for a /Measure dictionary containing /GPTS (geographic
 * corner points) and optionally /LPTS (page-space corner points).
 *
 * This covers GeoPDFs exported from ArcGIS "Publish to GeoPDF", TerraGo,
 * and QGIS georeferencing plugins, which store this metadata as plain
 * text inside the page's /VP (Viewport) dictionary — uncompressed, since
 * it must remain readable by third-party GeoPDF readers.
 *
 * Known limitation: if a PDF producer compresses page objects into an
 * object stream (/ObjStm), this scan will miss the dictionary. This is
 * uncommon for GeoPDFs specifically because compressing georeferencing
 * metadata breaks compatibility with most GeoPDF readers, but if you hit
 * a file this doesn't catch, that's the next thing to handle.
 *
 * Returns { bounds, gpts, lpts } or null
 */
function scanRawPDFForGeoBounds(buffer) {
  const text = bytesToLatin1String(buffer);

  let searchFrom = 0;
  while (true) {
    const measureIdx = text.indexOf('/Measure', searchFrom);
    if (measureIdx === -1) return null;

    const window = text.slice(measureIdx, measureIdx + 4000);
    const gptsMatch = window.match(/\/GPTS\s*\[/);

    if (gptsMatch) {
      const gptsStart = measureIdx + gptsMatch.index + gptsMatch[0].length;
      const gpts = extractNumbersFromArray(text, gptsStart);

      if (gpts && gpts.length >= 6 && gpts.length % 2 === 0) {
        let lpts = null;
        const lptsMatch = window.match(/\/LPTS\s*\[/);
        if (lptsMatch) {
          const lptsStart = measureIdx + lptsMatch.index + lptsMatch[0].length;
          lpts = extractNumbersFromArray(text, lptsStart);
        }

        const lats = [], lngs = [];
        for (let i = 0; i < gpts.length; i += 2) {
          lats.push(gpts[i]);
          lngs.push(gpts[i + 1]);
        }

        return {
          bounds: {
            minLat: Math.min(...lats),
            maxLat: Math.max(...lats),
            minLng: Math.min(...lngs),
            maxLng: Math.max(...lngs)
          },
          gpts,
          lpts
        };
      }
    }

    // This /Measure occurrence didn't have a usable /GPTS nearby, keep
    // looking in case the PDF has multiple viewport entries.
    searchFrom = measureIdx + 8;
  }
}

/**
 * Main entry point: load a GeoPDF file (ArrayBuffer) and return layer info
 *
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 * @returns {Promise<{canvas, bounds, pageCount, suggestedBounds, metadata, filename}>}
 */
export async function loadGeoPDF(buffer, filename) {
  const lib = await ensurePDFJS();

  const pdf  = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const page = await pdf.getPage(1);

  // Render at 2x for quality
  const canvas = await renderPageToCanvas(page, 2);

  // Try metadata extraction (author/title/etc, unrelated to georeferencing)
  let metadata = null;
  try {
    metadata = await pdf.getMetadata();
  } catch { /* ignore */ }

  // Try to extract geo bounds directly from raw PDF bytes.
  // This is what actually finds ArcGIS/TerraGo/QGIS GeoPDF georeferencing —
  // PDF.js's page API does not expose /VP or /Measure dictionaries.
  let geo = null;
  try {
    geo = scanRawPDFForGeoBounds(buffer);
  } catch { /* ignore, fall through to manual bounds */ }

  return {
    canvas,
    bounds: geo ? geo.bounds : null,   // null if not found → prompt user for manual bounds
    lpts: geo ? geo.lpts : null,       // kept for a future affine-transform upgrade
    pageCount: pdf.numPages,
    metadata,
    filename
  };
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
