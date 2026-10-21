# Dokumentasi Proyek Trip Angkutan

## Catatan Penting - Build & Deploy

### Setiap Kali Build, Wajib Jalankan Perintah Ini:

```bash
# 1. Build web app
npm run build

# 2. Copy output ke folder admin
cp www/index.html www/admin/
cp -r www/assets www/admin/

# 3. Restart server PHP
pkill -f "php.*8000"
php -S 0.0.0.0:8000 -t www/admin > admin.log 2>&1 &
```

Tanpa langkah 2, admin dashboard tidak memiliki assets terbaru (logo, CSS, JS).

---

## Arsitektur Aplikasi

### Dua Aplikasi Terpisah

Aplikasi ini terdiri dari **dua frontend berbeda** yang menggunakan backend Supabase yang sama:

| Aplikasi | Port | URL Akses | Deskripsi |
|----------|------|------------|-----------|
| Mobile App | 5173 | `http://localhost:5173` | Aplikasi petugas lapangan (login dengan ID + PIN) |
| Admin Dashboard | 8000 | `http://localhost:8000` | Dashboard admin (auto-login, tanpa input kredensial) |

### Backend

- **Supabase Edge Functions**: `https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api`
- Database: Supabase PostgreSQL
- Storage: Supabase Storage buckets (`apks`, `ota`)

---

## Struktur Direktori

```
Aplikasi-Trip-Main Branch/
├── src/                          # Kode sumber utama (React/Angular)
│   ├── pages/
│   │   ├── LoginPage.tsx         # Halaman login PETUGAS (mobile)
│   │   └── admin/
│   │       ├── AdminDashboard.tsx # Dashboard ADMIN
│   │       ├── AdminLoginPage.tsx # Halaman login admin (tidak digunakan - auto-login)
│   │       └── tabs/             # Tab-tab dashboard admin
│   │           ├── OfficersTab.tsx  # Manajemen petugas
│   │           ├── ReportsTab.tsx   # Laporan & foto dokumentasi
│   │           └── ...
│   └── services/                  # Service API, auth, sync, geofence, dll
├── www/                          # Build output (static files)
│   └── admin/                    # Folder untuk Admin Dashboard
│       ├── index.html            # Entry point admin (auto-redirect ke ?admin=true)
│       └── assets/               # Static assets
├── supabase/
│   ├── functions/api/            # Edge Functions
│   │   ├── _shared.ts           # Shared utilities (JWT, db client)
│   │   ├── index.ts             # Main router
│   │   └── handlers/            # Endpoint handlers
│   │       ├── auth.ts          # Login, logout
│   │       ├── officers.ts      # CRUD petugas
│   │       ├── geofences.ts     # CRUD geofence
│   │       └── ...
│   └── config.toml              # Edge Function config (verify_jwt=false)
└── android/                      # Capacitor project untuk APK
    └── app/build/outputs/apk/release/  # APK release
```

---

## Kredensial Login

### Petugas
- **Username**: ID Petugas (dari database)
- **Password**: PIN (6 digit, default: `123456`)

### Admin
- **Auto-login**: Tidak perlu input - langsung masuk ke dashboard
- **Kredensial tersimpan** di `localStorage.trip.admin`

---

## API Endpoints

### Auth
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/auth/login` | Login petugas (ID + PIN) |
| POST | `/auth/admin-login` | Login admin |
| POST | `/auth/refresh` | Refresh token |
| POST | `/auth/select-dermaga` | Pilih dermaga aktif |

### Officers
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/officers` | List semua petugas (admin) |
| GET | `/officers/my-region` | List petugas se-wilayah |
| POST | `/officers` | Tambah petugas |
| PUT | `/officers/:id/regions` | Update region petugas |
| PUT | `/officers/:id/dermagas` | Update akses dermaga |
| PUT | `/officers/:id/pin` | Update PIN |
| PUT | `/officers/:id/status` | Aktif/nonaktif |

