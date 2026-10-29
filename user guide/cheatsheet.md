# Cheatsheet & Referensi API — Update Aplikasi Trip Angkutan

> **Rujukan cepat** untuk rilis full-package `1.0.3` (dari `1.0.2`).
> Semua perintah dijalankan dari root repo: `/home/nazky/RPL/Intern/Trip-Angkutan`
> Server rilis (LAN kantor): `http://192.168.1.123:3000/api`

---

## 1. Ringkasan dalam Satu Baris

```bash
# 1) naikkan versi paket APK (package.json + android/app/build.gradle)
node scripts/sync-version.mjs 1.0.3 --code=12

# 2) build APK penuh
npm run build && npx cap sync android && (cd android && ./gradlew assembleRelease)

# 3) verifikasi isi APK (versi, sertifikat, hash)
APK="android/app/build/outputs/apk/release/Aplikasi Trip-release.apk"
~/android-sdk/build-tools/34.0.0/aapt2 dump badging "$APK" | head -1
~/android-sdk/build-tools/34.0.0/apksigner verify --print-certs "$APK" | head -3
sha256sum "$APK"; stat -c%s "$APK"

# 4) terbitkan ke server API intranet
node scripts/publish-apk.mjs --apk="$APK" --version=1.0.3 --notes="Rilis 1.0.3"

# 5) pastikan perangkat mendeteksi
curl -s "http://192.168.1.123:3000/api/app-version?current=1.0.2"
#    → latestVersion: "1.0.3", updateAvailable: true
```

> **Penting — `version.json` JANGAN diubah untuk rilis paket APK.**
> `version.json` adalah manifest **kanal modul web** (OTS), bukan versi APK.
> Nilainya dikelola `scripts/publish-ota-server.mjs`. Mengubahnya ke versi APK
> akan **menurunkan** versi modul dan membuat kanal cadangan tidak pernah
> menawarkan pembaruan. `sync-version.mjs` sekarang tidak menyentuh berkas itu
> (kecuali bila dipanggil dengan `--module`).

---

## 2. Naikkan Versi

```bash
# Otomatis: package.json + android/app/build.gradle
node scripts/sync-version.mjs 1.0.3 --code=12
```

| Argumen | Arti |
|---|---|
| `1.0.3` | versi paket (harus `X.Y.Z` murni) |
| `--code=12` | `versionCode` baru (harus **naik**; tanpa flag = +1 dari yang ada) |
| `--module` | ikut menulis `version.json` (hanya untuk rilis kanal modul) |
| `--root=DIR` | root repo lain |

Skrip menolak bila `versionCode` tidak naik. Yang ditulis:

| Berkas | Field |
|---|---|
| `android/app/build.gradle` | `versionCode 12`, `versionName "1.0.3"` |
| `package.json` | `"version": "1.0.3"` |

> **Perbaikan (2026-10-29):** `sync-version.mjs` dulu memakai regex polos
> (`/versionCode\s+\d+/`) yang lebih dulu mengenai **baris komentar** di
> `build.gradle` — Akibatnya `versionCode` asli tidak pernah naik (tetap 11)
> dan Android menolak upgrade dengan `INSTALL_FAILED_VERSION_DOWNGRADE`.
> Sekarang regex-nya hanya menyentuh baris deklarasi. **Selalu cek hasilnya:**
> `grep -n "versionCode\|versionName" android/app/build.gradle`.

Manual (kalau lebih suka):

```bash
# android/app/build.gradle
#   versionCode 12
#   versionName "1.0.3"
```

---

## 3. Build & Verifikasi Paket

### 3.1 Build

```bash
npm run build                  # build web app → www/
npx cap sync android           # salin www/ → android/app/src/main/assets/public
cd android && ./gradlew assembleRelease
# output: android/app/build/outputs/apk/release/Aplikasi Trip-release.apk
```

Folder keluaran rilis (arsip) — **dalam repo ini**:
`/home/nazky/RPL/Intern/Trip-Angkutan/android/app/build/outputs/apk/release/`

| Berkas | Isi |
|---|---|
| `Aplikasi Trip-release.apk` | hasil build Gradle terakhir (raw) |
| `Aplikasi-Trip-v1.0.2-release.apk` | paket dasar yang dipasang ke HP petugas (code 11) |
| `Aplikasi-Trip-v1.0.3-release.apk` | paket pembaruan yang diterbitkan ke server (code 12) |

### 3.2 Verifikasi paket

