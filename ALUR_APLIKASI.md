# Alur Aplikasi Trip Angkutan — Dokumentasi Lengkap

Dokumen ini mendeskripsikan alur kerja aplikasi mobile (petugas lapangan) dan web admin (administrasi) berdasarkan implementasi aktual di codebase.

---

## 1. Alur Aplikasi Mobile (Petugas Lapangan)

### 1.1 Inisiasi Awal & Login
| Step | Screen | Deskripsi |
|------|--------|-----------|
| 1 | Splash/Entry | Cek session lokal (`trip.session.v1`) |
| 2 | LoginPage | Input PIN 6-digit + `officerId`; device ID auto-generate & simpan lokal |
| 3 | **Region Lock** | Perangkat **terkunci permanen** ke region petugas setelah login pertama (mis. BADAU). Tidak bisa ganti region tanpa reset data. |
| 4 | HomeScreen | Dashboard: info petugas, region, koneksi, trip hari ini, menu navigasi |

### 1.2 Memulai Trip Baru
```
HomeScreen → "Mulai Trip" → TripConditionScreen
```

### 1.3 Pemilihan Kondisi (TripConditionScreen)
| Pilihan | Kode Internal | Perilaku |
|---------|---------------|----------|
| **Kosong / Tidak Ada Muatan** | `kosong` | Rute dikunci `SJRE → SBDZ` (`EMPTY_ROUTE_CODE`). Hapus vehicles/foto draft. Set `routeCode = SJRE-SBDZ`. |
| **Ada Angkutan** | `muatan` | Rute bebas (semua 4 rute tersedia). Reset condition saja. |

> **Implementasi**: `TripConditionScreen.tsx:11` export `EMPTY_ROUTE_CODE = 'SJRE-SBDZ'`

### 1.4 Alur "Angkutan Kosong" (Kondisi: Kosong)
```
TripConditionScreen (pilih "Kosong")
    ↓ patchDraft: condition=kosong, routeCode=SJRE-SBDZ, vehicles=[]
RouteSelectScreen
    ├─ Tampil hanya 1 rute: SJRE → SBDZ (Lock icon, label "Terkunci (Trip Kosong)")
    ├─ Tombol: "Lanjut (Rute Terkunci)"
    ↓
TripSummaryScreen (cameraFrom='trip-summary', cameraMode='photo')
    ├─ Ringkasan: ID Trip, Rute, Kondisi=Kosong, Petugas, Tanggal/Jam
    ├─ Kendaraan: "Trip tanpa kendaraan (kosong)"
    ├─ **WAJIB foto kamera** (bukti fisik angkutan kosong)
    │   └─ Tombol "Ambil Foto" → CameraScreen (cameraMode='photo')
    │       └─ HANYA kamera native/getUserMedia — TIDAK ada gallery picker
    ├─ Setelah photoTaken=true: Tombol "Submit Trip — Mulai Sekarang"
    ↓ startTrip()
TripActiveScreen
    ├─ Timer real-time (elapsed time)
    ├─ GPS tracking (jika implemented)
    ├─ Tombol "Selesai Trip"
    ↓
TripCompleteScreen
    ├─ "Trip Selesai!" + ringkasan
    ├─ Trigger `processSyncQueue()` background
    ├─ Tombol "Lihat Detail" / "Kembali ke Home"
    ↓
Data tersimpan lokal (localStorage) + masuk sync queue
```

