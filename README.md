# BorneoGIS GeoPDF Explorer

Alternatif gratis Avenza Maps untuk survei lapangan. Tanpa login, tanpa registrasi, offline-ready, installable sebagai PWA di Android dan desktop.

## Fitur

- Upload GeoPDF, GeoJSON, KML, GPX
- GPS realtime + follow mode + wake lock
- Track recording → export GPX / GeoJSON
- Ukur jarak & luas
- Cari koordinat (Lat/Lng)
- Project manager (tersimpan lokal, IndexedDB)
- Basemap: OpenStreetMap / Esri Satellite / OpenTopoMap
- Layer manager: toggle, opacity, reorder, hapus
- PWA: install di Android & desktop, update otomatis
- Offline mode via Service Worker

## Deploy ke Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd borneogis
vercel --prod
```

## Deploy ke GitHub Pages

1. Buat repository GitHub baru
2. Upload semua file ke repo
3. Settings → Pages → Deploy from branch: main, folder: / (root)

> Catatan: GitHub Pages memerlukan HTTPS untuk GPS dan PWA agar berfungsi.

## Struktur File

```
/index.html
/manifest.json
/service-worker.js
/vercel.json
/css/style.css
/js/app.js
/js/geopdf.js
/js/layers.js
/js/gps.js
/js/tracking.js
/js/measure.js
/js/storage.js
/js/projectManager.js
/js/pwa.js
/icons/icon-192.png
/icons/icon-512.png
```

## Teknologi

- HTML5 + CSS3 + Vanilla JavaScript (ES Modules)
- Leaflet.js 1.9.4
- PDF.js 3.11.174
- IndexedDB (via storage.js)
- Service Worker (offline + update)
- Web Geolocation API
- Screen Wake Lock API

## Cara Pakai GeoPDF

### GeoPDF dari QGIS (Layout → Export as PDF → Geospatial PDF)
Georeferensi terbaca otomatis.

### GeoPDF lainnya
Jika georeferensi tidak terbaca, aplikasi akan meminta batas koordinat (Min/Max Lat/Lng) secara manual.

---

Dibuat oleh **Lamri, S.P.** — GIS Analyst & WebGIS Developer, Kalimantan Timur
