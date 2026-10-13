# 🔄 Audit — Geofence Admin Tidak Sinkron ke Mobile (Regresi Backend API)

**Tanggal:** 2026-10-13
**Pelapor gejala:** "Di bagian geofencing admin dashboard, perubahan masih belum sinkron dengan aplikasi mobile."
**Status:** ✅ Diperbaiki & diverifikasi di produksi
**Service terdampak:** `aplikasi-trip-api` (project `aplikasi-trip`, environment `production`)

---

## 1. Ringkasan Eksekutif

Admin **menulis** geofence dengan benar, tetapi perubahan tidak pernah sampai ke perangkat
petugas. Penyebabnya **bukan** kode geofence (admin maupun mobile), melainkan **deployment**:
service `aplikasi-trip-api` — satu-satunya API yang dipakai admin DAN mobile — ternyata
dijalankan dari **backend repo `Trip-Dashboard`** (backend khusus dashboard) yang **tidak
punya endpoint login mobile**. Akibatnya mobile tidak bisa login/perpanjang sesi, dan
`syncGeofencesFromBackend()` berhenti pada `reason: 'unauthorized'`:

```
ADMIN  → POST/PUT /api/geofences ──────────► [DB /data/trip.db]   ✅ tersimpan
MOBILE → syncGeofencesFromBackend()
          ├─ api.isAuthenticated ?  → token kedaluwarsa / refresh 404
          ├─ POST /auth/login          → 404 (rute tidak ada)      ❌
          ├─ POST /auth/refresh        → 404 (rute tidak ada)      ❌
          └─ GET  /geofences           → tak pernah dieksekusi     ❌ → cache lama dipakai
```

Perbaikan: mengembalikan sumber service ke `444Nazky/Aplikasi-Trip-Ionic` +
`/backend/Dockerfile` (sesuai `.railway/railway.ts` di repo) dan men-deploy revision
`39bcca7`. Pascadeploy, jalur mobile (`/auth/login` petugas → `GET /geofences`) **berhasil 200**.

---

## 2. Bukti (semua diambil dari produksi, bukan asumsi)

| # | Uji | Hasil SEBELUM | Arti |
|---|-----|---------------|------|
| 1 | `POST /api/auth/member-login` | **404** `Cannot POST /api/...` | rute tidak ada |
| 2 | `POST /api/auth/login` | **404** | login PIN petugas mati |
| 3 | `POST /api/auth/refresh` | **404** | sesi 24 jam tidak bisa diperpanjang |
| 4 | `POST /api/auth/select-dermaga` | **404** | pilih dermaga mati |
| 5 | `POST /api/auth/admin-login` | 401 (`admin123`) | jalur admin hidup |
| 6 | `GET /api/geofences` (token admin) | 200 → `"TITIK SBDZ BARU"`, `allowedRouteCodes:["SBDZ-SJRE"]` | **jalur tulis sehat**, data ada di DB |
| 7 | `railway status` | `repo: 444Nazky/Trip-Dashboard` | sumber service salah |
| 8 | Log runtime | **tanpa** baris `Database loaded` | backend `better-sqlite3`, bukan backend `sql.js` milik branch API |
| 9 | `.railway/railway.ts` (repo) | `github("444Nazky/Aplikasi-Trip-Ionic")` + `dockerfilePath: "/backend/Dockerfile"` | sumber yang **diniatkan** proyek |
| 10 | Riwayat deploy | build 14:20 "Deploy with Python for native modules" | penukaran ke backend `better-sqlite3` (native) |

Perbandingan dua backend yang bersaing:

| | `Trip-Dashboard/backend` (live sebelum perbaikan) | `Aplikasi-Trip-Ionic/backend` (seharusnya) |
|---|---|---|
| Engine DB | `better-sqlite3` (native) | `sql.js` (WASM) |
| `member-login` / `login` / `refresh` / `select-dermaga` | ❌ tidak ada | ✅ ada |
| Endpoint admin (`/routes`, `/reports`, `/plates`, …) | ✅ | ✅ (superset — **0 rute hilang**) |
| Tabel DB | 12 tabel | 12 tabel **identik** |

