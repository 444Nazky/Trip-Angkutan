# System-Design.md

## 1. System Overview
Trip Angkutan adalah sistem manajemen angkutan yang terdiri dari:
- Aplikasi mobile (Ionic + React) untuk petugas lapangan
- Dashboard admin tertanam di codebase yang sama (`src/pages/admin/`)
- API sebagai server Deno lokal tunggal (`server/api/`)
- Database PostgreSQL lokal + PostgREST, storage berkas di disk server

## 2. Component Breakdown

### 2.1 Mobile Application (Ionic + React)
- **Frontend**: React dengan Tailwind CSS
- **Features**:
  - Authentication (JWT, TTL 90 hari)
  - Trip creation workflow (rute ganda: kedua rute tampil, nonaktif di-lock sesuai titik GPS/geofence)
  - Vehicle input (2-step process)
  - Camera capture for documentation
  - Offline-first architecture with sync queue
  - Update aplikasi mandiri (APK/OTA lewat storage lokal server, `/files/<bucket>/<path>`)

### 2.2 Backend API (server Deno lokal)
- **Endpoint Structure**: RESTful API dengan JWT custom (HS256, TTL 90 hari)
- **Deploy**: `docker compose build api-intranet && docker compose up -d`
- **Endpoint**:
  - `/auth/*` - Authentication management (admin-login, member-login)
  - `/trips/*` - Trip management
  - `/plates` - Plate registration and verification
  - `/region-tariffs` - Tariff configuration
  - `/reports/*` - Reporting and analytics
  - `/app-version`, `/app-download/:version`, `/apk-list` - Distribusi APK
  - `/ota-manifest`, `/ota-versions` - OTA bundel modul

### 2.3 Admin Dashboard (embedded)
- **Tertanam**: `src/pages/admin/` di codebase yang sama, login mode admin
- **Features**:
  - Tariff management (master + region-specific)
  - Officer management (many-to-many regions)
  - Plate registration and verification
  - Report generation and export
  - Theme and settings configuration

## 3. Data Flow

### 3.1 Normal Operation
1. Officer logs in → receives JWT token
2. Officer creates trip → data stored locally → added to sync queue
3. Officer completes vehicle input → data saved locally
4. Officer submits trip → `POST /trips` with JWT
5. Edge function processes trip → saves to Postgres → responds 201
6. Sync queue processes pending trips when online

### 3.2 Offline Operation
1. Officer creates trip → saved to localStorage
2. UI shows "Terputus (Offline mode)"
3. Sync queue maintains pending operations
4. When connection restored → auto-sync ke edge function

## 4. Authentication
1. Officer buka app → cek JWT valid di localStorage
2. Jika tidak ada → login screen
3. Officer masuk kredensial → `POST /auth/member-login`
4. Server validasi (bcrypt PIN) → return JWT + officer data
5. Token disimpan di localStorage dan API client
6. Semua request include `Authorization: Bearer <token>`
7. TTL token 90 hari

## 5. Authorization
- **JWT**: HS256 algorithm
- **Claims**: `officerId`, `regionId`, `role` (admin/officer)
- **Roles**:
  - `admin`: full access to all endpoints
  - `officer`: limited to own region and trips
- **Data officers**: kolom `pin` (bcrypt hash); `pin_hash` hanya nama field kontrak API client

## 6. Database Tables
- `regions`: Region codes (BADAU, SJRE, SBDZ, ENTIKONG)
- `officers`: Field officers dengan kolom pin bcrypt
- `officer_regions`: Many-to-many officer-region relationship
- `tariffs`: Master tariffs by vehicle type and load status
- `region_tariffs`: Region-specific tariff configuration
- `vehicle_plates`: Plate registration with status (internal/lokal/eksternal)
- `trips`: Trip records with route and status
- `vehicles`: Vehicle records linked to trips
- `trip_vehicles`: Junction table for trip-vehicle relationship

## 7. Deployment
- **Development**:
  - Aplikasi + admin: `npm run dev` (port 8000, LAN privat kantor)
- **Production**:
  - API: container `api-intranet` (Deno, port 3000), auth di handler
  - Mobile: Build → Capacitor sync → APK di storage lokal server (bucket `apks`)
