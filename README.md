# Trip Angkutan

Aplikasi mobile recording trips dan kendaraan transportasi berbahasa Indonesia, bersifat local-first. Dibangun dengan Ionic Angular dan Capacitor.

## Screenshots

Tambahkan screenshot di folder `screenshots/` dan referensi di sini.

## Fitur Utama

| Modul | Deskripsi |
|-------|-----------|
| **Autentikasi PIN** | Login 6 digit dengan identifikasi perangkat unik |
| **Dashboard Home** | Ringkasan user, region, konektivitas, dan trip |
| **Recording Trip** | Pembuatan trip muatan (berat/kosong) dengan GPS capture |
| **Input Kendaraan** | Data kendaraan: plat nomor, klasifikasi, tipe, foto, lokasi, tarif |
| **Riwayat Trip** | Histori trip dengan status sinkronisasi |
| **Sinkronisasi** | Upload otomatis saat online + manual |
| **Offline-First** | Data tersimpan lokal menggunakan IndexedDB/SQLite |
| **Native Features** | Kamera, GPS, network status via Capacitor |

## Tech Stack

| Teknologi | Versi | Fungsi |
|-----------|--------|---------|
| Angular | 22 | Framework utama |
| Ionic Angular | 9 | UI components & mobile-first design |
| Capacitor | 7 | Akses native features (camera, geolocation) |
| TypeScript | 6 | Bahasa pemrograman |
| RxJS | 7 | Reactive state management |
| Ionic Storage | - | Penyimpanan lokal (IndexedDB/SQLite) |
| ESLint | - | Code linting |
| Vitest | - | Unit testing |

## Struktur Proyek

```
src/
├── App.tsx                  # Root component
├── main.tsx                # Entry point
├── index.html              # HTML template
├── global.scss              # Global styles
├── global.d.ts              # Type declarations
├── vite-env.d.ts           # Vite environment types
├── environments/
│   ├── environment.ts       # Development config
│   └── environment.prod.ts   # Production config
├── theme/
│   └── variables.scss       # Ionic theme variables
├── pages/                   # Page components
└── assets/                  # Static assets
```

**Native Android:**
```
android/                     # Project Android Studio
www/                         # Capacitor web build output
```

## Prerequisites

- **Node.js** 22+
- **npm** (terinstall dengan Node.js)
- **Android Studio** + SDK 36
- **JDK** 21+ (untuk build Android)
- **API Backend** - konfigurasi ada di `src/environments/environment.ts`
- **Perangkat dengan kamera & GPS** untuk testing native features

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

## Build

```bash
# Production build (output ke www/)
npm run build

# Sync ke Android project
npx cap sync android

# Open di Android Studio
npx cap open android
```

## Android

```bash
# Run langsung ke device/emulator
npx cap run android
```

**App ID:** `com.plantation.tripangkut`
**Display Name:** `Trip Angkutan`
**Package:** `android/` (Android Studio project)

## Alur Aplikasi

```
1. Splash Screen → cek session lokal
2. Login PIN 6 digit → device ID di-generate otomatis
3. Home Dashboard → ringkasan & navigasi
4. Buat Trip → input data + GPS + kendaraan + tarif
5. Simpan lokal → IndexedDB/SQLite
6. History → lihat trip + status sync
7. Sinkronisasi → upload ke API saat online
```

## Data Lokal

**Database:** `tripangkut_db`

| Data | Keterangan |
|------|------------|
| User session | Token & data user |
| Trips | Semua trip dengan nested vehicles |
| Vehicles | Data kendaraan per trip |
| Tariffs | Cache tarif offline |
| Device ID | Identifikasi unik perangkat |

Trip tersimpan lokal sampai berhasil di-sync ke server. Status: `pending`, `synced`, `failed`.

## API

**Base URL Development:** `http://localhost:3000/api`
**Base URL Production:** `https://api.tripangkut.com/api`

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Login dengan officer ID + PIN |
| POST | `/auth/member-login` | Login petugas dengan username/password (budi/budi123) → JWT officer |
| POST | `/auth/admin-login` | Login admin (admin/admin123) → JWT role admin |
| GET | `/auth/verify` | Verify JWT token |
| GET | `/auth/officers/:regionCode` | List officers by region |
| GET/POST | `/trips` | CRUD trips |
| GET | `/trips/:id` | Trip detail |
| POST | `/trips/:tripId/vehicles` | Add vehicle to trip |
| GET | `/vehicles` | Data kendaraan |
| GET | `/tariffs` | Daftar tarif (**admin only**) |
| POST/PUT/DELETE | `/tariffs/:id` | CRUD tarif (**admin only**) |
| GET | `/officers` | Daftar officer |
| GET | `/regions` | Daftar region |
| GET | `/reports` | Laporan |
| GET | `/api/health` | Health check |

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

