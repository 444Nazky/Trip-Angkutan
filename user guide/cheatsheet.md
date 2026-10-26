# Cheatsheet & Referensi API — Update Aplikasi Trip Angkutan v1.0.3

> **Rujukan cepat** untuk rilis full-package `1.0.3` (dari `1.0.2`).
> Semua perintah dijalankan dari root repo: `/home/nazky/RPL/Intern/Aplikasi-Trip-Main Branch`

---

## 1. Ringkasan dalam Satu Baris

```bash
# naikkan versi (package.json + build.gradle; JANGAN sentuh version.json — lihat catatan §5.1)
node -e "const f='package.json',fs=require('fs');const j=JSON.parse(fs.readFileSync(f));j.version='1.0.3';fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
sed -i 's/versionCode 5/versionCode 6/; s/versionName "1.0.2"/versionName "1.0.3"/' android/app/build.gradle

# build APK penuh
npm run build && (cd android && ./gradlew assembleRelease)

# verifikasi isi APK
~/android-sdk/build-tools/35.0.0/aapt dump badging "android/app/build/outputs/apk/release/Aplikasi Trip-release.apk" | head -1

# upload ke Supabase Storage (bucket `apks`)
supabase storage cp "android/app/build/outputs/apk/release/Aplikasi Trip-release.apk" \
  ss:///apks/app-1.0.3.apk --linked --experimental \
  --content-type "application/vnd.android.package-archive"

# daftarkan metadata rilis (SQL Editor — CARA INI DISARANKAN untuk APK > 15 MB)
#   lihat §2.4 untuk query INSERT lengkap
#   (publish-apk.mjs mengirim base64 dan kena batas body Edge Function 20 MiB)
```

> Untuk APK berukuran besar seperti `1.0.3` (15,6 MiB → base64 20,8 MiB), **jangan** mengandalkan `publish-apk.mjs`: payload base64 melewati batas 20 MiB body Edge Function dan request ditolak. Gunakan **upload Storage terpisah** (bagian 2.1) + **INSERT metadata via SQL Editor** (bagian 2.4). `publish-apk.mjs` tetap berguna untuk APK kecil.

---

## 2. Upload APK v1.0.3 ke Supabase Storage

### 2.1 Opsi A — CLI (disarankan)

```bash
# Pastikan CLI ter-login & project ter-link
supabase login
supabase link --project-ref bmiruktfruunegtbydyw

# Pastikan bucket `apks` ada
supabase storage ls --linked --experimental
# → {"paths":["trip-photos/","apks/","ota/"], ...}

# Upload (nama objek WAJIB app-<versi>.apk)
supabase storage cp "android/app/build/outputs/apk/release/Aplikasi Trip-release.apk" \
  ss:///apks/app-1.0.3.apk \
  --linked --experimental \
  --content-type "application/vnd.android.package-archive"

# Verifikasi objek ada
supabase storage ls ss:///apks --linked --experimental
curl -I "https://bmiruktfruunegtbydyw.supabase.co/storage/v1/object/public/apks/app-1.0.3.apk"
# → HTTP/2 200
```

### 2.2 Opsi B — Supabase Dashboard

1. Buka <https://supabase.com/dashboard> → project **444Nazky's Project**.
2. Menu **Storage** → bucket **apks** → **Upload file**.
3. Unggah `Aplikasi Trip-release.apk`.
4. **Ganti nama** berkas menjadi `app-1.0.3.apk` (nama lain tidak akan ditemukan klien).
5. Pastikan bucket **Public bucket = ON**.

> Nama objek harus persis `app-<versi>.apk`. `getAppVersion()` membangun default URL sebagai `storagePublicUrl('apks', 'app-' + latest.version + '.apk')`.

### 2.3 Opsi C — skrip publish (upload + metadata sekaligus)

> ⚠️ **Hanya untuk APK kecil.** Skrip ini mengirim APK sebagai base64 di body JSON. Untuk `1.0.3` (15,6 MiB → base64 20,8 MiB) payload **melewati batas body Edge Function 20 MiB** dan request ditolak. Untuk `1.0.3` gunakan Opsi A + Opsi D (2.4). Opsi C tetap berguna untuk paket di bawah ~14 MiB.

```bash
node scripts/publish-apk.mjs \
  --apk="android/app/build/outputs/apk/release/Aplikasi Trip-release.apk" \
  --version=1.0.3 \
  --notes="Rilis full package 1.0.3 - verifikasi alur update manual (v1.0.2 ke v1.0.3)" \
  --min-version=1.0.2
```

