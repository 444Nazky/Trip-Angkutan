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
Alternatif tanpa edit file: taruh dua secret itu di
`supabase/functions/api/.env.secrets` (chmod 600) - `restart-all-ubuntu.sh`
membacanya otomatis. `JWT_SECRET` harus **identik** dengan yang dipakai
Supabase Edge Function.

### Restart semua layanan (PC kantor)
```bash
./restart-all-ubuntu.sh
```
Script ini: pull kode -> build image web + build image API -> bersihkan
container lama -> `docker compose up -d` -> health check port 8000/5173/3000
-> cetak URL lokal + LAN.
Script sengaja TIDAK memakai `set -e`: satu langkah gagal tidak boleh
menghentikan langkah lain.

### TOPOLOGI: DUA MESIN BERBEDA (penting!)

Di LAN kantor ada **dua** mesin Ubuntu yang sama-sama menjalankan repo ini.
Jangan sampai tertukar:

| Mesin | IP | Peran | Port |
|-------|----|-------|------|
| `ubuntu.local` | `192.168.1.123` | **SERVER PUSAT KANTOR** - kabel LAN ke router Linksys `192.168.1.1`, port forwarding 8000/5173/3000. Preset "Intranet Kantor" di aplikasi mengarah ke sini. | 8000, 5173, 3000 |
| `blackarch` | `192.168.1.2` (+ `192.168.100.10`) | Host 개발 / build (repo coord + checkout deploy). | 8000, 5173, 3000 |

- Preset aplikasi `http://192.168.1.123:3000/api` -> **harus** hidup di
  `ubuntu.local`, bukan di `blackarch`.
- `192.168.1.123` **sudah dipakai mesin lain** -> jangan pernah menambah
  alias IP `.123` di `blackarch` (duplikat IP -> ARP konflik, `.123` jadi
  tidak bisa dijangkau).
- `ubuntu.local` tidak membuka SSH (port 22 tertutup) -> deploy ke sana
  harus dijalankan **orang yang berada di depan mesin itu**. Lihat
  `docs/DEPLOY-UBUNTU-LOCAL.md`.
- Di `blackarch`, alamat `192.168.1.2` dibuat manual; sekarang sudah
  disimpan permanen di profil NM `LAN-Direct`
  (`ipv4.addresses "192.168.100.10/24,192.168.1.2/24"`, gateway TIDAK diubah
  supaya default route tetap lewat wlan0).
- `scripts/setup-static-ip-eno1.sh` **TIDAK** bisa dipakai apa adanya di
  `blackarch`: default `DEV=eno1` (iface sebenarnya `enp12s0`) dan profil
  `netplan-${DEV}` (profil NM asli bernama `LAN-Direct`). Pakai
  `DEV=enp12s0 CONN=LAN-Direct` kalau memang perlu.


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
8. **Build image API gagal: `COPY failed: no such file`** -> `.dockerignore` dulu
   mengecualikan seluruh folder `supabase`, jadi kode Edge Function tidak ikut
   ke build context. Sekarang `.dockerignore` mengecualikan `supabase/*` tapi
   tetap membiarkan `supabase/functions/api/**` masuk - DAN tetap mengecualikan
   `supabase/functions/api/.env.local` supaya secret tidak pernah masuk image.
9. **Cache dependency kosong di image**: `deno cache` TIDAK menerima flag izin
   (`--allow-net` dkk). Kalau diberi, perintah gagal diam-diam (`|| true`) dan
   cache tetap kosong -> server baru bisa start setelah mengunduh dari internet.
   Perintah yang benar: `deno cache --node-modules-dir=none api/local_server.ts`.
10. **Bundel OTA gagal diunduh setelah petugas pilih endpoint intranet**:
    URL storage (`/storage/v1/object/public/ota/...`) SELALU milik host Supabase
    cloud. Kalau origin-nya ikut `api.baseUrl` yang aktif, unduhan diarahkan ke
    port 3000 yang tidak melayani `/storage` -> 404. Pakai
    `supabaseProjectOrigin()` (src/services/api.ts) untuk URL storage.
