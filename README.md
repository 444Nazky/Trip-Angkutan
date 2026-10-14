# Product Requirements Document (PRD)
## Aplikasi Trip Angkutan

**Versi:** 1.1  
**Tanggal:** 2026-10-13  
**Status:** DRAFT / IN-REVIEW

---

## 1. Overview & Vision

**Apa produk ini?**

Aplikasi Trip Angkutan adalah sistem manajemen perjalanan (trip) untuk petugas lapangan yang mengoperasikan kendaraan ferry/angkut di wilayah perbatasan (Badau, Belitung, Entikong). Sistem ini memungkinkan petugas mencatat muatan, memverifikasi kendaraan, dan mengelola pembayaran tarif — bahkan saat **offline** di daerah terpencil tanpa sinyal.

**Siapa pengguna inti?**
- **Petugas lapangan**: Menggunakan aplikasi mobile untuk mencatat trip, scan plat, ambil foto, dan submit data tarif.
- **Admin**: Mengelola master data (tarif, plat kendaraan, petugas, rute, geofence) melalui dashboard web.

**Mengapa produk ini penting?**
- Petugas lapangan bekerja di area dengan koneksi internet tidak stabil.
- Setiap trip harus tercatat untuk transparansi dan audit.
- Tarif dinamis berdasarkan golongan kendaraan dan kondisi (muatan/kosong).
- Validasi geofence memastikan kendaraan berada di rute yang benar.

---

## 2. User Stories

### 2.1 Petugas Lapangan (Mobile)

| ID | Sebagai | Saya ingin | Agar |
|----|---------|-----------|------|
| US-01 | Petugas | Login dengan PIN 6-digit | Bisa mengakses aplikasi secara aman |
| US-02 | Petugas | Memilih kondisi trip (kosong/muatan) | Sistem menampilkan input yang sesuai |
| US-03 | Petugas | Scan nomor plat kendaraan dengan OCR / Auto-Format | Input cepat tanpa ketik manual |
| US-04 | Petugas | Ambil foto bukti kendaraan | Dokumentasi visual untuk audit |
| US-05 | Petugas | Memilih rute perjalanan | Validasi geofence berjalan |
| US-06 | Petugas | Submit trip tanpa internet | Data tersimpan lokal, sync kemudian |
| US-07 | Petugas | Lihat riwayat trip saya | Bisa melacak aktivitas harian |
| US-08 | Petugas | Dapat notifikasi & pembaruan otomatis (OTA) | Selalu menggunakan versi aplikasi paling stabil & mutakhir |

### 2.2 Admin (Dashboard)

| ID | Sebagai | Saya ingin | Agar |
|----|---------|-----------|------|
| US-10 | Admin | Kelola master tarif per golongan | Tarif selalu akurat |
| US-11 | Admin | Daftarkan kendaraan baru dengan plat | Kendaraan ter-record |
| US-12 | Admin | Kelola data petugas (CRUD) | Tim terorganisir |
| US-13 | Admin | Atur titik geofence per rute | Monitoring lokasi akurat |
| US-14 | Admin | Buat/edit rute perjalanan | Konfigurasi rute fleksibel |
| US-15 | Admin | Lihat laporan trip dengan filter | Analisis data lebih mudah |
| US-16 | Admin | Export laporan ke Excel | Bisa olah data offline |

---

## 3. Technical Architecture

### 3.1 Sistem Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND LAYER                           │
├──────────────────────┬──────────────────────┬────────────────────┤
│   MOBILE APP        │   ADMIN DASHBOARD    │   STATIC ASSETS    │
│   (React+Ionic)     │   (React+CodeIgniter) │   (Icons/Splash)   │
│   Capacitor 8        │   SheetJS Export     │                    │
│   Offline-First     │   Multi-tab UI       │                    │
└──────────┬──────────┴──────────┬───────────┴────────────────────┘
           │                    │
           ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API LAYER                               │
│   Express.js + SQLite (sql.js) │ JWT Auth (HS256, 24h)        │
│   Railway Deployment │ Firebase Functions (fallback)             │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA LAYER                                 │
│   SQLite Database │ Offline Storage (IndexedDB/SQLite/Capacitor)│
│   OTA Update Storage │ File Uploads                            │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Offline-First Strategy