Skrip ini: membaca APK → base64 → `POST /publish-version` → Edge Function menghitung SHA-256 & ukuran → mengunggah ke bucket `apks` sebagai `app-1.0.3.apk` → insert baris `app_versions`.

**Sekret:** header `x-publish-secret`, nilai dari env `PUBLISH_SECRET` (default repo: `trip-angkut-secret`).

Skrip juga memverifikasi bahwa `versionName` di dalam APK cocok dengan `--version` dan **menolak** bila beda — proteksi terhadap penerbitan paket salah label (bug yang pernah membuat versi di HP tidak pernah naik).

### 2.4 Insert metadata `app_versions` manual (via SQL Editor) — **disarankan untuk 1.0.3**

```sql
INSERT INTO app_versions (
  version, download_url, release_date, release_notes,
  is_force_update, min_version, apk_size, apk_hash,
  apk_version_name, apk_version_code
) VALUES (
  '1.0.3',
  'https://bmiruktfruunegtbydyw.supabase.co/storage/v1/object/public/apks/app-1.0.3.apk',
  now(),
  'Rilis full package 1.0.3 - verifikasi alur update manual (v1.0.2 ke v1.0.3)',
  false,
  '1.0.2',
  16345176,
  'ea51998095b8da0cbc6d11c686573274fbd311dd54b4cca13e578cccc47b51fc',
  '1.0.3',
  6
)
ON CONFLICT (version) DO UPDATE SET
  download_url = EXCLUDED.download_url,
  release_notes = EXCLUDED.release_notes,
  apk_size = EXCLUDED.apk_size,
  apk_hash = EXCLUDED.apk_hash,
  apk_version_name = EXCLUDED.apk_version_name,
  apk_version_code = EXCLUDED.apk_version_code,
  updated_at = now();
```

Isi `apk_hash` **wajib** diambil dari berkas yang benar-benar di-upload:

```bash
sha256sum "android/app/build/outputs/apk/release/Aplikasi Trip-release.apk"
stat -c%s "android/app/build/outputs/apk/release/Aplikasi Trip-release.apk"
```

---

## 3. Skema JSON — Endpoint Cek Versi

### 3.1 `GET /app-version?current=1.0.2`

**Request:**

```http
GET /functions/v1/api/app-version?current=1.0.2&t=1758540000000
Accept: application/json
```

**Response `200`:**

```json
{
  "latestVersion": "1.0.3",
  "updateAvailable": true,
  "isForceUpdate": false,
  "downloadUrl": "https://bmiruktfruunegtbydyw.supabase.co/storage/v1/object/public/apks/app-1.0.3.apk",
  "releaseNotes": "Rilis full package 1.0.3 - verifikasi alur update manual (v1.0.2 ke v1.0.3)",
  "apkSize": 16345176,
  "apkHash": "ea51998095b8da0cbc6d11c686573274fbd311dd54b4cca13e578cccc47b51fc",
  "minVersion": "1.0.2",
  "releaseDate": "2026-10-22T08:00:00+00:00",
  "apkAvailable": true
}
```

**Response `404`** — belum ada API versi / tidak ada baris rilis:

```json
{
  "latestVersion": "1.0.2",
  "updateAvailable": false,
  "downloadUrl": null,
  "releaseNotes": null
}
```

**Response `500`:**

```json
{ "error": "VERSION_CHECK_FAILED", "message": "Gagal memeriksa versi" }
```

### 3.2 Padanan nama field (spesifikasi ↔ API produksi)

| Konsep spesifikasi | Field API produksi | Tipe | Sumber nilai |
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

### 3.3 Endpoint lain

| Endpoint | Method | Keterangan |
|---|---|---|
| `/app-version?current=<v>` | GET | Cek versi (dipakai klien) |
| `/app-download/<versi>` | GET | `302` redirect ke URL Storage |
| `/release-notes/<versi>` | GET | Catatan rilis terstruktur (`notes[]` dengan `type`: feature/bugfix/security/improvement) |
| `/apk-list` | GET | Daftar seluruh versi yang terdaftar |
| `/report-version` | POST | Laporan versi terpasang per perangkat |
| `/device-versions` | GET | Rekap versi perangkat (butuh admin) |
| `/publish-version` | POST | Publikasi rilis (butuh `x-publish-secret`) |
| `/ota-manifest`, `/ota-versions`, `/publish-ota` | GET/POST | Kanal modul web — kanal cadangan, bukan jalur rilis 1.0.3 |

**Contoh `POST /report-version`:**

```json
{ "deviceId": "d4e5f6-…", "version": "1.0.3", "platform": "android" }
```

---

## 4. Izin Android Manifest

### 4.1 Izin yang wajib ada

