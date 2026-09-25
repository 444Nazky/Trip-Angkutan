# Trip Angkutan

Aplikasi mobile recording trips dan kendaraan transportasi berbahasa Indonesia, bersifat local-first. Dibangun dengan Ionic/React (frontend mobile), Capacitor (native bridge), dan Node.js/Express (backend API). Admin panel dual: PHP (`admin/`) dan Ionic/Angular build (`admin-ci/`).

---

## Screenshots

Tambahkan screenshot di folder `screenshots/` dan referensi di sini.

---

## Fitur Utama

| Modul | Deskripsi |
|-------|-----------|
| **Autentikasi PIN** | Login 6 digit dengan identifikasi perangkat unik; perangkat terkunci permanen ke *region* setelah login pertama |
| **Dashboard Home** | Ringkasan user, region, konektivitas, dan trip |
| **Recording Trip - Angkutan Kosong** | Rute dikunci `SJRE → SBDZ`; wajib keterangan + foto bukti fisik via kamera; auto-capture GPS, waktu, petugas |
| **Recording Trip - Ada Muatan** | Rute bebas; input kendaraan (plat, golongan, kategori); wajib foto selfie + seluruh kendaraan; loop input multiple kendaraan |
| **Riwayat Trip** | Histori trip dengan status sinkronisasi |
| **Sinkronisasi** | Upload otomatis saat online + manual; retry 3x dengan delay 5 detik |
| **Offline-First** | Data tersimpan lokal menggunakan localStorage/IndexedDB |
| **Native Features** | Kamera (photo + OCR plat), GPS, network status via Capacitor |

### Admin Panel (Web)
| Modul | Deskripsi |
|-------|-----------|
| **Dashboard Overview** | Trip terbaru dari server, status koneksi |
| **Master Tarif** | CRUD golongan (I–V), jenis kendaraan, tarif muatan/kosong, deskripsi; tarif region (Lokal/Eksternal per region) |
| **Master Plat** | Registrasi plat nomor dengan status (Internal/Lokal/Eksternal) + region asal; konfigurasi tarif terpusat (Internal=0, Lokal=bisa diubah, Eksternal=region) |
| **Master Petugas** | CRUD petugas per region; PIN 6-digit; status Aktif/Nonaktif; multi-region assignment; sync dari server (server = single source of truth) |
| **Laporan** | Filter per tanggal, golongan, jenis kendaraan; ringkasan + detail kendaraan per trip; **Export Excel (.xlsx) 2 sheet** |

---

## Tech Stack

| Teknologi | Versi | Fungsi |
|-----------|--------|---------|
| React | 18 | Framework utama (frontend mobile) |
| Ionic Framework | 9 | UI components & mobile-first design |
| Capacitor | 7 | Akses native features (camera, geolocation) |
| TypeScript | 5+ | Bahasa pemrograman |
| RxJS | 7 | Reactive patterns |
| Vite | 5+ | Build tool |
| Tailwind CSS | 3 | Utility-first styling |
| Tesseract.js | 5+ | OCR plat nomor |
| Zustand/React Context | - | State management (store.tsx) |
| Express.js | 4+ | Backend API |
| SQLite/PostgreSQL | - | Database backend |

---

## Struktur Proyek

