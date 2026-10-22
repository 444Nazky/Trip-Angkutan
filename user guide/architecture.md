# Arsitektur Sistem Update Aplikasi — Trip Angkutan v1.0.3

> **Status:** PRODUKSI — Full-Package APK Distribution via Supabase
> **Rilis aktif:** `1.0.3` (menggantikan `1.0.2`)
> **Tanggal:** 2026-10-22
> **Deprecasi:** Over-The-Air (OTA) **deprecated** — pembaruan kini didistribusikan sebagai **paket APK penuh** (full package), bukan patch/delta.

---

## 1. Ringkasan Arsitektur

Sistem pembaruan aplikasi mobile "Trip Angkutan" memakai model **self-hosted API update** yang sepenuhnya berjalan di atas Supabase. Tidak ada Play Store, tidak ada plugin OTA pihak ketiga, tidak ada patch delta.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    MOBILE CLIENT (Ionic/React + Capacitor)                │
│                                                                          │
│  ┌────────────────┐   ┌──────────────────┐   ┌────────────────────────┐  │
│  │ @capacitor/app │   │ @capacitor/      │   │ ApkInstallerPlugin     │  │
│  │ App.getInfo()  │   │ filesystem       │   │ (Java, milik proyek)  │  │
│  │ → versionName  │   │ download + read  │   │ → Intent ACTION_VIEW  │  │
│  └───────┬────────┘   └────────┬─────────┘   └───────────┬────────────┘  │
│          │                     │                         │               │
└──────────┼─────────────────────┼─────────────────────────┼───────────────┘
           │ GET /app-version     │ GET storage (binary)  │ content:// URI
           │ ?current=1.0.2       │ app-1.0.3.apk         │ + FileProvider
           ▼                     ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ SUPABASE EDGE FN     │  │ SUPABASE STORAGE     │  │ ANDROID PACKAGE      │
│ /functions/v1/api    │  │ bucket `apks` (public)│ │ MANAGER (system UI)  │
│                      │  │                      │  │                      │
│ • app-version (GET)  │  │ app-1.0.3.apk        │  │ dialog "Pasang"      │
│ • app-download (GET) │  │  (≈16 MB)            │  │ PackageInstaller     │
│ • report-version(POST)│  │                      │  │                      │
│ • publish-version    │  └──────────────────────┘  └──────────────────────┘
│   (POST)             │
│                      │
│ ┌──────────────────┐ │
│ │  TABEL DATABASE  │ │
│ │  app_versions    │ │
│ │  (metadata)      │ │
│ │  device_versions │ │
│ └──────────────────┘ │
└──────────────────────┘
```

Tiga komponen server yang terpisah secara sengaja:

| Komponen | Peran | Milik |
|---|---|---|
| **Edge Function `api`** | Orkestrasi: bandingkan versi, susun metadata rilis, catat versi perangkat | `supabase/functions/api/handlers/appVersion.ts` |
| **Supabase Storage** | Menyimpan *binary* APK (berkas besar, tidak cocok untuk baris DB) | bucket `apks` (public read) |
| **PostgreSQL (Supabase)** | Menyimpan *metadata* rilis (versi, hash, ukuran, catatan) | tabel `app_versions`, `device_versions` |

---

## 2. Komponen Klien & Peran Tiap File

| File | Tanggung jawab |
|---|---|
| `src/services/updateService.ts` | State machine update APK: cek versi → unduh → verifikasi hash → install. Sumber kebenaran versi lokal = `App.getInfo()` (Android App Info), bukan localStorage. |
| `src/services/apkInstaller.ts` | Adapter ke plugin native. Menormalisasi `file://` → path absolut, memanggil `ApkInstaller.install()`, guarded `isNativeAndroid()`. |
| `src/services/appUpdate.ts` | Controller Above UI: menggabungkan kanal APK & modul, menyimpan `AppUpdateState`, men-subscribe listener, mencegah proses ganda (`_checking` promise). |
| `src/components/UpdateNotifier.tsx` | Hook `useAppUpdate()` untuk UI status. Komponen notifier *default export* **tidak di-mount** di mana pun → **tidak ada auto-check** (lihat §6). |
| `src/pages/mobile/ProfileScreen.tsx` | Halaman Profil — **satu-satunya** pemicu manual: tombol "Cek Update" / "Update Sekarang". |
| `android/app/src/main/java/com/plantation/tripangkut/ApkInstallerPlugin.java` | Plugin Capacitor native: membuat `content://` URI via `FileProvider`, memanggil installer paket sistem. |
| `android/app/src/main/res/xml/file_paths.xml` | Deklarasi `files-path` agar `FileProvider` boleh membaca berkas di `getFilesDir()`. |
| `android/app/src/main/AndroidManifest.xml` | Izin `INTERNET` & `REQUEST_INSTALL_PACKAGES`; registrasi `FileProvider` ber-otoritas `${applicationId}.fileprovider`. |