```xml
<!-- Internet: cek versi + unduh APK -->
<uses-permission android:name="android.permission.INTERNET" />

<!-- Izin instalasi paket dari luar Play Store -->
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

### 4.2 `WRITE_EXTERNAL_STORAGE`

```xml
<!-- TIDAK dipakai — jangan ditambahkan -->
<!-- <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" /> -->
```

| Izin | Status di repo | Alasan |
|---|---|---|
| `INTERNET` | ✅ ada | Wajib untuk request API & unduhan APK |
| `REQUEST_INSTALL_PACKAGES` | ✅ ada | Wajib agar `Intent ACTION_VIEW` ke installer diizinkan |
| `WRITE_EXTERNAL_STORAGE` | ❌ tidak ada, **dan tidak perlu** | APK diunduh ke `Directory.Data` = `getFilesDir()` (storage privat aplikasi). Tidak butuh izin storage pada Android modern. Menambahnya hanya memperbesar permintaan izin. |

> Catatan: `WRITE_EXTERNAL_STORAGE` bahkan sudah deprecated sejak Android 10 (API 29). Pada Android 13+ (API 33+) digantikan `READ_MEDIA_*` yang juga tidak relevan di sini.

### 4.3 Izin lain yang sudah ada di repo (tidak terkait update)

`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `CAMERA` — untuk fitur geofence & swafoto.

### 4.4 Registrasi FileProvider (wajib)

```xml
<provider
    android:name="androidx.core.content.FileProvider"
    android:authorities="${applicationId}.fileprovider"
    android:exported="false"
    android:grantUriPermissions="true">
    <meta-data android:name="android.support.FILE_PROVIDER_PATHS"
               android:resource="@xml/file_paths" />
</provider>
```

### 4.5 Cleartext ke server LAN kantor (WAJIB untuk kirim data)

Aplikasi native (Capacitor/Android WebView) memuat halaman dari origin lokal
`https://localhost`. Dua hal WAJIB supaya request `http://192.168.1.123:3000`
(server intranet) tidak diblokir:

1. `capacitor.config.ts` → `android.allowMixedContent: true`
2. salin juga ke `android/app/src/main/assets/capacitor.config.json` (file ini
   yang dibaca runtime; `npx cap copy` menulis ulang isinya)

Dikombinasikan dengan `res/xml/network_security_config.xml`
(`cleartextTrafficPermitted="true"` untuk `192.168.1.123`).

Tanpa ini: petugas tidak bisa kirim data ke server intranet saat seluler
dimatikan, dan UI menampilkan "mixed content" walau Wi-Fi LAN sudah aktif.

---

`res/xml/file_paths.xml` **wajib** memuat `files-path` (tempat `Directory.Data` berada):

```xml
<paths>
    <external-path name="my_images" path="." />
    <cache-path name="my_cache_images" path="." />
    <files-path name="app_files" path="." />
</paths>
```

---

## 5. Build & Verifikasi

### 5.1 Naikkan versi

```bash
# Manual
#   android/app/build.gradle : versionCode 6 / versionName "1.0.3"
#   package.json             : "version": "1.0.3"

# Otomatis (package.json + build.gradle + version.json)
node scripts/sync-version.mjs 1.0.3 --code=6
```

> `sync-version.mjs` menaikkan `versionCode` **dengan syarat naik**; ia menolak nilai yang tidak naik. Opsi `--code=` memaksa nilai tertentu.
>
> ⚠️ **Perhatikan `version.json`.** Skrip ini juga menulis `version.json` menjadi `1.0.3+<timestamp>`. Berkas itu adalah manifest **kanal modul web** (saat ini `1.0.4+1792650248914`), bukan versi paket APK — menuliskannya dengan `1.0.3` akan **menurunkan** versi modul dan membuat kanal cadangan tidak pernah menawarkan pembaruan. Untuk rilis full-package, ubah `package.json` dan `android/app/build.gradle` **secara manual** (versi APK tidak bergantung pada `version.json`), atau kembalikan `version.json` ke nilainya semula setelah menjalankan skrip.

### 5.2 Build

```bash
npm run build                 # build web app → www/
cd android && ./gradlew assembleRelease
# output: android/app/build/outputs/apk/release/Aplikasi Trip-release.apk
```

### 5.3 Verifikasi paket

```bash
APK="android/app/build/outputs/apk/release/Aplikasi Trip-release.apk"

# 1) Versi & izin
~/android-sdk/build-tools/35.0.0/aapt dump badging "$APK" | head -3

# 2) Sertifikat tanda tangan (HARUS sama dengan versi terpasang)
~/android-sdk/build-tools/35.0.0/apksigner verify --print-certs "$APK" | head -3

# 3) Hash & ukuran (isi untuk tabel app_versions)
sha256sum "$APK"
stat -c%s "$APK"

# 4) Isi web bundle di dalam APK cocok dengan build lokal
unzip -p "$APK" assets/public/index.html | sha256sum
sha256sum www/index.html
```