```
src/
├── App.tsx                  # Root component
├── main.tsx                 # Entry point
├── index.html               # HTML template
├── index.css                # Global styles
├── global.scss              # Global SCSS
├── global.d.ts              # Type declarations
├── vite-env.d.ts            # Vite environment types
├── environments/
│   ├── environment.ts       # Development config
│   └── environment.prod.ts  # Production config
├── theme/
│   └── variables.scss       # Ionic theme variables
├── pages/                   # Page components
│   ├── LoginPage.tsx        # Halaman login
│   ├── data.ts              # Data statis/mock (ROUTES, tariffData, officerList)
│   ├── types.ts             # Type definitions (MobileScreen, AdminTab)
│   ├── store.tsx            # State management (Context + localStorage)
│   ├── admin/
│   │   └── AdminDashboard.tsx  # Admin panel (Overview, Tarif, Plat, Petugas, Laporan, Pengaturan)
│   └── mobile/
│       ├── MobileApp.tsx            # Wrapper mobile app
│       ├── MobileShell.tsx          # Shell dengan navigation
│       ├── HomeScreen.tsx           # Beranda (Mulai Trip, Riwayat, Ganti Petugas)
│       ├── CameraScreen.tsx         # Kamera OCR plat + foto bukti (HANYA kamera, no gallery)
│       ├── FloatingBottomNav.tsx    # Bottom navigation
│       ├── HistoryScreen.tsx        # Riwayat perjalanan
│       ├── HistoryDetailScreen.tsx  # Detail riwayat
│       ├── OfficerSwitchScreen.tsx  # Ganti petugas (PIN 6-digit)
│       ├── PinVerifyScreen.tsx      # Verifikasi PIN
│       ├── ProfileScreen.tsx        # Profil user
│       ├── RouteSelectScreen.tsx    # Pilih rute (terkunci SJRE→SBDZ untuk trip kosong)
│       ├── StatusBar.tsx            # Status bar custom
│       ├── TripActiveScreen.tsx     # Perjalanan aktif (timer, GPS)
│       ├── TripCompleteScreen.tsx   # Selesai perjalanan
│       ├── TripConditionScreen.tsx  # Status Muatan: Kosong vs Ada Muatan
│       ├── TripSummaryScreen.tsx    # Ringkasan trip (wajib foto kamera sebelum submit)
│       └── VehicleFormScreen.tsx    # Form kendaraan (plat, OCR scan, jenis, kategori, foto)
├── services/
│   ├── api.ts          # Base HTTP client dengan auth interceptor
│   ├── auth.ts         # Autentikasi (login, token, refreshBackendSession)
│   ├── ocr.ts          # OCR plat nomor (Tesseract.js)
│   ├── plates.ts       # Manajemen plat nomor (CRUD + cek status)
│   ├── regions.ts      # Data wilayah, terminal, rute
│   ├── sync.ts         # Queue-based background sync (offline/online)
│   ├── tariffs.ts      # Tarif/biaya perjalanan (master + region)
│   ├── trips.ts        # CRUD perjalanan (server + local)
│   ├── officers.ts     # Sync petugas dari server ke lokal
│   └── xlsx.ts         # Export Excel (SheetJS)
```

**Native Android:**
```
android/                     # Project Android Studio
www/                         # Capacitor web build output
```

---

## Prerequisites

- **Node.js** 22+
- **npm** (terinstall dengan Node.js)
- **Android Studio** + SDK 36
- **JDK** 21+ (untuk build Android)
- **API Backend** - konfigurasi ada di `src/environments/environment.ts`
- **Perangkat dengan kamera & GPS** untuk testing native features

---

## Instalasi

```bash
# Clone repo
git clone https://github.com/444Nazky/Aplikasi-Trip-Ionic.git
cd Aplikasi-Trip-Ionic

# Install dependencies
npm ci

# Setup Capacitor
npx cap sync android
```

---

## Development

```bash
# Start dev server (http://localhost:5173)
npm start

# Start both frontend + backend together
./start-dev.sh

# Start backend separately
cd backend && npm start
```

### Backend Development

Backend Express.js di folder `backend/`:
- Port: 3000
- Database: SQLite (otomatis dibuat)
- API prefix: `/api`

```bash
cd backend
npm install
npm start
```

### Frontend Development

```bash
# Watch mode untuk development
npm run watch

# Lint code
npm run lint

# Unit tests
npm test

# Type check & build validation
npm run build
```

---

## Build

```bash
# Production build (output ke www/)
npm run build

# Sync ke Android project
npx cap sync android

# Open di Android Studio
npx cap open android
```

