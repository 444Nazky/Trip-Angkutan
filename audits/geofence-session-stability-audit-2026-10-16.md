# 🔄 Audit — Geofence “Belum ada titik tersimpan”, “Lokasi Tidak Sesuai Dermaga”, dan Sesi Petugas

**Tanggal:** 2026-10-16
**Pelapor:** petugas lapangan (7 keluhan; dipetakan di §1)
**Cakupan:** mobile (`mobile-trip Mobile Branch`), admin dashboard (`Trip-Dashboard Admin Branch`), backend (`endpoint-trip Endpoint Branch`)
**Status:** ✅ FIXED di working tree — menunggu build/publish APK + deploy backend

---

## 1. Pemetaan keluhan → akar masalah

| # | Keluhan lapangan | Akar masalah | Fix |
|---|------------------|--------------|-----|
| 1 | Geofence admin tidak sinkron; mobile terus “Belum ada titik geofence tersimpan” | Cache geofence **dipurgasi tiap login**, lalu sync **tidak bisa pulih** (token/renew) → perangkat kosong permanen | Jangan purge saat login ulang petugas yang sama + jalur pemulihan sesi (§2.1, §2.2) |
| 2 | Setelah admin ubah koordinat, mobile kosong; tombol sinkron bilang “belum login” padahal sudah login | `handleSync` menggantung pada `renewSessionIfNeeded()` yang **mustahil sukses** tanpa token | Sinkron mandiri + pesan status jujur (§2.3) |
| 3 | Hanya Budi Santoso yang jalan; petugas lain kosong | Sesi officer tersimpan **tanpa `dermagaAccess`** → penarikan geofence jatuh ke master/tak ter-scope; ditambah #1 | Lengkapi `dermagaAccess` di sesi + ambil titik SEMUA dermaga akses (§2.4) |
| 4 | `[geofence] Sync: not authenticated, trying to renew session` → `session renewal failed`; minta data disimpan di localStorage tanpa expired | (a) `renewSessionIfNeeded` mensyaratkan token valid → **chicken-and-egg**; (b) login offline **menghapus token + dermaga aktif**; (c) token petugas backend hanya 24 jam | Token petugas berumur panjang, login diam-diam dari kredensial lokal, login offline tidak lagi merusak sesi (§2.1, §2.2) |
| 5 | Dewi (2 dermaga) pilih D1 di lokasi D1 → “Lokasi Tidak Sesuai Dermaga”, tombol Lanjut mati | Dashboard **tidak pernah mengirim `dermagaId`** → titik tersimpan “berlaku umum” & radius saling tumpang tindih; perbandingan `dermagaId !== dockId` mentah menyalakan banner walau titik umum | Kirim `dermagaId` dari dashboard + peringkat titik + banner hanya untuk UUID asli berbeda (§2.5, §2.6) |
| 6 | Geofence sering berubah-ubah (kadang D1, kadang hanya D2, kadang keduanya) | Sync **menimpa** cache dengan hasil satu dermaga yang sedang dipilih → daftar ikut berubah saat pilihan ganti | Tarik union SEMUA dermaga akses (§2.4) |
| 7 | “Cek lokasi lagi” bikin salah satu geofence dermaga hilang | Handler tombol memanggil `forceSync` yang menimpa cache dengan subset dermaga terpilih (bug #6) | Idem §2.4 + cache last-known-good tidak pernah dikosongkan |

---

## 2. Akar masalah & perbaikan (detail)

### 2.1 Backend — sesi petugas tidak praktis expired

`endpoint-trip/.../routes/auth.js` menerbitkan token petugas `expiresIn: '24h'`. Begitu
habis (dan `JWT_SECRET` pernah dirotasi — lihat insiden 2026-10-13), semua panggilan
sync 401 dan petugas terjebak.

**Fix:** konstanta `OFFICER_TOKEN_TTL = '3650d'` untuk `login`, `member-login`, dan
`refresh` (3 titik). Token **admin dashboard tetap 24 jam** karena dashboard dipakai
di jaringan kantor, bukan perangkat lapangan.

**File:** `endpoint-trip Endpoint Branch/backend/src/routes/auth.js`,
`Aplikasi-Trip-Main Branch/backend/src/routes/auth.js`
(`mobile-trip Mobile Branch/backend/src/routes/auth.js` sudah tanpa `expiresIn` sejak awal — konsisten.)

### 2.2 Mobile — rencana sesi dibuat “tidak bisa mati”

Tiga cacat bertumpuk:

1. `renewSessionIfNeeded()` hanya dipanggil saat **sudah tidak** terautentikasi, tetapi
   `ensureBackendSession()` langsung gagal bila token kosong → renew **selalu** gagal
   (`session renewal failed`). Mustahil pulih.
2. `buildOfflineSession()` (jalur login offline) memanggil `api.setToken(null)` dan
   menghapus `trip.auth.dermaga.v1` → setelah login offline aplikasi dianggap “belum login”.
3. Tidak ada kredensial tersimpan untuk membangun ulang sesi.

**Fix (`src/services/auth.ts`):**

- `silentReLogin()`: bila token kosong, pakai kredensial login terakhir dari
  `trip.auth.lastCredential.v1` (PIN petugas atau username/password member) → ambil token baru
  **tanpa meminta petugas mengetik ulang**. Dipakai oleh `renewSessionIfNeeded()` dan `isSessionReady()`.
- Login offline **tidak lagi** menghapus token/dermaga bila petugasnya sama; hanya
  dibersihkan saat GANTI petugas. Dermaga juga dibersihkan bila tidak ada di akses petugas.
- `isSessionReady()` menganggap token tanpa `exp` tetap siap (kompatibel token petugas lama).
- `logout()` tetap membersihkan kredensial (`clearOfficer`).

> ⚠️ **TODO-security:** kredensial login disimpan polos di localStorage (`trip.auth.lastCredential.v1`).
> Ini permintaan operasional eksplisit (“kerja dulu, keamanan belakangan”). Sebelum rilis publik,
> ganti dengan refresh-token + penyimpanan aman (native keystore).

### 2.3 Mobile — tombol sinkron konfigurasi geofence

`GeofenceConfigScreen.handleSync` memanggil `renewSessionIfNeeded()` lebih dulu dan
berhenti dengan “Sesi habis. Silakan logout dan login ulang.” bila gagal — jalan buntu
karena §2.2. **Fix:** sync langsung, laporkan `unauthorized`/`network`/`empty` apa adanya,
dan selalu muat ulang titik dari cache lokal (last-known-good).

### 2.4 Mobile — cakupan titik: union semua dermaga akses

`syncGeofencesFromBackend` dulu hanya menarik `?dermagaId=<yang dipilih>` lalu **menimpa**
cache. Akibatnya daftar titik berubah setiap pilihan dermaga berganti/blog berulang.

**Fix (`src/services/geofence.ts`):**

- `accessibleIds` = gabungan dari `officer.dermagaAccess`, **kunci rute yang tersimpan**
  (`getStoredRoutes().dermagaId`), dan dermaga aktif.
- Satu request per dermaga akses; hasil di-**union** + dedup id.
- Titik milik dermaga akses tetap; titik dermaga lain (UUID asli di luar akses) dibuang.

**Fix (`src/services/auth.ts`):** `enrichOfficerWithDermagaAccess()` mengisi `dermagaAccess`
ke sesi saat login PIN (dari `dermagas`), saat member-login (dari roster setelah cache),
dan saat petugas memilih dermaga (`addDermagaToStoredOfficer`). Dulu sesi officer sering
**tanpa** `dermagaAccess` sehingga penarikan geofence jatuh ke master semua region.

### 2.5 Dashboard admin — titik geofence akhirnya punya dermaga

`RoutesTab.saveGeofencePoint` membentuk payload **tanpa `dermagaId`** dan
`services/geofences.ts` tidak pernah mengirimnya → semua titik `dermaga_id = NULL`
(“berlaku umum”), muncul di semua dermaga, radius saling menimpa.

**Fix:**

- `GeofenceRule` dapat `dermagaId?` + `enabled?`; `createGeofenceRule` mengirim
  `dermagaId` (dan `enabled` bila ada).
- `createRouteGeofencePoint(routeCode, data, { dermagaId })` — titik baru memakai dermaga rute.
- Saat **edit** titik lama, `dermagaId` dermaga rute ikut dikirim → data lama yang NULL
  ikut terrapikan (tanpa pernah mengosongkannya).

### 2.6 Mobile — “Lokasi Tidak Sesuai Dermaga” palsu

`RouteSelectScreen` membandingkan `activePoint.dermagaId !== dockId` mentah-mentah. Titik
“berlaku umum”/id warisan (`BADAU-D1`) yang radiusnya tumpang tindih membuat banner menyala
walau petugas **benar** di dermaga terpilih → tombol “Lanjut” mati.

**Fix (`geofence.ts` + `RouteSelectScreen.tsx`):**

- Helper `pointIsForOtherDermaga()` — banner hanya menyala bila **kedua sisi UUID asli**
  dan berbeda.
- Peringkat pemilihan titik saat dermaga terpilih: `0` titik dermaga itu → `1` titik umum
  (dermagaId kosong) → `2` id warisan; yang jelas milik dermaga lain tidak pernah dipilih.

### 2.7 Mobile — penyaringan rute tidak boleh mengosongkan perangkat

`scopedGeofencePoints` membuang titik yang `allowedRoutes`-nya tidak beririsan dengan rute
penugasan. Satu ketidakcocokan kode (mis. admin menulis arah terbalik) = daftar **kosong** =
“Belum ada titik geofence” + input trip terkunci.

**Fix:** bila hasil penyaringan kosong, simpan **semua** titik aktif. Validasi rute tetap
menahan rute yang tidak diizinkan di titik itu — petugas tidak kehilangan konfigurasi.

---

## 3. Verifikasi

| Pemeriksaan | Hasil |
|-------------|-------|
| `npx tsc --noEmit` (mobile-trip) | exit 0 |
| `npx vitest run` (mobile-trip) | **141/141 lulus** (12 suite; +8 tes baru) |
| `npx tsc --noEmit` (Trip-Dashboard) | exit 0 |
| `npm test` (Trip-Dashboard) | **36/36 lulus** |
| `node --check` backend auth (endpoint + Main) | OK; admin tetap `24h`, officer `3650d` |

Tes baru:

- `src/services/geofence.test.ts` — union 2 dermaga, dedup titik umum, penyaringan dermaga
  lain (UUID), penyaringan rute tidak mengosongkan, `pointIsForOtherDermaga`.
- `src/services/sessionRecovery.test.ts` — login diam-diam (PIN & member), tanpa kredensial,
  kredensial ditolak, token lama dipakai, cache geofence dipertahankan saat petugas sama
  dihapus saat ganti petugas, `dermagaAccess` tersimpan ke sesi.

## 4. Belum dikerjakan / risiko tersisa

1. **Deploy + build.** Fix backend butuh redeploy `endpoint`; fix mobile butuh build APK/OTA baru.
   Tanpa itu, perangkat petugas masih memakai kode lama.
2. **APK lama di perangkat** belum punya jalur pemulihan ini — petugas dengan token basi perlu
   login sekali setelah APK baru terpasang.
3. **`Aplikasi-Trip-Main Branch` belum diselaraskan** (branch Main berbeda struktur; hanya backend
   auth-nya yang ikut diubah). Perlu port bertahap agar kedua workspace tidak menyimpang.
4. **Keamanan kredensial localStorage** (§2.2) — sengaja ditunda sesuai permintaan.
5. Titik geofence lama di DB produksi masih `dermaga_id = NULL` sampai admin membuka & menyimpan
   ulang titiknya dari tab Master Rute (perbaikan §2.5 mengikat dermaga saat edit).
