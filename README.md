# BorneoGIS Explorer

**Aplikasi GIS Lapangan Profesional — Offline-First PWA**

> Menggabungkan keunggulan Avenza Maps + ArcGIS Field Maps + QGIS Viewer dalam satu aplikasi web.

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new)

---

## Fitur Utama

| Fitur | Status |
|-------|--------|
| GPS Survey Mode (lat/lng/alt/accuracy/speed/heading) | ✅ |
| Track Recorder (GPX/GeoJSON/KML export) | ✅ |
| Waypoint Manager | ✅ |
| Photo Mapping (geotagged dari kamera) | ✅ |
| GeoPDF Engine (LGI dictionary) | ✅ |
| Layer Manager (drag-drop reorder, opacity, visibility) | ✅ |
| GIS Analysis (Buffer/Union/Intersect/Dissolve/Difference/Clip) | ✅ |
| Digitizing (Point/Line/Polygon/Rectangle) | ✅ |
| Import: GeoJSON, KML, GPX, CSV, ZIP Shapefile, GeoPDF | ✅ |
| Export: GeoJSON, KML, CSV, PNG Map | ✅ |
| Project Manager (CRUD + Backup .bgis) | ✅ |
| Offline-first (IndexedDB + Service Worker) | ✅ |
| PWA (install Android/Desktop) | ✅ |
| Dark/Light Mode | ✅ |
| Basemap: OSM / Esri Satellite / OpenTopoMap / CartoDB / Terrain | ✅ |

---

## Deploy ke Vercel

```bash
# Clone atau download repository ini
git clone <repo-url>
cd borneogis

# Deploy langsung ke Vercel
npx vercel --prod
```

Atau drag-drop folder ke [vercel.com/new](https://vercel.com/new).

---

## Struktur File

```
/
├── index.html              # Entri utama
├── manifest.json           # PWA manifest
├── service-worker.js       # Offline caching + update
├── vercel.json             # Routing config
├── css/
│   └── style.css           # Semua style (dark/light theme)
├── js/
│   ├── storage.js          # IndexedDB abstraction
│   ├── projectManager.js   # CRUD project
│   ├── layerManager.js     # Layer tree professional
│   ├── geopdf.js           # GeoPDF engine (LGI dictionary)
│   ├── gps.js              # GPS Survey Mode
│   ├── tracking.js         # Track Recorder
│   ├── photoMapping.js     # Photo Mapping + kamera
│   ├── analysis.js         # GIS Analysis (Turf.js)
│   ├── export.js           # Export multi-format
│   ├── pwa.js              # Install + update PWA
│   ├── map.js              # Leaflet core + basemap + digitizing
│   └── app.js              # Main controller + Waypoint Manager
└── icons/
    ├── icon-72.png
    ├── icon-96.png
    ├── icon-128.png
    ├── icon-144.png
    ├── icon-152.png
    ├── icon-192.png
    ├── icon-384.png
    └── icon-512.png
```

---

## Teknologi

- **Leaflet.js 1.9.4** — Peta interaktif
- **Turf.js 6** — GIS Analysis
- **PDF.js 4.0.379** — GeoPDF rendering
- **Leaflet.Draw 1.0.4** — Digitizing
- **IndexedDB** — Storage lokal
- **Service Worker** — Offline + PWA
- **Vanilla JS ES6** — Tanpa framework

---

## Penggunaan Offline

Setelah pertama kali dibuka online, semua aset di-cache oleh Service Worker.
Aplikasi bisa berjalan penuh tanpa internet kecuali:
- Tile basemap baru (tile yang sudah pernah dilihat ter-cache otomatis)
- Nominatim geocoder

---

## Lisensi

MIT — Bebas digunakan, dimodifikasi, dan didistribusikan.

Dibuat oleh **Lamri, S.P.** | GIS Analyst & WebGIS Developer | Kutai Timur, Kalimantan Timur