### Android

```bash
# Run langsung ke device/emulator
npx cap run android
```

**App ID:** `com.plantation.tripangkut`  
**Display Name:** `Trip Angkutan`  
**Package:** `android/` (Android Studio project)

---

## Alur Aplikasi Mobile (Petugas Lapangan)

### 1. Inisiasi Awal & Login
```
Splash Screen → cek session lokal
    ↓
LoginPage → PIN 6-digit + device ID auto-generate
    ↓
Perangkat TERKUNCI permanen ke region petugas (mis. BADAU) setelah login pertama
    ↓
HomeScreen → "Mulai Trip"
```

### 2. Pemilihan Kondisi (TripConditionScreen)
Petugas memilih status kondisi angkutan:

| Kondisi | Perilaku |
|---------|----------|
| **Kosong** (Angkutan Kosong) | Rute dikunci **hanya SJRE → SBDZ** (kode `EMPTY_ROUTE_CODE`); wajib isi keterangan; wajib foto bukti fisik via kamera; auto-capture GPS/waktu/petugas; "Simpan Data & Selesai Trip" |
| **Ada Muatan** | Rute bebas dipilih (semua rute tersedia); lanjut ke form kendaraan |

### 3. Alur "Kosong" (Angkutan Kosong)
```
TripConditionScreen (pilih "Kosong")
    ↓ routeCode = SJRE-SBDZ (locked)
RouteSelectScreen (rute terkunci, tampil Lock icon)
    ↓
TripSummaryScreen → wajib foto kamera (cameraMode: 'photo', cameraFrom: 'trip-summary')
    ↓ photoTaken = true
Submit Trip → startTrip() → TripActiveScreen (timer berjalan)
    ↓
TripCompleteScreen → "Trip Selesai!" → data tersimpan lokal + sync queue
```

### 4. Alur "Ada Muatan" (Dengan Muatan)
```
TripConditionScreen (pilih "Ada Muatan")
    ↓
RouteSelectScreen (semua rute bebas: SJRE-SBDZ, SBDZ-SJRE, SJRE-BDAU, BDAU-SJRE)
    ↓
VehicleFormScreen:
  ├─ Step 1: Input Kendaraan
  │   ├─ No. Polisi (manual + OCR scan via CameraScreen)
  │   ├─ Cek Status Plat (internal/lokal/eksternal via API)
  │   ├─ Jenis Kendaraan (Motor, Mobil, Truck Kecil/Sedang/Besar dari Master Tarif)
  │   └─ Tombol "Simpan Data Kendaraan" → modal konfirmasi
  │
  ├─ Step 2: Detail Informasi Tambahan (muncul setelah plat + jenis terisi)
  │   ├─ Kategori Kendaraan: Internal / Eksternal (Berganji) / Eksternal (Tanpa Garansi)
  │   ├─ Foto Bukti: WAJIB via kamera (selfie + seluruh kendaraan)
  │   └─ Tombol "Simpan Data Kendaraan"
  │
  └─ Loop Validasi Perulangan:
      Sistem tanya: "Apakah ada kendaraan lain yang akan diinput?"
      ├─ YA → form dibersihkan (plate/type/category reset, foto reset), input kendaraan berikutnya
      └─ TIDAK → form ditutup → TripSummaryScreen
```

### 5. Ringkasan & Submit Trip (TripSummaryScreen)
- Menampilkan: ID Trip (auto-generate TRP-YYYY-NNNN), Rute, Kondisi, Petugas, Tanggal/Jam
- Daftar kendaraan (plat, jenis, kategori, status plat, foto)
- **Wajib foto kamera** sebelum submit (tombol "Ambil Foto" → CameraScreen)
- Tombol "Submit Trip — Mulai Sekarang" (disabled tanpa foto)
- Tombol "Batal" → reset draft + kembali Home