```bash
APK="android/app/build/outputs/apk/release/Aplikasi Trip-release.apk"

# 1) Versi di dalam APK (harus = versi yang dipublikasikan)
~/android-sdk/build-tools/34.0.0/aapt2 dump badging "$APK" | head -1

# 2) Sertifikat tanda tangan (HARUS sama dengan versi terpasang di HP)
~/android-sdk/build-tools/34.0.0/apksigner verify --print-certs "$APK" | head -3

# 3) Hash & ukuran (isi untuk tabel app_versions)
sha256sum "$APK"
stat -c%s "$APK"

# 4) Isi web bundle di dalam APK cocok dengan build lokal
unzip -p "$APK" assets/public/index.html | sha256sum
sha256sum www/index.html
```

**Nilai yang harus keluar untuk rilis 1.0.3:**

```
package: name='com.plantation.tripangkut' versionCode='12' versionName='1.0.3' …
Signer #1 certificate DN: CN=Trip Angkutan, OU=Mobile, O=444Nazky, L=Pontianak, C=ID
Signer #1 certificate SHA-256 digest: 09f181c1c6fba02473345cfd515e49d0cc360c1dc6462eba7ddd3f72d4d3bce9
```

---

## 4. Terbitkan ke Server API

### 4.1 Versi BARU (belum pernah terbit)

```bash
node scripts/publish-apk.mjs \
  --apk="android/app/build/outputs/apk/release/Aplikasi Trip-release.apk" \
  --version=1.0.3 \
  --notes="Rilis full package 1.0.3" \
  --min-version=1.0.2
```

Yang terjadi di server (`server/api/handlers/appVersion.ts` → `publishVersion()`):

1. Header `x-publish-secret` diperiksa (bawaan `trip-angkut-secret`).
2. `apkBase64` di-decode → SHA-256 + ukuran dihitung.
3. Berkas diunggah ke bucket `apks` sebagai **`app-<versi>.apk`** (lokasi disk
   server: `STORAGE_DIR/apks/app-<versi>.apk`).
4. Baris `app_versions` di-INSERT.

Skrip juga **menolak** bila `versionName` di dalam APK ≠ `--version` — proteksi
terhadap penerbitan paket salah label (bug yang pernah membuat versi di HP
tidak pernah naik).

### 4.2 Versi yang SUDAH pernah terbit (terbit ulang)

```bash
node scripts/publish-apk-republish.mjs \
  --apk="android/app/build/outputs/apk/release/Aplikasi Trip-release.apk" \
  --version=1.0.3 \
  --notes="Uji pembaruan: install full package (APK) lewat tombol Perbarui Aplikasi di halaman Profil."
```

**Kenapa skrip ini perlu ada.** `app_versions.version` bertipe `UNIQUE`.
Publish kedua untuk versi yang sama ditolak `500` — padahal **berkas APK-nya
sudah tersimpan** di disk (upload terjadi sebelum insert). Akibatnya berkas di
server versi baru, sementara `apk_hash` di database masih hash versi lama →
perangkat reporting **"Hash APK tidak cocok"** dan tombol update tidak pernah
berhasil.

Skrip `publish-apk-republish.mjs` memakai endpoint `POST /api/admin/import`
(mode `replace`, khusus tabel `app_versions`):

1. Metadata versi lain di server dikumpulkan ulang (tanggal, catatan, hash
   & ukuran dihitung dari berkas yang benar-benar tersimpan di disk server).
2. Baris versi target ditulis ulang dengan hash/ukuran/`versionName`/
   `versionCode` yang benar.
3. Berkas APK dikirim ulang ke bucket `apks`.
4. Hasil diverifikasi: unduh ulang berkasnya dari server, bandingkan hash-nya
   dengan hash di database.

Opsi:

| Argumen | Arti |
|---|---|
| `--dry-run` | tampilkan rencana (baris yang akan ditulis) tanpa menulis |
| `--notes="…"` | catatan rilis |
| `--min-version=1.0.2` | versi minimum yang didukung (dipaksa untuk update wajib) |
| `--force-update` | tandai sebagai pembaruan wajib (modal penuh, tidak bisa ditutup) |
| `--server=URL` | alamat server lain |
| `--token=…` | token admin, bila server tidak memakai `ADMIN_AUTH_DISABLED=1` |

> Server intranet biasanya berjalan dengan `ADMIN_AUTH_DISABLED=1`, sehingga
> request tanpa token tetap dianggap admin. Kalau tidak, pakai `--token`.

### 4.3 Kanal modul web (opsional, bukan jalur rilis APK)

```bash
npm run ota:publish -- --notes="…"
# atau
node scripts/publish-ota-server.mjs --notes="…"
```

