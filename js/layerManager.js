/* ============================================================
   layerManager.js — Upload parsing, layer store, layer tree UI,
   visibility/opacity/reorder/grouping, attribute editing, export
   ============================================================ */
const LayerManager = (() => {
  let map;
  const layers = new Map(); // id -> { id, name, type, geojson, leafletLayer, color, opacity, visible, group, raster, meta }
  let order = []; // array of ids, top -> bottom
  let activeLayerId = null;
  let onChange = () => {};

  const PALETTE = ['#2DD4BF', '#38BDF8', '#F59E0B', '#F87171', '#A78BFA', '#34D399', '#FB923C', '#F472B6'];
  let colorCursor = 0;
  function nextColor() { return PALETTE[(colorCursor++) % PALETTE.length]; }

  function init(leafletMap, changeCb) {
    map = leafletMap;
    onChange = changeCb || (() => {});
  }

  function uid() { return 'lyr_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  /* ---------------- FILE PARSING DISPATCH ---------------- */
  async function handleFiles(fileList, progressCb) {
    const files = Array.from(fileList);
    // group shapefile parts by basename
    const shpGroups = {};
    const rest = [];
    files.forEach(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      if (['shp', 'shx', 'dbf', 'prj'].includes(ext)) {
        const base = f.name.slice(0, -(ext.length + 1));
        shpGroups[base] = shpGroups[base] || {};
        shpGroups[base][ext] = f;
      } else rest.push(f);
    });

    for (const f of rest) {
      try {
        progressCb?.(f.name, 'processing');
        await processSingleFile(f);
        progressCb?.(f.name, 'done');
      } catch (err) {
        console.error(err);
        progressCb?.(f.name, 'error', err.message);
      }
    }
    for (const base in shpGroups) {
      try {
        progressCb?.(base + '.shp', 'processing');
        await processShapefileGroup(base, shpGroups[base]);
        progressCb?.(base + '.shp', 'done');
      } catch (err) {
        console.error(err);
        progressCb?.(base + '.shp', 'error', err.message);
      }
    }
  }

  async function processSingleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const text = async () => file.text();
    let geojson, type;

    if (ext === 'geojson' || ext === 'json') {
      geojson = JSON.parse(await text());
      type = 'geojson';
    } else if (ext === 'kml') {
      const xml = new DOMParser().parseFromString(await text(), 'text/xml');
      geojson = toGeoJSON.kml(xml);
      type = 'kml';
    } else if (ext === 'gpx') {
      const xml = new DOMParser().parseFromString(await text(), 'text/xml');
      geojson = toGeoJSON.gpx(xml);
      type = 'gpx';
    } else if (ext === 'csv') {
      geojson = parseCsvToGeoJSON(await text());
      type = 'csv';
    } else if (ext === 'zip') {
      // generic shapefile zip (shpjs handles full archive)
      const buf = await file.arrayBuffer();
      geojson = await shp(buf);
      type = 'shapefile';
    } else if (ext === 'pdf') {
      await PDFViewerModule.loadPdfFile(file); // handled by pdfViewer.js, registers its own raster layer
      return;
    } else {
      throw new Error('Format tidak didukung: .' + ext);
    }

    if (Array.isArray(geojson)) geojson = geojson[0]; // shpjs may return array of layers
    addGeoJSONLayer(file.name.replace(/\.[^.]+$/, ''), geojson, type);
  }

  async function processShapefileGroup(base, parts) {
    if (!parts.shp || !parts.dbf) throw new Error('Shapefile butuh minimal .shp dan .dbf');
    const zip = new JSZip();
    for (const ext in parts) zip.file(base + '.' + ext, await parts[ext].arrayBuffer());
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    let geojson = await shp(buf);
    if (Array.isArray(geojson)) geojson = geojson[0];
    addGeoJSONLayer(base, geojson, 'shapefile');
  }

  function parseCsvToGeoJSON(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(',').map(h => h.trim());
    const latKey = headers.find(h => /^(lat|latitude|y)$/i.test(h));
    const lngKey = headers.find(h => /^(lon|lng|long|longitude|x)$/i.test(h));
    if (!latKey || !lngKey) throw new Error('CSV harus punya kolom lat/lon (lat,lng atau latitude,longitude).');
    const features = lines.slice(1).filter(Boolean).map(line => {
      const cells = line.split(',');
      const props = {};
      headers.forEach((h, i) => props[h] = isNaN(cells[i]) ? cells[i] : Number(cells[i]));
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(props[lngKey]), Number(props[latKey])] },
        properties: props,
      };
    });
    return { type: 'FeatureCollection', features };
  }

  /* ---------------- LAYER CRUD ---------------- */
  function addGeoJSONLayer(name, geojson, sourceType, opts = {}) {
    if (!geojson || !geojson.features) {
      if (geojson && geojson.type) geojson = { type: 'FeatureCollection', features: [geojson] };
      else throw new Error('Data geometri kosong / tidak valid.');
    }
    const id = opts.id || uid();
    const color = opts.color || nextColor();
    const leafletLayer = L.geoJSON(geojson, {
      style: () => ({ color, weight: 2.5, fillColor: color, fillOpacity: 0.25 }),
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 6, color, weight: 2, fillColor: color, fillOpacity: 0.7,
      }),
      onEachFeature: (feature, lyr) => {
        lyr.on('click', () => showFeatureInfo(id, feature, lyr));
      },
    }).addTo(map);

    const entry = {
      id, name: name || 'Layer', type: sourceType || 'geojson', geojson, leafletLayer,
      color, opacity: opts.opacity ?? 0.85, visible: true, group: opts.group || null, meta: {},
    };
    layers.set(id, entry);
    order.unshift(id);
    persist(entry);
    activeLayerId = id;
    onChange();
    try { map.fitBounds(leafletLayer.getBounds(), { maxZoom: 16, padding: [30, 30] }); } catch (e) {}
    return entry;
  }

  function addRasterLayerRecord(entry) {
    // used by pdfViewer.js for georeferenced raster overlays
    layers.set(entry.id, entry);
    order.unshift(entry.id);
    activeLayerId = entry.id;
    onChange();
  }

  function persist(entry) {
    BGDB.putLayer({
      id: entry.id, name: entry.name, type: entry.type, geojson: entry.geojson,
      color: entry.color, opacity: entry.opacity, visible: entry.visible, group: entry.group,
    }).catch(console.error);
  }

  async function restoreFromDB() {
    const saved = await BGDB.getAllLayers();
    saved.forEach(s => {
      if (!s.geojson) return; // raster layers re-loaded separately / skipped on reload
      const leafletLayer = L.geoJSON(s.geojson, {
        style: () => ({ color: s.color, weight: 2.5, fillColor: s.color, fillOpacity: 0.25 }),
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 6, color: s.color, weight: 2, fillColor: s.color, fillOpacity: 0.7 }),
        onEachFeature: (feature, lyr) => lyr.on('click', () => showFeatureInfo(s.id, feature, lyr)),
      });
      if (s.visible) leafletLayer.addTo(map);
      layers.set(s.id, { ...s, leafletLayer });
      order.push(s.id);
    });
    onChange();
  }

  function removeLayer(id) {
    const e = layers.get(id);
    if (!e) return;
    if (e.leafletLayer) map.removeLayer(e.leafletLayer);
    layers.delete(id);
    order = order.filter(o => o !== id);
    BGDB.deleteLayer(id).catch(() => {});
    if (e.raster) BGDB.deleteRaster(id).catch(() => {});
    if (activeLayerId === id) activeLayerId = order[0] || null;
    onChange();
  }

  function toggleVisibility(id) {
    const e = layers.get(id);
    if (!e) return;
    e.visible = !e.visible;
    if (e.leafletLayer) {
      if (e.visible) map.addLayer(e.leafletLayer); else map.removeLayer(e.leafletLayer);
    }
    persist(e);
    onChange();
  }

  function setOpacity(id, val) {
    const e = layers.get(id);
    if (!e) return;
    e.opacity = val;
    if (e.leafletLayer) {
      if (e.leafletLayer.setStyle) e.leafletLayer.setStyle({ fillOpacity: val * 0.35, opacity: val });
      if (e.leafletLayer.setOpacity) e.leafletLayer.setOpacity(val);
    }
    persist(e);
  }

  function reorder(idOrder) {
    order = idOrder;
    // re-stack: bring to front in reverse so first item ends up topmost
    [...order].reverse().forEach(id => {
      const e = layers.get(id);
      if (e?.leafletLayer?.bringToFront) e.leafletLayer.bringToFront();
    });
    onChange();
  }

  function setActive(id) { activeLayerId = id; onChange(); }
  function getActive() { return activeLayerId ? layers.get(activeLayerId) : null; }
  function getLayer(id) { return layers.get(id); }
  function getAll() { return order.map(id => layers.get(id)).filter(Boolean); }
  function rename(id, name) { const e = layers.get(id); if (e) { e.name = name; persist(e); onChange(); } }

  function ensureDigitizeTarget() {
    let active = getActive();
    if (active && active.geojson) return active;
    return addGeoJSONLayer('Digitasi Baru', { type: 'FeatureCollection', features: [] }, 'draw');
  }

  function addFeatureToLayer(id, feature) {
    const e = layers.get(id);
    if (!e) return;
    e.geojson.features.push(feature);
    e.leafletLayer.addData(feature);
    persist(e);
    onChange();
  }

  function updateFeatureProps(layerId, featureIndexOrId, newProps) {
    const e = layers.get(layerId);
    if (!e) return;
    const f = e.geojson.features.find((ft, i) => i === featureIndexOrId || ft.properties?.__id === featureIndexOrId);
    if (f) { f.properties = newProps; persist(e); }
  }

  /* ---------------- FEATURE INFO (bottom sheet / popup) ---------------- */
  function showFeatureInfo(layerId, feature, lyr) {
    const props = feature.properties || {};
    const rows = Object.entries(props).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`).join('');
    const html = `<h3 style="margin:0 0 10px;font-family:var(--font-display);font-size:15px;">Atribut Fitur</h3>
      <table>${rows || '<tr><td colspan="2">Tidak ada atribut</td></tr>'}</table>`;
    const sheet = document.getElementById('bottomSheet');
    const content = document.getElementById('bottomSheetContent');
    if (window.innerWidth <= 880 && sheet && content) {
      content.innerHTML = html;
      sheet.classList.add('open');
    } else {
      lyr.bindPopup(html, { maxWidth: 260 }).openPopup();
    }
  }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ---------------- STATS ---------------- */
  function computeStats() {
    let totalFeatures = 0, totalAreaHa = 0, totalLengthKm = 0;
    const perLayer = [];
    layers.forEach(e => {
      if (!e.geojson) { perLayer.push({ name: e.name, features: 0, areaHa: 0, lengthKm: 0 }); return; }
      let areaHa = 0, lengthKm = 0;
      const feats = e.geojson.features || [];
      feats.forEach(f => {
        if (!f.geometry) return;
        const t = f.geometry.type;
        try {
          if (t === 'Polygon' || t === 'MultiPolygon') areaHa += turf.area(f) / 10000;
          if (t === 'LineString' || t === 'MultiLineString') lengthKm += turf.length(f, { units: 'kilometers' });
        } catch (e) {}
      });
      totalFeatures += feats.length;
      totalAreaHa += areaHa;
      totalLengthKm += lengthKm;
      perLayer.push({ name: e.name, features: feats.length, areaHa, lengthKm });
    });
    return { totalLayers: layers.size, totalFeatures, totalAreaHa, totalLengthKm, perLayer };
  }

  /* ---------------- EXPORT ---------------- */
  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function exportGeoJSON(id) {
    const e = id ? layers.get(id) : mergedActiveOrAll();
    downloadBlob(JSON.stringify(e.geojson, null, 2), `${e.name || 'export'}.geojson`, 'application/geo+json');
  }

  function mergedActiveOrAll() {
    const active = getActive();
    if (active && active.geojson) return active;
    const all = getAll().filter(l => l.geojson);
    const features = all.flatMap(l => l.geojson.features);
    return { name: 'borneogis_export', geojson: { type: 'FeatureCollection', features } };
  }

  function exportKML(id) {
    const e = id ? layers.get(id) : mergedActiveOrAll();
    const kml = geojsonToKML(e.geojson, e.name);
    downloadBlob(kml, `${e.name || 'export'}.kml`, 'application/vnd.google-earth.kml+xml');
  }

  function geojsonToKML(gj, docName) {
    const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const placemarks = gj.features.map(f => {
      const name = escXml(f.properties?.name || f.properties?.NAME || '');
      const coordsToStr = (c) => c.join(',');
      let geomXml = '';
      const g = f.geometry;
      if (!g) return '';
      if (g.type === 'Point') geomXml = `<Point><coordinates>${coordsToStr(g.coordinates)}</coordinates></Point>`;
      else if (g.type === 'LineString') geomXml = `<LineString><coordinates>${g.coordinates.map(coordsToStr).join(' ')}</coordinates></LineString>`;
      else if (g.type === 'Polygon') geomXml = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${g.coordinates[0].map(coordsToStr).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      else if (g.type === 'MultiPolygon') geomXml = `<MultiGeometry>${g.coordinates.map(poly => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${poly[0].map(coordsToStr).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`).join('')}</MultiGeometry>`;
      const extData = Object.entries(f.properties || {}).map(([k, v]) => `<Data name="${escXml(k)}"><value>${escXml(v)}</value></Data>`).join('');
      return `<Placemark><name>${name}</name><ExtendedData>${extData}</ExtendedData>${geomXml}</Placemark>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escXml(docName)}</name>${placemarks}</Document></kml>`;
  }

  function exportGPX(id) {
    const e = id ? layers.get(id) : mergedActiveOrAll();
    const points = [];
    const tracks = [];
    e.geojson.features.forEach(f => {
      if (f.geometry?.type === 'Point') points.push(f);
      if (f.geometry?.type === 'LineString') tracks.push(f);
    });
    const wpts = points.map(f => `<wpt lat="${f.geometry.coordinates[1]}" lon="${f.geometry.coordinates[0]}"><name>${f.properties?.name || ''}</name></wpt>`).join('');
    const trks = tracks.map(f => `<trk><trkseg>${f.geometry.coordinates.map(c => `<trkpt lat="${c[1]}" lon="${c[0]}"></trkpt>`).join('')}</trkseg></trk>`).join('');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="BorneoGIS Explorer" xmlns="http://www.topografix.com/GPX/1/1">${wpts}${trks}</gpx>`;
    downloadBlob(gpx, `${e.name || 'export'}.gpx`, 'application/gpx+xml');
  }

  function exportCSV(id) {
    const e = id ? layers.get(id) : mergedActiveOrAll();
    const feats = e.geojson.features.filter(f => f.geometry?.type === 'Point');
    if (!feats.length) { return false; }
    const propKeys = [...new Set(feats.flatMap(f => Object.keys(f.properties || {})))];
    const header = ['lat', 'lng', ...propKeys].join(',');
    const rows = feats.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0], ...propKeys.map(k => f.properties?.[k] ?? '')].join(','));
    downloadBlob([header, ...rows].join('\n'), `${e.name || 'export'}.csv`, 'text/csv');
    return true;
  }

  return {
    init, handleFiles, addGeoJSONLayer, addRasterLayerRecord, removeLayer, toggleVisibility, setOpacity,
    reorder, setActive, getActive, getLayer, getAll, rename, restoreFromDB, ensureDigitizeTarget,
    addFeatureToLayer, updateFeatureProps, computeStats, exportGeoJSON, exportKML, exportGPX, exportCSV,
    downloadBlob, showFeatureInfo, nextColor,
  };
})();