11. **Banner "LAN:" di log server intranet kosong**: `Deno.networkInterfaces()`
    butuh izin `--allow-sys`. Tanpa itu fungsinya melempar "Requires sys access
    to networkInterfaces" yang Tertangkap try/catch -> daftar IP kosong tanpa
    error yang mencolok. Catatan: `deno eval` memberi izin otomatis, jadi
    tes dengan `deno eval` TIDAK bisairms hal ini - harus `deno run`.
12. **`docker compose up` gagal "container name is already in use"**:
    container `trip-web` milik project compose LAIN (checkout lama) masih
    hidup. `restart-all-ubuntu.sh` sudah membersihkan container `trip-web` /
    `trip-api` sebelum `up` supaya restart selalu idempotent.
13. **Server intranet crash-loop**: `JWT_SECRET` kosong tidak lagi mematikan
    server (cuma warning), tapi `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
    kosong tetap bikin container exit. Compose pakai `restart: on-failure:5`
    supaya container terlihat "Exited (1)", bukan spam restart terus.
14. **Data tidak terkirim dari aplikasi native (gejala "mixed content")**:
   aplikasi native (Capacitor/Android WebView) memuat halaman dari origin
   LOKAL `https://localhost`. `validateEndpointInput()` (src/services/api.ts)
   DULU menolak `http://192.168.1.123:3000` begitu protokol halaman `https:`,
   jadi UI memaksa pindah ke Supabase - dan saat seluler dimatikan tidak ada
   internet -> antrean offline tidak bisa dikirim. Aturan sekarang: mixed
   content hanya berlaku untuk halaman https yang dibuka di BROWSER;
   aplikasi native (`isNativeApp()`) dan loopback exempt.
   WebView juga harus mengizinkan cleartext:
   `android.allowMixedContent: true` di `capacitor.config.ts` DAN di
   `android/app/src/main/assets/capacitor.config.json` (file inilah yang
   dibaca runtime - `npx cap copy` menulis ulang isinya).
   `res/xml/network_security_config.xml` tetap `cleartextTrafficPermitted`.
15. **`CORS_ORIGIN` mematikan aplikasi native**: origin `https://localhost`
   (WebView) tidak ada di daftar browser biasa, jadi server membalas 403
   "Origin tidak diizinkan" dan TIDAK ADA data yang bisa dikirim. Origin
   native (`https://localhost`, `capacitor://localhost`, `http://localhost`,
   `https://127.0.0.1`) sekarang SELALU diizinkan di `withCors()`
   (supabase/functions/api/index.ts).
16. **HTTPS untuk server intranet (opsional)**: set `TLS_CERT_FILE` +
   `TLS_KEY_FILE` (lihat `supabase/functions/api/.env.example`) supaya
   `local_server.ts` serves HTTPS di port 3000. Sertifikat self-signed harus
   diinstall di perangkat petugas. Kandidat endpoint-nya muncul otomatis
   kalau `intranetHttpsApiBaseUrl` diisi di `src/environments/environment.ts`.
17. **Deno memblokir baca `/proc`**: `Deno.readTextFile("/proc/meminfo")` dan
   `Deno.open("/proc/stat")` gagal dengan "Requires all access to ..." ->
   hanya boleh kalau server jalan dengan `--allow-all`. Server intranet TIDAK
   memakai `--allow-all`, jadi `server/api/_system.ts` membaca /proc lewat
   subprocess `cat` (fallback otomatis), dan kapasitas disk lewat `df`.
   Konsekuensi: `Dockerfile.backend` wajib punya `--allow-run=cat` dan
   `--allow-run=df`. Tanpa itu, panel "Kondisi Hardware Server" di dashboard
   admin tampil nol (bukan error). Catatan: `deno eval` memberi izin penuh
   otomatis, jadi tes dengan `deno eval` TIDAK bisa mendeteksi masalah izin
   ini - harus `deno run` / `deno test`.
18. **Grafik request per menit kosong**: `server/api/_metrics.ts` dulu hanya
   mengirim bucket menit yang ADA request-nya, jadi deretnya bolong-bolong
   dan grafik di dashboard terlihat kosong. Sekarang `snapshot()` selalu
   mengirim 60 bucket kontinu (lama -> baru, jarak tepat 1 menit, menit sepi
   diisi 0). Kalau grafik masih kosong, cek `metrics.buckets` dari
   `/api/server-stats`, bukan UI.