---

## 3. Akar Masalah Berlapis

### Lapis 1 — Markah ekspor `JWT_SECRET` tertimpa (bug kode, branch `endpoint`)
`backend/src/middleware/auth.js` menuliskan secret lalu **menimpa seluruh objek ekspor**:

```js
module.exports.JWT_SECRET = JWT_SECRET;   // ← hilang…
function authenticate(...) { ... }
function requireAdmin(...) { ... }
module.exports = { authenticate, requireAdmin };   // ← …ditimpa di sini
```

`routes/auth.js` meng-`require('../middleware/auth').JWT_SECRET` → `undefined` →
`jwt.sign()` melempar `secretOrPrivateKey must have a value` → **semua login 500**
(reproduksi lokal: `token_len=0`, log `Admin login error: ... secretOrPrivateKey`).
Masuk bersama commit `36d726d` "hapus Firebase half + dead surface + dual JWT_SECRET".
Ini alasan operasional mengapa backend ditukar ke repo dashboard.

### Lapis 2 — Sumber service API dialihkan ke repo dashboard (regresi deployment)
Menukar backend menyelamatkan login admin tetapi **menghapus seluruh permukaan API mobile**.
Karena mobile menunjuk URL yang sama (`src/environments/environment*.ts`), petugas:
- tidak bisa login (404) — setelah token 24 jam habis aplikasi praktis lumpuh;
- tidak pernah memperbarui konfigurasi geofence → gejala yang dilaporkan.

Token lama masih sempat lolos verifikasi (`JWT_SECRET` env tidak berubah), sehingga
gejala tampak "kadang jalan, kadang tidak" — bukan benar-benar tersinkron.

---

## 4. Perbaikan yang Diterapkan

| Tindakan | Detail |
|---|---|
| Fix bug kode | `middleware/auth.js` branch `endpoint`: satu ekspor tunggal `module.exports = { authenticate, requireAdmin, JWT_SECRET }` (baris ganda dihapus) |
| Alihkan sumber service | `source.repo` → `444Nazky/Aplikasi-Trip-Ionic`, `source.branch` → `mobile`, `build.builder` → `DOCKERFILE`, `build.dockerfilePath` → `/backend/Dockerfile` |
| Cegah redeploy sia-sia | `build.watchPatterns` → `["backend/**"]` (commit OTA/aplikasi tidak lagi me-restart API) |
| Yang **tidak** disentuh | variabel (`JWT_SECRET`, `ADMIN_PASSWORD`, `DB_PATH`, `UPLOADS_DIR`), volume `/data`, domain, port 8080 |

Deployment yang dihasilkan: **`af22dd51-35ad-403b-9444-50b1bc19aef2` — SUCCESS**,
branch `mobile`, commit `39bcca79a6bd89422975981c81e7462a2057af48`.

### Rehearsal sebelum menyentuh produksi
DB SQLite dibuat backend yang saat itu live (`better-sqlite3`), lalu dijalankan dengan
backend branch `mobile` (`sql.js`) — membuktikan kompatibilitas lintas-engine:

| Uji rehearsal | Hasil |
|---|---|
| Boot di DB buatan backend admin | ✅ `Database loaded`, migrasi berguard lolos |
| Kontinuitas data geofence | ✅ titik `"TITIK SBDZ BARU"` tetap ada |
| 8 endpoint admin | ✅ 200 semua (`/routes` 16 rute, `/reports/summary`, `/officers`, `/regions`, `/dermagas`, `/plates`, `/region-tariffs`, `/tariffs`) |
| `/auth/login` petugas (PIN `123456` seed) | ✅ token diterbitkan |
| **Skenario keluhan**: admin `PUT` radius 100→250 → petugas `GET /geofences` | ✅ petugas membaca **250** |
| `/auth/refresh` & `/routes/mine` | ✅ 200 |

