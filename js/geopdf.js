// geopdf.js - GeoPDF Engine for BorneoGIS Explorer
const GeoPDFEngine = (() => {
  const loadedPDFs = new Map();

  async function loadGeoPDF(file) {
    App.showLoading(`Memuat GeoPDF: ${file.name}...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      // Extract geospatial metadata
      const geoInfo = await extractGeoInfo(pdf, arrayBuffer);
      const id = `pdf_${Date.now()}`;

      // Render all pages to canvas and create image overlay
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const pageData = await renderPage(pdf, i, geoInfo);
        pages.push(pageData);
      }

      const pdfData = { id, name: file.name, pdf, geoInfo, pages, file };
      loadedPDFs.set(id, pdfData);

      if (geoInfo && geoInfo.bounds) {
        await addPDFToMap(id, pdfData);
      } else {
        // Non-georeferenced PDF - show as image overlay with manual placement
        await addRawPDFToMap(id, pdfData);
      }

      App.hideLoading();
      App.showToast(`GeoPDF dimuat: ${file.name}`, 'success');
      return id;
    } catch (err) {
      App.hideLoading();
      App.showToast(`Gagal memuat PDF: ${err.message}`, 'error');
      console.error(err);
    }
  }

  async function extractGeoInfo(pdf, buffer) {
    try {
      const metadata = await pdf.getMetadata();
      // Try to extract viewport/geospatial info from PDF metadata
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });

      // Check for OGC GeoPDF standard metadata
      let bounds = null;
      let crs = 'EPSG:4326';
      let projWKT = null;

      // Try raw binary search for geospatial markers in PDF
      const uint8 = new Uint8Array(buffer);
      const text = new TextDecoder('latin1').decode(uint8);

      // Look for NEATLINE or Viewport dictionary in PDF
      const neatlineMatch = text.match(/\/NEATLINE\s*\[([^\]]+)\]/);
      const lgiMatch = text.match(/\/LGIDict\s*<<([\s\S]*?)>>/);
      const registrationMatch = text.match(/\/Registration\s*\[[\s\S]*?\]/);

      if (lgiMatch) {
        // Parse LGI (Latitude/Longitude Geographic Information) dictionary
        const lgiText = lgiMatch[1];
        const ctmMatch = lgiText.match(/\/CTM\s*\[([^\]]+)\]/);
        const neatlineInLGI = lgiText.match(/\/Neatline\s*\[([^\]]+)\]/);

        if (ctmMatch && neatlineInLGI) {
          const ctm = ctmMatch[1].trim().split(/\s+/).map(Number);
          const neat = neatlineInLGI[1].trim().split(/\s+/).map(Number);

          if (ctm.length >= 6 && neat.length >= 8) {
            const pdfW = viewport.width;
            const pdfH = viewport.height;
            // CTM: [a b c d e f] transforms PDF coords to geo coords
            const [a, b, c, d, e, f] = ctm;
            const minX = e; const minY = f;
            const maxX = a * pdfW + e; const maxY = d * pdfH + f;
            bounds = [[minY, minX], [maxY, maxX]];
          }
        }
      }

      // Fallback: parse registration points if present
      if (!bounds && registrationMatch) {
        bounds = estimateBoundsFromRegistration(registrationMatch[0], viewport);
      }

      return { bounds, crs, viewport, pageWidth: viewport.width, pageHeight: viewport.height };
    } catch (e) {
      console.warn('Could not extract geospatial info:', e);
      return null;
    }
  }

  function estimateBoundsFromRegistration(regText, viewport) {
    try {
      const coords = regText.match(/-?\d+\.?\d*/g)?.map(Number) || [];
      if (coords.length >= 8) {
        const lats = [coords[1], coords[3], coords[5], coords[7]];
        const lngs = [coords[0], coords[2], coords[4], coords[6]];
        return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
      }
    } catch (e) {}
    return null;
  }

  async function renderPage(pdf, pageNum, geoInfo) {
    const page = await pdf.getPage(pageNum);
    const scale = 2; // High res
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { canvas, dataUrl: canvas.toDataURL('image/png'), width: viewport.width, height: viewport.height };
  }

  async function addPDFToMap(id, pdfData) {
    const { geoInfo, pages, name } = pdfData;
    const bounds = L.latLngBounds(geoInfo.bounds);

    const overlays = pages.map((page, i) => {
      const overlay = L.imageOverlay(page.dataUrl, bounds, { opacity: 1, interactive: false });
      return overlay;
    });

    const group = L.layerGroup(overlays);
    LayerManager.addLayer({
      id: `pdf_${id}`,
      name: name.replace('.pdf', ''),
      type: 'geopdf',
      leafletLayer: group,
      color: '#f39c12',
      metadata: { pdfId: id, hasBounds: true, bounds: geoInfo.bounds }
    });

    MapManager.map.fitBounds(bounds, { padding: [20, 20] });
  }

  async function addRawPDFToMap(id, pdfData) {
    const { pages, name } = pdfData;
    // No geo info - overlay at current map view center
    const center = MapManager.map.getCenter();
    const zoom = MapManager.map.getZoom();
    const deg = 0.1 / Math.pow(2, zoom - 10);

    const sw = [center.lat - deg, center.lng - deg];
    const ne = [center.lat + deg, center.lng + deg];
    const bounds = L.latLngBounds([sw, ne]);

    const overlay = L.imageOverlay(pages[0].dataUrl, bounds, { opacity: 0.8, interactive: true });

    // Make draggable
    overlay.on('add', function() {
      App.showToast('PDF tidak memiliki informasi georeferensi. Posisi dapat disesuaikan.', 'warning');
    });

    LayerManager.addLayer({
      id: `pdf_${id}`,
      name: name.replace('.pdf', '') + ' (Non-geo)',
      type: 'geopdf',
      leafletLayer: overlay,
      color: '#e67e22',
      metadata: { pdfId: id, hasBounds: false }
    });
  }

  async function loadMultiple(files) {
    const results = [];
    for (const file of files) {
      const id = await loadGeoPDF(file);
      if (id) results.push(id);
    }
    return results;
  }

  function getLoadedPDFs() {
    return Array.from(loadedPDFs.values());
  }

  function unload(id) {
    loadedPDFs.delete(id);
    LayerManager.removeLayer(`pdf_${id}`);
  }

  return { loadGeoPDF, loadMultiple, getLoadedPDFs, unload };
})();

window.GeoPDFEngine = GeoPDFEngine;
