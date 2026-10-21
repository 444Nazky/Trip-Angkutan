# Dokumentasi Proyek Trip Angkutan

## Catatan Penting - Build & Deploy

### Port Operasional

| Port | Aplikasi | Direktori Serve |
|------|----------|-----------------|
| **5173** | Mobile App | - |
| **8000** | Admin Dashboard | `admin-www/` |

**PERINGATAN**: Port 8000 HARUS serve dari direktori `admin-www/`. Direktori `www/` berisi aplikasi mobile.

---

### Build & Deploy (Tanpa Docker)

```bash
# 1. Build
npm run build

# 2. Setup admin-www (struktur BENAR)
rm -rf admin-www
mkdir -p admin-www/assets/js admin-www/assets/css admin-www/Assets
cp www/admin/index.html admin-www/
cp -r www/assets/* admin-www/assets/
cp www/assets/karyamasv.svg admin-www/Assets/
cp www/3rdpartylicenses.txt admin-www/
cp www/sw.js admin-www/

# 3. Restart server
pkill -f "php.*8000"
php -S 0.0.0.0:8000 -t admin-www > admin.log 2>&1 &
```

### Deploy Backend (Supabase)

```bash
supabase functions deploy api --project-ref bmiruktfruunegtbydyw
```

---

## Arsitektur Aplikasi

### Backend
- **REST API**: 100% Supabase Edge Functions
- **URL**: `https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api`
- **Database**: Supabase PostgreSQL
- **Storage**: Supabase Storage buckets

---

## Struktur Direktori

```
Aplikasi-Trip-Main Branch/
├── src/                          # Kode sumber utama
│   ├── pages/
│   │   ├── admin/
│   │   │   ├── AdminDashboard.tsx  # Main admin entry
│   │   │   ├── ReportSheet.tsx      # Spreadsheet view
│   │   │   └── tabs/
│   │   │       ├── ReportsTab.tsx   # Tab Laporan
│   │   │       └── TariffTab.tsx   # Tab Master Tarif
│   │   └── mobile/
│   └── services/
│       ├── trips.ts              # Trip services & types
│       └── tariffs.ts           # Tariff services & types
├── www/                          # Build output mobile
├── admin-www/                    # Build output admin (serve ke port 8000)
└── supabase/functions/api/       # Backend Edge Functions
```

---

## Tab Navigation (AdminDashboard.tsx)

```tsx
{tab === 'reports' && <ReportsTab />}     // Laporan
{tab === 'tariff' && <TariffTab />}       // Master Tarif
{tab === 'plates' && <PlatesTab />}       // Master Plat
{tab === 'routes' && <RoutesTab />}       // Master Rute
{tab === 'officers' && <OfficersTab />}   // Petugas
{tab === 'settings' && <SettingsTab />}   // Pengaturan
```

---

## CSS Variables

**JANGAN** gunakan CSS variable yang tidak terdefinisi.

```tsx
// BENAR
<div style={{ background: '#3B82F6' }}>
<div className="bg-blue-500">

// SALAH - var(--admin-accent) TIDAK terdefinisi
<div style={{ background: 'var(--admin-accent)' }}>
```

---

## Troubleshooting

| Gejala | Solusi |
|--------|--------|
| Halaman blank | Copy assets ke admin-www |
| Logo tidak muncul | Cek folder Assets/ |
| Login page di admin | Serve dari admin-www |
| Grafik tidak tampil | Gunakan warna hardcoded |
| Perubahan tidak muncul | Ctrl+Shift+R |

---

## Perubahan Terbaru (21 Okt 2024)

### Admin Dashboard
- Tab default "Laporan" (bukan "Dashboard")
- Navigasi sidebar: Laporan, Master Tarif, Master Plat, Master Rute, Petugas, Pengaturan
- Grafik Komposisi Muatan menggunakan warna hardcoded `#3B82F6`
- Auto-login admin tanpa halaman login

### API Backend
- Kalkulasi tarif otomatis dari Master Tarif
- Report endpoint menghitung ulang `tariff_amount` yang 0/null

---

## Checklist Deploy

- [ ] `npm run build`
- [ ] Setup admin-www dengan struktur BENAR
- [ ] `supabase functions deploy api`
- [ ] Test: Ctrl+Shift+R di browser