---

## 3. Komunikasi Klien → Server

### 3.1 Cek Versi (version check)

```
GET https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api/app-version
      ?current=1.0.2&t=1758540000000
Accept: application/json
```

* `current` = versi native terpasang (dari `App.getInfo().version`, mis. `1.0.2`).
* `t` = timestamp anti-cache.
* **Header anti-cache sengaja hanya `Accept`.** Header `Cache-Control`/`Pragma`/`Expires` memicu preflight CORS pada Edge Function dan membuat seluruh cek versi gagal diam-diam. Anti-cache diwujudkan lewat `cache: 'no-store'` + query `t=`.

Respons `200 OK`:

```json
{
  "latestVersion": "1.0.3",
  "updateAvailable": true,
  "isForceUpdate": false,
  "downloadUrl": "https://bmiruktfruunegtbydyw.supabase.co/storage/v1/object/public/apks/app-1.0.3.apk",
  "releaseNotes": "Rilis full package 1.0.3 ...",
  "apkSize": 16345176,
  "apkHash": "ea51998095b8da0cbc6d11c686573274fbd311dd54b4cca13e578cccc47b51fc",
  "minVersion": null,
  "releaseDate": "2026-10-22T08:00:00+00:00",
  "apkAvailable": true
}
```

> **Catatan penamaan field.** API produksi memakai nama field `latestVersion` / `downloadUrl` / `apkSize` / `apkHash` (camelCase). Konsep `version_code` / `version_name` / `apk_url` pada spesifikasi Clima adalah padanan logisnya:
>
> | Konsep spesifikasi | Field API produksi | Sumber |
> |---|---|---|
> | `version_code` | `apkVersionCode` (kolom DB) | `versionCode` di AndroidManifest |
> | `version_name` | `latestVersion` / `apkVersionName` (kolom DB) | `versionName` di AndroidManifest |
> | `apk_url` | `downloadUrl` | `download_url` di `app_versions`, default `storagePublicUrl('apks', 'app-<version>.apk')` |

Kode status yang ditangani klien:

| Status | Arti | Perilaku klien |
|---|---|---|
| `200` | Metadata valid | Lanjut: `updateAvailable`? download : `up-to-date` |
| `404` | API versi belum tersedia | Dianggap `up-to-date` (bukan error) |
| `500` | Gagal baca DB | `NETWORK_ERROR`, tampilkan pesan, **jangan** diam-diam bilang "terbaru" |
| `null` (gagal jaringan) | Timeout/offline | `NETWORK_ERROR` |

### 3.2 Unduh APK (binary)

```
GET https://bmiruktfruunegtbydyw.supabase.co/storage/v1/object/public/apks/app-1.0.3.apk?t=...
→ 200 application/vnd.android.package-archive   (≈16 MB, streaming)
```

Bucket `apks` ber-izin **public read**; tidak perlu signed URL. URL absolut dari server langsung dipakai apa adanya. (Bila `downloadUrl` relatif, `resolveDownloadUrl()` menempelkannya ke `api.baseUrl` — bukan ke origin — agar path `/api/...` tidak jadi `/api/api/...`.)

### 3.3 Laporkan Versi Perangkat (telemetry)

```
POST /functions/v1/api/report-version
Content-Type: application/json
{ "deviceId": "<uuid>", "version": "1.0.3", "platform": "android" }
```

