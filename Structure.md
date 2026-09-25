# Struktur Proyek Aplikasi-Trip-Ionic

## Overview
Proyek ini adalah aplikasi mobile (Ionic/Capacitor + React/TypeScript) dengan backend Node.js/Express, dan dua versi admin panel (PHP `admin/` dan Ionic/Angular build `admin-ci/`).

---

## Struktur Direktori Utama

```
Aplikasi-Trip-Ionic/
├── src/                    # Source code utama (React + Ionic Mobile)
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
├── README.md               # Dokumentasi utama
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
│   ├── LoginPage.tsx       # Halaman login PIN 6-digit
│   ├── data.ts             # Data statis: ROUTES, tariffData, officerList, allTrips
│   ├── types.ts            # Type definitions (MobileScreen, AdminTab)
│   ├── store.tsx           # State management (Context + localStorage persistence)
│   ├── admin/
│   │   └── AdminDashboard.tsx  # Admin: Overview, Tarif, Plat, Petugas, Laporan, Pengaturan
│   └── mobile/
│       ├── MobileApp.tsx           # Wrapper mobile app
│       ├── MobileShell.tsx         # Shell dengan navigation
│       ├── HomeScreen.tsx          # Beranda: Mulai Trip, Riwayat, Ganti Petugas, Profil
│       ├── CameraScreen.tsx        # Kamera OCR plat + foto bukti (HANYA kamera, no gallery)
│       ├── FloatingBottomNav.tsx   # Bottom navigation
│       ├── HistoryScreen.tsx       # Riwayat perjalanan (list + filter)
│       ├── HistoryDetailScreen.tsx # Detail riwayat trip
│       ├── OfficerSwitchScreen.tsx # Ganti petugas (pilih dari daftar)
│       ├── PinVerifyScreen.tsx     # Verifikasi PIN 6-digit
│       ├── ProfileScreen.tsx       # Profil user & device info
│       ├── RouteSelectScreen.tsx   # Pilih rute (terkunci SJRE→SBDZ untuk trip kosong)
│       ├── StatusBar.tsx           # Status bar custom (koneksi, GPS, battery)
│       ├── TripActiveScreen.tsx    # Perjalanan aktif: timer, GPS, tombol Selesai
│       ├── TripCompleteScreen.tsx  # Selesai perjalanan: ringkasan + trigger sync
│       ├── TripConditionScreen.tsx # Status Muatan: Kosong vs Ada Muatan
│       ├── TripSummaryScreen.tsx   # Ringkasan trip (wajib foto kamera sebelum submit)
│       └── VehicleFormScreen.tsx   # Form kendaraan: plat, OCR, jenis, kategori, foto, loop multi-kendaraan
├── services/
│   ├── api.ts          # Base HTTP client (axios/fetch) dengan auth interceptor
│   ├── auth.ts         # Autentikasi: login, logout, token, refreshBackendSession
│   ├── ocr.ts          # OCR plat nomor (Tesseract.js)
│   ├── plates.ts       # Manajemen plat: CRUD + cek status plat
│   ├── regions.ts      # Data wilayah, terminal, rute
│   ├── sync.ts         # Queue-based background sync (offline-first)
│   ├── tariffs.ts      # Tarif: master + region (fetch, create, update, delete)
│   ├── trips.ts        # CRUD perjalanan (server + local)
│   ├── officers.ts     # Sync petugas dari server ke lokal (merge backend data)
│   ├── xlsx.ts         # Export Excel (SheetJS/xlsx)
│   └── theme.ts        # Admin theme preferences
```

---

## Detail backend/ (Backend API)

```
backend/
├── package.json
├── package-lock.json
├── node_modules/
└── src/
    └── db.js             # Database connection (PostgreSQL/MySQL/SQLite)
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
- **Capacitor** (Native bridge: Camera, Geolocation, Filesystem)
- **Vite** (Build tool)
- **Tailwind CSS** (Utility-first CSS)
- **React Context** (State management via store.tsx)
- **Tesseract.js** (OCR plat nomor)
- **Axios/Fetch** (API client)

### Backend
- **Node.js** + **Express**
- **Database**: PostgreSQL/MySQL/SQLite (via db.js)
- **JWT** Authentication

### Admin Panel v1
- **PHP** (Vanilla/Laravel?)

### Admin Panel v2
- **Angular** + **Ionic** (Build output di admin-ci/)

### Mobile Native
- **Android** (Capacitor)
- **iOS** (Capacitor - config ada tapi folder tidak terlihat)

---

## Alur Aplikasi Mobile (Petugas Lapangan)

```
LoginPage (PIN 6-digit + device ID)
    │
    ▼
Perangkat TERKUNCI permanen ke region petugas (mis. BADAU)
    │
    ▼
