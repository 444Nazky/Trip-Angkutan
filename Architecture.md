# Architecture.md

> **Dokumen arsitektur tunggal.** Sebelumnya isi ini terpecah di `Architecture.md` +
> `System-Design.md` — dua berkas dengan komponen, tabel, dan endpoint yang sama,
> tetapi penomoran heading-nya kacau (`## 5.` muncul empat kali, `## 4.` dua kali).
> Digabung supaya tidak ada dua sumber yang bisa saling berbeda.
>
> Dokumen pendamping: `README.md` (PRD + spesifikasi fitur), `OFFLINE-FIRST-ARCHITECTURE.md`
> (detail strategi offline), `OTA-UPDATE-SYSTEM.md` (sistem pembaruan), `Structure.md`
> (peta direktori), `ALUR_APLIKASI.md` (alur per layar).

## 1. System Overview

Trip Angkutan mengikuti arsitektur client-server dengan tiga komponen utama:

1. **Mobile Application** (Ionic + React) — dipakai petugas lapangan.
2. **Backend API** (Node.js + Express + SQLite) — pengolahan data & autentikasi.
3. **Admin Dashboard** (CodeIgniter 2.2.4 + React static build) — pengawasan.

## 2. Component Breakdown

### 2.1 Mobile Application (Ionic + React)
- **Frontend**: React + Tailwind CSS.
- **Fitur**: autentikasi (JWT/PIN), alur pembuatan trip, input kendaraan 2 langkah,
  kamera untuk dokumentasi, arsitektur offline-first dengan antrean sinkronisasi.
- Dipanggil via Capacitor untuk fitur native (kamera, geolokasi, filesystem).

### 2.2 Backend API (Node.js + Express + SQLite)
- **Struktur**: RESTful API dengan autentikasi JWT.
- **Database**: SQLite (melalui sql.js wrapper).
- Endpoint kunci: `/api/auth/*`, `/api/trips/*`, `/api/vehicles`, `/api/plates`,
  `/api/region-tariffs`, `/api/reports/*`.

### 2.3 Admin Dashboard (CodeIgniter 2.2.4)
- Build React disajikan sebagai berkas statis.
- **Fitur**: master tarif (global + per region), master petugas (relasi banyak-ke-banyak
  region), pendaftaran & verifikasi plat, pembuatan/ekspor laporan, pengaturan tema.

## 3. Component Diagram

```
+-------------------+       HTTP/REST       +---------------------+
|   MOBILE APP      | <--------------------> |    BACKEND API      |
| (Ionic + React)   |                       | (Node.js + Express) |
+-------------------+                       +---------------------+
        |                                         |
        | HTTP requests/responses                 | SQL queries
        v                                         v
+-------------------+                       +---------------------+
|   LOCAL STORAGE   | <------------------- |   SQLITE DATABASE   |
+-------------------+                       +---------------------+
        |                                         |
        | Data persistence                       | Data processing
        v                                         v
+-------------------+                       +---------------------+
| ADMIN DASHBOARD   | <-----------------   |  STATIC FILES       |
| (CodeIgniter 2.2) |  (React build)       |  (www/ folder)      |
+-------------------+                       +---------------------+
```

## 4. Technology Stack

| Layer | Teknologi | Keterangan |
|-------|-----------|------------|
| Mobile | Ionic + React | Capacitor untuk fitur native, Tailwind CSS untuk styling |
| Backend | Node.js + Express | SQLite via sql.js wrapper |
| Admin | CodeIgniter 2.2.4 | Menyajikan build React statis dari `www/` |
| Database | SQLite | Diakses lewat sql.js wrapper |
| Auth | JWT (HS256) | Masa berlaku 24 jam, akses berbasis role |

## 5. Data Flow

### 5.1 Operasi Normal
1. Petugas login → menerima token JWT.
2. Petugas membuat trip → data disimpan lokal → masuk antrean sinkronisasi.
3. Petugas melengkapi input kendaraan → data disimpan lokal.
4. Petugas submit trip → `POST /api/trips` dengan JWT.
5. Backend memproses → simpan ke SQLite → balas 201.
6. Antrean sinkronisasi memproses trip tertunda saat online.

### 5.2 Operasi Offline
1. Petugas membuat trip → disimpan di penyimpanan lokal.
2. UI menampilkan status terputus (mode offline).
3. Antrean sinkronisasi menyimpan operasi yang tertunda.
4. Saat koneksi kembali → sinkronisasi otomatis ke backend.

