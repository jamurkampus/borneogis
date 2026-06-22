// photoMapping.js - Geotagged Photo Capture and Map Display
'use strict';

const PhotoMapping = (() => {
  let photos = [];
  let photoMarkers = {};
  let stream = null;
  let currentFacingMode = 'environment'; // rear camera default
  const VIDEO_CONSTRAINTS = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };

  // ------------------------------------------------
  // CAMERA
  // ------------------------------------------------
  async function openCamera() {
    const modal = document.getElementById('photo-modal');
    if (!modal) {
      App.showToast('Photo modal tidak ditemukan', 'error');
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false });
      const video = document.getElementById('photo-video');
      if (video) {
        video.srcObject = stream;
        video.play();
      }
      modal.style.display = 'flex';
    } catch (err) {
      console.error('Camera error:', err);
      // Fallback: file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.onchange = e => handleFilePhoto(e.target.files[0]);
      input.click();
    }
  }

  function closeCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    const modal = document.getElementById('photo-modal');
    if (modal) modal.style.display = 'none';
  }

  async function switchCamera() {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: currentFacingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      const video = document.getElementById('photo-video');
      if (video) { video.srcObject = stream; video.play(); }
    } catch (err) {
      App.showToast('Gagal ganti kamera', 'error');
    }
  }

  async function capturePhoto() {
    const video = document.getElementById('photo-video');
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    // If rear camera, no mirror flip
    if (currentFacingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const position = GPS.getLastPosition();
    const heading = GPS.getLastHeading();

    const photo = {
      id: `photo_${Date.now()}`,
      dataUrl,
      timestamp: new Date().toISOString(),
      lat: position ? position.lat : null,
      lng: position ? position.lng : null,
      altitude: position ? position.altitude : null,
      accuracy: position ? position.accuracy : null,
      heading: heading,
      projectId: ProjectManager.getCurrent()?.id || 'default',
      note: ''
    };

    await Storage.put(Storage.STORES.PHOTOS || 'photos', photo);
    photos.push(photo);

    if (photo.lat && photo.lng) {
      addPhotoMarker(photo);
      App.showToast('Foto disimpan dengan koordinat GPS', 'success');
    } else {
      App.showToast('Foto disimpan (GPS tidak aktif, tanpa koordinat)', 'warning');
    }

    closeCamera();
    renderPhotoList();
  }

  async function handleFilePhoto(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
      const dataUrl = e.target.result;
      // Try EXIF GPS extraction
      const exifCoords = extractExifGPS(file);
      const position = GPS.getLastPosition();

      const photo = {
        id: `photo_${Date.now()}`,
        dataUrl,
        timestamp: new Date().toISOString(),
        lat: exifCoords?.lat || (position ? position.lat : null),
        lng: exifCoords?.lng || (position ? position.lng : null),
        altitude: exifCoords?.altitude || (position ? position.altitude : null),
        accuracy: position ? position.accuracy : null,
        heading: GPS.getLastHeading(),
        projectId: ProjectManager.getCurrent()?.id || 'default',
        note: ''
      };

      await Storage.put(Storage.STORES.PHOTOS || 'photos', photo);
      photos.push(photo);
      if (photo.lat && photo.lng) addPhotoMarker(photo);
      renderPhotoList();
      App.showToast('Foto dari file berhasil dimuat', 'success');
    };
    reader.readAsDataURL(file);
  }

  // ------------------------------------------------
  // EXIF GPS (manual read, no external lib)
  // ------------------------------------------------
  function extractExifGPS(file) {
    // Basic EXIF extraction - returns null if not found
    // Full EXIF requires async ArrayBuffer read; skip here for brevity
    // Production: use exifr library
    return null;
  }

  // ------------------------------------------------
  // MAP MARKERS
  // ------------------------------------------------
  function addPhotoMarker(photo) {
    if (!photo.lat || !photo.lng || !window.MapManager) return;

    const icon = L.divIcon({
      className: 'photo-marker-icon',
      html: `<div class="photo-pin">
        <div class="photo-thumb" style="background-image:url(${photo.dataUrl})"></div>
        <div class="photo-pin-tail"></div>
      </div>`,
      iconSize: [52, 60],
      iconAnchor: [26, 60],
      popupAnchor: [0, -64]
    });

    const marker = L.marker([photo.lat, photo.lng], { icon });

    const heading = photo.heading ? `${Math.round(photo.heading)}°` : 'N/A';
    const alt = photo.altitude ? `${photo.altitude.toFixed(1)} m` : 'N/A';
    const ts = new Date(photo.timestamp).toLocaleString('id-ID');

    marker.bindPopup(`
      <div class="photo-popup">
        <img src="${photo.dataUrl}" style="width:100%;max-width:240px;border-radius:6px;margin-bottom:8px;display:block">
        <div class="photo-popup-meta">
          <div><b>Waktu:</b> ${ts}</div>
          <div><b>Lat:</b> ${photo.lat.toFixed(8)}</div>
          <div><b>Lng:</b> ${photo.lng.toFixed(8)}</div>
          <div><b>Altitude:</b> ${alt}</div>
          <div><b>Arah Kamera:</b> ${heading}</div>
          ${photo.accuracy ? `<div><b>Akurasi:</b> ${photo.accuracy.toFixed(1)} m</div>` : ''}
        </div>
        ${photo.note ? `<div style="margin-top:8px;font-size:12px;color:#aaa">${photo.note}</div>` : ''}
        <button onclick="PhotoMapping.deletePhoto('${photo.id}')" 
          style="margin-top:8px;padding:4px 10px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">
          Hapus Foto
        </button>
      </div>
    `, { maxWidth: 280 });

    marker.addTo(MapManager.map);
    photoMarkers[photo.id] = marker;

    // Add to layer manager
    LayerManager.addLayer({
      id: `photo_${photo.id}`,
      name: `Foto ${new Date(photo.timestamp).toLocaleTimeString('id-ID')}`,
      type: 'photo',
      visible: true,
      leafletLayer: marker,
      metadata: { timestamp: photo.timestamp, lat: photo.lat, lng: photo.lng }
    });
  }

  function removePhotoMarker(photoId) {
    if (photoMarkers[photoId]) {
      MapManager.map.removeLayer(photoMarkers[photoId]);
      delete photoMarkers[photoId];
    }
  }

  // ------------------------------------------------
  // CRUD
  // ------------------------------------------------
  async function loadPhotos() {
    const project = ProjectManager.getCurrent();
    if (!project) return;
    try {
      photos = await Storage.getByIndex(Storage.STORES.PHOTOS || 'photos', 'projectId', project.id);
      photos.forEach(p => { if (p.lat && p.lng) addPhotoMarker(p); });
      renderPhotoList();
    } catch (err) {
      console.warn('Load photos error:', err);
      photos = [];
    }
  }

  async function deletePhoto(photoId) {
    await Storage.remove(Storage.STORES.PHOTOS || 'photos', photoId);
    photos = photos.filter(p => p.id !== photoId);
    removePhotoMarker(photoId);
    LayerManager.removeLayer(`photo_${photoId}`);
    renderPhotoList();
    App.showToast('Foto dihapus', 'info');
    // Close popup
    MapManager.map.closePopup();
  }

  // ------------------------------------------------
  // UI LIST
  // ------------------------------------------------
  function renderPhotoList() {
    const container = document.getElementById('photo-list');
    if (!container) return;

    if (!photos.length) {
      container.innerHTML = '<div class="empty-state">Belum ada foto. Klik kamera untuk memulai.</div>';
      return;
    }

    container.innerHTML = photos.map(p => {
      const ts = new Date(p.timestamp).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const hasCoords = p.lat && p.lng;
      return `
      <div class="photo-list-item" onclick="PhotoMapping.zoomToPhoto('${p.id}')">
        <div class="photo-thumb-small" style="background-image:url(${p.dataUrl})"></div>
        <div class="photo-list-info">
          <div class="photo-list-time">${ts}</div>
          <div class="photo-list-coords">
            ${hasCoords
              ? `<span class="coords-badge">📍 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>`
              : '<span class="no-coords-badge">⚠ Tanpa Koordinat</span>'}
          </div>
        </div>
        <button class="btn-icon-sm danger" onclick="event.stopPropagation(); PhotoMapping.deletePhoto('${p.id}')" title="Hapus">🗑</button>
      </div>`;
    }).join('');
  }

  function zoomToPhoto(photoId) {
    const photo = photos.find(p => p.id === photoId);
    if (!photo || !photo.lat) {
      App.showToast('Foto ini tidak memiliki koordinat', 'warning');
      return;
    }
    MapManager.map.flyTo([photo.lat, photo.lng], 18, { duration: 1 });
    if (photoMarkers[photoId]) photoMarkers[photoId].openPopup();
  }

  // ------------------------------------------------
  // EXPORT ALL PHOTOS AS GEOJSON
  // ------------------------------------------------
  function exportAsGeoJSON() {
    const georeferenced = photos.filter(p => p.lat && p.lng);
    if (!georeferenced.length) {
      App.showToast('Tidak ada foto dengan koordinat GPS', 'warning');
      return;
    }

    const fc = {
      type: 'FeatureCollection',
      features: georeferenced.map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat, p.altitude || 0] },
        properties: {
          id: p.id,
          timestamp: p.timestamp,
          heading: p.heading,
          accuracy: p.accuracy,
          note: p.note
          // dataUrl excluded from GeoJSON (too large)
        }
      }))
    };

    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `borneogis_photos_${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    App.showToast(`${georeferenced.length} titik foto diekspor`, 'success');
  }

  // ------------------------------------------------
  // PUBLIC API
  // ------------------------------------------------
  return {
    openCamera,
    closeCamera,
    switchCamera,
    capturePhoto,
    handleFilePhoto,
    deletePhoto,
    zoomToPhoto,
    exportAsGeoJSON,
    loadPhotos,
    getPhotos: () => photos,
    getCount: () => photos.length
  };
})();

window.PhotoMapping = PhotoMapping;
