// export.js - Multi-format Export for BorneoGIS
const ExportManager = (() => {

  function downloadFile(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function layerToGeoJSON(layerId) {
    const layer = LayerManager.getById(layerId);
    if (!layer || !layer.leafletLayer || !layer.leafletLayer.toGeoJSON) return null;
    return layer.leafletLayer.toGeoJSON();
  }

  function allLayersToGeoJSON() {
    const fc = { type: 'FeatureCollection', features: [] };
    LayerManager.getAll().forEach(l => {
      if (l.visible && l.leafletLayer && l.leafletLayer.toGeoJSON) {
        try {
          const geojson = l.leafletLayer.toGeoJSON();
          const features = geojson.type === 'Feature' ? [geojson] : geojson.features || [];
          features.forEach(f => { f.properties = f.properties || {}; f.properties._layer = l.name; });
          fc.features.push(...features);
        } catch (e) {}
      }
    });
    return fc;
  }

  function exportGeoJSON(layerId, name = 'export') {
    const geojson = layerId ? layerToGeoJSON(layerId) : allLayersToGeoJSON();
    if (!geojson) { App.showToast('Tidak ada data untuk diekspor', 'warning'); return; }
    downloadFile(JSON.stringify(geojson, null, 2), `${name}.geojson`, 'application/geo+json');
    App.showToast('GeoJSON berhasil diekspor', 'success');
  }

  function exportKML(layerId, name = 'export') {
    const geojson = layerId ? layerToGeoJSON(layerId) : allLayersToGeoJSON();
    if (!geojson) { App.showToast('Tidak ada data', 'warning'); return; }

    const features = geojson.type === 'Feature' ? [geojson] : geojson.features || [];
    const placemarks = features.map(f => {
      const props = f.properties || {};
      const geom = f.geometry;
      let geomKML = '';

      if (geom.type === 'Point') {
        geomKML = `<Point><coordinates>${geom.coordinates[0]},${geom.coordinates[1]},${geom.coordinates[2] || 0}</coordinates></Point>`;
      } else if (geom.type === 'LineString') {
        geomKML = `<LineString><coordinates>${geom.coordinates.map(c => c.join(',')).join(' ')}</coordinates></LineString>`;
      } else if (geom.type === 'Polygon') {
        const outer = geom.coordinates[0].map(c => c.join(',')).join(' ');
        geomKML = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${outer}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      }

      const desc = Object.entries(props).map(([k,v]) => `${k}: ${v}`).join('\n');
      return `<Placemark><name>${props.name || props.NAME || 'Feature'}</name><description>${desc}</description>${geomKML}</Placemark>`;
    }).join('\n    ');

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>${name}</name>
    ${placemarks}
  </Document>
</kml>`;
    downloadFile(kml, `${name}.kml`, 'application/vnd.google-earth.kml+xml');
    App.showToast('KML berhasil diekspor', 'success');
  }

  function exportCSV(layerId, name = 'export') {
    const geojson = layerId ? layerToGeoJSON(layerId) : allLayersToGeoJSON();
    if (!geojson) { App.showToast('Tidak ada data', 'warning'); return; }

    const features = geojson.type === 'Feature' ? [geojson] : geojson.features || [];
    const pointFeatures = features.filter(f => f.geometry && f.geometry.type === 'Point');

    if (pointFeatures.length === 0) { App.showToast('Tidak ada fitur titik untuk CSV', 'warning'); return; }

    const allKeys = new Set(['latitude', 'longitude']);
    pointFeatures.forEach(f => Object.keys(f.properties || {}).forEach(k => allKeys.add(k)));
    const keys = Array.from(allKeys);

    const rows = pointFeatures.map(f => {
      const [lng, lat] = f.geometry.coordinates;
      const props = f.properties || {};
      return keys.map(k => {
        if (k === 'latitude') return lat;
        if (k === 'longitude') return lng;
        const v = props[k];
        return typeof v === 'string' && v.includes(',') ? `"${v}"` : (v || '');
      }).join(',');
    });

    const csv = [keys.join(','), ...rows].join('\n');
    downloadFile(csv, `${name}.csv`, 'text/csv');
    App.showToast('CSV berhasil diekspor', 'success');
  }

  async function exportMapPNG(name = 'borneogis_map') {
    App.showLoading('Mengekspor peta sebagai PNG...');
    try {
      // Use leaflet-image or html2canvas if available
      const mapEl = document.getElementById('map');
      if (window.html2canvas) {
        const canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: true });
        canvas.toBlob(blob => {
          downloadFile(blob, `${name}.png`, 'image/png');
          App.showToast('PNG berhasil diekspor', 'success');
        });
      } else {
        // Screenshot fallback using canvas
        const map = MapManager.map;
        const size = map.getSize();
        const canvas = document.createElement('canvas');
        canvas.width = size.x; canvas.height = size.y;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = '14px monospace'; ctx.fillStyle = '#00d4ff';
        ctx.fillText('BorneoGIS Explorer - Map Export', 10, 20);
        ctx.fillText(`Center: ${map.getCenter().lat.toFixed(6)}, ${map.getCenter().lng.toFixed(6)}`, 10, 40);
        ctx.fillText(`Zoom: ${map.getZoom()}`, 10, 60);
        canvas.toBlob(blob => {
          downloadFile(blob, `${name}.png`, 'image/png');
          App.showToast('Map info diekspor (screenshot penuh memerlukan html2canvas)', 'info');
        });
      }
    } catch (e) { App.showToast('Export PNG gagal: ' + e.message, 'error'); }
    App.hideLoading();
  }

  function exportLayer(layerId) {
    const layer = LayerManager.getById(layerId);
    if (!layer) return;
    const name = layer.name.replace(/\s+/g, '_');

    const modal = document.getElementById('export-modal');
    if (modal) {
      document.getElementById('export-layer-name').textContent = layer.name;
      document.getElementById('export-geojson-btn').onclick = () => { exportGeoJSON(layerId, name); modal.style.display = 'none'; };
      document.getElementById('export-kml-btn').onclick = () => { exportKML(layerId, name); modal.style.display = 'none'; };
      document.getElementById('export-csv-btn').onclick = () => { exportCSV(layerId, name); modal.style.display = 'none'; };
      modal.style.display = 'flex';
    } else {
      exportGeoJSON(layerId, name);
    }
  }

  function exportWaypointsCSV(waypoints, name = 'waypoints') {
    if (!waypoints || waypoints.length === 0) { App.showToast('Tidak ada waypoint', 'warning'); return; }
    const keys = ['id', 'name', 'category', 'lat', 'lng', 'altitude', 'notes', 'timestamp'];
    const rows = waypoints.map(w => keys.map(k => {
      const v = w[k]; return typeof v === 'string' && v.includes(',') ? `"${v}"` : (v || '');
    }).join(','));
    downloadFile([keys.join(','), ...rows].join('\n'), `${name}.csv`, 'text/csv');
    App.showToast('Waypoints CSV diekspor', 'success');
  }

  return { exportGeoJSON, exportKML, exportCSV, exportMapPNG, exportLayer, exportWaypointsCSV, downloadFile };
})();

window.ExportManager = ExportManager;