### Geofences
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/geofences` | List geofence |
| POST | `/geofences` | Tambah geofence |
| PUT | `/geofences/:id` | Update geofence |
| DELETE | `/geofences/:id` | Hapus geofence |

### Trips
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/trips` | List trips |
| POST | `/trips` | Buat trip baru |
| POST | `/trips/complete` | Selesaikan trip |

### App/OTA
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/app-version?current=X.X.X` | Cek update APK |
| GET | `/ota-manifest` | Cek update modul web |
| GET | `/app-download/:versi` | Download APK |
| POST | `/report-version` | Laporkan versi APK terinstall |

---

## Database Tables

### officers
Kolom utama: `id`, `name`, `username`, `pin`, `region_id`, `is_active`

### officer_dermagas
Relasi many-to-many antara `officers` dan `dermagas`

### officer_regions
Relasi many-to-many antara `officers` dan `regions`

### geofences
Kolom utama: `id`, `name`, `latitude`, `longitude`, `radius_meters`, `allowed_route_codes`, `dermaga_id`, `enabled`

### app_versions
Tabel untuk versioning APK

### ota_bundles
Tabel untuk versioning modul web

---

## Fitur Utama

### 1. Login & Auth
- Petugas login dengan ID + PIN
- Admin auto-login saat akses dashboard
- Token JWT HS256 dengan TTL 90 hari

### 2. Sinkronisasi Offline
- Data tersimpan di IndexedDB (mobile)
- Sync otomatis saat online
- Fallback offline

### 3. Geofencing
- Titik geofence per dermaga
- Validasi lokasi GPS petugas
- Allowed routes per titik

### 4. OTA Update
- Update APK via `/app-download/:versi`
- Update modul web via `/ota-manifest`
- Version reporting

### 5. Laporan
- Report sheet dengan foto dokumentasi
- Filter tanggal, golongan, jenis kendaraan
- Export Excel

---

## Common Issues & Solutions

### 1. Admin Dashboard Blank / Assets Lama
**Penyebab**: Assets (logo, CSS, JS) belum di-copy ke folder admin setelah build
**Solusi**: Jalankan script deploy atau manual:
```bash
cp www/index.html www/admin/
cp -r www/assets www/admin/
```

### 2. Logo Tidak Muncul / Favicon Salah
**Penyebab**: Path reference salah (case-sensitive: `/Assets/` vs `/assets/`)
**Solusi**: Gunakan path lowercase: `/assets/karyamasv.svg`

### 3. Modal Foto Tidak Muncul di Tengah Viewport
**Penyebab**: PhotoViewer.tsx merender di dalam scroll container
**Solusi**: Gunakan React Portal ke document.body

### 4. Login Gagal (401)
**Penyebab**: Edge Function belum di-deploy atau verify_jwt=true
**Solusi**: Deploy Edge Functions dengan config `verify_jwt=false`

### 5. PIN Tidak Cocok
**Penyebab**: Hash PIN tidak cocok antara DB dan client
**Solusi**: Reset PIN di database dengan bcrypt hash "123456"

---

## Deployment Checklist

### Backend (Supabase)
- [ ] Edge Functions deployed: `supabase functions deploy api`
- [ ] Secrets set: `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- [ ] Table `app_versions` ada dan terisi
- [ ] Table `ota_bundles` ada
- [ ] Table `geofences` ada dan terisi data

### Frontend
- [ ] Build: `npm run build`
- [ ] Copy assets: `cp www/index.html www/admin/ && cp -r www/assets www/admin/`
- [ ] Restart server PHP
- [ ] Build APK: `./gradlew assembleRelease`
- [ ] Copy APK ke root project

### Mobile App
- [ ] Update API URL jika perlu
- [ ] Build release APK
- [ ] Test login petugas

### Admin Dashboard
- [ ] Test auto-login
- [ ] Test semua tab berfungsi
- [ ] Test scroll pada data panjang
- [ ] Test foto viewer centered dengan benar

---

## Icon & Assets

### Logo Aplikasi
- File: `/assets/karyamasv.svg` (lowercase)
- Digunakan di: Login page, sidebar admin

