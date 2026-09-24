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