**Hasil yang diharapkan untuk 1.0.3:**

```
package: name='com.plantation.tripangkut' versionCode='6' versionName='1.0.3' …
Signer #1 certificate DN: CN=Trip Angkutan, OU=Mobile, O=444Nazky, L=Pontianak, C=ID
Signer #1 certificate SHA-256 digest: 09f181c1c6fba02473345cfd515e49d0cc360c1dc6462eba7ddd3f72d4d3bce9
```

### 5.4 Audit konsistensi APK vs metadata

```bash
node scripts/verify-apks.mjs
```

Menghasilkan `SEMUA APK & METADATA KONSISTEN` bila nama berkas, `versionName` di dalam APK, dan metadata rilis saling cocok. Exit code 1 bila ada ketidakcocokan.

> ⚠️ **Keterbatasan skrip di repo ini.** `verify-apks.mjs` memindai direktori `backend/apks` dan `backend/metadata/versions.json` — keduanya **tidak ada** di repositori ini (metadata rilis kini berada di Supabase: tabel `app_versions` + bucket `apks`). Karena targetnya tidak ditemukan, skrip keluar dengan kode 0 tanpa memeriksa apa pun. Untuk rilis `1.0.3` lakukan verifikasi manual memakai perintah di bagian 5.3 (aapt badging + apksigner + sha256) dan cocokkan dengan baris `app_versions` di server.

---

## 6. Verifikasi Setelah Publish

```bash
# 1) Versi terbaru yang dilaporkan server
curl -s "https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api/app-version?current=1.0.2" | python3 -m json.tool
#    → latestVersion: "1.0.3", updateAvailable: true

# 2) Dari perangkat 1.0.3 → tidak ada update
curl -s "https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api/app-version?current=1.0.3" | python3 -m json.tool
#    → updateAvailable: false

# 3) APK benar-benar bisa diunduh
curl -sI "https://bmiruktfruunegtbydyw.supabase.co/storage/v1/object/public/apks/app-1.0.3.apk" | head -3
#    → HTTP/2 200, content-type: application/vnd.android.package-archive

# 4) Ukuran unduhan cocok dengan apkSize di DB
curl -sI "https://bmiruktfruunegtbydyw.supabase.co/storage/v1/object/public/apks/app-1.0.3.apk" | grep -i content-length

# 5) Daftar versi terdaftar
curl -s "https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api/apk-list" | python3 -m json.tool
```

**Hash yang diunduh harus cocok dengan `apk_hash` di DB:**

```bash
curl -s "https://bmiruktfruunegtbydyw.supabase.co/storage/v1/object/public/apks/app-1.0.3.apk" \
  | sha256sum
# harus sama dengan apkHash di respons /app-version
```

---

## 7. Nilai Rilis v1.0.3

| Atribut | Nilai |
|---|---|
| `version` | `1.0.3` |
| `versionCode` | `6` |
| `versionName` | `1.0.3` |
| `applicationId` | `com.plantation.tripangkut` |
| `minSdkVersion` | `24` (Android 7.0) |
| `targetSdkVersion` | `36` |
| Ukuran APK | `16345176` byte (≈15,6 MiB) |
| SHA-256 | `ea51998095b8da0cbc6d11c686573274fbd311dd54b4cca13e578cccc47b51fc` |
| Sertifikat SHA-256 | `09f181c1c6fba02473345cfd515e49d0cc360c1dc6462eba7ddd3f72d4d3bce9` |
| Object path (Storage) | `apks/app-1.0.3.apk` |
| Versi sebelumnya (terpasang) | `1.0.2`, `versionCode` `4` |

---

## 8. Perintah Diagnosa

```bash
# Log aplikasi (Android)
adb logcat | grep -Ei "Update|Version|ApkInstaller"

# Log Android Studio / devices
adb shell dumpsys package com.plantation.tripangkut | grep -E "versionName|versionCode"

# Cek izin unknown-apps
adb shell appops get com.plantation.tripangkut REQUEST_INSTALL_PACKAGES

# Izinkan instalasi untuk uji (opsional, hanya untuk perangkat uji)
adb shell appops set com.plantation.tripangkut REQUEST_INSTALL_PACKAGES allow

# Log server (Supabase)
supabase functions logs api --project-ref bmiruktfruunegtbydyw
```

---