---

## 5. Verifikasi Pascadeploy (produksi nyata)

| Uji | Hasil |
|---|---|
| `GET /api/health` | 200 `{"status":"ok"}` |
| `POST /auth/member-login` · `/auth/login` · `/auth/refresh` · `/auth/region-login` · `/auth/select-dermaga` | **401/400** (rute hidup) — sebelumnya **404** |
| `POST /auth/admin-login` → `GET /geofences` | 200, data utuh (`"TITIK SBDZ BARUU"`, `radiusMeters 100`, `["SBDZ-SJRE"]`) termasuk perubahan nama yang dilakukan admin saat perbaikan berjalan |
| Endpoint admin (`/routes`, `/officers`, `/reports/summary`, `/regions`, `/dermagas`, `/plates`, `/region-tariffs`) | 200 semua |
| **Jalur mobile**: `POST /auth/login` petugas nyata (`acimmulyono`) → `GET /geofences` | ✅ token terbit, **200** + data geofence yang sama |
| Status deployment | `SUCCESS`, commit `39bcca7`, branch `mobile` |

---

## 6. Limitasi (jujur, belum terbukti)

1. **Belum diuji di perangkat Android.** Bukti berhenti di HTTP: endpoint hidup + petugas
   nyata bisa login + menarik geofence. Uji akhir (`adb logcat`, banner geofence berubah)
   masih perlu dijalankan di HP.
2. **Image Docker tidak bisa dibangun lokal** (socket `/var/run/docker.sock` tak bisa
   diakses) — jadi build divalidasi oleh Railway (SUCCESS), bukan lokal.
3. **Fix branch `endpoint` belum di-commit** (masih perubahan kerja). Branch itu tidak
   dipakai service saat ini, tetapi menyimpan bug bila dipakai lagi.
4. **Ada agen/sesi lain di tree yang sama** (`claude_code` men-deploy pukul 14:20). Bila
   mereka men-deploy dari direktori lokal `Trip-Dashboard/backend` lagi, regresi ini
   akan terulang — koordinasi diperlukan.
5. Perangkat petugas yang tokennya sudah terhapus harus **login sekali**; setelah itu
   sync geofence berjalan lagi (login/resume/interval 15 menit/tombol manual).

---

## 7. Pencegahan

1. **`.railway/railway.ts` adalah sumber kebenaran.** Sumber service = repo + `/backend/Dockerfile`
   itu; jangan men-deploy backend repo dashboard ke service API.
2. **Satu backend untuk dua klien.** Backend `Aplikasi-Trip-Ionic/backend` sudah superset
   (0 rute admin hilang) — tidak perlu ada dua API.
3. **Uji asap rute auth setelah setiap deploy API**: bila `/api/auth/member-login`
   mengembalikan 404, mobile pasti mati. Tiga perintah `curl` cukup untuk menangkapnya.
4. **Hati-hati pola `module.exports.X = …` lalu `module.exports = {…}`** — markah pertama
   hilang tanpa error. Pakai satu ekspor objek, dan tambahkan tes yang memuat modul.
5. Lindungi `JWT_SECRET`/`ADMIN_PASSWORD` saat mengedit konfigurasi: patch konfigurasi
   hanya boleh menyentuh kunci yang dimaksud (gap patch bersifat merge).

---

## 8. Artefak

- `endpoint-trip Endpoint Branch/backend/src/middleware/auth.js` — fix markah ekspor (belum di-commit)
- Service `aplikasi-trip-api`: `source.repo`, `source.branch`, `build.watchPatterns` (live)
- Deployment `af22dd51-35ad-403b-9444-50b1bc19aef2` (SUCCESS)

*Laporan disusun oleh Buffy (Freebuff) — 2026-10-13.*
