# Product Requirements Document (PRD)
## Aplikasi Trip Angkutan

**Versi:** 1.0  
**Tanggal:** 2026-10-13  
**Status:** DRAFT

---

## 1. Overview & Vision

**Apa produk ini?**

Aplikasi Trip Angkutan adalah sistem manajemen perjalanan (trip) untuk petugas lapangan yang mengoperasikan kendaraan ferry/angkut di wilayah perbatasan (Badau, Belitung, Entikong). Sistem ini memungkinkan petugas mencatat muatan, memverifikasi kendaraan, dan mengelola pembayaran tarif — bahkan saat **offline** di daerah terpencil tanpa sinyal.

**Siapa pengguna inti?**
- **Petugas lapangan**: Menggunakan aplikasi mobile untuk mencatat trip, scan plat, ambil foto, dan submit data tarif.
- **Admin**: Mengelola master data (tarif, plat kendaraan, petugas, rute, geofence) melalui dashboard web.

**Mengapa produk ini penting?**
- Petugas lapangan bekerja di area dengan koneksi internet tidak stabil
- Setiap trip harus tercatat untuk transparansi dan audit
- Tarif dinamis berdasarkan golongan kendaraan dan kondisi (muatan/kosong)
- Validasi geofence memastikan kendaraan berada di rute yang benar

---

## 2. User Stories

### 2.1 Petugas Lapangan (Mobile)

| ID | Sebagai | Saya ingin | Agar |
|----|---------|-----------|------|
| US-01 | Petugas | Login dengan PIN 6-digit | Bisa mengakses aplikasi secara aman |
| US-02 | Petugas | Memilih kondisi trip (kosong/muatan) | Sistem menampilkan input yang sesuai |
| US-03 | Petugas | Scan nomor plat kendaraan dengan OCR | Input cepat tanpa ketik manual |
| US-04 | Petugas | Ambil foto bukti kendaraan | Dokumentasi visual untuk audit |
| US-05 | Petugas | Memilih rute perjalanan | Validasi geofence berjalan |
| US-06 | Petugas | Submit trip tanpa internet | Data tersimpan lokal, sync kemudian |
| US-07 | Petugas | Lihat riwayat trip saya | Bisa melacak aktivitas harian |
| US-08 | Petugas | Dapat notifikasi update aplikasi | Selalu menggunakan versi terbaru |

### 2.2 Admin (Dashboard)

| ID | Sebagai | Saya ingin | Agar |
|----|---------|-----------|------|
| US-10 | Admin | Kelola master tarif per golongan | Tarif selalu akurat |
| US-11 | Admin | Daftarkan kendaraan baru dengan plat | Kendaraan ter-record |
| US-12 | Admin | Kelola data petugas (CRUD) | Tim terorganisir |
| US-13 | Admin | Atur titik geofence per rute | Monitoring lokasi akurat |
| US-14 | Admin | Buat/edit rute perjalanan | Konfigurasi rute flexibel |
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
│   (React+Ionic)     │   (React+Codeigniter)   │   (Icons/Splash)   │
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
1. Mobile menarik seluruh data master dari server
2. Sinkronisasi geofence config terbaru
3. Upload antrian trip yang belum sync

**Kondisi: Offline (rutinitas petugas)**
1. Login divalidasi secara lokal (PIN hash tersimpan)
2. Trip baru disimpan ke storage lokal
3. Validasi geofence berjalan offline
4. Foto disimpan ke Capacitor Filesystem

**Kondisi: Kembali Online**
1. Sinkronisasi data dua arah otomatis
2. Handle conflict resolution (server wins untuk master data)

### 3.3 OTA Update System

**Problem:** Mobile native (Android APK) menyimpan cache agresif, menyebabkan update sekunder gagal.

**Solusi (PURGE-FIRST FULL-PACKAGE):**
1. Cek versi dengan anti-cache: `?t=Date.now()` + `Cache-Control: no-cache`
2. Jika versi baru terdeteksi → auto-purge total:
   - Hapus seluruh Cache Storage
   - Hapus direktori OTA di Filesystem
   - Bersihkan localStorage metadata lama
3. Download full package baru
4. Verifikasi integritas SHA-256
5. Atomic reload WebView

---

## 4. Feature Specifications

### 4.1 Mobile App Features

#### 4.1.1 Authentication
- **Login**: PIN 6-digit
- **Region Lock**: Device terkunci ke region pertama login
- **Session**: JWT 24-hour, refresh on resume

#### 4.1.2 Trip Recording
| Field | Tipe | Validasi | Required |
|-------|------|----------|----------|
| Kondisi | Enum (kosong/muatan) | - | Ya |
| Golongan | Enum (I-V) | Auto dari plat | Ya |
| Rute | Dropdown | Valid geofence | Ya |
| Plat Kendaraan | Text/OCR | Terdaftar di master | Ya |
| Foto Bukti | Image | Kamera capture | Ya |
| Timestamp | DateTime | Auto | Ya |

**Alur Trip Kosong:**
1. Pilih kondisi "Kosong"
2. Pilih rute
3. Input/plat scan
4. Ambil foto
5. Submit → selesai

**Alur Trip Muatan:**
1. Pilih kondisi "Muatan"
2. Pilih rute
3. Input/plat scan
4. Ambil foto
5. Opsional: tambah kendaraan lagi (loop)
6. Swafoto wajib
7. End Trip

#### 4.1.3 OCR License Plate
- Library: Tesseract.js
- Fallback: Manual input
- Format: huruf-angka (pelat Indonesia)