## Sinkronisasi Data

### Cara Kerja

1. **Trip dibuat** → data disimpan ke localStorage + ditambahkan ke sync queue
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
├── auth.ts     # Login/logout + token management
└── sync.ts     # Queue-based background sync
```
# Struktur Proyek Aplikasi-Trip-Ionic

## Overview
Proyek ini adalah aplikasi mobile (Ionic/Capacitor) dengan frontend React + TypeScript, backend Node.js, dan dua versi admin panel (PHP dan Angular/Ionic build).

---

## Struktur Direktori Utama

```
Aplikasi-Trip-Ionic/
├── src/                    # Source code utama (React + Ionic)
├── backend/                # Backend API (Node.js/Express)
├── admin/                  # Admin Panel v1 (PHP)
├── admin-ci/               # Admin Panel v2 (Ionic/Angular build output)
├── android/                # Konfigurasi Android (Capacitor)
├── www/                    # Build output web (Ionic)
├── .angular/               # Angular cache
├── .vscode/                # VS Code settings
├── capacitor.config.ts     # Konfigurasi Capacitor
├── ionic.starter.json      # Konfigurasi Ionic starter
├── package.json            # Dependencies utama
├── tailwind.config.js      # Konfigurasi Tailwind CSS
├── tsconfig.json           # TypeScript config root
├── tsconfig.app.json       # TypeScript config app
├── tsconfig.spec.json      # TypeScript config test
├── vite.config.ts          # Konfigurasi Vite
├── eslint.config.js        # Konfigurasi ESLint
├── .editorconfig           # Editor config
├── .browserslistrc         # Browserslist config
├── .gitignore              # Git ignore
└── Structure.md            # File ini
```

---

## Detail src/ (Frontend Mobile App)

```
src/
├── App.tsx                 # Root component
├── main.tsx                # Entry point
├── index.html              # HTML template
├── index.css               # Global styles
├── global.scss             # Global SCSS
├── global.d.ts             # Global type declarations
├── vite-env.d.ts           # Vite env types
├── environments/
│   ├── environment.ts      # Env development
│   └── environment.prod.ts # Env production
├── assets/
│   ├── guest-profile.jpeg
│   ├── icon/
│   │   └── favicon.png
│   └── shapes.svg
├── theme/
│   └── variables.scss      # Ionic CSS variables & theming
├── pages/
│   ├── LoginPage.tsx       # Halaman login
│   ├── data.ts             # Data statis/mock
│   ├── types.ts            # Type definitions
│   ├── store.tsx           # State management (Zustand/Context)
│   ├── admin/
│   │   └── AdminDashboard.tsx
│   └── mobile/
│       ├── MobileApp.tsx           # Wrapper mobile app
│       ├── MobileShell.tsx         # Shell dengan navigation
│       ├── HomeScreen.tsx          # Beranda
│       ├── CameraScreen.tsx        # Kamera OCR plat nomor
│       ├── FloatingBottomNav.tsx   # Bottom navigation
│       ├── HistoryScreen.tsx       # Riwayat perjalanan
│       ├── HistoryDetailScreen.tsx # Detail riwayat
│       ├── OfficerSwitchScreen.tsx # Ganti petugas
│       ├── PinVerifyScreen.tsx     # Verifikasi PIN
│       ├── ProfileScreen.tsx       # Profil user
│       ├── RouteSelectScreen.tsx   # Pilih rute
│       ├── StatusBar.tsx           # Status bar custom
│       ├── TripActiveScreen.tsx    # Perjalanan aktif
│       ├── TripCompleteScreen.tsx  # Selesai perjalanan
│       ├── TripConditionScreen.tsx # Kondisi perjalanan
│       ├── TripSummaryScreen.tsx   # Ringkasan perjalanan
│       └── VehicleFormScreen.tsx   # Form kendaraan
├── services/
│   ├── api.ts          # Base API client (axios/fetch)
│   ├── auth.ts         # Autentikasi (login, token, refresh)
│   ├── ocr.ts          # OCR plat nomor (Tesseract.js)
│   ├── plates.ts       # Manajemen plat nomor
│   ├── regions.ts      # Data wilayah/rute
│   ├── sync.ts         # Sinkronisasi offline/online
│   ├── tariffs.ts      # Tarif/biaya perjalanan
│   └── trips.ts        # CRUD perjalanan
```

---

## Detail backend/ (Backend API)

```
backend/
├── package.json
├── package-lock.json
├── node_modules/
└── src/
    └── db.js             # Database connection (PostgreSQL/MySQL)
