// layerManager.js - Professional Layer Tree for BorneoGIS
const LayerManager = (() => {
  const layers = new Map();
  let layerOrder = [];
  let activeLayerId = null;

  function generateId() {
    return `lyr_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
  }

  function addLayer(config) {
    const id = config.id || generateId();
    const layer = {
      id,
      name: config.name || 'Layer Baru',
      type: config.type || 'geojson', // geojson, geopdf, tile, track, waypoint
      leafletLayer: config.leafletLayer,
      visible: config.visible !== false,
      opacity: config.opacity !== undefined ? config.opacity : 1,
      color: config.color || '#00d4ff',
      group: config.group || null,
      metadata: config.metadata || {},
      createdAt: new Date().toISOString()
    };

    layers.set(id, layer);
    layerOrder.unshift(id); // Add to top

    if (layer.visible && layer.leafletLayer && MapManager.map) {
      layer.leafletLayer.addTo(MapManager.map);
    }

    renderLayerTree();
    return id;
  }

  function removeLayer(id) {
    const layer = layers.get(id);
    if (!layer) return;
    if (layer.leafletLayer && MapManager.map) {
      MapManager.map.removeLayer(layer.leafletLayer);
    }
    layers.delete(id);
    layerOrder = layerOrder.filter(i => i !== id);
    renderLayerTree();
  }

  function toggleVisibility(id) {
    const layer = layers.get(id);
    if (!layer) return;
    layer.visible = !layer.visible;
    if (layer.leafletLayer) {
      if (layer.visible) {
        layer.leafletLayer.addTo(MapManager.map);
      } else {
        MapManager.map.removeLayer(layer.leafletLayer);
      }
    }
    renderLayerTree();
  }

  function setOpacity(id, opacity) {
    const layer = layers.get(id);
    if (!layer) return;
    layer.opacity = opacity;
    if (layer.leafletLayer) {
      if (layer.leafletLayer.setOpacity) layer.leafletLayer.setOpacity(opacity);
      else if (layer.leafletLayer.setStyle) layer.leafletLayer.setStyle({ opacity, fillOpacity: opacity * 0.4 });
    }
  }

  function renameLayer(id, name) {
    const layer = layers.get(id);
    if (layer) { layer.name = name; renderLayerTree(); }
  }

  function duplicateLayer(id) {
    const layer = layers.get(id);
    if (!layer || !layer.leafletLayer) return;
    const newLayer = L.geoJSON(layer.leafletLayer.toGeoJSON ? layer.leafletLayer.toGeoJSON() : null);
    if (newLayer) {
      addLayer({ ...layer, id: null, name: `${layer.name} (Kopi)`, leafletLayer: newLayer });
    }
  }

  function moveUp(id) {
    const idx = layerOrder.indexOf(id);
    if (idx <= 0) return;
    [layerOrder[idx-1], layerOrder[idx]] = [layerOrder[idx], layerOrder[idx-1]];
    reorderMapLayers();
    renderLayerTree();
  }

  function moveDown(id) {
    const idx = layerOrder.indexOf(id);
    if (idx >= layerOrder.length - 1) return;
    [layerOrder[idx+1], layerOrder[idx]] = [layerOrder[idx], layerOrder[idx+1]];
    reorderMapLayers();
    renderLayerTree();
  }

  function reorderMapLayers() {
    layerOrder.slice().reverse().forEach((id, i) => {
      const layer = layers.get(id);
      if (layer && layer.leafletLayer && layer.leafletLayer.bringToFront) {
        layer.leafletLayer.bringToFront();
      }
    });
  }

  function zoomToLayer(id) {
    const layer = layers.get(id);
    if (!layer || !layer.leafletLayer) return;
    try {
      if (layer.leafletLayer.getBounds) {
        MapManager.map.fitBounds(layer.leafletLayer.getBounds(), { padding: [20, 20] });
      }
    } catch (e) {}
  }

  function getLayerInfo(id) {
    const layer = layers.get(id);
    if (!layer) return null;
    let featureCount = 0;
    try {
      if (layer.leafletLayer && layer.leafletLayer.getLayers) {
        featureCount = layer.leafletLayer.getLayers().length;
      }
    } catch (e) {}
    return { ...layer, featureCount };
  }

  function addTrackLayer(track) {
    const coords = track.points.map(p => [p.lat, p.lng]);
    const polyline = L.polyline(coords, { color: '#ff6b35', weight: 3, opacity: 0.9 });
    addLayer({ name: track.name, type: 'track', leafletLayer: polyline, color: '#ff6b35', metadata: { trackId: track.id, distance: track.distance } });
  }

  function addWaypointLayer(waypoint) {
    const icon = L.divIcon({
      className: '',
      html: `<div class="wp-marker" style="background:${waypoint.color || '#ff4757'}"><i class="icon-waypoint"></i></div>`,
      iconSize: [32, 32], iconAnchor: [16, 32]
    });
    const marker = L.marker([waypoint.lat, waypoint.lng], { icon })
      .bindPopup(`<b>${waypoint.name}</b><br>${waypoint.category || ''}<br>${waypoint.notes || ''}`);
    addLayer({ name: waypoint.name, type: 'waypoint', leafletLayer: marker, color: waypoint.color || '#ff4757', metadata: { waypointId: waypoint.id } });
  }

  function renderLayerTree() {
    const container = document.getElementById('layer-tree');
    if (!container) return;

    if (layerOrder.length === 0) {
      container.innerHTML = `<div class="layer-empty"><i class="icon-layers"></i><p>Belum ada layer</p></div>`;
      return;
    }

    container.innerHTML = layerOrder.map(id => {
      const l = layers.get(id);
      if (!l) return '';
      const typeIcon = l.type === 'geopdf' ? 'icon-pdf' : l.type === 'track' ? 'icon-route' : l.type === 'waypoint' ? 'icon-waypoint' : 'icon-layer';
      return `
      <div class="layer-item ${activeLayerId === id ? 'active' : ''}" data-id="${id}" draggable="true">
        <div class="layer-item-header">
          <button class="layer-vis-btn ${l.visible ? 'visible' : ''}" onclick="LayerManager.toggleVisibility('${id}')" title="${l.visible ? 'Sembunyikan' : 'Tampilkan'}">
            <svg viewBox="0 0 24 24" width="14" height="14">${l.visible ? '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>' : '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>'}
            </svg>
          </button>
          <div class="layer-color" style="background:${l.color}"></div>
          <span class="layer-name" ondblclick="LayerManager.startRename('${id}')">${l.name}</span>
          <div class="layer-actions">
            <button onclick="LayerManager.zoomToLayer('${id}')" title="Zoom ke Layer">⊕</button>
            <button onclick="LayerManager.moveUp('${id}')" title="Naikan">↑</button>
            <button onclick="LayerManager.moveDown('${id}')" title="Turunkan">↓</button>
            <button onclick="LayerManager.showLayerMenu('${id}', event)" title="Opsi">⋮</button>
          </div>
        </div>
        <div class="layer-opacity">
          <label>Opacity</label>
          <input type="range" min="0" max="1" step="0.05" value="${l.opacity}" 
            oninput="LayerManager.setOpacity('${id}', parseFloat(this.value))">
          <span>${Math.round(l.opacity * 100)}%</span>
        </div>
      </div>`;
    }).join('');

    // Setup drag and drop for reordering
    setupDragDrop(container);
  }

  function setupDragDrop(container) {
    let dragId = null;
    container.querySelectorAll('.layer-item').forEach(item => {
      item.addEventListener('dragstart', e => { dragId = item.dataset.id; item.classList.add('dragging'); });
      item.addEventListener('dragend', e => { item.classList.remove('dragging'); dragId = null; });
      item.addEventListener('dragover', e => { e.preventDefault(); item.classList.add('drag-over'); });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', e => {
        e.preventDefault();
        item.classList.remove('drag-over');
        if (!dragId || dragId === item.dataset.id) return;
        const fromIdx = layerOrder.indexOf(dragId);
        const toIdx = layerOrder.indexOf(item.dataset.id);
        layerOrder.splice(toIdx, 0, layerOrder.splice(fromIdx, 1)[0]);
        reorderMapLayers();
        renderLayerTree();
      });
    });
  }

  function showLayerMenu(id, event) {
    const menu = document.getElementById('context-menu');
    const layer = layers.get(id);
    if (!menu || !layer) return;
    menu.innerHTML = `
      <div class="ctx-item" onclick="LayerManager.renameLayer('${id}', prompt('Nama baru:', '${layer.name}') || '${layer.name}'); App.hideContextMenu()">Rename</div>
      <div class="ctx-item" onclick="LayerManager.duplicateLayer('${id}'); App.hideContextMenu()">Duplikat</div>
      <div class="ctx-item" onclick="LayerManager.zoomToLayer('${id}'); App.hideContextMenu()">Zoom ke Layer</div>
      <div class="ctx-item" onclick="ExportManager.exportLayer('${id}'); App.hideContextMenu()">Export Layer</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item danger" onclick="LayerManager.removeLayer('${id}'); App.hideContextMenu()">Hapus Layer</div>
    `;
    App.showContextMenu(menu, event);
  }

  function startRename(id) {
    const layer = layers.get(id);
    if (!layer) return;
    const name = prompt('Nama layer:', layer.name);
    if (name && name.trim()) renameLayer(id, name.trim());
  }

  function getAll() {
    return layerOrder.map(id => layers.get(id)).filter(Boolean);
  }

  function getById(id) { return layers.get(id); }

  return {
    addLayer, removeLayer, toggleVisibility, setOpacity, renameLayer,
    duplicateLayer, moveUp, moveDown, zoomToLayer, getLayerInfo,
    addTrackLayer, addWaypointLayer, renderLayerTree, showLayerMenu,
    startRename, getAll, getById
  };
})();

window.LayerManager = LayerManager;
