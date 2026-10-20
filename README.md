# Trip Angkutan (Mobile + Admin)

Aplikasi Trip Angkutan: aplikasi mobile petugas lapangan (Ionic/Capacitor + React) dengan dashboard admin tertanam di codebase yang sama. Seluruh API berjalan sebagai Supabase Edge Functions, tanpa backend mandiri.

## Stack

| Bagian | Teknologi |
|--------|-----------|
| Frontend | React 19, Vite 7, TypeScript, Tailwind CSS, lucide-react, Ionic, Capacitor |
| Backend | Supabase Edge Functions (Deno) — satu function `api` |
| Database | Supabase Postgres + Storage (APK, foto bukti trip, OTA bundle) |
| Build | `vite build` → `www/` → Capacitor Android (APK di Supabase Storage) |

## Struktur

```
src/                    # Aplikasi (React + Ionic)
  pages/mobile/         # Layar petugas (login PIN, trip, riwayat, profil)
  pages/admin/          # Dashboard admin tertanam (overview, tarif, plat, petugas, laporan, pengaturan)
  services/             # Klien API (api.ts lock ke Supabase) + offline-first (sync, offlineDb)
supabase/
  functions/api/        # Edge Function "api" — seluruh endpoint
    handlers/           # auth, trips, tariffs, plates, routes, geofences, officers, reports, appVersion (OTA)
  migrations/           # Skema SQL
android/                # Capacitor Android (source project)
scripts/                # Rilis APK/OTA (publish-apk.mjs, publish-ota, sync-version.mjs)
```

## Menjalankan

```bash
npm install
npm run dev             # http://localhost:8000 (LAN privat kantor / cepat dev admin)
```

Login admin: `admin` / `admin123456` (dashboard admin tertanam). Petugas mobile: PIN 6 digit dari tabel `officers` (bcrypt, server-side verify).

Config Supabase (`src/environments/environment.ts`): project key `bmiruktfruunegtbydyw`, endpoint
`https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api`.

## Perintah

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` / `start` | Dev server Vite (HMR) |
| `npm run build` | Build produksi ke `www/` |
| `npm run lint` | ESLint untuk `src/**/*.{ts,tsx}` |
| `npx tsc --noEmit -p tsconfig.app.json` | Typecheck (tidak ada script `typecheck`) |
| `npx vitest run` | Unit test services |

## Deploy Backend

Deploy ulang edge function setelah perubahan di `supabase/functions/`:

```bash
npx supabase functions deploy api --project-ref bmiruktfruunegtbydyw --no-verify-jwt
```

`verify_jwt = false` di `supabase/config.toml` — autentikasi dilakukan oleh handler (`auth.ts` token JWT custom, TTL 90 hari).

## API

Endpoint di bawah `/functions/v1/api`, melalui header `Authorization: Bearer <token>`:

- `POST /auth/admin-login`, `POST /auth/member-login`, `PUT /auth/change-admin-password`
- `GET|POST /tariffs`, `PUT|DELETE /tariffs/:id`, `GET /region-tariffs`, `PUT /region-tariffs/:regionId`
- `GET|POST /plates`, `POST /plates/check`, `PUT|DELETE /plates/:id`
- `GET|POST /officers`, `GET /officers/my-region`, `PUT /officers/:id/{regions,dermagas,pin,status}`, `DELETE /officers/:id`
- `GET|POST /routes`, `PUT|DELETE /routes/:id`, `GET /dermagas`, `GET /regions`
- `GET|POST /geofences`, `PUT|DELETE /geofences/:id`, `GET /geofences/resolve-link?url=`
- `GET /reports/summary`, `GET /reports/trips`, `GET /reports/trips/filters`
- `GET /trips`, `POST /trips/complete`

Kode rute geofence berformat `ASAL-TUJUAN` (cth. `SJRE-SBDZ`).

## Update Aplikasi (APK + OTA)

Sistem update mandiri lewat Supabase Storage. Endpoint yang relevan di edge function:

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/app-version?current=` | GET | Cek versi APK terbaru |
| `/app-download/:version` | GET | Download file APK |
| `/apk-list` | GET | List semua versi APK |
| `/release-notes/:version` | GET | Catatan rilis versi |
| `/publish-version` | POST | Publish APK baru (admin) |
| `/ota-manifest` | GET | Manifest bundle OTA modul |

Publish APK baru:

```bash
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

Penyimpanan: bucket Supabase Storage `apks` (file APK) dan metadata versi di tabel Postgres.

## Dokumen Terkait

- `Structure.md` — struktur direktori dan alur layar.
- `System-Design.md` — arsitektur data + services.
- `UPDATE-SYSTEM-ARCHITECTURE.md` — detail sistem update/OTA.
