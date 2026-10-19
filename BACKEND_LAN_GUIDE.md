# Panduan Jalan Server Backend (LAN) — Trip Angkutan

Backend ini sudah **migrasi ke Supabase** (`@supabase/supabase-js`). Tidak ada sqlite.js / sql.js / better-sqlite3 yang dipakai untuk operasi produksi. Nantinya boleh disederhanakan lebih jauh (hapus adapter sql.js yang ada di `src/db.js`), tapi saat ini backend sudah mengarah sepenuhnya ke Supabase.

## 1. Yang diubah / yang harus diset

### Environment variables
Salin `backend/.env.example` jadi file env sesungguhnya, misalnya `backend/.env`.

Yang wajib diisi:

```
SUPABASE_URL=https://bmiruktfruunegtbydyw.supabase.co
SUPABASE_ANON_KEY=<anon key dari Supabase dashboard>
SUPABASE_SERVICE_KEY=<service_role key dari Supabase dashboard>
JWT_SECRET=<secret panjang, random>
```

`.env.example` sudah mengarah ke project Supabase yang sama:
- `SUPABASE_URL=https://bmiruktfruunegtbydyw.supabase.co`

Jadi satu-satunya yang harus disesuaikan adalah **dua key**.

### Migrations
Skema harus sudah dijalankan sekali di Supabase SQL Editor:
- `Aplikasi-Trip-Main Branch/backend/migrations/001_initial_schema.sql`

File migration sudah ada dan berisi seluruh tabel inti:
- regions, dermagas, routes, officers, officer_dermagas, officer_regions, tariffs, trips, vehicles, trip_vehicles, geofences, vehicle_plates, region_tariffs, plate_scans, device_versions, admin_credentials.

## 2. Struktur backend yang sekarang

Folder utama backend (Aplikasi-Trip-Main Branch/backend):

- `src/index.js` → entry server. Menyuntik `req.supabase`, `req.db`, `req.helpers`, CORS + health check.
- `src/lib/supabase.js` → inisialisasi client Supabase (anon + service_role).
- `src/db.js` → adapter backward-compat yang membungkus Supabase dengan antarmuka mirip sql.js. Berfungsi, tapi nanti bisa dipangkas.
- `src/middleware/auth.js` → JWT verify + role-based guard.
- `src/routes/*.js` → auth, trips, geofences, officers, master, tariffs, reports, dan lain-lain.

## 3. Cara jalankan di LAN

### Di PC server (di tempat yang bisa resolusi `192.168.x.x` / `10.x.x.x`)

Pindah ke folder backend:

```bash
cd "Aplikasi-Trip-Main Branch/backend"
```

Lalu jalankan:

```bash
node src/index.js
```

Jika ingin development mode auto-reload (jika nodemon tersedia):

```bash
npm run dev
```

### Bind ke jaringan LAN
Backend ini sudah listen di:

```js
app.listen(PORT, '0.0.0.0', ...)
```

Jadi secara default sudah bisa diakses dari mesin lain dalam satu LAN, asalkan firewall mengizinkan port tersebut.

### Default port
- `PORT=3000` jika tidak diset.

Jika ingin port lain, beri env:

```bash
PORT=8000 node src/index.js
```

## 4. Verifikasi cepat setelah jalan

Dari mesin lain di LAN, misalkan IP backend `192.168.1.200`:

```bash
curl http://192.168.1.200:3000/api/health
```

Seharusnya mendapat JSON berisi `status`, `database`, `timestamp`, `version`.

Untuk tes login admin:

```bash
curl -X POST http://192.168.1.200:3000/api/auth/admin-login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}'
```

## 5. Catatan kinerja / koneksi Supabase

- Backend melakukan pengecekan koneksi ringan saat boot: `SELECT id FROM regions LIMIT 1`.
- Jika Supabase tidak reachable saat boot, server tetap jalan tapi operasi DB akan gagal.
- Bila ada query kompleks yang belum didukung oleh wrapper (`_executeSelect`, `_executeInsert`, dst.), backend bisa saja fallback atau gagal parsial. Saat ini sebagian besar rute sudah pakai client Supabase langsung (bukan hanya wrapper):
  - contoh: `trips.js`, `auth.js`, `geofences.js`, `officers.js`, `reports.js` umumnya memanggil `client.from(...)`.

Artinya sebagian besar logika utama sudah **baca/tulis langsung ke Supabase**.

## 6. Yang perlu dicek ulang sebelum deploy stabil

- Pastikan RLS policy di Supabase sudah sesuai. Migration mencantumkan policy umum untuk read + write di banyak tabel. Tapi tetap disarankan diverifikasi ulang di dashboard.
- Pastikan `SUPABASE_SERVICE_KEY` hanya dipakai di backend, tidak terekspos ke frontend.
- Jika ada skrip migration/manual DB yang masih memakai `sql.js`, itu hanya untuk tooling/adapter, bukan produksi query utama.

## 7. Jika nanti ingin menyederhanakan kode

Beberapa file mencatat bahwa migrasi dari sql.js ke Supabase sudah terjadi:

- `src/index.js`
- `src/routes/auth.js`
- `src/routes/trips.js`
- `src/lib/supabase.js`

Jadi jika di masa depan ingin pembersihan lebih lanjut, fokusnya:
- menghapus dependency `sql.js` di `backend/package.json` jika tidak dipakai lagi,
- menyederhanakan/menghapus `src/db.js` jika tidak dipakai sama sekali.

Saat ini tidak ada sisa kode produksi yang baca/tulis SQLite lokal untuk operasi utama.