Kanal ini Publish bundel web (`www/`) dan **tidak berkaitan** dengan versi
paket APK. Jangan dipakai untuk uji tombol update versi ini.

---

## 5. Skema JSON — Endpoint Cek Versi

### 5.1 `GET /app-version?current=1.0.2`

**Request:**

```http
GET /api/app-version?current=1.0.2&t=1758540000000
Accept: application/json
```

**Response `200`:**

```json
{
  "latestVersion": "1.0.3",
  "updateAvailable": true,
  "isForceUpdate": false,
  "downloadUrl": "http://192.168.1.123:3000/files/apks/app-1.0.3.apk",
  "releaseNotes": "Uji pembaruan: install full package (APK) …",
  "apkSize": 16361480,
  "apkHash": "0ffac76a703e2372ef643a31767e4c96f4b47093bfada49fb3cf879f84aea77e",
  "minVersion": "1.0.2",
  "releaseDate": "2026-10-29T02:53:27.409+00:00",
  "apkAvailable": true
}
```

**Response `404`** — belum ada baris rilis:

```json
{ "latestVersion": "1.0.2", "updateAvailable": false, "downloadUrl": null, "releaseNotes": null }
```

**Response `500`:**

```json
{ "error": "VERSION_CHECK_FAILED", "message": "Gagal membaca versi" }
```

### 5.2 Padanan nama field

| Konsep | Field API produksi | Tipe | Sumber nilai |
|---|---|---|---|
| `version_name` | `latestVersion` | `string` | `app_versions.version` |
| `version_name` (di dalam APK) | `apkVersionName` | `string` | `versionName` di AndroidManifest |
| `version_code` (di dalam APK) | `apkVersionCode` | `integer` | `versionCode` di AndroidManifest |
| `apk_url` | `downloadUrl` | `string` | `app_versions.download_url` |
| `apk_hash` | `apkHash` | `string` | SHA-256 hex, 64 karakter |
| `apk_size` | `apkSize` | `number` | ukuran berkas dalam byte |
| — | `updateAvailable` | `boolean` | hasil perbandingan semver |
| — | `isForceUpdate` | `boolean` | `app_versions.is_force_update` |
| — | `minVersion` | `string \| null` | `app_versions.min_version` |
| — | `releaseNotes` | `string` | `app_versions.release_notes` |
| — | `releaseDate` | `string` | `app_versions.release_date` (ISO-8601) |
| — | `apkAvailable` | `boolean` | selalu `true` bila baris ada |

### 5.3 Endpoint lain

| Endpoint | Method | Keterangan |
|---|---|---|
| `/app-version?current=<v>` | GET | Cek versi (dipakai klien) |
| `/app-download/<versi>` | GET | `302` redirect ke berkas lokal |
| `/release-notes/<versi>` | GET | Catatan rilis terstruktur (`notes[]` dengan `type`: feature/bugfix/security/improvement) |
| `/apk-list` | GET | Daftar seluruh versi yang terdaftar |
| `/report-version` | POST | Laporan versi terpasang per perangkat |
| `/device-versions` | GET | Rekap versi perangkat (butuh admin) |
| `/publish-version` | POST | Publikasi rilis (butuh `x-publish-secret`) |
| `/admin/import` | POST | Impor massal (dipakai `publish-apk-republish.mjs`) |
| `/ota-manifest`, `/ota-versions`, `/publish-ota` | GET/POST | Kanal modul web — kanal cadangan |

Berkas APK disajikan di luar prefix `/api`:
`GET http://192.168.1.123:3000/files/<bucket>/<path>` → `apks/app-<versi>.apk`.

**Contoh `POST /report-version`:**

```json
{ "deviceId": "d4e5f6-…", "version": "1.0.3", "platform": "android" }
```

---

## 6. Verifikasi Setelah Publish

```bash
SRV=http://192.168.1.123:3000

# 1) Perangkat 1.0.2 → harus detecting update
curl -s "$SRV/api/app-version?current=1.0.2" | python3 -m json.tool
#    → latestVersion: "1.0.3", updateAvailable: true

# 2) Perangkat 1.0.3 → tidak ada update
curl -s "$SRV/api/app-version?current=1.0.3" | python3 -m json.tool
#    → updateAvailable: false

# 3) APK benar-benar bisa diunduh
curl -sI "$SRV/files/apks/app-1.0.3.apk" | head -3
#    → HTTP/1.1 200, content-type: application/vnd.android.package-archive

# 4) Hash berkas yang bisa diunduh HARUS sama dengan apkHash di respons
curl -s "$SRV/files/apks/app-1.0.3.apk" | sha256sum

# 5) Daftar versi terdaftar
curl -s "$SRV/api/apk-list" | python3 -m json.tool

# 6) Versi di dalam APK yang terunduh = versi yang dipublikasikan
curl -s -o /tmp/cek.apk "$SRV/files/apks/app-1.0.3.apk"
~/android-sdk/build-tools/34.0.0/aapt2 dump badging /tmp/cek.apk | head -1
```

