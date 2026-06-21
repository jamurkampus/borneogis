# BorneoGIS Explorer

GIS workspace berbasis browser. Tanpa login, tanpa server wajib, data tersimpan lokal di IndexedDB.

## Menjalankan secara lokal

Service worker dan beberapa fitur (geolocation di sebagian browser) butuh HTTP(S), bukan `file://`. Jalankan server statis sederhana di folder ini, contoh:

```bash
npx serve .
# atau
python3 -m http.server 8080
```

Lalu buka `http://localhost:8080`.

## Deploy

- **GitHub Pages**: push folder ini ke repo, aktifkan Pages dari branch `main` / folder root. Tidak perlu build step.
- **Vercel**: import repo, set *Framework Preset* ke "Other" — tidak ada build command, *Output Directory* = root.

## Struktur

```
index.html
manifest.json
service-worker.js
css/style.css
js/db.js               -> IndexedDB (layers, raster, settings)
js/map.js               -> Leaflet map, basemap switcher, GPS
js/layerManager.js      -> Upload parsing (GeoJSON/KML/GPX/CSV/SHP), layer tree, export
js/geospatialTools.js   -> Measurement, digitasi (Leaflet.draw), analisis Turf.js
js/pdfViewer.js         -> Render PDF/GeoPDF via PDF.js, georeferensi manual
js/app.js               -> Bootstrap, wiring UI, search, dashboard, AI assistant dummy
icons/                  -> PWA icons (SVG)
```

## Catatan jujur tentang batasan saat ini

Beberapa hal yang baik untuk diketahui sebelum dipakai produksi:

1. **Deteksi koordinat GeoPDF otomatis** memakai pendekatan heuristik (mencari pasangan angka desimal di teks PDF), bukan parser resmi OGC GeoPDF `/Measure` dictionary — PDF.js tidak mengekspos struktur itu secara native. Untuk GeoPDF BIG/Ina-Geoportal yang tidak mencetak koordinat sebagai teks biasa di sheet, gunakan tombol **"Georeferensi Manual (4 titik)"** (saat ini diimplementasikan sebagai 2-titik SW/NE — cukup untuk sheet yang tidak terotasi; rotasi diatur terpisah lewat slider).
2. **Shapefile (.zip)** memakai `shpjs`, yang menangani reprojection dasar dari file `.prj` umum, tapi proyeksi eksotis bisa gagal — fallback ke asumsi WGS84 jika `.prj` tidak terbaca.
3. **Export PDF peta** saat ini mengarahkan ke PNG + dialog print browser, karena pembuatan PDF vektor murni dari canvas Leaflet butuh library tambahan (mis. jsPDF) yang sengaja tidak disertakan agar bundle tetap ringan — gampang ditambahkan jika dibutuhkan.
4. **Offline tile caching** bersifat *cache-as-you-browse*: area yang sudah pernah dibuka tersimpan otomatis lewat service worker: belum ada UI "download wilayah ini untuk offline" dengan radius/zoom-range eksplisit.
5. **Pencarian alamat** memakai Nominatim (OpenStreetMap) via fetch langsung — butuh koneksi internet; pencarian koordinat & nama objek lokal (di layer yang sudah diupload) tetap berfungsi offline.

Semua bagian di atas berjalan dan bisa dipakai sekarang; poin-poin ini murni transparansi soal kedalaman implementasi masing-masing, supaya tidak ada kejutan saat dipakai untuk pekerjaan nyata.