### 1.5 Alur "Ada Muatan" (Kondisi: Ada Angkutan)
```
TripConditionScreen (pilih "Ada Muatan")
    ↓ patchDraft: condition=muatan
RouteSelectScreen
    ├─ Tampil 4 rute: SJRE-SBDZ, SBDZ-SJRE, SJRE-BDAU, BDAU-SJRE
    ├─ Pilih rute → patchDraft(routeCode)
    ├─ Tombol: "Lanjut Input Kendaraan"
    ↓
VehicleFormScreen
    ├─ **Step 1: Identitas Kendaraan**
    │   ├─ No. Polisi: input manual (uppercase) + OCR scan
    │   │   ├─ Tombol "Scan Foto Plat (OCR)" → CameraScreen (cameraMode='ocr')
    │   │   │   └─ Hasil OCR → auto-fill plat → auto-run checkPlate()
    │   │   ├─ Tombol "Cek Status Plat" → API checkPlate(plate, originRegionId)
    │   │   │   └─ Response: status (internal/lokal/eksternal), found, originRegionCode, checkpointRegionCode
    │   │   │       └─ Jika !found & bukan internal → dropdown "Region asal" (dari fetchRegions)
    │   │   └─ Pesan error/plateMsg jika server offline
    │   ├─ Jenis Kendaraan: grid 3 kolom dari Master Tarif (tariffs.map(t=>t.type))
    │   │   └─ Emoji: 🏍️ Motor, 🚗 Mobil, 🚛 Truck
    │   └─ Validasi: vehicleInputDone = !!plate && !!vehicleType
    │
    ├─ **Step 2: Detail Informasi Tambahan** (muncul setelah vehicleInputDone)
    │   ├─ Kategori Kendaraan (3 pilihan button):
    │   │   ├─ Internal (badge: Internal, slate-800)
    │   │   ├─ Eksternal (Berganji) (badge: Ekst. Berganji, amber-500)
    │   │   └─ Eksternal (Tanpa Garansi) (badge: Ekst. Tanpa Garansi, rose-500)
    │   ├─ Foto Bukti — **WAJIB via kamera** (selfie + seluruh kendaraan)
    │   │   └─ Tombol → CameraScreen (cameraMode='photo', cameraFrom='vehicle-form')
    │   │       ├─ Preview foto di viewfinder
    │   │       └─ Setelah capture → patchDraft(photo=true, photoUrl=dataUrl) → kembali
    │   └─ Tombol "Simpan Data Kendaraan" (disabled tanpa foto + plat + jenis + kategori)
    │       └─ Modal konfirmasi: "Tambah Kendaraan?"
    │           ├─ "Tidak, Lanjutkan" → pushVehicle(resetPhoto=false) → go('trip-summary')
    │           └─ "Ya, Tambah" → pushVehicle(resetPhoto=true) → setShowModal(false) → form reset untuk input berikutnya
    │
    └─ **Loop Validasi Perulangan** (di modal konfirmasi):
        Sistem tanya: "Input kendaraan tambahan untuk trip yang sama?"
        ├─ **YA** → form dibersihkan (plate/type/category/foto reset) → input kendaraan berikutnya
        └─ **TIDAK** → form ditutup → TripSummaryScreen

TripSummaryScreen
    ├─ Ringkasan lengkap: ID Trip, Rute, Kondisi=Ada Muatan, Petugas, Tanggal/Jam
    ├─ Daftar kendaraan (plat, jenis, kategori, status plat, thumbnail foto)
    ├─ **WAJIB foto kamera** (bukti trip keseluruhan)
    │   └─ Sama seperti alur kosong
    ├─ Tombol "Submit Trip — Mulai Sekarang" (disabled tanpa foto)
    ↓ startTrip()
TripActiveScreen → TripCompleteScreen → Selesai + Sync
```

### 1.6 Keamanan & Manajemen Petugas
| Fitur | Screen | Deskripsi |
|-------|--------|-----------|
| **Ganti Petugas** | OfficerSwitchScreen | Daftar petugas region yang sama; pilih → PinVerifyScreen |
| **Verifikasi PIN** | PinVerifyScreen | Input PIN 6-digit petugas target; sukses → setOfficerId + refreshBackendSession |
| **Region Lock** | LoginPage + store.ts | Device ID terkunci ke region petugas login pertama; tidak bisa ganti region |
| **Auto Sync Officer** | store.ts:356-360 | Saat app start: `refreshOfficers(true)` → fetch officers dari server → merge lokal |