### 6. Trip Aktif & Selesai
- **TripActiveScreen**: Timer real-time, GPS tracking, tombol "Selesai Trip"
- **TripCompleteScreen**: Konfirmasi trip selesai, ringkasan, trigger background sync
- Data otomatis masuk sync queue → upload ke server saat online

### 7. Keamanan & Perangkat
- **Penguncian Region**: Device ID di-generate saat login pertama → terkunci permanen ke region petugas tersebut
- **Ganti Petugas**: OfficerSwitchScreen + PinVerifyScreen (PIN 6-digit unik per petugas)
- **Verifikasi PIN**: Digunakan untuk pergantian petugas dan validasi keamanan

---

## Alur Pelaporan Web (Administrasi / Backend)

### 1. Dashboard Overview
- Trip terbaru dari server (10 terakhir)
- Status koneksi server (Online/Offline)
- Quick refresh

### 2. Master Tarif (Tab "Master Tarif")
- **Golongan I–V**: Motor, Mobil, Truck Kecil/Sedang/Besar
- **Tarif Muatan & Kosong** per golongan (Rp)
- **Deskripsi** kendaraan
- CRUD lokal + sync best-effort ke server
- **Tarif Region (Lokal/Eksternal)**: Konfigurasi per region (bisa Aktif/Nonaktif)

### 3. Master Plat (Tab "Master Plat")
- Registrasi nomor plat + pemilik + region asal + status
- **Status Plat**: `internal` (Rp 0, dikunci), `lokal` (tarif cadangan, bisa diubah), `eksternal` (tarif region pos)
- Konfigurasi tarif terpusat per region

### 4. Master Petugas (Tab "Petugas")
- CRUD petugas per region (BADAU, ENTIKONG, dll)
- **PIN 6-digit unik** per petugas
- **Status**: Aktif / Nonaktif (mobile menolak login Nonaktif)
- **Multi-region assignment**: Satu petugas bisa punya akses multiple region
- **Server = Single Source of Truth**: Data lokal di-merge dengan server saat sync; status/wilayah selalu sinkron

### 5. Laporan (Tab "Laporan")
- **Filter**: Tanggal trip, Golongan (I–V), Jenis Kendaraan
- **Rekapitulasi per Tanggal**: Total trip (kosong vs muatan), total kendaraan, total pendapatan → **Export Excel**
- **Detail per Trip**: No Trip, Waktu, Rute, Petugas, Status Muatan, Kategori, Jumlah Unit, Sub-total
- **Detail Kendaraan per Trip**: No Polisi, Jenis, Golongan, Kategori, Beban, Tarif
- **Export Excel (.xlsx)**: 2 sheet — "Laporan Trip" + "Detail Kendaraan"

---

## Data Lokal (localStorage)

| Key | Keterangan |
|-----|------------|
| `trip.trips.v1` | Semua trip dengan nested vehicles (status: pending/synced/failed) |
| `trip.officerId.v1` | ID petugas aktif |
| `trip.session.v1` | Login status (boolean) |
| `trip.userType` | 'admin' \| 'member' |
| `trip.tariffs.v1` | Cache master tarif offline |
| `trip.officers.v1` | Cache daftar petugas offline |
| `trip.auth.officer.v1` | Officer JWT session (auth.ts) |

---

## API Endpoints

**Base URL Development:** `http://localhost:3000/api`  
**Base URL Production:** `https://api.tripangkut.com/api`

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Login officer ID + PIN |
| POST | `/auth/member-login` | Login petugas username/password → JWT officer |
| POST | `/auth/admin-login` | Login admin → JWT role admin |
| GET | `/auth/verify` | Verify JWT token |
| GET | `/auth/officers/:regionCode` | List officers by region |

