# AI Rules - Trip Angkutan

## Arsitektur Sistem (MUTLAK)

### Port Operasional
| Port | Aplikasi | Deskripsi |
|------|----------|-----------|
| **5173** | Mobile App | Aplikasi petugas lapangan (login dengan ID + PIN) |
| **8000** | Admin Dashboard | Dashboard admin (auto-login, tanpa input kredensial) |
| **3000** | API | Server API lokal di PC kantor |

**PERINGATAN KRITIS**: Port 8000 HARUS serving dari direktori `admin-www/`, BUKAN direktori root www/. Direktori www/ berisi aplikasi mobile, bukan admin dashboard.

### Backend - Sepenuhnya Lokal
- **REST API**: server API Deno di `server/api/` (`index.ts` = router, `local_server.ts` = entry point)
- **URL**: `http://192.168.1.123:3000/api` (PC kantor, port 3000)
- **Database**: PostgreSQL lokal (container `db`) lewat PostgREST (container `rest`)
- **Storage**: berkas di disk server, disajikan sebagai `/files/<bucket>/<path>` (bucket `trip-photos`, `apks`, `ota`)
- Tidak ada backend luar (Supabase/Railway), tidak ada kredensial cloud, tidak ada panggilan keluar internet

Router, rate limit, cache, dan CORS semuanya di `server/api/index.ts`.

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
├── www/                          # Build output (mobile)
├── admin-www/                   # Build output (admin) - serve dengan PHP
└── server/api/                  # Backend (server API Deno)
    ├── index.ts                 # Router + CORS + rate limit
    ├── local_server.ts          # Entry point (port 3000)
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
# 1. Build
npm run build

# 2. Setup admin-www (struktur yang BENAR)
rm -rf admin-www
mkdir -p admin-www/assets/js admin-www/assets/css admin-www/Assets
cp www/admin/index.html admin-www/
cp -r www/assets/* admin-www/assets/
cp www/3rdpartylicenses.txt admin-www/
cp www/sw.js admin-www/

# 3. Pastikan folder Assets ada untuk logo SVG
cp www/assets/karyamasv.svg admin-www/Assets/

# 4. Serve
php -S 0.0.0.0:8000 -t admin-www
```

### Backend (lokal)

```bash
docker compose build api-intranet web && docker compose up -d
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

### 3. Admin Dashboard Tidak Auto-Login
**Penyebab**: HTML yang di-serve adalah versi mobile (port 8000 serving direktori yang salah)
**Solusi**: Pastikan port 8000 serving dari `admin-www/`, bukan `www/`

### 4. Assets (JS/CSS/Logo) Tidak Terbaca
**Penyebab**: Struktur direktori admin-www tidak lengkap
**Solusi**: Copy SEMUA assets dari `www/` ke `admin-www/assets/` termasuk folder Assets/

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
| Login page muncul di admin | Pastikan serve dari admin-www |
| Grafik tidak tampil | Cek CSS variables, gunakan hardcoded |
| TypeScript error | `npx tsc --noEmit --skipLibCheck` |
| API error | Cek log container: `docker compose logs -f api-intranet` |
