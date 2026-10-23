# Project Guidelines - Trip Angkutan

## Arsitektur Sistem (MUTLAK)

### Port Operasional
- **Port 5173**: Mobile App (aplikasi petugas lapangan)
- **Port 8000**: Admin Dashboard (HARUS serve dari direktori `admin-www/`)
- **Port 3000**: API INTRANET (server lokal di PC kantor, opsional)

### Backend - DUAL ENDPOINT
Aplikasi mobile punya **dua pilihan endpoint**, dipilih petugas lewat
"Pengaturan Server" (halaman Profil / Login):

| Endpoint | URL | Kapan dipakai |
|----------|-----|---------------|
| Supabase (cloud) | `https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api` | Default, butuh internet |
| Intranet Kantor (LAN) | `http://192.168.1.123:3000/api` | Di kantor, tanpa internet |

- **Kode API-nya SAMA**. `supabase/functions/api/index.ts` sekarang mengekspor
  `handleRequest`, lalu:
  - Cloud  : Edge Runtime memanggil `Deno.serve(handleRequest)`
  - Intranet: `supabase/functions/api/local_server.ts` memanggil `Deno.serve` dengan
    handler yang sama, di port 3000.
- **Database tetap Supabase PostgreSQL** (cloud). Yang lokal hanya HTTP server-nya.
- **`JWT_SECRET` intranet HARUS sama** dengan secret di Supabase, kalau tidak
  token yang issued cloud tidak valid di intranet (muncul "session expired").
- Router menampilkan label `Supabase` / `Intranet` di Profil > Server / Endpoint.
- Admin dashboard tetap memakai Supabase cloud.

File terkait:
- `src/services/api.ts` - `apiBaseCandidates()`, `isIntranetBaseUrl()`, `setApiBaseUrlOverride()`
- `src/environments/environment.ts` - `intranetApiBaseUrl`
- `src/components/ServerSettingsModal.tsx` - UI pilihan endpoint
- `supabase/functions/api/local_server.ts` - server intranet (Deno)
- `Dockerfile.backend` - image Deno untuk service `api-intranet`

### Setup server intranet (PC kantor)
```bash
cp supabase/functions/api/.env.example supabase/functions/api/.env.local
# isi SUPABASE_SERVICE_ROLE_KEY + JWT_SECRET (WAJIB, jangan di-commit)
```

### Restart semua layanan (PC kantor)
```bash
./restart-all-ubuntu.sh
```
Script ini: pull kode -> build image web + image API -> `docker compose up -d`
-> health check port 8000/5173/3000 -> cetak URL lokal + LAN.
Script sengaja TIDAK memakai `set -e`: satu langkah gagal tidak boleh
menghentikan langkah lain.

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
5. **Server intranet gagal start**: `Could not find a matching package for 'npm:bcryptjs@2.4.3'`
   -> Deno ikut membaca package.json repo. Wajib jalankan dengan `--node-modules-dir=none`
   (sudah dipakai di `Dockerfile.backend`).
6. **Petugas logout terus-menerus setelah ganti endpoint**: `JWT_SECRET` intranet
   beda dengan yang di Supabase.
7. **`docker compose up` gagal**: `supabase/functions/api/.env.local` belum ada
   -> `restart-all-ubuntu.sh` membuatnya otomatis dari `.env.example`.