MobileShell (FloatingBottomNav)
    │
    ├── HomeScreen
    │       │
    │       ├── "Mulai Trip" → TripConditionScreen
    │       │       ├── "Kosong" (Angkutan Kosong)
    │       │       │       ├── routeCode = SJRE-SBDZ (locked)
    │       │       │       ├── RouteSelectScreen (rute terkunci, Lock icon)
    │       │       │       ├── TripSummaryScreen (wajib foto kamera)
    │       │       │       ├── Submit Trip → TripActiveScreen
    │       │       │       └── TripCompleteScreen → Selesai + Sync
    │       │       │
    │       │       └── "Ada Muatan" (Dengan Muatan)
    │       │               ├── RouteSelectScreen (semua rute bebas)
    │       │               ├── VehicleFormScreen
    │       │               │       ├── Step 1: Input Kendaraan
    │       │               │       │       ├── No. Polisi (manual + OCR scan)
    │       │               │       │       ├── Cek Status Plat (API)
    │       │               │       │       ├── Jenis Kendaraan (dari Master Tarif)
    │       │               │       │       └── "Simpan Data Kendaraan" → Modal konfirmasi
    │       │               │       │
    │       │               │       ├── Step 2: Detail Informasi Tambahan
    │       │               │       │       ├── Kategori: Internal / Eksternal (Berganji) / Eksternal (Tanpa Garansi)
    │       │               │       │       ├── Foto Bukti WAJIB via kamera (selfie + muatan)
    │       │               │       │       └── "Simpan Data Kendaraan"
    │       │               │       │
    │       │               │       └── Loop: "Ada kendaraan lain?" → Ya: reset form → input berikutnya / Tidak: tutup
    │       │               │
    │       │               ├── TripSummaryScreen (wajib foto kamera)
    │       │               ├── Submit Trip → TripActiveScreen
    │       │               └── TripCompleteScreen → Selesai + Sync
    │       │
    │       ├── HistoryScreen → HistoryDetailScreen
    │       ├── OfficerSwitchScreen → PinVerifyScreen
    │       └── ProfileScreen
    │
    └── CameraScreen (OCR plat / Foto bukti — HANYA kamera, tanpa galeri)
```

---

## Services & Data Flow

```
services/
├── auth.ts     → Login, token management, session, refreshBackendSession
├── api.ts      → Base HTTP client, interceptors, JWT auth header
├── trips.ts    → CRUD perjalanan (create, read, update, complete) + server sync
├── tariffs.ts  → Master tarif + tarif region (fetch, CRUD)
├── regions.ts  → Data wilayah, terminal, rute
├── plates.ts   → Validasi & format plat + cek status (internal/lokal/eksternal)
├── ocr.ts      → Tesseract.js OCR dari CameraScreen
├── sync.ts     → Offline queue, background sync, retry logic
├── officers.ts → Sync petugas dari server (server = single source of truth)
└── store.tsx   → Global state (user, trips, draft, tariffs, officers, settings)
```

---

## Data Models (Key Types)

### VehicleEntry (store.tsx:9-21)
```typescript
interface VehicleEntry {
  plate: string
  type: string
  category: string           // 'Internal' | 'Eksternal (Berganji)' | 'Eksternal (Tanpa Garansi)'
  tariff: number
  photoUrl?: string
  plateStatus?: string       // 'internal' | 'lokal' | 'eksternal'
  originRegion?: string
  checkpointRegion?: string
}
```

### Trip (store.tsx:23-41)
```typescript
interface Trip {
  id: string                 // TRP-YYYY-NNNN
  route: string              // "SJRE → SBDZ"
  status: string
  time: string
  date: string
  load: 'Ada Muatan' | 'Kosong'
  vehicle: string            // Legacy single vehicle
  type: string
  category: string
  revenue: string
  revenueNum: number
  officer: string
  duration: string
  photo: boolean
  photoUrl?: string
  vehicles?: VehicleEntry[]  // Multi-vehicle support
  synced?: boolean           // Sync status
}
```

### Draft (store.tsx:43-59)
```typescript
interface Draft {
  routeCode: string | null
  condition: 'kosong' | 'muatan' | null
  vehicles: VehicleEntry[]
  vehicleForm: { plate: string; type: string; category: string }
  photo: boolean
  photoUrl?: string
  cameraFrom: MobileScreen
  cameraMode: 'photo' | 'ocr'
  ocrResult?: string
  ocrError?: string
  startedAt: number | null
}
```

---

## Catatan Penting

1. **Dual Admin Panel**: PHP (`admin/`) dan Ionic/Angular build (`admin-ci/`)
2. **Capacitor**: Config di `capacitor.config.ts`, build Android di `android/`
3. **OCR Integration**: Tesseract.js di `CameraScreen` untuk scan plat nomor
4. **Offline Support**: `sync.ts` handle queue saat offline, sinkron saat online
5. **Camera Only**: Semua foto (bukti trip, selfie muatan, OCR plat) **HANYA via kamera** — import galeri/penyimpanan dimatikan
5. **Region Lock**: Device terkunci ke region setelah login pertama; ganti petugas butuh PIN 6-digit
6. **Theming**: Ionic CSS variables (`src/theme/variables.scss`) + Tailwind (`tailwind.config.js`)
7. **Build Output**: Web build di `www/`, Android build di `android/app/build/`
8. **Server = Source of Truth**: Data petugas, tarif, plat dari server di-merge ke lokal; admin panel selalu fetch dari server

---

## Lisensi

MIT License