---

## 2. Alur Pelaporan Web (Administrasi / Backend)

### 2.1 Dashboard Overview (`AdminDashboard.tsx` tab 'overview')
- Trip terbaru 10 dari server (`/trips`)
- Status koneksi server (Online/Offline/Connecting)
- Tombol Refresh manual

### 2.2 Master Tarif (`AdminDashboard.tsx` tab 'tariff')
| Sub-modul | Fitur |
|-----------|-------|
| **Golongan (I–V)** | CRUD: Golongan, Jenis, Tarif Muatan, Tarif Kosong, Deskripsi |
| **Tarif Region** | Per region: Tarif Lokal (nominal + aktif), Tarif Eksternal (nominal + aktif) |
| **Sync** | Local-first: simpan lokal → push ke server best-effort; gagal → status offline |

> **Data Structure**: `tariffData` (data.ts:19-25) + `RegionTariffRow` (tariffs.ts)

### 2.3 Master Plat (`AdminDashboard.tsx` tab 'plates')
| Fitur | Deskripsi |
|-------|-----------|
| **Registrasi Plat** | No. Plat, Pemilik (opsional), Region Asal, Status (internal/lokal/eksternal) |
| **Status Plat** | `internal` = Rp 0 (dikunci), `lokal` = tarif cadangan, `eksternal` = tarif region |
| **Konfigurasi Tarif Terpusat** | Tabel per region: Internal (Rp 0 dikunci), Lokal (editable + toggle aktif), Eksternal (editable + toggle aktif) |
| **Sync** | Create/Update/Delete → server; localStorage sebagai fallback |

### 2.4 Master Petugas (`AdminDashboard.tsx` tab 'officers')
| Fitur | Deskripsi |
|-------|-----------|
| **CRUD Petugas** | Nama, Region (multi-select checkbox), PIN 6-digit, Device |
| **Status** | Aktif / Nonaktif (mobile menolak login Nonaktif) |
| **Multi-Region** | Satu petugas bisa akses multiple region (via junction table) |
| **Server = Source of Truth** | `mergeBackendOfficers()` (line 28-47): server data wins; lokal data (device, trips, PIN) dipertahankan |
| **Sync PIN** | PIN dikirim ke server hanya jika diisi ulang 6 digit |

### 2.5 Laporan (`AdminDashboard.tsx` tab 'reports')
| Fitur | Deskripsi |
|-------|-----------|
| **Filter** | Tanggal trip, Golongan (I–V), Jenis Kendaraan (dari master tarif) |
| **Rekapitulasi per Tanggal** | Total trip, kosong vs muatan, total kendaraan, total pendapatan |
| **Detail per Trip** | No Trip, Tanggal, Jam, Tempat/Wilayah, Rute Asal/Tujuan, Petugas, Status Muatan, Kategori, Jumlah Unit, Sub-total |
| **Detail Kendaraan** | Per trip: No Polisi, Jenis, Golongan, Kategori, Beban, Tarif |
| **Export Excel (.xlsx)** | 2 Sheet: "Laporan Trip" + "Detail Kendaraan" (via `downloadXlsx` dari xlsx.ts) |

---

## 3. Sinkronisasi & Offline-First

### 3.1 Mekanisme Sync (`sync.ts`)
```
Trip dibuat (commitTrip)
    ↓
addToSyncQueue(trip) → queue di localStorage
    ↓
processSyncQueue() dipicu oleh:
  ├─ App foreground + online
  ├─ Window focus event
  ├─ Manual "Sync" button
  └─ TripCompleteScreen mount
    ↓
POST /trips (batch) dengan JWT auth
    ↓
Success → markTripSynced(id) → synced=true
Failure → retry (max 3x, delay 5s) → status=failed
```