**Kondisi: Online (saat start/periodik)**
1. Mobile menarik seluruh data master dari server.
2. Sinkronisasi geofence config terbaru.
3. Upload antrian trip yang belum sync.

**Kondisi: Offline (rutinitas petugas)**
1. Login divalidasi secara lokal (PIN hash tersimpan).
2. Trip baru disimpan ke storage lokal.
3. Validasi geofence berjalan offline.
4. Foto disimpan ke Capacitor Filesystem.

**Kondisi: Kembali Online**
1. Sinkronisasi data dua arah otomatis.
2. Handle conflict resolution (server wins untuk master data).

### 3.3 Over-The-Air (OTA) Update System (Purge-First Full-Package Architecture)

**Problem:**  
Webview Mobile Native (Android APK/iOS) mengagresi Cache Storage & Filesystem secara ketat. Akibatnya, pembaruan pertama (V1.0.0 → V1.0.1) berhasil, namun pembaruan sekunder berikutnya (V1.0.1 → V1.0.2) **SELALU GAGAL** terdeteksi atau terpanggil kecuali pengguna melakukan 'Clear Data' manual di Settings Android. Partial/chunk update juga sering memicu file integrity mismatch.

**Spesifikasi Eksekusi Teknis Solusi (PURGE-FIRST FULL-PACKAGE):**

1. **Mekanisme Cek Versi (Anti-Cache Manifest Fetch):**
   - Pengambilan remote manifest (`version.json`) wajib menyertakan parameter anti-cache: `?t=${Date.now()}` dan HTTP header `Cache-Control: no-cache, no-store, must-revalidate`.
   - Pada DEV MODE (`import.meta.env.DEV`), sediakan fallback mock version check agar tidak memicu error CORS/network failure.

2. **Pembersihan Total Sebelum Unduh (Auto-Purge):**
   - Jika `remote.version > local.version`, sistem **DILARANG** mengunduh bundle baru secara langsung.
   - Eksekusi fungsi `resetOtaStorage()` terlebih dahulu:
     - Hapus SELURUH Cache Storage (`caches.keys()` → `caches.delete()`).
     - Hapus total direktori `OTA_DIR` di Capacitor Filesystem.
     - Bersihkan key `localStorage` metadata versi/chunk lama.

3. **Full Build Download & Atomic Reload:**
   - Setelah storage lama bersih total, unduh seluruh bundle/assets baru secara utuh.
   - Validasi integritas berkas terhadap hash SHA-256 / manifest integrity. Jika ada 1 berkas corrupt, lakukan rollback otomatis ke bundled default assets.
   - Perbarui versi aktif di storage, lalu lakukan atomic reload WebView (`window.location.reload(true)` / navigasi bersih) untuk memuat versi baru.

4. **Service Worker & Manual Fallback:**
   - Pastikan Service Worker tidak me-serve cache basi saat fetching manifest/bundle OTA baru.
   - Sediakan tombol manual *Reset & Paksa Pembaruan* di UI `UpdateNotifier` / Pengaturan sebagai fallback jika terjadi network timeout di lapangan.

---

## 4. Feature Specifications

### 4.1 Mobile App Features

#### 4.1.1 Authentication
- **Login**: PIN 6-digit.
- **Region Lock**: Device terkunci ke region pertama login.
- **Session**: JWT 24-hour, refresh on resume.

#### 4.1.2 Trip Recording
| Field | Tipe | Validasi | Required |
|-------|------|----------|----------|
| Kondisi | Enum (kosong/muatan) | - | Ya |
| Golongan | Enum (I-V) | Auto dari plat | Ya |
| Rute | Dropdown | Valid geofence | Ya |
| Plat Kendaraan | Text/OCR | Format otomatis (e.g. KT 719 CEB) & terdaftar di master | Ya |
| Foto Bukti | Image | Kamera capture | Ya |
| Timestamp | DateTime | Auto | Ya |

**Alur Trip Kosong:**
1. Pilih kondisi "Kosong".
2. Pilih rute.
3. Input / plat scan (Auto-Formatter: Kode Wilayah + Angka + Seri Belakang).
4. Ambil foto.
5. Submit → selesai.

**Alur Trip Muatan:**
1. Pilih kondisi "Muatan".
2. Pilih rute.
3. Input / plat scan.
4. Ambil foto.
5. Opsional: tambah kendaraan lagi (loop).
6. Swafoto wajib.
7. End Trip.