### Trips
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/trips` | CRUD trips |
| GET | `/trips/:id` | Trip detail |
| POST | `/trips/:tripId/vehicles` | Add vehicle to trip |

### Master Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vehicles` | Data kendaraan |
| GET/POST/PUT/DELETE | `/tariffs` | CRUD master tarif (admin) |
| GET/POST/PUT/DELETE | `/region-tariffs` | CRUD tarif region (admin) |
| GET/POST/PUT/DELETE | `/plates` | CRUD master plat (admin) |
| GET/POST/PUT/DELETE | `/officers` | CRUD petugas (admin) |
| GET | `/regions` | Daftar region |
| GET | `/reports/trips` | Laporan trip (dengan filter) |
| GET | `/reports/trips/filters` | Opsi filter laporan (golongan, jenis) |

### Authentication
Backend menggunakan JWT. Login endpoint:
```json
POST /auth/login
Body: { "officerId": 1, "pin": "123456" }
Response: { "token": "...", "officer": {...} }
```
Frontend kirim token di header:
```
Authorization: Bearer <token>
```

---

## Sinkronisasi Data

### Cara Kerja
1. **Trip dibuat** → data disimpan ke localStorage + ditambahkan ke sync queue (`sync.ts`)
2. **Sync queue diproses** → HTTP POST ke backend saat:
   - App di foreground + ada koneksi internet
   - Tab/browser mendapat fokus (focus event)
   - Tombol "Sync" ditekan manual
3. **Retry otomatis** → max 3x dengan delay 5 detik
4. **Offline mode** → data tetap tersimpan, sync saat online

### Status Sinkronisasi
- `pending` - Di queue, belum diupload
- `syncing` - Sedang diupload
- `synced` - Berhasil diupload ke server
- `failed` - Gagal setelah max retry

### File Sync Service
```
src/services/
├── api.ts      # HTTP client dengan auth
├── auth.ts     # Login/logout + token management + refreshBackendSession
├── sync.ts     # Queue-based background sync
├── officers.ts # Sync petugas dari server ke lokal
└── trips.ts    # CRUD trip (server + local)
```

---

## Region & Rute

### Region Terdaftar
- **BADAU** (Kode: BDAU)
- **ENTIKONG** (Kode: ENK)
- **SIJANGKUNG** (Kode: SJRE)
- **SABADI** (Kode: SBDZ)

### Rute Tersedia
| Kode | Asal → Tujuan | Jarak | Durasi |
|------|---------------|-------|--------|
| `SJRE-SBDZ` | Sijangkung → Sabadi | 42 km | 1j 10m |
| `SBDZ-SJRE` | Sabadi → Sijangkung | 42 km | 1j 10m |
| `SJRE-BDAU` | Sijangkung → Badau | 18 km | 35m |
| `BDAU-SJRE` | Badau → Sijangkung | 18 km | 35m |

**Trip Kosong**: Hanya `SJRE-SBDZ` (dikunci via `EMPTY_ROUTE_CODE` constant di `TripConditionScreen.tsx:11`)

---

## Master Tarif (Golongan & Jenis Kendaraan)

| Golongan | Jenis | Tarif Muatan | Tarif Kosong | Deskripsi |
|----------|-------|--------------|--------------|-----------|
| I | Motor | Rp 15.000 | Rp 8.000 | Sepeda motor roda dua |
| II | Mobil | Rp 45.000 | Rp 20.000 | Mobil penumpang / pickup kecil |
| III | Truck Kecil | Rp 120.000 | Rp 55.000 | Truck ringan s/d 3 ton |
| IV | Truck Sedang | Rp 280.000 | Rp 130.000 | Truck sedang 3–8 ton |
| V | Truck Besar | Rp 450.000 | Rp 200.000 | Truck besar / trailer di atas 8 ton |

**Tarif Region (Lokal/Eksternal)**: Dikonfigurasi per region di Admin Panel → Master Plat → "Konfigurasi Tarif Terpusat"

---

## Kategori Kendaraan (Mobile)