```

---

## Detail admin/ (Admin Panel v1 - PHP)

```
admin/
├── index.php             # Entry point PHP
├── package.json          # Jika pakai build tools
└── src/                  # Source PHP/JS
```

---

## Detail admin-ci/ (Admin Panel v2 - Ionic/Angular Build)

```
admin-ci/
├── index.html            # Entry HTML
├── index.php             # PHP fallback
├── 3rdpartylicenses.txt  # Licenses
├── prerendered-routes.json
├── main-*.js             # Bundled JS (multiple versions)
├── styles-*.css          # Bundled CSS
├── assets/
│   ├── guest-profile.jpeg
│   └── icon/
│       └── favicon.png
└── svg/                  # Ionicon SVG icons (300+ files)
```

---

## Detail android/ (Capacitor Android)

```
android/
├── .gitignore
├── app/
│   ├── build.gradle
│   ├── .gitignore
│   └── build/            # Build artifacts (generated)
└── .gitignore
```

---

## Detail www/ (Web Build Output)

```
www/
├── index.html
├── prerendered-routes.json
├── main-*.js
├── styles-*.css
├── assets/               # Copied from src/assets
└── svg/                  # Ionicon SVG icons
```

---

## Teknologi yang Digunakan

### Frontend (Mobile)
- **React 18** + **TypeScript**
- **Ionic Framework** (UI components)
- **Capacitor** (Native bridge)
- **Vite** (Build tool)
- **Tailwind CSS** (Utility-first CSS)
- **Zustand/React Context** (State management)
- **Tesseract.js** (OCR plat nomor)
- **Axios/Fetch** (API client)

### Backend
- **Node.js** + **Express** (assumed dari struktur)
- **Database**: PostgreSQL/MySQL (via db.js)

### Admin Panel v1
- **PHP** (Vanilla/Laravel?)

### Admin Panel v2
- **Angular** + **Ionic** (Build output di admin-ci/)

### Mobile Native
- **Android** (Capacitor)
- **iOS** (Capacitor - config ada tapi folder tidak terlihat)

---

## Alur Aplikasi Mobile

```
LoginPage
    │
    ▼
MobileShell (dengan FloatingBottomNav)
    │
    ├── HomeScreen
    │       │
    │       ├── RouteSelectScreen → VehicleFormScreen → TripConditionScreen
    │       │                                              │
    │       │                                              ▼
    │       │                                    TripActiveScreen
    │       │                                              │
    │       │                                              ▼
    │       │                                    TripCompleteScreen
    │       │                                              │
    │       │                                              ▼
    │       │                                    TripSummaryScreen
    │       │
    ├── HistoryScreen → HistoryDetailScreen
    ├── ProfileScreen
    ├── OfficerSwitchScreen
    ├── PinVerifyScreen
    └── CameraScreen (OCR plat nomor)
```

---

## Services & Data Flow

```
services/
├── auth.ts     → Login, token management, session
├── api.ts      → Base HTTP client, interceptors
├── trips.ts    → CRUD perjalanan (create, read, update, complete)
├── tariffs.ts  → Hitung tarif berdasarkan rute/jarak
├── regions.ts  → Data wilayah, terminal, rute
├── plates.ts   → Validasi & format plat nomor
├── ocr.ts      → Tesseract.js OCR dari CameraScreen
├── sync.ts     → Offline queue, background sync
└── store.tsx   → Global state (user, trips, settings)
```

---

## Catatan Penting

1. **Dual Admin Panel**: Ada 2 versi admin - PHP (`admin/`) dan Ionic/Angular build (`admin-ci/`)
2. **Capacitor**: Konfigurasi di `capacitor.config.ts`, build Android di `android/`, iOS tidak terlihat tapi dikonfigurasi
3. **OCR Integration**: Menggunakan Tesseract.js di `CameraScreen` untuk scan plat nomor
4. **Offline Support**: `sync.ts` handle queue saat offline, sinkron saat online
5. **Theming**: Ionic CSS variables di `src/theme/variables.scss` + Tailwind di `tailwind.config.js`
6. **Build Output**: Web build di `www/`, Android build di `android/app/build/`

## Lisensi

MIT License