#### 4.1.3 OCR & Input Plat Kendaraan
- **Library**: Tesseract.js.
- **Smart Formatting (Indonesian Standard)**:
  - Format: `[1-2 Huruf Kode] [1-4 Angka] [1-3 Huruf Seri]` (e.g., `B 1010 ABC`, `KT 719 CEB`).
  - Auto-space cerdas saat mengetik angka pertama dari huruf depan, serta huruf kembali dari angka tengah.
  - Auto-uppercase secara real-time.
- **Fallback**: Manual input.

#### 4.1.4 Geofencing & Out-of-Geofence Alert
- **Radius Rute**: Asal → Tujuan dengan radius default 100 meter.
- **Validation**: GPS Realtime vs Geofence Points.
- **Out-of-Geofence Alert**:
  - Jika posisi petugas berada di luar seluruh titik geofence resmi, sistem menampilkan **Card Peringatan Merah** ("Di Luar Area Geofence Resmi") dan mengunci (disable) tombol *Lanjut Input Kendaraan*.
  - Sediakan tombol *Periksa Ulang Lokasi* di dalam card alert untuk pindaian ulang GPS secara manual.
  - Sediakan Dev Override toggle khusus lingkungan `DEV MODE` (`import.meta.env.DEV`).

#### 4.1.5 History
- List view dengan filter tanggal.
- Detail trip dengan foto.
- Sync status indicator.

### 4.2 Admin Dashboard Features

#### 4.2.1 Overview Tab
- Trip terbaru (real-time).
- Status koneksi petugas.
- Quick stats.

#### 4.2.2 Master Tarif
- CRUD golongan (I-V).
- Tarif per region.
- Override per kondisi (muatan/kosong).

#### 4.2.3 Master Plat
- Registrasi kendaraan baru.
- Status: aktif/nonaktif.
- Histori pemilik.

#### 4.2.4 Master Petugas
- CRUD petugas.
- Multi-region assignment.
- Reset PIN.

#### 4.2.5 Master Rute
- CRUD rute (asal → tujuan).
- Jarak (km).
- Titik geofence dengan koordinat.
- Auto-extract dari Google Maps link.

#### 4.2.6 Geofence Management & Map Preview
- CRUD titik geofence.
- Latitude/Longitude (auto from Maps link).
- Radius (1-10000 meter, default 100).
- Rute association.
- **Leaflet.js Integration**: Modal preview geofence dirender interaktif menggunakan Leaflet (`MapContainer` & `L.circle`) untuk menghindari galat `X-Frame-Options` (`refused to connect`) pada embed standard OpenStreetMap.

#### 4.2.7 Reports
- Filter: tanggal, golongan, region, petugas.
- Kolom: Tanggal, Plat, Golongan, Rute, Kondisi, Tarif, Lokasi (Maps link).
- Export: Excel (SheetJS).

### 4.3 Backend API Endpoints

| Endpoint | Method | Deskripsi | Auth |
|----------|--------|-----------|------|
| `/api/auth/login` | POST | Login petugas | Public |
| `/api/auth/verify-pin` | POST | Verify PIN | Officer |
| `/api/trips` | GET | List trips | Officer |
| `/api/trips` | POST | Create trip | Officer |
| `/api/trips/:id` | PUT | Update trip | Officer |
| `/api/plates` | GET | List plates | Officer |
| `/api/plates` | POST | Create plate | Admin |
| `/api/plates/:id` | PUT | Update plate | Admin |
| `/api/plates/:id` | DELETE | Delete plate | Admin |
| `/api/tariffs` | GET | List tariffs | Officer |
| `/api/tariffs` | POST | Create tariff | Admin |
| `/api/tariffs/:id` | PUT | Update tariff | Admin |
| `/api/officers` | GET | List officers | Admin |
| `/api/officers` | POST | Create officer | Admin |
| `/api/officers/my-region` | GET | My region officers | Officer |
| `/api/officers/:id` | PUT | Update officer | Admin |
| `/api/regions` | GET | List regions | Public |
| `/api/routes` | GET | List routes | Officer |
| `/api/routes` | POST | Create route | Admin |
| `/api/geofences` | GET | List geofences | Officer |
| `/api/geofences` | POST | Create geofence | Admin |
| `/api/geofences/resolve-link` | POST | Parse Maps URL | Admin |
| `/api/reports/trips` | GET | Trip report | Admin |
| `/api/config` | GET | App config | Officer |