---

## 7. Nilai Rilis (terkini)

| Atribut | 1.0.2 (terpasang) | 1.0.3 (rilis baru) |
|---|---|---|
| `versionName` | `1.0.2` | `1.0.3` |
| `versionCode` | `11` | `12` |
| `applicationId` | `com.plantation.tripangkut` | sama |
| `minSdkVersion` | `24` (Android 7.0) | sama |
| `targetSdkVersion` | `36` | sama |
| Ukuran APK | `16361420` byte | `16361420` byte |
| SHA-256 | `d84ce58ea6e4fc40…` | `8c756e54607b0c5d…` |
| Sertifikat SHA-256 | `09f181c1…` | `09f181c1…` (sama — wajib) |
| Lokasi berkas di server | `apks/app-1.0.2.apk` | `apks/app-1.0.3.apk` |
| `min_version` | — | `1.0.2` |

> Berkas 1.0.2 yang **tersimpan di server** masih build lama
> (`c8cbac8926e93842…`, 16357720 byte) — itu yang terpasang di HP petugas.
> APK 1.0.2 di folder rilis adalah build **fixed** (tombol "Cek Update"
> berfungsi) dengan `versionCode` tetap `11`, jadi bisa dipasang di atas
> versi lama tanpa penolakan Android.

> **Catatan:** Gradle menghapus berkas asing di `outputs/apk/release/` setiap
> `assembleRelease`. Kalau folder itu perlu berisi kedua paket, salin
> **setelah** build terakhir.

---

## 8. Perintah Diagnosa

```bash
# Log aplikasi (Android)
adb logcat | grep -Ei "Update|Version|ApkInstaller"

# Versi terpasang di perangkat uji
adb shell dumpsys package com.plantation.tripangkut | grep -E "versionName|versionCode"

# Izin instalasi paket
adb shell appops get com.plantation.tripangkut REQUEST_INSTALL_PACKAGES

# Izinkan instalasi untuk uji (opsional, hanya perangkat uji)
adb shell appops set com.plantation.tripangkut REQUEST_INSTALL_PACKAGES allow

# Health & statistik server intranet
curl -s http://192.168.1.123:3000/api/health
curl -s http://192.168.1.123:3000/api/server-stats | python3 -m json.tool | head -40
```

---

## 9. Jebakan yang Sudah Terjadi (jangan ulangi)

| Jebakan | Gejala | Solusi |
|---|---|---|
| **Origin native dianggap "localhost dev"** | **Tombol "Cek Update" di HP mati total** — selalu "Sudah Terbaru", versi tampil "—", server tak pernah dihubungi | `isLocalhostDev()` di `src/services/runtimeEnv.ts` wajib keluar lebih dulu untuk `Capacitor.isNativePlatform()`. Aplikasi native dimuat dari origin `https://localhost` — itu BUKAN mode dev |
| Versi sudah ada di `app_versions` | Publish `500`, hash di DB tetap yang lama → `HASH_MISMATCH` di perangkat | Pakai `publish-apk-republish.mjs` (bukan `publish-apk.mjs`) |
| `versionCode` tidak naik | `INSTALL_FAILED_VERSION_DOWNGRADE` | Naikkan `versionCode` (1.0.3 = 12 > 1.0.2 = 11) |
| `sync-version.mjs` menyentuh baris komentar | `versionCode` tidak berubah | Sudah diperbaiki; verifikasi dengan `grep versionCode android/app/build.gradle` |
| `version.json` ditulis dengan versi APK | Versi modul turun → kanal OTA tidak pernah menawarkan update | Jangan sentuh `version.json` untuk rilis APK |
| Nama berkas APK tidak `app-<versi>.apk` | Unduhan 404 | Simpan sebagai `apks/app-<versi>.apk` di disk server |
| `versionName` di dalam APK ≠ versi yang dipublikasikan | Versi di HP tidak pernah naik; popup update muncul selamanya | Cek dengan `aapt2 dump badging`; skrip publish menolak otomatis bila beda |
| Sertifikat tanda tangan berbeda | `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Pakai keystore `android/app/tripangkut.keystore` yang sama |
| Hash di DB ≠ hash berkas di server | `HASH_MISMATCH` | Terbitkan ulang dengan `publish-apk-republish.mjs` |
| Header anti-cache (`Cache-Control` dsb) ikut dikirim | Cek versi gagal total, diam-diam | Hanya kirim header `Accept` |
| `files-path` tidak ada di `file_paths.xml` | `Failed to find configured root` | Tambahkan `<files-path name="app_files" path="." />` |
| Versi ditulis setelah unduhan | Aplikasi mengklaim "sudah update" padahal belum terpasang | Tulis versi hanya setelah `App.getInfo()` berubah |
| `downloadUrl` relatif ditempel ke origin | 404 (`/api/api/...`) | Tempel ke `api.baseUrl` (lihat `resolveDownloadUrl()`) |
| `app_versions.version` diberi stempel `1.0.3+123` | `publish-version` menolak format | Semver murni: `1.0.3` |
| APK "cocok" tapi hanya beberapa ratus byte | Installer terbuka lalu gagal | Cek `apkSize`; ambang minimum 1.000.000 byte |
| Server intranet mati / IP berubah | Perangkat tidak bisa cek versi | Cek `curl http://192.168.1.123:3000/api/health`; preset endpoint di aplikasi |
| Endpoint perangkat masih cloud | 1.0.3 versi lama = code 10, ditolak sebagai downgrade di atas code 11 | Pakai endpoint **Intranet Kantor** di Profil → Server |