| Kategori | Badge | Warna | Keterangan |
|----------|-------|-------|------------|
| **Internal** | Internal | Slate 800 | Kendaraan internal plantation |
| **Eksternal (Berganji)** | Ekst. Berganji | Amber 500 | Kendaraan eksternal dengan tarif/garansi |
| **Eksternal (Tanpa Garansi)** | Ekst. Tanpa Garansi | Rose 500 | Kendaraan eksternal tanpa tarif/garansi |

*Kategori "Lokal" dihapus/digantikan oleh "Eksternal (Berganji)" & "Eksternal (Tanpa Garansi)" di UI mobile*

---

## Status Plat Nomor (OCR + Cek Server)

| Status | Warna | Arti |
|--------|-------|------|
| **internal** | Slate 800 | Plat terdaftar internal → Rp 0 |
| **lokal** | Blue 100/700 | Plat lokal region → tarif lokal |
| **eksternal** | Amber 100/700 | Plat eksternal → tarif region pos |

---

## Lisensi

MIT License

# Aplikasi Trip Angkutan

Aplikasi *mobile* pencatatan *trip* dan kendaraan transportasi berbahasa Indonesia yang dirancang dengan sistem *local-first*. Dibangun menggunakan Ionic/React (frontend mobile), Capacitor (native bridge), dan Node.js/Express (backend API). Dilengkapi dengan panel admin ganda (PHP dan Ionic/Angular).

---

## 🚀 Fitur Utama & Pembaruan Sistem Hak Akses

| Modul | Deskripsi |
|-------|-----------|
| **Struktur Wilayah (Generik)** | Sistem pengelolaan berbasis **Region 1** dengan **Dermaga 1** (memuat Rute 1 & 2) dan **Dermaga 2** (memuat Rute 3 & 4). |
| **Hak Akses Pegawai Standar** | Pembatasan ketat rute dan dermaga sesuai pengaturan admin di *dashboard*; menu di luar izin akses otomatis disembunyikan (*hidden*). |
| **Fitur Spesial Dual Access ("User 2 Kaki")** | Fitur interaktif untuk pengguna multi-dermaga (contoh: akses ke Dermaga 1 dan Dermaga 2 sekaligus), di mana sistem wajib memunculkan dialog pilihan (*prompt selection*) tempat bertugas setiap kali *login*. |
| **Autentikasi & Sesi** | Login PIN 6 digit dengan identifikasi perangkat unik; perangkat terkunci permanen ke *region* setelah login pertama. |
| **Recording Trip - Cepat & Sat-Set** | Prioritas utama langsung jepret foto dokumentasi via kamera (blokir total impor galeri), diikuti input nomor plat, baru detail lainnya menyusul. |
| **Riwayat & Sinkronisasi** | Histori *trip* lengkap dengan status sinkronisasi *queue-based* (otomatis saat *online* + manual). |

---

## 👥 Data Uji Coba (Dummy Accounts)

Konfigurasi akun untuk tahap percobaan (*testing*):
1. **Budi Santoso**: Region 1, Dermaga 1 (Hanya akses rute Dermaga 1).
2. **Andi Pratama**: Region 1, Dermaga 2 (Hanya akses rute Dermaga 2).
3. **Dewi Kusuma (User 2 Kaki / Dual Access)**: Region 1, Dermaga 1 & 2 (Wajib memilih dermaga via *prompt* setiap kali *login*).

---

## 🛠️ Tech Stack

| Teknologi | Versi | Fungsi |
|-----------|--------|---------|
| React / Ionic | 18 / 9 | Framework utama & UI components (*mobile-first*) |
| Capacitor | 7 | Akses fitur *native* (kamera eksklusif & geolokasi) |
| TypeScript / Tailwind | 5+ / 3 | Bahasa pemrograman & *utility-first styling* |
| Express.js / SQLite | 4+ / - | Backend API dan basis data server |

---

## 📂 Struktur Proyek Utama