Dipanggil otomatis oleh `refreshInstalledVersion()` **hanya ketika versi native benar-benar berubah** — yaitu setelah APK baru benar-benar terpasang, bukan setelah paket selesai diunduh. Ini yang mencegah klaim "sudah update" yang palsu.

---

## 4. Manifest Android & Izin

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

* **INTERNET** — wajib untuk cek versi & unduh APK.
* **REQUEST_INSTALL_PACKAGES** — wajib agar sistem mengizinkan instalasi APK dari luar Play Store. Tanpa ini, `Intent ACTION_VIEW` ke installer ditolak.

`WRITE_EXTERNAL_STORAGE` **tidak ada** dan **tidak diperlukan**: APK diunduh ke `Directory.Data` = `getFilesDir()` (storage privat aplikasi), yang tidak butuh izin storage pada Android modern. Menambahkan izin tersebut justru memperbesar permintaan izin tanpa ada gunanya.

### 4.1 Registrasi FileProvider

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

`res/xml/file_paths.xml` **wajib** memuat `files-path`:

```xml
<paths>
    <external-path name="my_images" path="." />
    <cache-path name="my_cache_images" path="." />
    <files-path name="app_files" path="." />   <!-- ← Directory.Data -->
</paths>
```

Tanpa entri `files-path`, `FileProvider` melempar `IllegalArgumentException: Failed to find configured root` dan installer tidak pernah terbuka.

---

## 5. Intent Android & Instalasi Paket

Rantai panggilan yang terjadi di perangkat:

```
src/services/updateService.ts  → installUpdate()
  └─ Filesystem.getUri({ path: 'updates/app-1.0.3.apk', directory: Data })
       └─ openApkInstaller(uri)                       [apkInstaller.ts]
            └─ ApkInstaller.install({ path })         [plugin Capacitor]
                 └─ FileProvider.getUriForFile(ctx, "com.plantation.tripangkut.fileprovider", apk)
                      └─ new Intent(Intent.ACTION_VIEW)
                         .setDataAndType(uri, "application/vnd.android.package-archive")
                         .addFlags(FLAG_GRANT_READ_URI_PERMISSION)
                         .addFlags(FLAG_ACTIVITY_NEW_TASK)
                         └─ startActivity(intent) → Android PackageInstaller
```

**Mengapa `ACTION_VIEW` + `FileProvider` (bukan `file://` langsung):**
Android 7+ (`FileUriExposedException`) melarang intent ke `file://`. `FileProvider` menerjemahkan path absolut di `getFilesDir()` menjadi `content://com.plantation.tripangkut.fileprovider/...` yang aman & complies.
`FLAG_GRANT_READ_URI_PERMISSION` wajib — installer berjalan di proses berbeda sehingga harus diberi izin baca eksplisit.
`FLAG_ACTIVITY_NEW_TASK` wajib karena `startActivity` dipanggil dari `Plugin` yang tidak berganti Activity.

**Konsekuensi penting:** installer yang terbuka **bukan** berarti versi terpasang. Pengguna bisa membatalkan. `installUpdate()` karena itu **tidak** menulis versi baru; versi hanya dianggap sah setelah `App.getInfo()` mengembalikan `1.0.3` saat aplikasi hidup lagi.

---

## 6. Pemicu Manual (Invarian)

Tidak ada pembaruan otomatis. Invarian yang dijaga kode:

1. `appUpdate.check()` **hanya** dipanggil dari `ProfileScreen.checkNow()` (tombol "Cek Update"). Komponen `UpdateNotifier` default-export tidak di-mount di mana pun → tidak ada polling, tidak ada cek saat startup.
2. `App.tsx` pada `appStateChange(isActive)` hanya memanggil `appUpdate.syncInstalledVersion()` — membaca versi native lokal, **tidak** melakukan request jaringan.
3. `AppUpdateController.check()` memakai guard `_checking` sehingga klik ganda tidak memicu dua proses unduh.
4. `LOCALHOST_UPDATE_DISABLED` mematikan seluruh alur update ketika dijalankan di `localhost`/port dev, agar build lokal tidak memicu unduhan APK.

Dengan invarian ini, satu-satunya jalan menuju instalasi baru adalah: **petugas membuka Profil → menekan tombol**.

---

## 7. View Layer