#### 4.1.4 Geofencing
- Per-route: asal → tujuan dengan radius
- Default radius: 100 meter
- Validation: GPS location vs geofence points
- Offline validation supported

#### 4.1.5 History
- List view dengan filter tanggal
- Detail trip dengan foto
- Sync status indicator

### 4.2 Admin Dashboard Features

#### 4.2.1 Overview Tab
- Trip terbaru (real-time)
- Status koneksi petugas
- Quick stats

#### 4.2.2 Master Tarif
- CRUD golongan (I-V)
- Tarif per region
- Override per kondisi (muatan/kosong)

#### 4.2.3 Master Plat
- Registrasi kendaraan baru
- Status: aktif/nonaktif
- Histori pemilik

#### 4.2.4 Master Petugas
- CRUD petugas
- Multi-region assignment
- Reset PIN

#### 4.2.5 Master Rute
- CRUD rute (asal → tujuan)
- Jarak (km)
- Titik geofence dengan koordinat
- Auto-extract dari Google Maps link

#### 4.2.6 Geofence Management
- CRUD titik geofence
- Latitude/Longitude (auto from Maps)
- Radius (1-10000 meter, default 100)
- Rute association

#### 4.2.7 Reports
- Filter: tanggal, golongan, region, petugas
- Kolom: Tanggal, Plat, Golongan, Rute, Kondisi, Tarif, Lokasi (Maps link)
- Export: Excel (SheetJS)

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

---

## 6. UI/UX Specifications

### 6.1 Mobile Screens

| Screen | Purpose | Key Components |
|--------|---------|----------------|
| LoginScreen | PIN entry | Number pad, region badge |
| HomeScreen | Main hub | Quick stats, recent trips |
| TripConditionScreen | Select condition | Toggle: kosong/muatan |
| RouteSelectScreen | Choose route | List with distance |
| VehicleFormScreen | Input/plat scan | Camera, OCR, plate input |
| CameraScreen | Photo capture | Camera viewfinder |
| TripSummaryScreen | Review before submit | Summary card |
| HistoryScreen | Past trips | List with status |
| HistoryDetailScreen | Trip detail | Full info + photos |
| SettingsScreen | App settings | Profile, sync, update |
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
| Geofence | Geofence point CRUD |
| Reports | Report builder + Excel export |

### 6.3 Design System

**Mobile (Ionic-style):**
- Primary: Blue (#007AFF)
- Secondary: Gray (#8E8E93)
- Success: Green (#34C759)
- Danger: Red (#FF3B30)
- Background: White/Light Gray
- Text: Black (#000)

**Admin Dashboard (Tailwind):**
- Primary: Indigo (#4F46E5)
- Secondary: Slate (#64748B)
- Success: Emerald (#10B981)
- Danger: Red (#EF4444)
- Background: Slate-50 (#F8FAFC)
- Cards: White with shadow

---

## 7. Non-Functional Requirements

### 7.1 Performance
- Mobile cold start: < 3 seconds
- Offline operation: Full functionality
- Sync on resume: < 5 seconds when online
- OCR response: < 2 seconds

### 7.2 Security
- JWT token: 24-hour expiry
- PIN: Hashed with salt (bcrypt)
- HTTPS: Mandatory for all API calls
- Role-based: Admin vs Officer
- Region lock: Device → first login region

### 7.3 Reliability
- Offline-first: No data loss
- Conflict resolution: Server wins (master data)
- OTA rollback: Safe fallback on corrupt download
- Auto-sync: On network restore

### 7.4 Compatibility
- Android: 6.0+ (API 23)
- iOS: 13.0+
- Browser: Chrome 90+, Firefox 88+, Safari 14+

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

## 9. Testing Strategy

### 9.1 Unit Tests (Vitest)
- Sync service
- Auth service
- OTA update service
- Local database service
- Geofence validation

### 9.2 Integration Tests
- API endpoint tests
- Offline/online sync flow

### 9.3 E2E Tests (Future)
- Full trip flow
- Admin CRUD operations

### 9.4 Manual Testing
- APK release: sequential OTA updates
- Offline scenario: Airplane mode testing
- GPS simulation: Fake location

---

## 10. Open Issues & Backlog

### High Priority
- [ ] Push `endpoint` to GitHub for Railway auto-deploy
- [ ] Set `ADMIN_PASSWORD` env var in Railway
- [ ] Publish OTA update from `mobile-trip` branch
- [ ] Deploy backend latest to production

### Medium Priority
- [ ] E2E test suite implementation
- [ ] Push notification for sync completion
- [ ] Trip edit capability (admin)

### Low Priority
- [ ] iOS build setup
- [ ] Dark mode support
- [ ] Multi-language (Bahasa Indonesia only now)

---

## 11. Glossary

| Term | Definition |
|------|------------|
| Trip | Satu perjalanan kendaraan dari dermaga asal ke tujuan |
| Golongan | Kategori kendaraan (I-V) berdasarkan ukuran |
| Dermaga | Port/terminal keberangkatan |
| Geofence | Area virtual berbasis GPS untuk validasi lokasi |
| OTA | Over-The-Air: update aplikasi via internet |
| Officer | Petugas lapangan yang mengoperasikan aplikasi |
| PIN | 6-digit passcode untuk login |
| Region | Wilayah operasional (Badau, Belitung, Entikong) |

---

## 12. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-13 | Claude | Initial PRD |

---

*Document ini adalah living document dan akan diperbarui sesuai perkembangan proyek.*
