// analysis.js - GIS Analysis Engine using Turf.js
const Analysis = (() => {

  function getSelectedGeoJSON() {
    const layers = LayerManager.getAll();
    const geojsonLayers = layers.filter(l => l.type === 'geojson' || l.type === 'digitize');
    if (geojsonLayers.length === 0) { App.showToast('Tidak ada layer GeoJSON untuk dianalisis', 'warning'); return null; }
    // Use first visible layer
    const target = geojsonLayers.find(l => l.visible);
    if (!target || !target.leafletLayer.toGeoJSON) return null;
    return target.leafletLayer.toGeoJSON();
  }

  function getActiveLayerGeoJSON(layerId) {
    const layer = LayerManager.getById(layerId);
    if (!layer || !layer.leafletLayer || !layer.leafletLayer.toGeoJSON) return null;
    return layer.leafletLayer.toGeoJSON();
  }

  async function runBuffer(sourceId, distanceMeters) {
    const geojson = getActiveLayerGeoJSON(sourceId);
    if (!geojson) return;
    App.showLoading('Membuat buffer...');
    try {
      const buffered = turf.buffer(geojson, distanceMeters / 1000, { units: 'kilometers' });
      addResultLayer(buffered, `Buffer ${distanceMeters}m`, '#3498db');
      App.hideLoading();
      App.showToast(`Buffer ${distanceMeters}m berhasil dibuat`, 'success');
      return buffered;
    } catch (e) { App.hideLoading(); App.showToast('Buffer gagal: ' + e.message, 'error'); }
  }

  async function runUnion(id1, id2) {
    const g1 = getActiveLayerGeoJSON(id1);
    const g2 = getActiveLayerGeoJSON(id2);
    if (!g1 || !g2) return;
    App.showLoading('Menggabungkan layer...');
    try {
      const features1 = flattenFeatures(g1);
      const features2 = flattenFeatures(g2);
      let result = features1[0];
      for (const f of [...features1.slice(1), ...features2]) {
        result = turf.union(result, f);
      }
      addResultLayer(result, 'Union Result', '#2ecc71');
      App.hideLoading();
      App.showToast('Union berhasil', 'success');
    } catch (e) { App.hideLoading(); App.showToast('Union gagal: ' + e.message, 'error'); }
  }

  async function runIntersect(id1, id2) {
    const g1 = getActiveLayerGeoJSON(id1);
    const g2 = getActiveLayerGeoJSON(id2);
    if (!g1 || !g2) return;
    App.showLoading('Mengintersect layer...');
    try {
      const features1 = flattenFeatures(g1);
      const features2 = flattenFeatures(g2);
      const results = [];
      for (const f1 of features1) {
        for (const f2 of features2) {
          try {
            const intersection = turf.intersect(f1, f2);
            if (intersection) results.push(intersection);
          } catch (e) {}
        }
      }
      if (results.length === 0) { App.showToast('Tidak ada irisan', 'warning'); return; }
      const fc = turf.featureCollection(results);
      addResultLayer(fc, 'Intersect Result', '#e74c3c');
      App.hideLoading();
      App.showToast(`Intersect: ${results.length} fitur`, 'success');
    } catch (e) { App.hideLoading(); App.showToast('Intersect gagal: ' + e.message, 'error'); }
  }

  async function runDissolve(sourceId, propertyKey = null) {
    const geojson = getActiveLayerGeoJSON(sourceId);
    if (!geojson) return;
    App.showLoading('Dissolve...');
    try {
      const dissolved = propertyKey
        ? turf.dissolve(geojson, { propertyName: propertyKey })
        : turf.dissolve(geojson);
      addResultLayer(dissolved, 'Dissolved', '#9b59b6');
      App.hideLoading();
      App.showToast('Dissolve berhasil', 'success');
    } catch (e) { App.hideLoading(); App.showToast('Dissolve gagal: ' + e.message, 'error'); }
  }

  async function runDifference(id1, id2) {
    const g1 = getActiveLayerGeoJSON(id1);
    const g2 = getActiveLayerGeoJSON(id2);
    if (!g1 || !g2) return;
    App.showLoading('Menghitung difference...');
    try {
      const f1 = flattenFeatures(g1);
      const f2 = flattenFeatures(g2);
      const results = [];
      for (const feat of f1) {
        let result = feat;
        for (const mask of f2) {
          try { result = turf.difference(result, mask); } catch (e) {}
        }
        if (result) results.push(result);
      }
      const fc = turf.featureCollection(results.filter(Boolean));
      addResultLayer(fc, 'Difference Result', '#f39c12');
      App.hideLoading();
      App.showToast('Difference berhasil', 'success');
    } catch (e) { App.hideLoading(); App.showToast('Difference gagal: ' + e.message, 'error'); }
  }

  async function runClip(sourceId, maskId) {
    return runIntersect(sourceId, maskId);
  }

  function calculateArea(sourceId) {
    const geojson = getActiveLayerGeoJSON(sourceId);
    if (!geojson) return;
    try {
      const features = flattenFeatures(geojson);
      let totalArea = 0;
      const results = [];
      features.forEach((f, i) => {
        if (f.geometry.type.includes('Polygon')) {
          const area = turf.area(f);
          totalArea += area;
          results.push({ feature: i + 1, area_m2: area.toFixed(2), area_ha: (area / 10000).toFixed(4) });
        }
      });

      showAnalysisResult('Kalkulasi Luas', [
        { label: 'Total Luas', value: `${(totalArea / 10000).toFixed(4)} Ha` },
        { label: 'Total Luas (m²)', value: `${totalArea.toFixed(2)} m²` },
        { label: 'Total Luas (km²)', value: `${(totalArea / 1000000).toFixed(6)} km²` },
        { label: 'Jumlah Polygon', value: results.length }
      ], results);
    } catch (e) { App.showToast('Kalkulasi area gagal: ' + e.message, 'error'); }
  }

  function calculateLength(sourceId) {
    const geojson = getActiveLayerGeoJSON(sourceId);
    if (!geojson) return;
    try {
      const length = turf.length(geojson, { units: 'meters' });
      showAnalysisResult('Kalkulasi Panjang', [
        { label: 'Total Panjang', value: `${length.toFixed(2)} m` },
        { label: 'Total Panjang (km)', value: `${(length / 1000).toFixed(4)} km` }
      ]);
    } catch (e) { App.showToast('Kalkulasi panjang gagal: ' + e.message, 'error'); }
  }

  async function findNearest(point, sourceId) {
    const geojson = getActiveLayerGeoJSON(sourceId);
    if (!geojson) return;
    try {
      const pt = turf.point([point.lng, point.lat]);
      const features = flattenFeatures(geojson);
      const pointFeatures = features.filter(f => f.geometry.type === 'Point');
      if (pointFeatures.length === 0) { App.showToast('Tidak ada fitur titik', 'warning'); return; }
      const nearest = turf.nearestPoint(pt, turf.featureCollection(pointFeatures));
      const dist = turf.distance(pt, nearest, { units: 'meters' });

      MapManager.map.setView([nearest.geometry.coordinates[1], nearest.geometry.coordinates[0]], 16);
      App.showToast(`Fitur terdekat: ${dist.toFixed(1)} m`, 'info');
      return { feature: nearest, distance: dist };
    } catch (e) { App.showToast('Nearest gagal: ' + e.message, 'error'); }
  }

  function flattenFeatures(geojson) {
    if (geojson.type === 'Feature') return [geojson];
    if (geojson.type === 'FeatureCollection') return geojson.features;
    return [turf.feature(geojson)];
  }

  function addResultLayer(geojson, name, color) {
    const leafletLayer = L.geoJSON(geojson, {
      style: { color, weight: 2, opacity: 0.9, fillOpacity: 0.3, fillColor: color },
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 6, fillColor: color, color: '#fff', weight: 1, fillOpacity: 0.9 })
    });
    LayerManager.addLayer({ name, type: 'analysis', leafletLayer, color });
  }

  function showAnalysisResult(title, stats, tableData = null) {
    const modal = document.getElementById('analysis-result-modal');
    if (!modal) return;

    let html = `<h3>${title}</h3><div class="analysis-stats">`;
    stats.forEach(s => {
      html += `<div class="stat-item"><span class="stat-label">${s.label}</span><span class="stat-value">${s.value}</span></div>`;
    });
    html += '</div>';

    if (tableData && tableData.length > 0) {
      const keys = Object.keys(tableData[0]);
      html += `<table class="analysis-table"><thead><tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr></thead><tbody>`;
      tableData.forEach(row => {
        html += `<tr>${keys.map(k => `<td>${row[k]}</td>`).join('')}</tr>`;
      });
      html += '</tbody></table>';
    }

    document.getElementById('analysis-result-content').innerHTML = html;
    modal.style.display = 'flex';
  }

  function measureDistance(latlngs) {
    if (latlngs.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < latlngs.length; i++) {
      total += turf.distance(
        [latlngs[i-1].lng, latlngs[i-1].lat],
        [latlngs[i].lng, latlngs[i].lat],
        { units: 'meters' }
      );
    }
    return total;
  }

  function measureArea(latlngs) {
    if (latlngs.length < 3) return 0;
    const coords = latlngs.map(ll => [ll.lng, ll.lat]);
    coords.push(coords[0]);
    const poly = turf.polygon([coords]);
    return turf.area(poly);
  }

  function bearingBetween(pt1, pt2) {
    return turf.bearing([pt1.lng, pt1.lat], [pt2.lng, pt2.lat]);
  }

  return {
    runBuffer, runUnion, runIntersect, runDissolve, runDifference, runClip,
    calculateArea, calculateLength, findNearest,
    measureDistance, measureArea, bearingBetween,
    showAnalysisResult
  };
})();

window.Analysis = Analysis;