---

## Statistik Server (dashboard admin)

- Endpoint: `GET /api/server-stats` di server intranet port 3000 (butuh role
  admin). Isinya: `metrics` (proses Deno: request, success rate, latensi,
  bucket per menit, top path) + `system` (hardware: CPU, RAM, swap, storage,
  load average, uptime mesin) + `components` (status Supabase/DB/disk/BCrypt).
- Kolektor hardware: `server/api/_system.ts` (sumber `/proc/stat`,
  `/proc/cpuinfo`, `/proc/meminfo`, `/proc/loadavg`, `/proc/uptime`, `df -k`).
- UI: `src/pages/admin/components/ServerStatsPanel.tsx` (dipakai
  `src/pages/admin/tabs/SettingsTab.tsx`). Grafik request per menit digambar
  sebagai SVG kurva mulus + area gradien (gaya kripto), bukan diagram batang.
  Lebar SVG diukur pakai `ResizeObserver` (jsdom tidak punya itu, jadi ada
  fallback ke event `resize`).
- Rebuild WAJIB setelah ubah backend: `docker compose build api-intranet web &&
  docker compose up -d` (perubahan izin `--allow-run` ada di
  `Dockerfile.backend`).
- Uji: `deno test --allow-env --allow-read --allow-sys --allow-run=df
  --allow-run=cat server/api/metrics.test.ts`.

---

## Design Token Admin Dashboard

- Sumber tunggal: `src/pages/admin/theme.ts`. Semua halaman admin (tab
  Laporan, Master Tarif, Master Plat, Master Rute, Master Region, Petugas,
  Endpoint, plus sheet Laporan & Rekap) memakai token dari file ini.
- **Pengecualian**: tab "Pengaturan" (`SettingsTab` + `ServerStatsPanel`)
  tetap memakai tema terminal gelap - jangan di-token-kan ke `theme.ts`.
- Token penting: `PAGE`, `PAGE_TITLE`, `PAGE_SUBTITLE`, `CARD`, `TABLE_WRAP`,
  `TABLE_HEAD_ROW`, `TABLE_CELL`, `BTN_PRIMARY`, `BTN_SECONDARY`, `INPUT`,
  `LABEL`, `BADGE*`, `DOT*`, `PILL*`, `GROUP_ROW`, `FOOT_ROW`, `SHEET_BODY`,
  `SHEET_HEADER`, `STAT_LABEL`, `STAT_VALUE`, `TOAST*`.
- Palet: aksen biru (`blue-600`), status emerald / amber / red / slate,
  permukaan putih di atas `slate-50`, garis `slate-200`. Warna lain
  (mis. `violet-600`) dilarang di halaman admin.
- Gotcha: saat menulis ulang `className="..."` menjadi
  `` className={`${TOKEN} ...`} ``, closing `}` WAJIB ada. Kalau hilang,
  JSX-nya tidak parse ("Expected "}" but found "."") dan pesan errornya menunjuk baris
  yang benar secara misleading.
- Setel selesai: `npm run build` lalu salin bundle ke `admin-www/` sesuai
  struktur di CLAUDE.md root (hash file berubah -> file lama harus dihapus).

---

## Catatan Tambahan - Endpoint Ganti Saat Runtime

- `api.baseUrl` (src/services/api.ts) **live**, bukan konstanta modul. Ganti
  endpoint langsung berlaku tanpa reload aplikasi.
- `setApiBaseUrlOverride()` tidak reload halaman lagi.
- Antrean data offline (IndexedDB) tetap aman: yang dikirim ke server aktif.
- Bundel OTA & file APK tetap di Supabase Storage (butuh internet). Endpoint
  intranet mengurangi ketergantungan internet untuk operasi harian, bukan
  menghilangkan sama sekali.
- `restart-all-ubuntu.sh` memakai `set -uo pipefail` (bukan `-e`): build admin
  yang gagal tidak boleh mematikan mobile + API intranet.
