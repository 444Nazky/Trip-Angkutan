# Trip Dashboard (Admin)

Dashboard admin untuk aplikasi Trip Angkutan — mengelola master tarif, plat, rute + geofence, petugas, dan laporan trip. Frontend React 19 + Vite + Tailwind, backend Node.js/Express + SQLite, deploy ke Firebase Hosting.

## Stack

| Bagian | Teknologi |
|--------|-----------|
| Frontend | React 19, Vite 7, TypeScript, Tailwind CSS, lucide-react |
| Backend | Express 4, better-sqlite3, JWT, bcryptjs, multer |
| Build/deploy | `vite build` → `www/` → Firebase Hosting (GitHub Actions) |

## Struktur

```
src/                    # Frontend admin (React + Vite)
  pages/admin/          # Dashboard, tab, laporan (ReportSheet), komponen
  services/             # Klien API (api, auth, trips, tariffs, geofences, geo, xlsx, theme)
  environments/         # apiBaseUrl (localhost vs produksi, lewat import.meta.env.PROD)
public/Assets/          # Logo statis
backend/src/
  index.js              # Express app + routing
  db.js                 # Schema, migrasi idempoten, seed (better-sqlite3)
  routes/               # auth, tariffs, plates, officers, routes, geofences, reports, trips
  middleware/auth.js    # authenticate (JWT) + requireAdmin
data/trip.db            # SQLite (dibuat & dimigrasi otomatis saat boot)
firebase.json           # Hosting: publish www/, SPA rewrite
.github/workflows/      # Deploy otomatis ke Firebase saat push ke main
```

## Menjalankan

```bash
npm install
npm run dev             # frontend → http://localhost:5173

cd backend
npm install
JWT_SECRET=change-me npm run dev    # API → http://localhost:3000 (dev: node --watch)
```

Variabel backend: `JWT_SECRET` (**wajib**), `PORT` (default 3000), `DB_PATH` (default `data/trip.db`), `ADMIN_USERNAME` / `ADMIN_PASSWORD` (default `admin` / `admin123`, bisa diganti lewat menu Pengaturan).

## Perintah

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` / `start` | Dev server Vite (HMR) |
| `npm run build` | Build produksi ke `www/` |
| `npm run preview` | Pratinjau hasil build |
| `npm run lint` | ESLint untuk `src/**/*.{ts,tsx}` |
| `npm run typecheck` | `tsc --noEmit` |
| `backend: npm run dev` | API dengan restart otomatis |

## API

Semua endpoint di bawah `/api`, di belakang `Authorization: Bearer <token>`:

- `POST /auth/admin-login`, `POST /auth/change-admin-password`
- `GET|POST /tariffs`, `PUT|DELETE /tariffs/:id`, `GET /region-tariffs`, `PUT /region-tariffs/:regionId`
- `GET|POST /plates`, `PUT|DELETE /plates/:id`
- `GET|POST /officers`, `PUT /officers/:id/{regions,dermagas,pin,status}`, `DELETE /officers/:id`
- `GET|POST /routes`, `PUT|DELETE /routes/:id`, `GET /dermagas`, `GET /regions`
- `GET|POST /geofences`, `PUT|DELETE /geofences/:id`, `GET /geofences/resolve-link?url=`
- `GET /reports/summary`, `GET /reports/trips`, `GET /reports/trips/filters`
- `GET /trips`, `POST /trips/complete` (unggah bukti foto), `GET /api/health`

Kode rute untuk geofence berformat `ASAL-TUJUAN` (cth. `SJRE-SBDZ`).

## Deploy

Push ke `main` → GitHub Actions menjalankan `npm ci && npm run build` lalu deploy `www/` ke Firebase Hosting (project `aplikasi-trip`). Konfigurasi hosting ada di `firebase.json`.

URL API produksi di-set di `src/environments/environment.ts` (cabang `import.meta.env.PROD`).

## 🔄 Custom Self-Hosted API Update System

> **Status:** PRODUKSI — Mengganti sistem OTA pihak ketiga yang sering mengalami kegagalan patch/update sekunder.
> **Tanggal Overhaul:** 2026-10-14

### API Endpoints

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/api/v1/app-version` | GET | Cek versi terbaru aplikasi mobile |
| `/api/v1/app-download/:version` | GET | Download file APK |
| `/api/v1/apk-list` | GET | List semua versi APK |
| `/api/v1/apk-info/:version` | GET | Info APK (size, hash) |
| `/api/v1/release-notes/:version` | GET | Catatan rilis |
| `/api/v1/publish-version` | POST | Publish APK baru (admin) |

### Publish APK Baru

```bash
# Install di root project
node scripts/publish-apk.mjs \
  --apk=/path/to/app-release.apk \
  --version=1.0.1 \
  --notes="Perbaikan bug"

# Dengan force update
node scripts/publish-apk.mjs \
  --apk=/path/to/app.apk \
  --version=2.0.0 \
  --force-update \
  --min-version=1.0.0
```

### Penyimpanan

```
backend/
├── apks/               # File APK
│   ├── app-1.0.0.apk
│   └── app-1.0.1.apk
└── metadata/
    └── versions.json   # Metadata versi
```

### Dokumentasi Lengkap

Lihat `UPDATE-SYSTEM-ARCHITECTURE.md` untuk detail arsitektur lengkap.