---

## 5. Data Models

### 5.1 Database Schema (SQLite)

```sql
-- Officers
CREATE TABLE officers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  region TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Regions
CREATE TABLE regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL
);

-- Routes
CREATE TABLE routes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  distance_km REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Geofences
CREATE TABLE geofences (
  id TEXT PRIMARY KEY,
  route_id TEXT REFERENCES routes(id),
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius_meters INTEGER DEFAULT 100,
  direction TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Vehicles (Plates)
CREATE TABLE plates (
  id TEXT PRIMARY KEY,
  plate_number TEXT UNIQUE NOT NULL,
  golongan TEXT NOT NULL,
  owner_name TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tariffs
CREATE TABLE tariffs (
  id TEXT PRIMARY KEY,
  golongan TEXT NOT NULL,
  region_id TEXT REFERENCES regions(id),
  price_load REAL NOT NULL,
  price_empty REAL NOT NULL,
  effective_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Trips
CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  officer_id TEXT REFERENCES officers(id),
  plate_id TEXT REFERENCES plates(id),
  route_id TEXT REFERENCES routes(id),
  condition TEXT NOT NULL,
  tariff_id TEXT REFERENCES tariffs(id),
  amount REAL,
  photo_url TEXT,
  selfie_url TEXT,
  latitude REAL,
  longitude REAL,
  trip_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  sync_status TEXT DEFAULT 'pending'
);
```

### 5.2 Local Storage Schema (Mobile)

| Key | Type | Description |
|-----|------|-------------|
| `trip.session.v1` | Object | Current user session |
| `trip.roster.v1` | Array | Officers list |
| `trip.plates.v1` | Array | Vehicle plates |
| `trip.tariffs.v1` | Array | Tariff config |
| `trip.routes.v1` | Array | Routes |
| `trip.geofence.config.v1` | Object | Geofence points |
| `trip.pending.sync` | Array | Unsynced trips |
| `trip.history.v1` | Array | Trip history cache |
| `trip.ota.metadata.v1` | Object | OTA version & hash verification metadata |

---

## 6. UI/UX Specifications

### 6.1 Mobile Screens

| Screen | Purpose | Key Components |
|--------|---------|----------------|
| LoginScreen | PIN entry | Number pad, region badge |
| HomeScreen | Main hub | Quick stats, recent trips |
| TripConditionScreen | Select condition | Toggle: kosong/muatan |
| RouteSelectScreen | Choose route | Out-of-geofence alert card, distance info |
| VehicleFormScreen | Input/plat scan | Camera, OCR, smart plate formatter |
| CameraScreen | Photo capture | Camera viewfinder |
| TripSummaryScreen | Review before submit | Summary card |
| HistoryScreen | Past trips | List with status |
| HistoryDetailScreen | Trip detail | Full info + photos |
| SettingsScreen | App settings | Profile, sync, OTA reset & check update |
| ProfileScreen | Officer profile | Info + logout |
| DermagaSelectScreen | Choose dermaga | Region list |

### 6.2 Admin Dashboard Tabs

| Tab | Purpose |
|-----|---------|
| Overview | Real-time stats, recent trips |
| Tarif | Master tariff CRUD |
| Plat | Vehicle plate management |
| Petugas | Officer management |
| Rute | Route + geofence config |
| Geofence | Geofence point CRUD + Leaflet.js interactive preview |
| Reports | Report builder + Excel export |

---

## 7. Non-Functional Requirements

### 7.1 Performance
- Mobile cold start: < 3 seconds.
- Offline operation: Full functionality.
- Sync on resume: < 5 seconds when online.
- OCR response: < 2 seconds.

### 7.2 Security
- JWT token: 24-hour expiry.
- PIN: Hashed with salt (bcrypt).
- HTTPS: Mandatory for all API calls.
- Role-based: Admin vs Officer.
- Region lock: Device → first login region.

### 7.3 Reliability
- Offline-first: No data loss.
- Conflict resolution: Server wins (master data).
- OTA rollback: Safe fallback on corrupt download.
- Auto-sync: On network restore.

### 7.4 Compatibility
- Android: 6.0+ (API 23).
- iOS: 13.0+.
- Browser: Chrome 90+, Firefox 88+, Safari 14+.

