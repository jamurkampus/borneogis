/* ============================================================
   geospatialTools.js — Measurement, digitizing (Leaflet.draw),
   and spatial analysis (Turf.js): buffer, intersect, union, clip,
   dissolve, area/length calc, nearest, spatial query
   ============================================================ */
const GeoTools = (() => {
  let map;
  let measureLayer, measurePoints = [], measureMode = null, measureLine, measurePolygon;
  let drawnItems, drawControl, drawMode = null;
  let onMeasureUpdate = () => {};

  function init(leafletMap, cbMeasure) {
    map = leafletMap;
    onMeasureUpdate = cbMeasure || (() => {});
    measureLayer = L.layerGroup().addTo(map);
    drawnItems = new L.FeatureGroup().addTo(map);
  }

  /* ---------------- MEASUREMENT ---------------- */
  function startMeasure(mode) {
    clearMeasure();
    measureMode = mode;
    map.getContainer().style.cursor = 'crosshair';
    map.doubleClickZoom.disable();
    map.on('click', onMeasureClick);
    map.on('dblclick', onMeasureDblClick);
  }

  function onMeasureClick(e) {
    measurePoints.push([e.latlng.lng, e.latlng.lat]);
    drawMeasureFeedback();
    if (measureMode === 'bearing' && measurePoints.length === 2) {
      finishMeasure();
    }
  }

  function onMeasureDblClick(e) {
    L.DomEvent.stop(e); // prevent map zoom on the finishing double-click
    if (measurePoints.length) measurePoints.pop(); // drop the duplicate point the preceding click added
    drawMeasureFeedback();
    finishMeasure();
  }

  function drawMeasureFeedback() {
    measureLayer.clearLayers();
    measurePoints.forEach(p => L.circleMarker([p[1], p[0]], { radius: 4, color: '#F59E0B', fillOpacity: 1 }).addTo(measureLayer));
    if (measurePoints.length < 2) return;

    if (measureMode === 'distance' || measureMode === 'bearing') {
      const line = L.polyline(measurePoints.map(p => [p[1], p[0]]), { color: '#F59E0B', weight: 3, dashArray: measureMode === 'bearing' ? '6,6' : null }).addTo(measureLayer);
      const dist = turf.length(turf.lineString(measurePoints), { units: 'kilometers' });
      let result = { type: 'distance', km: dist, m: dist * 1000 };
      if (measureMode === 'bearing') {
        const [a, b] = measurePoints;
        const bearing = turf.bearing(turf.point(a), turf.point(b));
        const azimuth = (bearing + 360) % 360;
        result = { type: 'bearing', bearing, azimuth, km: dist };
      }
      onMeasureUpdate(result);
    }

    if (measureMode === 'area' || measureMode === 'perimeter') {
      if (measurePoints.length >= 3) {
        const ring = [...measurePoints, measurePoints[0]];
        const poly = turf.polygon([ring]);
        L.polygon(measurePoints.map(p => [p[1], p[0]]), { color: '#F59E0B', weight: 2, fillOpacity: 0.15 }).addTo(measureLayer);
        const areaM2 = turf.area(poly);
        const perimKm = turf.length(turf.lineString(ring), { units: 'kilometers' });
        onMeasureUpdate({ type: measureMode, areaHa: areaM2 / 10000, areaM2, perimeterKm: perimKm });
      } else {
        L.polyline(measurePoints.map(p => [p[1], p[0]]), { color: '#F59E0B', weight: 2 }).addTo(measureLayer);
      }
    }
  }

  function finishMeasure() {
    map.off('click', onMeasureClick);
    map.off('dblclick', onMeasureDblClick);
    map.doubleClickZoom.enable();
    map.getContainer().style.cursor = '';
  }
  function dblFinish() { finishMeasure(); }

  function clearMeasure() {
    measurePoints = [];
    measureLayer?.clearLayers();
    map.off('click', onMeasureClick);
    map.off('dblclick', onMeasureDblClick);
    map.doubleClickZoom.enable();
    map.getContainer().style.cursor = '';
    measureMode = null;
  }

  /* ---------------- DIGITIZING (Leaflet.draw) ---------------- */
  function enableDrawMode(shape, onCreated) {
    disableDrawMode();
    const options = {
      shapeOptions: { color: '#2DD4BF', weight: 3, fillOpacity: 0.25 },
    };
    let handler;
    if (shape === 'marker') handler = new L.Draw.Marker(map);
    else if (shape === 'polyline') handler = new L.Draw.Polyline(map, options);
    else if (shape === 'polygon') handler = new L.Draw.Polygon(map, options);
    if (!handler) return;
    drawMode = shape;
    handler.enable();
    map.once(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      const gj = layer.toGeoJSON();
      onCreated && onCreated(gj);
      drawMode = null;
    });
  }

  function disableDrawMode() {
    drawMode = null;
  }

  function enableEditMode(targetLayer) {
    if (!targetLayer) return;
    // targetLayer is an L.GeoJSON instance, which already extends L.FeatureGroup —
    // pass it directly rather than wrapping it in a second FeatureGroup.
    const editHandler = new L.EditToolbar.Edit(map, { featureGroup: targetLayer });
    editHandler.enable();
    return editHandler;
  }

  /* ---------------- ANALYSIS (Turf.js) ---------------- */
  function buffer(geojson, distance, units) {
    return turf.buffer(geojson, distance, { units });
  }
  function intersect(gjA, gjB) {
    const fa = gjA.features || [gjA];
    const fb = gjB.features || [gjB];
    const out = [];
    fa.forEach(a => fb.forEach(b => {
      try { const r = turf.intersect(a, b); if (r) out.push(r); } catch (e) {}
    }));
    return { type: 'FeatureCollection', features: out };
  }
  function union(gjA, gjB) {
    const all = [...(gjA.features || [gjA]), ...(gjB.features || [gjB])];
    if (!all.length) return { type: 'FeatureCollection', features: [] };
    let acc = all[0];
    for (let i = 1; i < all.length; i++) {
      try { acc = turf.union(acc, all[i]) || acc; } catch (e) {}
    }
    return { type: 'FeatureCollection', features: [acc] };
  }
  function clip(target, clipWith) {
    // clip target features by the union boundary of clipWith
    const clipFeatures = clipWith.features || [clipWith];
    let clipUnion = clipFeatures[0];
    for (let i = 1; i < clipFeatures.length; i++) {
      try { clipUnion = turf.union(clipUnion, clipFeatures[i]) || clipUnion; } catch (e) {}
    }
    const targetFeatures = target.features || [target];
    const out = [];
    targetFeatures.forEach(t => {
      try {
        const r = turf.intersect(t, clipUnion);
        if (r) out.push(r);
      } catch (e) {}
    });
    return { type: 'FeatureCollection', features: out };
  }
  function dissolve(geojson, propName) {
    try {
      const fc = turf.featureCollection((geojson.features || [geojson]).map(f => ({
        ...f, properties: f.properties || {},
      })));
      const result = propName ? turf.dissolve(fc, { propertyName: propName }) : turf.dissolve(fc);
      return result;
    } catch (e) {
      // fallback: sequential union
      const feats = geojson.features || [geojson];
      let acc = feats[0];
      for (let i = 1; i < feats.length; i++) {
        try { acc = turf.union(acc, feats[i]) || acc; } catch (e2) {}
      }
      return { type: 'FeatureCollection', features: acc ? [acc] : [] };
    }
  }
  function calcArea(geojson) {
    const feats = geojson.features || [geojson];
    return feats.reduce((sum, f) => {
      try { return sum + turf.area(f); } catch (e) { return sum; }
    }, 0);
  }
  function calcLength(geojson, units = 'kilometers') {
    const feats = geojson.features || [geojson];
    return feats.reduce((sum, f) => {
      try { return sum + turf.length(f, { units }); } catch (e) { return sum; }
    }, 0);
  }
  function nearest(fromPoint, targetsFC) {
    const targets = turf.featureCollection((targetsFC.features || [targetsFC]).filter(f => f.geometry));
    try {
      const nearestPt = turf.nearestPoint(fromPoint, targets);
      return nearestPt;
    } catch (e) {
      // fallback for non-point: find feature with nearest centroid
      let best = null, bestDist = Infinity;
      (targetsFC.features || []).forEach(f => {
        const c = turf.centroid(f);
        const d = turf.distance(fromPoint, c);
        if (d < bestDist) { bestDist = d; best = f; }
      });
      return best;
    }
  }
  function spatialQuery(geojson, field, op, value) {
    const feats = geojson.features || [geojson];
    return feats.filter(f => {
      const v = f.properties?.[field];
      if (v === undefined) return false;
      if (op === '=') return String(v) === String(value);
      if (op === '>') return parseFloat(v) > parseFloat(value);
      if (op === '<') return parseFloat(v) < parseFloat(value);
      if (op === 'contains') return String(v).toLowerCase().includes(String(value).toLowerCase());
      return false;
    });
  }

  return {
    init, startMeasure, finishMeasure, dblFinish, clearMeasure,
    enableDrawMode, disableDrawMode, enableEditMode, get drawnItems() { return drawnItems; },
    buffer, intersect, union, clip, dissolve, calcArea, calcLength, nearest, spatialQuery,
  };
})();