### 3.2 Status Sinkronisasi Trip
| Status | Arti |
|--------|------|
| `pending` | Di queue, belum diupload |
| `syncing` | Sedang diupload |
| `synced` | Berhasil ke server |
| `failed` | Gagal setelah max retry |

### 3.3 Refresh Backend Session (`auth.ts:89-98`)
```typescript
export async function refreshBackendSession(officerId?: string): Promise<boolean> {
  const id = officerId ?? activeOfficerId ?? getStoredOfficer()?.id
  if (!id) return false
  activeOfficerId = String(id)
  api.setToken(null)
  const result = await loginWithPin(String(id), DEMO_PIN)
  return result.success
}
```
- Dipanggil saat: `refreshOfficers(force=true)` (store.ts:338-340)
- Tujuan: Terbitkan ulang JWT dengan klaim region terbaru (jika admin pindah petugas wilayah)

---

## 4. Data Master & Referensi

### 4.1 Region & Rute (`data.ts:3-8`)
| Kode | Asal → Tujuan | Jarak | Durasi |
|------|---------------|-------|--------|
| `SJRE-SBDZ` | Sijangkung → Sabadi | 42 km | 1j 10m |
| `SBDZ-SJRE` | Sabadi → Sijangkung | 42 km | 1j 10m |
| `SJRE-BDAU` | Sijangkung → Badau | 18 km | 35m |
| `BDAU-SJRE` | Badau → Sijangkung | 18 km | 35m |

**Trip Kosong**: Hanya `SJRE-SBDZ` (konstanta `EMPTY_ROUTE_CODE`)

### 4.2 Master Tarif (`data.ts:19-25`)
| Gol | Jenis | Muatan | Kosong | Deskripsi |
|-----|-------|--------|--------|-----------|
| I | Motor | 15.000 | 8.000 | Sepeda motor roda dua |
| II | Mobil | 45.000 | 20.000 | Mobil penumpang / pickup kecil |
| III | Truck Kecil | 120.000 | 55.000 | Truck ringan s/d 3 ton |
| IV | Truck Sedang | 280.000 | 130.000 | Truck sedang 3–8 ton |
| V | Truck Besar | 450.000 | 200.000 | Truck besar / trailer > 8 ton |

### 4.3 Kategori Kendaraan Mobile (`VehicleFormScreen.tsx:119-137`)
| Kategori | Badge | Warna | Keterangan |
|----------|-------|-------|------------|
| Internal | Internal | Slate 800 | Kendaraan internal plantation |
| Eksternal (Berganji) | Ekst. Berganji | Amber 500 | Dengan tarif/garansi |
| Eksternal (Tanpa Garansi) | Ekst. Tanpa Garansi | Rose 500 | Tanpa tarif/garansi |

### 4.4 Status Plat Nomor (`plates.ts` + `data.ts`)
| Status | Warna | Arti Tarif |
|--------|-------|------------|
| `internal` | Slate 800/White | Rp 0 (dikunci) |
| `lokal` | Blue 100/700 | Tarif lokal region |
| `eksternal` | Amber 100/700 | Tarif eksternal region pos |

---

## 5. API Contracts (Ringkasan)

### Auth
```
POST /auth/login              {officerId, pin} → {token, officer}
POST /auth/member-login       {username, password} → {token, officer}
POST /auth/admin-login        {username, password} → {token, role:admin}
GET  /auth/verify             → {valid, officer}
GET  /auth/officers/:region   → Officer[]
```

### Trips
```
GET    /trips                 → Trip[] (dengan vehicles)
POST   /trips                 → create trip
GET    /trips/:id             → Trip detail
POST   /trips/:tripId/vehicles → add vehicle
```