---

## 8. Deployment Architecture

| Component | Platform | Branch |
|-----------|----------|--------|
| Mobile APK | Google Play / Direct APK | `mobile-trip` |
| OTA Updates | Raw GitHub CDN | `mobile-trip` |
| Admin Dashboard | Netlify | `Trip-Dashboard` |
| Backend API | Railway | `endpoint-trip` |
| Fallback Functions | Firebase | `endpoint-trip` |

---

## 9. Testing Strategy & Verification Targets

### 9.1 OTA Update Verification (Sequential Releases)
- Simulasi rilis beruntun di APK Mobile Release: `V1.0.0` → `V1.0.1` (Update Pertama) → `V1.0.2` (Update Sekunder tanpa clear data manual).
- Verifikasi bahwa `V1.0.2` langsung terdeteksi, melakukan auto-purge storage/cache, mengunduh utuh, dan aktif sempurna tanpa sisa chunk `V1.0.1`.

### 9.2 Unit & Integration Tests (Vitest)
- Sync service.
- Auth service.
- OTA update service (`ota.ts`).
- Local database service.
- Geofence & location validation.

### 9.3 Manual Testing
- APK release: sequential OTA updates.
- Offline scenario: Airplane mode testing.
- GPS simulation: Out-of-geofence trigger test.

---

## 10. Open Issues & Backlog

### High Priority
- [ ] Implementasi Purge-First OTA System pada `ota.ts` & Service Worker.
- [ ] Refactoring Leaflet.js pada modal preview Geofence Admin Dashboard.
- [ ] Push `endpoint` to GitHub untuk Railway auto-deploy.
- [ ] Set `ADMIN_PASSWORD` env var di Railway.

### Medium Priority
- [ ] E2E test suite implementation.
- [ ] Push notification untuk sync completion.
- [ ] Trip edit capability (admin).

### Low Priority
- [ ] iOS build setup.
- [ ] Dark mode support.
- [ ] Multi-language (Bahasa Indonesia default).

---

## 11. Glossary

| Term | Definition |
|------|------------|
| Trip | Satu perjalanan kendaraan dari dermaga asal ke tujuan |
| Golongan | Kategori kendaraan (I-V) berdasarkan ukuran |
| Dermaga | Port/terminal keberangkatan |
| Geofence | Area virtual berbasis GPS untuk validasi lokasi |
| OTA | Over-The-Air: update aplikasi via internet |
| Custom Self-Hosted API Update | Sistem update custom dengan Purge-First Full-Package strategy |
| Purge-First | Strategi pembersihan total cache/storage sebelum mengunduh update baru |
| Officer | Petugas lapangan yang mengoperasikan aplikasi |
| PIN | 6-digit passcode untuk login |
| Region | Wilayah operasional (Badau, Belitung, Entikong) |

---

## 13. Update System (2026-10-14)

### Custom Self-Hosted API Update System

**Status:** PRODUKSI — Mengganti sistem OTA pihak ketiga yang sering mengalami kegagalan patch/update sekunder.

**Arsitektur:**
```
Mobile Client (Ionic/Capacitor) ←→ Backend API (Express.js)
    @capacitor/app (version)              /api/v1/app-version
    @capacitor/filesystem (download)      /api/v1/app-download/:version
    Native Intent (install)
```

**Alur Kerja:**
1. Client cek versi: `GET /api/v1/app-version?current=:version`
2. Server respons: JSON dengan latestVersion, updateAvailable, downloadUrl
3. Client download APK ke Directory.Data (durable storage)
4. Verifikasi SHA-256 hash
5. Native Intent untuk instalasi

**Konfigurasi Android:**
```xml
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

**Dokumentasi Lengkap:** `UPDATE-SYSTEM-ARCHITECTURE.md`

---

## 12. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-13 | Claude | Initial PRD |
| 1.1 | 2026-10-13 | Gemini | Integrasi Purge-First OTA Architecture, Auto-Format Plat Nomor, Leaflet.js Geofence Preview, & Out-of-Geofence Alert |
| 1.2 | 2026-10-14 | Claude | Custom Self-Hosted API Update System (Purge-First Full-Package) — menggantikan third-party OTA plugin |

---

*Document ini adalah living document dan akan diperbarui sesuai perkembangan proyek.*