```
              ┌─────────────────────────────────────────┐
              │  ProfileScreen — "Pembaruan Aplikasi"    │
              └─────────────────────────────────────────┘
                              │ useAppUpdate()
                              ▼
   ┌───────────────────────────────────────────────────────────┐
   │  state.status      │ kind  │ version │  label tombol     │
   ├────────────────────┼───────┼─────────┼───────────────────┤
   │ idle / offline     │  –    │   –     │ "Cek Update"      │
   │ checking           │  –    │   –     │ "Memeriksa…"      │
   │ downloading        │ apk   │ 1.0.3   │ "Mengunduh…"       │
   │ ready              │ apk   │ 1.0.3   │ "Update Sekarang"  │ ← hijau
   │ installing         │ apk   │ 1.0.3   │ "Memasang…"        │
   │ up-to-date         │  –    │   –     │ "Sudah Terbaru"    │ (disabled)
   │ error              │ apk   │   –     │ "Coba Lagi"        │
   └────────────────────┴───────┴─────────┴───────────────────┘
```

Kanal APK diperiksa **lebih dulu**; bila server menyediakan paket baru, kanal modul web tidak dievaluasi. Badge hijau "Paket APK 1.0.3 siap dipasang" muncul di bawah tombol, memberi instraksi eksplisit — satu tombol, tanpa menebak.

---

## 8. Model Data (Supabase PostgreSQL)

### 8.1 `app_versions` — metadata rilis

| Kolom | Tipe | Isi untuk v1.0.3 |
|---|---|---|
| `id` | `uuid` | PK |
| `version` | `text` UNIQUE | `1.0.3` (harus cocok `^\d+\.\d+\.\d+$`) |
| `download_url` | `text` | URL Storage publik `…/apks/app-1.0.3.apk` |
| `release_date` | `timestamptz` | timestamp publikasi |
| `release_notes` | `text` | catatan rilis |
| `is_force_update` | `boolean` | `false` (manual, tidak dipaksa) |
| `min_version` | `text` | `null` |
| `apk_size` | `bigint` | `16345176` |
| `apk_hash` | `text` | SHA-256 hex `ea519980…` |
| `apk_version_name` | `text` | `1.0.3` (nama versi **di dalam** APK) |
| `apk_version_code` | `integer` | `6` (kode versi **di dalam** APK) |
| `created_at` / `updated_at` | `timestamptz` | default `now()` |

### 8.2 `device_versions` — versi terpasang per perangkat

| Kolom | Tipe | Isi |
|---|---|---|
| `device_id` | `text` | UUID perangkat (upsert, conflict target) |
| `version` | `text` | versi native terpasang, mis. `1.0.3` |
| `platform` | `text` | `android` |
| `last_seen` | `timestamptz` | heartbeat |

---

## 9. Ringkasan Alur End-to-End (v1.0.2 → v1.0.3)

```
 PETUGAS                EDGE FUNCTION            STORAGE            DB            ANDROID
   │                        │                     │                 │              │
   │── buka Profil ─────────┤                     │                 │              │
   │── tekan "Cek Update" ──▶│                     │                 │              │
   │                        │── SELECT app_versions (latest) ────────▶│              │
   │                        │◀─ 1.0.3, hash, url ────────────────────│              │
   │◀─ 200 metadata ────────│                     │                 │              │
   │                        │                     │                 │              │
   │── GET app-1.0.3.apk ─────────────────────────▶│                 │              │
   │◀─ binary 16 MB ──────────────────────────────│                 │              │
   │                        │                     │                 │              │
   │  [verifikasi SHA-256 vs apkHash]              │                 │              │
   │  simpan → getFilesDir()/updates/app-1.0.3.apk │                 │              │
   │                        │                     │                 │              │
   │── tekan "Update Sekarang" ──────────────────────────────────────────────▶│
   │                        │                     │                 │   ACTION_VIEW│
   │                        │                     │                 │   FileProvider
   │                        │                     │                 │   → dialog   │
   │── setujui dialog ─────────────────────────────────────────────────────▶│
   │                        │                     │                 │   terpasang  │
   │                        │                     │                 │              │
   │── app dibuka lagi → App.getInfo() = 1.0.3 ─────────────────────────────▶│
   │                        │                     │                 │              │
   │                        │◀─ POST /report-version {1.0.3} ────────│              │
   │   "Aplikasi sudah versi terbaru"            │                 │              │
```