### Master Data
```
GET    /tariffs               → TariffRow[]
POST   /tariffs               → create tarif
PUT    /tariffs/:id           → update tarif
DELETE /tariffs/:id           → delete tarif

GET    /region-tariffs        → RegionTariffRow[]
POST   /region-tariffs        → upsert tarif region

GET    /plates                → PlateRecord[]
POST   /plates                → create plate
PUT    /plates/:id            → update plate
DELETE /plates/:id            → delete plate

GET    /officers              → BackendOfficerRow[]
POST   /officers              → create officer (name, pin, regionId, regionIds[])
PUT    /officers/:id/regions  → update regions
PUT    /officers/:id/pin      → update PIN
PUT    /officers/:id/status   → update isActive
DELETE /officers/:id          → delete officer

GET    /regions               → Region[]

GET    /reports/trips         → ReportTrip[] (filter: dateFrom, dateTo, golongan, vehicleType)
GET    /reports/trips/filters → {golongan[], vehicleTypes[]}
```

---

## 6. File Kunci per Fitur

| Fitur | File Utama |
|-------|------------|
| Login & Region Lock | `LoginPage.tsx`, `store.tsx` (setOfficerId, officerId state) |
| Trip Condition | `TripConditionScreen.tsx` (EMPTY_ROUTE_CODE) |
| Route Select | `RouteSelectScreen.tsx` (filter routes by condition) |
| Vehicle Form | `VehicleFormScreen.tsx` (Step 1+2, kategori, loop modal) |
| Camera (OCR + Photo) | `CameraScreen.tsx` (Capacitor Camera + getUserMedia fallback) |
| Trip Summary | `TripSummaryScreen.tsx` (wajib foto, submit trip) |
| Trip Active/Complete | `TripActiveScreen.tsx`, `TripCompleteScreen.tsx` |
| Sync Queue | `sync.ts` (addToSyncQueue, processSyncQueue) |
| Auth & Token | `auth.ts` (loginWithPin, refreshBackendSession, ensureBackendSession) |
| Master Tarif | `tariffs.ts` + `AdminDashboard.tsx` (tab 'tariff') |
| Master Plat | `plates.ts` + `AdminDashboard.tsx` (tab 'plates') |
| Master Petugas | `officers.ts` + `AdminDashboard.tsx` (tab 'officers') |
| Laporan & Export | `trips.ts` (fetchTripReports) + `xlsx.ts` + `AdminDashboard.tsx` (tab 'reports') |
| Data Statis | `data.ts` (ROUTES, tariffData, officerList, allTrips) |
| Types | `types.ts` (MobileScreen, AdminTab) |
| State | `store.tsx` (AppProvider, useApp, Draft, Trip, VehicleEntry) |

---

## 7. Catatan Implementasi Penting

1. **Camera Only Policy**: `CameraScreen.tsx` — **TIDAK ADA** `<input type="file">` / gallery picker. Semua foto (bukti trip, selfie muatan, OCR plat) **wajib via kamera** (native Capacitor Camera plugin atau getUserMedia web fallback).

2. **Offline-First**: Semua operasi CRUD (trip, tarif, plat, petugas) update localStorage dulu, lalu sync ke server best-effort. UI tidak blocking.

3. **Region Lock**: Device ID di-generate saat login pertama → terkunci ke region petugas. Ganti region = clear storage + login ulang.

4. **Multi-Vehicle per Trip**: `Trip.vehicles: VehicleEntry[]` — loop di VehicleFormScreen modal konfirmasi.

5. **Server = Source of Truth untuk Petugas**: `mergeBackendOfficers()` merge server data (nama, wilayah, status) dengan lokal (device, PIN, trips). Admin panel selalu fetch dari server saat mount.

6. **PIN 6-Digit**: Unik per petugas. Digunakan untuk login mobile + ganti petugas. Admin set via Master Petugas.

7. **Export Excel**: SheetJS (`xlsx` package) generate 2 sheet: "Laporan Trip" + "Detail Kendaraan".

---

*Dokumen ini disinkronkan dengan implementasi aktual di codebase `/home/nazky/RPL/Intern/Aplikasi-Trip-Ionic` per September 2026.*