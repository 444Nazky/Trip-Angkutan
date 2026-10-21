# Project Guidelines - Trip Angkutan

## Arsitektur Sistem (MUTLAK)

### Port Operasional
- **Port 5173**: Mobile App (aplikasi petugas lapangan)
- **Port 8000**: Admin Dashboard (HARUS serve dari direktori `admin-www/`)

### Backend
- **REST API**: 100% Supabase Edge Functions
- **URL**: `https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api`
- **TIDAK ADA port tambahan untuk backend**

---

## CSS Variables - ATURAN KRITIS

### JANGAN GUNAKAN CSS VARIABLES YANG TIDAK TERDEFINISI

**Contoh BENAR**:
```tsx
<div style={{ background: '#3B82F6' }}>
<div className="bg-blue-500">
```

**Contoh SALAH (menyebabkan grafik tidak tampil)**:
```tsx
<div style={{ background: 'var(--admin-accent)' }}>
```

**Warna Aman**:
- Biru: `#3B82F6`
- Hijau: `#10B981`
- Merah: `#EF4444`

---

## Tab Navigation - AdminDashboard.tsx

**PENTING**: Pastikan setiap tab merender component yang BENAR.

```tsx
{tab === 'reports' && <ReportsTab />}      // Laporan, BUKAN TariffTab
{tab === 'tariff' && <TariffTab />}         // Master Tarif
```

**Kesalahan umum**: Duplikasi kondisi `tab === 'reports'` menyebabkan component salah dirender.

---

## Deployment

### Frontend
```bash
npm run build
# Copy ke admin-www dengan struktur BENAR:
rm -rf admin-www && mkdir -p admin-www/assets/js admin-www/assets/css admin-www/Assets
cp www/admin/index.html admin-www/
cp -r www/assets/* admin-www/assets/
cp www/assets/karyamasv.svg admin-www/Assets/
```

### Backend
```bash
supabase functions deploy api --project-ref bmiruktfruunegtbydyw
```

---

## graphify Usage
```bash
graphify query "<pertanyaan>"
graphify path "<A>" "<B>"
graphify explain "<konsep>"
graphify update .  # Setelah modifikasi code
```

---

## Checklist Sebelum Deploy
- [ ] Run `npx tsc --noEmit --skipLibCheck` - tidak ada error
- [ ] Cek semua CSS variable dalam inline styles
- [ ] Build: `npm run build`
- [ ] Setup admin-www dengan struktur BENAR
- [ ] Serve dari admin-www (BUKAN www)
- [ ] Test: Ctrl+Shift+R di browser

---

## Riwayat Masalah

1. **Grafik tidak tampil**: `var(--admin-accent)` tidak terdefinisi -> gunakan `#3B82F6`
2. **Tab Laporan salah**: Duplikasi kondisi di AdminDashboard.tsx
3. **Admin tidak auto-login**: Port 8000 serving direktori yang salah
4. **Assets tidak terbaca**: Struktur admin-www tidak lengkap