---

## 10. Kenapa Arsitektur Ini (dan Kenapa OTA Lama Dihapus)

**Kegagalan OTA lama (dokumentasi di `OTA-UPDATE-SYSTEM.md`):** manifest & aset pernah tidak ikut ter-*stage* ke repo publish (`.gitignore` memblokir `version.json`), sehingga klien menerima `404` → update selalu tampil "tidak ada pembaruan" berapa kali pun rilis dibuat. Ditambah patching binary di WebView Android selalu menyisakan cache & state lawas sehingga "update kedua" selalu gagal dan menuntut "Clear Data" manual.

**Arsitektur sekarang menjamin:**
* Satu endpoint, satu sumber kebenaran (tabel `app_versions`), tanpa risiko manifest yang hilang.
* Full package (bukan delta) → tidak ada state patch parsial yang bisa rusak.
* SHA-256 diverifikasi **sebelum** installer ditawarkan → paket rusak atau terpotong terdeteksi, bukan dipasang.
* Metadata & biner dipisah → query versi tetap ringan walau APK 16 MB.
* Pemicu manual → petugas tidak pernah dipaksa mengunduh 16 MB di jaringan seluler tanpa ia tahu.

---

## 11. Catatan & Kendala Aktual

> **Penting untuk pembaca dokumen ini.** Kanal modul web yang masih ada di repository (`src/services/ota.ts`, `/ota-manifest`, `/publish-ota`, tabel `ota_bundles`, berkas `version.json` versi `1.0.4+…`) **belum dihapus secara fisik** pada rilis `1.0.3`. Rilis ini berfokus pada jalur **full package APK**; jalur modul web masih hidup sebagai kanal cadangan dan dipanggil *hanya* bila kanal APK tidak menyediakan paket baru (`appUpdate.runCheck()` → `apkInfo?.updateAvailable && updateService.state === 'ready'`).

* Kontrak "OTA dihapus permanen" berarti penghapusan total kode modul (`ota.ts`, `sw.js`, `publish-ota`, `ota_bundles`) pada rilis berikutnya — **belum** dilakukan pada `1.0.3`.
* Rilis `1.0.3` tidak mengubah logika fungsional apa pun; hanya menaikkan versi dan memverifikasi paket penuh.
* Metadata rilis pada server saat dokumen ini dibuat masih menunjuk `1.0.1`, dan objek `apks/app-1.0.1.apk` **tidak ada** di bucket Storage (404 `NoSuchKey`). Upload `app-1.0.3.apk` + insert baris `app_versions` adalah langkah yang wajib dijalankan sebelum uji lapangan (perintah ada di `cheatsheet.md` §2).
* Bucket `apks` **wajib** public read; tanpa itu `downloadUrl` menghasilkan 400/403 dan unduhan selalu gagal.
* `app_versions.version` **wajib** semver murni (`1.0.3`, tanpa `+timestamp`) karena `publish-version` menolak format lain, dan `compareVersionsNoStamp()` membuang stempel sebelum perbandingan.

---

## 12. Rujukan File

| Topik | Lokasi |
|---|---|
| Handler versi | `supabase/functions/api/handlers/appVersion.ts` |
| Routing endpoint | `supabase/functions/api/index.ts` (bagian "app update / OTA", baris ~248–259) |
| State machine update | `src/services/updateService.ts` |
| Adapter installer | `src/services/apkInstaller.ts` |
| Controller Above UI | `src/services/appUpdate.ts` |
| Halaman Profil | `src/pages/mobile/ProfileScreen.tsx` |
| Plugin native | `android/app/src/main/java/com/plantation/tripangkut/ApkInstallerPlugin.java` |
| Manifest & FileProvider | `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/xml/file_paths.xml` |
| Versi build | `android/app/build.gradle` (`versionCode` / `versionName`), `package.json` |
| Skrip rilis | `scripts/publish-apk.mjs`, `scripts/verify-apks.mjs`, `scripts/sync-version.mjs` |
