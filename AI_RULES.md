# AI Rules - Trip Angkutan

## Arsitektur Sistem (MUTLAK)

### Port Operasional
| Port | Aplikasi | Deskripsi |
|------|----------|-----------|
| **5173** | Mobile App | Aplikasi petugas lapangan (login dengan ID + PIN) |
| **8000** | Admin Dashboard | Dashboard admin (auto-login, tanpa input kredensial) |
| **3000** | API Intranet | Server API lokal di PC kantor (opsional, dual endpoint) |

**PERINGATAN KRITIS**: Build admin ada di `www/admin/` dan memakai aset bersama dari root `www/`. Jangan menyalin `www/admin/index.html` menimpa `www/index.html` (itu akan mengganti aplikasi mobile dengan dashboard). Saat menyajikan manual, buka URL `/admin/`.

### Backend - Dual Endpoint
- **REST API**: Supabase Edge Functions (kode identik untuk cloud dan intranet)
- **URL cloud**: `https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api`
- **URL intranet**: `http://192.168.1.123:3000/api` (PC kantor, port 3000)
- **Database**: Supabase PostgreSQL (dari kedua endpoint)
- **Storage**: berkas APK di storage server intranet (`/files/apks/`)
- Mobile memilih endpoint lewat "Pengaturan Server" (Profil / Login)
- Admin dashboard tetap memakai Supabase cloud

Router, rate limit, cache, dan CORS SAMA untuk keduanya - `index.ts` mengekspor
`handleRequest`, dipakai oleh Edge Runtime (cloud) dan `local_server.ts` (intranet).

**ATURAN**: unduhan APK memakai path relatif dari server update (`/app-download/...`
-> `/files/apks/...`). Pembaruan hanya lewat APK penuh.

`api.baseUrl` bersifat LIVE (bukan konstanta modul) supaya ganti endpoint
langsung berlaku tanpa reload aplikasi.

---

## Struktur Direktori

```
Aplikasi-Trip-Main Branch/
├── src/                          # Kode sumber utama
│   ├── pages/
│   │   ├── admin/                # Admin Dashboard components
│   │   │   ├── AdminDashboard.tsx  # Main admin entry
│   │   │   ├── ReportSheet.tsx    # Spreadsheet report view
│   │   │   └── tabs/              # Tab components
│   │   │       ├── ReportsTab.tsx  # Laporan tab
│   │   │       └── TariffTab.tsx   # Master Tarif tab
│   │   └── mobile/               # Mobile app
│   └── services/                # API services
│       ├── trips.ts              # Trip types & functions
│       └── tariffs.ts           # Tariff types & functions
├── www/                          # Build output: mobile (root) + admin (www/admin)
└── supabase/functions/api/       # Backend Edge Functions
    └── handlers/
        └── reports.ts            # Report API handler
```

---

## CSS Variables - ATURAN KRITIS

### JANGAN GUNAKAN CSS VARIABLES YANG TIDAK TERDEFINISI

**Masalah Umum**: Grafik/chart tidak tampil karena CSS variable `var(--admin-accent)` tidak terdefinisi.

**Solusi**: Selalu gunakan warna hardcoded atau Tailwind classes.

```tsx
// BENAR - warna hardcoded
<div style={{ background: '#3B82F6' }}>
<div className="bg-blue-500">

// SALAH - variable tidak terdefinisi
<div style={{ background: 'var(--admin-accent)' }}>
```

**Warna Aman untuk Inline Styles**:
- Biru: `#3B82F6` (blue-500)
- Hijau: `#10B981` (green-500)
- Merah: `#EF4444` (red-500)
- Abu-abu: `#CBD5E1` (slate-300), `#94A3B8` (slate-400)

---

## Tab Navigation - AdminDashboard.tsx

### Aturan Rendering Tab

**PENTING**: Setiap tab HARUS merender component yang BENAR.

```tsx
{tab === 'reports' && <ReportsTab />}      // Laporan
{tab === 'tariff' && <TariffTab />}        // Master Tarif
{tab === 'plates' && <PlatesTab />}         // Master Plat
{tab === 'routes' && <RoutesTab />}         // Master Rute
{tab === 'officers' && <OfficersTab />}     // Petugas
{tab === 'settings' && <SettingsTab />}    // Pengaturan
```

**KESALAHAN UMUM**: Tab `reports` salah render `TariffTab` karena duplikasi kondisi.