### Favicon
- File: `/assets/icon/favicon.png`
- Format: PNG

### Assets Path (PENTING: Case-Sensitive!)
- Path: SELALU gunakan `/assets/` (lowercase)
- JANGAN gunakan `/Assets/` (huruf besar akan 404 di server PHP

### Build Checklist
```bash
# Setiap kali build Angular:
npm run build

# Copy output:
cp www/index.html www/admin/
cp -r www/assets www/admin/

# Restart server:
pkill -f "php.*8000"
php -S 0.0.0.0:8000 -t www/admin &
```

---

## Troubleshooting

### Cek Edge Function Logs
```bash
supabase functions logs api --project-ref bmiruktfruunegtbydyw
```

### Cek Database Tables
```sql
SELECT * FROM officers LIMIT 5;
SELECT * FROM geofences LIMIT 5;
SELECT * FROM app_versions;
```

### Test API Langsung
```bash
# Health check
curl https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api/health

# Test login
curl -X POST https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"officerId":"<ID>","pin":"123456"}'
```

### Restart Admin Server
```bash
pkill -f "php -S 0.0.0.0:8000"
cd /path/to/project
php -S 0.0.0.0:8000 -t www/admin > admin.log 2>&1 &
```

---

## Perubahan Terbaru (20 Okt 2024)

### Admin Dashboard

| Fitur | Status |
|-------|--------|
| Tab default "Laporan" (bukan "Dashboard") | Aktif |
| Navigasi sidebar tanpa tab "Dashboard" | Aktif |
| Auto-login admin tanpa halaman login | Aktif |
| Modal foto fixed viewport (portal ke document.body) | Aktif |
| Scroll terkunci saat modal terbuka | Aktif |

### API Backend

| Fitur | Status |
|-------|--------|
| verify_jwt=false | Aktif |
| TTL token 90 hari | Aktif |
| PIN petugas reset ke 123456 | Aktif |
| app_versions + ota_bundles tables | Aktif |

### Assets & Paths

| Komponen | Path |
|----------|------|
| Logo SVG | /assets/karyamasv.svg |
| Favicon | /assets/icon/favicon.png |
| Assets static | /assets/ (lowercase!)

### Troubleshooting Cepat

| Gejala | Cek |
|---------|-----|
| Halaman blank / assets lama | Copy assets + restart PHP |
| Logo tidak muncul | Path case-sensitive |
| Modal di luar viewport | Portal ke document.body aktif |
| Login 401 | Edge Functions verify_jwt=false |
| Grafik/chart tidak tampil | Cek CSS variables (lihat bawah) |

---

## CSS Variables - PERHATIKAN!

### ATURAN PENTING
**JANGAN** gunakan CSS variable yang tidak terdefinisi dalam inline styles.

### Contoh SALAH (menyebabkan grafik tidak tampil)
```tsx
// var(--admin-accent) TIDAK terdefinisi di mana pun!
// Ini akan membuat grafik terlihat seperti background solid
style={{ background: `conic-gradient(var(--admin-accent) ...)` }}
```

### Contoh BENAR
```tsx
// Gunakan warna hardcoded
style={{ background: `conic-gradient(#3B82F6 ...)` }}

// Atau gunakan Tailwind class
className="bg-blue-500"
```

### Warna Aman untuk Inline Styles
- Biru: `#3B82F6` (blue-500)
- Hijau: `#10B981` (green-500)
- Merah: `#EF4444` (red-500)
- Abu-abu: `#CBD5E1` (slate-300), `#94A3B8` (slate-400)

---

## Checklist Sebelum Deploy

- [ ] Run `npx tsc --noEmit --skipLibCheck` - tidak ada error
- [ ] Cek semua CSS variable dalam inline styles terdefinisi
- [ ] Build: `npm run build`
- [ ] Copy: `cp -r www/* /path/to/admin-www/`
- [ ] Deploy backend: `supabase functions deploy api --project-ref bmiruktfruunegtbydyw`
- [ ] Test di browser (clear cache jika perlu)