---

## 10. Checklist Rilis

**Sebelum build**

- [ ] `node scripts/sync-version.mjs 1.0.3 --code=12`
- [ ] `grep -n "versionCode\|versionName" android/app/build.gradle` → `12` / `"1.0.3"`
- [ ] `version.json` **tidak** berubah (masih versi modul)
- [ ] `npm run build` → sukses
- [ ] `npx cap sync android` → sukses
- [ ] `cd android && ./gradlew assembleRelease` → APK terbentuk

**Verifikasi paket**

- [ ] `aapt2 dump badging` → `versionName='1.0.3'`, `versionCode='12'`
- [ ] `apksigner verify` → sertifikat SHA-256 `09f181c1…`
- [ ] `sha256sum` & `stat -c%s` dicatat
- [ ] `unzip -p … assets/public/index.html` cocok dengan `www/index.html`

**Publish**

- [ ] `node scripts/publish-apk.mjs …` (versi baru) **atau**
      `node scripts/publish-apk-republish.mjs …` (versi sudah ada)
- [ ] Output skrip: `OK - versi 1.0.3 terbit dan bisa diunduh perangkat.`
- [ ] `GET /api/app-version?current=1.0.2` → `latestVersion: "1.0.3"`, `updateAvailable: true`
- [ ] `curl -sI /files/apks/app-1.0.3.apk` → `200`
- [ ] Hash berkas yang diunduh = `apkHash` di respons

**Uji lapangan**

- [ ] Perangkat uji masih di 1.0.2 (install `Aplikasi-Trip-v1.0.2-release.apk`)
- [ ] Profil → "Cek & Perbarui" → badge hijau "Paket APK 1.0.3 siap dipasang"
- [ ] "Perbarui Sekarang" → dialog installer Android muncul
- [ ] Setujui → versi jadi 1.0.3
- [ ] Buka app lagi → "Aplikasi sudah versi terbaru"; `POST /report-version` terkirim

---

## 11. Rujukan Cepat

| Topik | Lokasi |
|---|---|
| Handler versi server | `server/api/handlers/appVersion.ts` |
| Routing endpoint | `server/api/index.ts` (bagian "app update / OTA") |
| Penyimpanan berkas lokal | `server/api/_db.ts` (`serveStoredFile`, `db.storage`) |
| Server intranet (Deno) | `server/api/local_server.ts` |
| State machine update | `src/services/updateService.ts` |
| Adapter installer | `src/services/apkInstaller.ts` |
| Controller di atas UI | `src/services/appUpdate.ts` |
| Halaman Profil | `src/pages/mobile/ProfileScreen.tsx` |
| Plugin native | `android/app/src/main/java/com/plantation/tripangkut/ApkInstallerPlugin.java` |
| Manifest | `android/app/src/main/AndroidManifest.xml` |
| FileProvider paths | `android/app/src/main/res/xml/file_paths.xml` |
| Skrip rilis | `scripts/publish-apk.mjs`, `scripts/publish-apk-republish.mjs`, `scripts/sync-version.mjs` |
| Dokumen lain | `user guide/architecture.md`, `user guide/workflow.md` |