---

## Emoji & UI

- **JANGAN** gunakan emoji di UI
- Gunakan teks biasa atau ikon dari `lucide-react`
- Pemisah teks: gunakan `-` (strip), bukan `·` (titik tengah)

---

## Deployment Checklist

### Frontend (Admin Dashboard)

```bash
# 1. Build (menghasilkan www/ dan www/admin/index.html)
npm run build

# 2. Serve seluruh www supaya /assets/ dipakai bersama
php -S 0.0.0.0:8000 -t www

# 3. Buka dashboard di /admin/, mobile di /
#    Admin  : http://localhost:8000/admin/
#    Mobile : http://localhost:8000/

# Untuk produksi pakai Docker Compose (image menyalin www/admin ke root
# port 8000 dan www ke root port 5173):
docker compose build web
docker compose up -d web
```

### Backend (Supabase)

```bash
supabase functions deploy api --project-ref bmiruktfruunegtbydyw
```

---

## Riwayat Masalah & Solusi

### 1. Grafik Komposisi Muatan Tidak Tampil
**Penyebab**: CSS variable `var(--admin-accent)` tidak terdefinisi
**Solusi**: Gunakan warna hardcoded `#3B82F6`
**File**: `src/pages/admin/tabs/ReportsTab.tsx`

### 2. Tab Laporan Menampilkan Master Tarif
**Penyebab**: Duplikasi kondisi `tab === 'reports'` di `AdminDashboard.tsx`
**Solusi**: Pastikan hanya satu kondisi per tab, render component yang sesuai

### 3. Admin Dashboard Menampilkan Halaman Login Mobile
**Penyebab**: URL `/admin/` tidak dipakai sehingga yang dimuat `www/index.html` (mobile)
**Solusi**: Buka `http://host:8000/admin/`; pada Docker, pastikan image menyalin `www/admin` ke root admin

### 4. Assets (JS/CSS/Logo) Tidak Terbaca
**Penyebab**: `www/assets/` tidak ikut tersaji, padahal `www/admin/index.html` merujuk `/assets/...` dari root
**Solusi**: Sajikan seluruh direktori `www/` (bukan hanya `www/admin/`) dan pastikan `www/assets/` lengkap

### 5. Perubahan Frontend Tidak Muncul
**Penyebab**: Browser cache atau file JS tidak ter-update
**Solusi**: 
- Hard refresh: Ctrl+Shift+R
- Verifikasi: `curl http://localhost:8000/assets/js/main-*.js` harus 200

---

## Graphify Usage

```bash
# Query untuk pertanyaan codebase
graphify query "tariff report calculation"

# Path untuk relasi
graphify path "ReportTrip" "tariff_amount"

# Explain untuk konsep spesifik
graphify explain "trip revenue"

# Update graph setelah modifikasi
graphify update .
```

---

## Admin Dashboard Features

### Laporan Tab (ReportsTab)
- Tabel trip dengan filter tanggal, golongan, jenis kendaraan
- Grafik Komposisi Muatan (pie chart)
- Statistik: Total Trip, Muatan, Unit, Pendapatan
- Export ke Excel

### Master Tarif Tab (TariffTab)
- Konfigurasi tarif per golongan kendaraan
- Tarif muatan vs kosong

### Spreadsheet View (ReportSheet)
- View alternatif dalam format spreadsheet
- Refresh otomatis tiap 15 detik
- Sinkron langsung dari database

---

## API Endpoints

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/tariffs` | GET/POST/PUT/DELETE | Master tarif |
| `/trips` | GET | List trip |
| `/trips/complete` | POST | Complete trip dengan foto |
| `/reports/trips` | GET | Laporan trip |
| `/reports/summary` | GET | Summary statistics |
| `/officers` | GET/POST/PUT/DELETE | Manajemen petugas |

---

## Troubleshooting

| Gejala | Cek |
|--------|-----|
| Halaman blank | Copy assets + restart server |
| Logo tidak muncul | Path case-sensitive, cek folder Assets |
| Login page muncul di admin | Pastikan membuka `/admin/` (manual) atau root admin container |
| Grafik tidak tampil | Cek CSS variables, gunakan hardcoded |
| TypeScript error | `npx tsc --noEmit --skipLibCheck` |
| API error | Cek Supabase Edge Functions logs |