Detail lengkap: `OFFLINE-FIRST-ARCHITECTURE.md`.

## 6. Authentication & Authorization

- **JWT**: algoritma HS256, masa berlaku 24 jam.
- **Claims**: `officerId`, `regionId`, `role` (admin/officer).
- **Middleware**: `authenticate` (verifikasi JWT), `requireAdmin` (khusus admin).
- **Role**: `admin` = seluruh endpoint; `officer` = region & trip miliknya sendiri.
- **Alur login**:
  1. Aplikasi dibuka → periksa JWT valid di penyimpanan lokal.
  2. Tanpa token → layar login.
  3. Petugas mengisi kredensial → `POST /api/auth/member-login` (atau PIN).
  4. Server memvalidasi → mengembalikan JWT + data petugas.
  5. Token disimpan dan dikirim sebagai `Authorization: Bearer <token>`.
  6. Token kedaluwarsa (24 jam) → `POST /api/auth/refresh`.

## 7. Database

### 7.1 Tabel Inti
- `regions`: kode region (BADAU, SJRE, SBDZ, ENTIKONG).
- `officers`: petugas lapangan beserta penugasan region.
- `officer_regions`: relasi banyak-ke-banyak petugas–region.
- `tariffs`: master tarif per jenis kendaraan & status muatan.
- `region_tariffs`: konfigurasi tarif per region.
- `vehicle_plates`: pendaftaran plat dengan status (internal/lokal/eksternal).
- `trips`: catatan trip beserta rute dan statusnya.
- `vehicles`: data kendaraan yang terkait trip.
- `trip_vehicles`: tabel penghubung trip–kendaraan.

### 7.2 Operasi Database
- **sql.js wrapper**: mengubah `undefined` menjadi `null` agar binding benar.
- **Migrasi**: penambahan kolom otomatis (semua `CREATE TABLE IF NOT EXISTS` idempotent).
- **Seed data**: data awal region, petugas, dan tarif.

## 8. API Design

### 8.1 Authentication
- `POST /api/auth/admin-login` — login admin.
- `POST /api/auth/member-login` — login petugas (username/password).
- `POST /api/auth/login` — login PIN (butuh ID petugas).
- `POST /api/auth/refresh` — perpanjang token.

### 8.2 Trips
- `POST /api/trips` — membuat trip (butuh JWT).
- `GET /api/trips` — daftar trip (petugas difilter per region).
- `GET /api/trips/:id` — detail trip.
- `POST /api/trips/:id/vehicles` — menambah kendaraan ke trip.

### 8.3 Plates
- `GET/POST/PUT/DELETE /api/plates` — CRUD plat.
- `POST /api/plates/check` — verifikasi status plat (internal/lokal/eksternal).

### 8.4 Reports
- `GET /api/reports/trips` — laporan trip rinci (khusus admin).
- `GET /api/reports/trips/filters` — opsi filter laporan.
- `GET /api/reports/trips/export` — ekspor sisi server (fallback).

### 8.5 Struktur REST Ringkas
- `/api/auth/*` — manajemen autentikasi · `/api/trips/*` — manajemen trip
- `/api/vehicles` — manajemen kendaraan · `/api/plates` — plat
- `/api/region-tariffs` — konfigurasi tarif · `/api/reports/*` — pelaporan

## 9. Deployment Architecture

- **Development**: Backend `npm start`; Mobile `npm start` (dev server); Admin `php -S`.
- **Production**:
  - Backend: proses manager (PM2) / layanan container.
  - Mobile: build → `npx cap sync android` → rilis APK (pembaruan berikutnya lewat OTA,
    lihat `OTA-UPDATE-SYSTEM.md`).
  - Admin: salin build ke web server CodeIgniter (`www/`).

## 10. Error Handling

- **401 Unauthorized**: token tidak ada / kedaluwarsa.
- **403 Forbidden**: token tidak valid atau hak akses kurang.
- **404 Not Found**: endpoint atau resource tidak ada.
- **500 Internal Server Error**: pengecualian tak tertangani.
- **Sync error**: percobaan ulang otomatis dengan backoff eksponensial.

## 11. Security Considerations

- **Autentikasi**: JWT dengan penandatanganan HS256.
- **Transport**: HTTPS di produksi.
- **Validasi input**: selalu divalidasi ulang di sisi server.
- **Perlindungan data**: PIN di-hash (bcrypt), token berumur pendek, tidak ada data
  sensitif pada URL.