## 9. Jebakan yang Sudah Terjadi (jangan ulangi)

| Jebakan | Gejala | Solusi |
|---|---|---|
| Nama objek APK tidak `app-<versi>.apk` | Unduhan 404 | Samakan dengan `app-1.0.3.apk` |
| `versionCode` tidak naik | `INSTALL_FAILED_VERSION_DOWNGRADE` | Naikkan `versionCode` (1.0.3 = 6) |
| Sertifikat tanda tangan berbeda | `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Pakai keystore `android/app/tripangkut.keystore` yang sama |
| `versionName` di dalam APK ≠ versi yang dipublikasikan | Versi di HP tidak pernah naik; popup update muncul selamanya | Cek dengan `aapt dump badging`; `publish-apk.mjs` menolak otomatis bila beda |
| Header anti-cache (`Cache-Control` dsb) ikut dikirim | Cek versi gagal total, diam-diam | Hanya kirim header `Accept` |
| `files-path` tidak ada di `file_paths.xml` | `Failed to find configured root` | Tambahkan `<files-path name="app_files" path="." />` |
| Versi ditulis setelah unduhan | Aplikasi mengklaim "sudah update" padahal belum terpasang | Tulis versi hanya setelah `App.getInfo()` berubah |
| `downloadUrl` relatif ditempel ke origin | 404 (`/api/api/...`) | Tempel ke `api.baseUrl` (lihat `resolveDownloadUrl()`) |
| Bucket Storage tidak public | 400/403 saat unduhan | Set **Public bucket = ON** |
| `app_versions.version` diberi stempel `1.0.3+123` | `publish-version` menolak format | Semver murni: `1.0.3` |
| APK "cocok" tapi hanya beberapa ratus byte | Installer terbuka lalu gagal | Cek `apkSize`; ambang minimum 1.000.000 byte |

---

## 10. Checklist Rilis

**Sebelum build**

- [ ] `android/app/build.gradle` → `versionCode 6`, `versionName "1.0.3"`
- [ ] `package.json` → `"version": "1.0.3"`
- [ ] `npx tsc --noEmit --skipLibCheck` → tanpa error
- [ ] `npm run build` → sukses
- [ ] `cd android && ./gradlew assembleRelease` → APK terbentuk

**Verifikasi paket**

- [ ] `aapt dump badging` → `versionName='1.0.3'`, `versionCode='6'`
- [ ] `apksigner verify` → sertifikat SHA-256 `09f181c1…`
- [ ] `sha256sum` & `stat -c%s` dicatat
- [ ] `unzip -p … assets/public/index.html` cocok dengan `www/index.html`
- [ ] `node scripts/verify-apks.mjs` → konsisten

**Publish**

- [ ] Upload `app-1.0.3.apk` ke bucket `apks` (public read ON)
- [ ] Baris `app_versions` untuk `1.0.3` ter-insert (dengan `apk_hash` & `apk_size` benar)
- [ ] `GET /app-version?current=1.0.2` → `latestVersion: "1.0.3"`, `updateAvailable: true`
- [ ] `curl -sI …/apks/app-1.0.3.apk` → `200`

**Uji lapangan**

- [ ] Perangkat uji masih di 1.0.2
- [ ] Tekan "Cek Update" → badge hijau "Paket APK 1.0.3 siap dipasang"
- [ ] Tekan "Update Sekarang" → dialog installer Android muncul
- [ ] Setujui → versi jadi 1.0.3
- [ ] Buka app lagi → "Aplikasi sudah versi terbaru"; `POST /report-version` terkirim

---

## 11. Rujukan Cepat

| Topik | Lokasi |
|---|---|
| Handler versi server | `supabase/functions/api/handlers/appVersion.ts` |
| Routing endpoint | `supabase/functions/api/index.ts` (≈ baris 248–259) |
| State machine update | `src/services/updateService.ts` |
| Adapter installer | `src/services/apkInstaller.ts` |
| Controller di atas UI | `src/services/appUpdate.ts` |
| Halaman Profil | `src/pages/mobile/ProfileScreen.tsx` |
| Plugin native | `android/app/src/main/java/com/plantation/tripangkut/ApkInstallerPlugin.java` |
| Manifest | `android/app/src/main/AndroidManifest.xml` |
| FileProvider paths | `android/app/src/main/res/xml/file_paths.xml` |
| Tabel DB | `supabase/scripts/create_ota_tables.sql` |
| Skrip rilis | `scripts/publish-apk.mjs`, `scripts/verify-apks.mjs`, `scripts/sync-version.mjs` |
| Dokumen lain | `user guide/architecture.md`, `user guide/workflow.md` |
