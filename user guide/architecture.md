# Arsitektur Sistem Update Aplikasi — Trip Angkutan

> **Status:** PRODUKSI — Full-Package APK Distribution via **server API intranet**
> **Rilis aktif:** `1.0.3` (menggantikan `1.0.2`)
> **Tanggal:** 2026-10-29
> **Model:** paket APK penuh (bukan patch/delta), distribution sendiri — tanpa Play Store.
> **Server rilis (LAN kantor):** `http://192.168.1.123:3000` (`ubuntu.local`)

---

## 1. Ringkasan Arsitektur

Sistem pembaruan aplikasi mobile "Trip Angkutan" memakai model **self-hosted API
update**: aplikasi menanyakan versinya ke server, lalu menarik paket APK penuh
(±16 MB) dan memasangkannya lewat installer sistem Android.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    MOBILE CLIENT (Angular + Capacitor)                   │
│                                                                          │
│  ┌────────────────┐   ┌──────────────────┐   ┌────────────────────────┐  │
│  │ @capacitor/app │   │ @capacitor/      │   │ ApkInstallerPlugin     │  │
│  │ App.getInfo()  │   │ filesystem       │   │ (Java, milik proyek)  │  │
│  │ → versionName  │   │ download + read  │   │ → Intent ACTION_VIEW  │  │
│  └───────┬────────┘   └────────┬─────────┘   └───────────┬────────────┘  │
│          │                     │                         │               │
└──────────┼─────────────────────┼─────────────────────────┼───────────────┘
           │ GET /app-version     │ GET /files/apks/…      │ content:// URI
           │ ?current=1.0.2       │ app-1.0.3.apk          │ + FileProvider
           ▼                     ▼                         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SERVER INTRANET (ubuntu.local — Deno, port 3000)                       │
│                                                                          │
│  ROUTER  server/api/index.ts                                           │
│    • app-version (GET)        → metadata rilis dari tabel app_versions  │
│    • app-download/:version(GET)→ redirect ke berkas lokal                │
│    • release-notes/:version(GET)                                       │
│    • apk-list (GET)                                                 │
│    • report-version (POST)     → device_versions (upsert)               │
│    • publish-version (POST)    → unggah APK + INSERT app_versions       │
│    • admin/import (POST)       → impor massal (Appel untuk republish)   │
│                                                                          │
│  BERKAS   STORAGE_DIR/apks/app-<versi>.apk      ← bind-mount ./data/storage
│  DISERAHKAN /files/<bucket>/<path>              (server/api/_db.ts)     │
│                                                                          │
│  DATABASE  PostgreSQL lokal ← PostgREST (POSTGREST_URL)                 │
│    • app_versions   (metadata rilis: versi, hash, ukuran, catatan)      │
│    • device_versions(versi terpasang per perangkat)                      │
└──────────────────────────────────────────────────────────────────────────┘
           │                                            ▼
           │                              ┌───────────────────────────────┐
           │                              │ ANDROID PACKAGE MANAGER       │
           │                              │ dialog "Pasang aplikasi ini?" │
           │                              │ → terpasang, versi naik       │
           │                              └───────────────────────────────┘
```

Tiga komponen server yang terpisah secara sengaja:

| Komponen | Peran | Milik |
|---|---|---|
| **Router API (Deno)** | Orkestrasi: bandingkan versi, susun metadata rilis, catat versi perangkat | `server/api/index.ts`, `server/api/handlers/appVersion.ts` |
| **Penyimpanan lokal (disk)** | Menyimpan *binary* APK (16 MB tidak cocok untuk baris DB) | direktori `STORAGE_DIR` → bucket `apks` |
| **PostgreSQL (via PostgREST)** | Menyimpan *metadata* rilis | tabel `app_versions`, `device_versions` |

### 1.1 Dua endpoint, satu kode

Aplikasi mobile punya dua pilihan server yang dipilih petugas di
**Profil → Server / Endpoint**:

| Endpoint | URL | Kapan dipakai |
|---|---|---|
| Supabase (cloud) | `https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api` | Default, butuh internet |
| **Intranet kantor (LAN)** | `http://192.168.1.123:3000/api` | Di kantor, tanpa internet |

Kode API-nya sama persis; yang membedakan hanya lokasi server dan tempat
berkasnya disimpan. Rilis untuk uji lapangan dipakai **server intranet**,
karena berkas APK-nya berada di disk kantor — petugas tetap bisa menarik
pembaruan saat internet mati.

> Berkas APK **tidak pernah** diambil dari host lain. `publish-version` menolak
> `downloadUrl` yang menunjuk origin lain; berkas wajib dikirim sebagai isi
> (`apkBase64`) supaya tersimpan di disk server.

---

## 2. Komponen Klien & Peran Tiap File

| File | Tanggung jawab |
|---|---|
| `src/services/updateService.ts` | State machine update APK: cek versi → unduh → verifikasi hash → install. Sumber kebenaran versi lokal = `App.getInfo()` (App Info Android), bukan localStorage. |
| `src/services/apkInstaller.ts` | Adapter ke plugin native. Menormalisasi `file://` → path absolut, memanggil `ApkInstaller.install()`, guarded `isNativeAndroid()`. |
| `src/services/appUpdate.ts` | Controller Above UI: menggabungkan kanal APK & modul, menyimpan `AppUpdateState`, mencegah proses ganda (promise `_checking`). |
| `src/services/ota.ts` | Kanal **modul web** (cadangan). Dipakai hanya bila kanal APK tidak menyediakan paket baru. |
| `src/components/UpdateNotifier.tsx` | Hook `useAppUpdate()` untuk UI status. Komponen notifier *default export* **tidak di-mount** di mana pun → **tidak ada auto-check** (lihat §6). |
| `src/pages/mobile/ProfileScreen.tsx` | Halaman Profil — **satu-satunya** pemicu manual: tombol "Cek & Perbarui Aplikasi" / "Perbarui Sekarang". |
| `android/app/src/main/java/com/plantation/tripangkut/ApkInstallerPlugin.java` | Plugin Capacitor native: membuat `content://` URI via `FileProvider`, memanggil installer paket sistem. |
| `android/app/src/main/res/xml/file_paths.xml` | Deklarasi `files-path` agar `FileProvider` boleh membaca berkas di `getFilesDir()`. |
| `android/app/src/main/AndroidManifest.xml` | Izin `INTERNET` & `REQUEST_INSTALL_PACKAGES`; registrasi `FileProvider` ber-otoritas `${applicationId}.fileprovider`. |

---

## 3. Komunikasi Klien → Server

### 3.1 Cek Versi (version check)

```
GET http://192.168.1.123:3000/api/app-version?current=1.0.2&t=1758540000000
Accept: application/json
```

* `current` = versi native terpasang (dari `App.getInfo().version`, mis. `1.0.2`).
* `t` = timestamp anti-cache.
* **Header anti-cache sengaja hanya `Accept`.** Header `Cache-Control`/`Pragma`/`Expires` memicu preflight CORS dan membuat seluruh cek versi gagal diam-diam. Anti-cache diwujudkan lewat `cache: 'no-store'` + query `t=`.

Respons `200 OK`:

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

> **Catatan penamaan field.** Field produksi: `latestVersion` / `downloadUrl` /
> `apkSize` / `apkHash` (camelCase). Padanan logisnya:
>
> | Konsep | Field API produksi | Sumber |
> |---|---|---|
> | `version_code` | `apkVersionCode` (kolom DB) | `versionCode` di AndroidManifest |
> | `version_name` | `latestVersion` / `apkVersionName` (kolom DB) | `versionName` di AndroidManifest |
> | `apk_url` | `downloadUrl` | `app_versions.download_url` (disimpan **relatif**: `/files/apks/app-<versi>.apk`) |

Path disimpan relatif supaya tetap valid saat alamat IP PC kantor berubah;
server menyelesaikan path relatif terhadap origin request yang sedang melayani
klien.

Kode status yang ditangani klien:

| Status | Arti | Perilaku klien |
|---|---|---|
| `200` | Metadata valid | Lanjut: `updateAvailable`? download : `up-to-date` |
| `404` | API versi belum tersedia | Dianggap `up-to-date` (bukan error) |
| `500` | Gagal baca DB | `NETWORK_ERROR`, tampilkan pesan, **jangan** diam-diam bilang "terbaru" |
| `null` (gagal jaringan) | Timeout/offline | `NETWORK_ERROR` |

### 3.2 Unduh APK (binary)

```
GET http://192.168.1.123:3000/files/apks/app-1.0.3.apk?t=...
→ 200 application/vnd.android.package-archive   (≈16 MB)
```

Disajikan langsung dari disk server oleh `serveStoredFile()`
(`server/api/_db.ts`), tanpa lewat database. Path `/api/files/...` juga
diterima karena sebagian klien menyusun URL dari base URL API.

### 3.3 Laporkan Versi Perangkat (telemetry)

```
POST /api/report-version
Content-Type: application/json
{ "deviceId": "<uuid>", "version": "1.0.3", "platform": "android" }
```

Dipanggil otomatis oleh `refreshInstalledVersion()` **hanya ketika versi native
benar-benar berubah** — yaitu setelah APK baru benar-benar terpasang, bukan
setelah paket selesai diunduh. Ini yang mencegah klaim "sudah update" yang
palsu.

---

## 4. Manifest Android & Izin

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

* **INTERNET** — wajib untuk cek versi & unduh APK.
* **REQUEST_INSTALL_PACKAGES** — wajib agar sistem mengizinkan instalasi APK dari luar Play Store. Tanpa ini, `Intent ACTION_VIEW` ke installer ditolak.

`WRITE_EXTERNAL_STORAGE` **tidak ada** dan **tidak diperlukan**: APK diunduh
ke `Directory.Data` = `getFilesDir()` (storage privat aplikasi), yang tidak
butuh izin storage pada Android modern.

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
    <cache-path name="my_cache" path="." />
    <files-path name="app_files" path="." />   <!-- ← Directory.Data -->
</paths>
```

Tanpa entri `files-path`, `FileProvider` melempar
`IllegalArgumentException: Failed to find configured root` dan installer tidak
pernah terbuka.

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
Android 7+ (`FileUriExposedException`) melarang intent ke `file://`.
`FileProvider` menerjemahkan path absolut di `getFilesDir()` menjadi
`content://com.plantation.tripangkut.fileprovider/...` yang aman.
`FLAG_GRANT_READ_URI_PERMISSION` wajib — installer berjalan di proses berbeda.
`FLAG_ACTIVITY_NEW_TASK` wajib karena `startActivity` dipanggil dari `Plugin`
yang tidak berganti Activity.

**Konsekuensi penting:** installer yang terbuka **bukan** berarti versi
terpasang. Pengguna bisa membatalkan. `installUpdate()` karena itu **tidak**
menulis versi baru; versi hanya dianggap sah setelah `App.getInfo()`
mengembalikan `1.0.3` saat aplikasi hidup lagi.

---

## 6. Pemicu Manual (Invarian)

Tidak ada pembaruan otomatis. Invarian yang dijaga kode:

1. `appUpdate.check()` **hanya** dipanggil dari `ProfileScreen.checkNow()`
   (tombol di halaman Profil). Komponen `UpdateNotifier` default-export tidak
   di-mount di mana pun → tidak ada polling, tidak ada cek saat startup.
2. `App.tsx` pada `appStateChange(isActive)` hanya memanggil
   `appUpdate.syncInstalledVersion()` — membaca versi native lokal, **tidak**
   melakukan request jaringan.
3. `AppUpdateController.check()` memakai guard `_checking` sehingga klik ganda
   tidak memicu dua proses unduh.
4. `LOCALHOST_UPDATE_DISABLED` mematikan seluruh alur update **hanya di browser
   dev server** (`localhost`, `127.0.0.1`, `::1`, atau port
   `5173/5174/3000/4200/8080`), agar build lokal tidak memicu unduhan APK.
   **Aplikasi native dikecualikan** — `isLocalhostDev()`
   (`src/services/runtimeEnv.ts`) keluar lebih dulu bila
   `Capacitor.isNativePlatform()` true. Ini penting: aplikasi Android memuat
   halamannya dari origin lokal `https://localhost`, jadi tanpa pengecualian
   ini tombol "Cek Update" mati total di perangkat.

Dengan invarian ini, satu-satunya jalan menuju instalasi baru adalah:
**petugas membuka Profil → menekan tombol**.

> Catatan: **unduhan** dan **pemasangan** itu dua hal berbeda. Unduhan terjadi
> sebagai bagian dari "Cek & Perbarui" (tombol yang sama). **Pemasangan**
> (installer Android) hanya terjadi setelah petugas menekan tombol
> "Perbarui Sekarang" — tidak pernah otomatis.

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
   │ idle / offline     │  –    │   –     │ "Cek & Perbarui"  │
   │ checking           │  –    │   –     │ "Memeriksa…"      │
   │ downloading        │ apk   │ 1.0.3   │ "Mengunduh…"       │
   │ ready              │ apk   │ 1.0.3   │ "Perbarui Sekarang"│ ← hijau
   │ installing         │ apk   │ 1.0.3   │ "Memasang…"        │
   │ up-to-date         │  –    │   –     │ "Sudah Terbaru"    │ (disabled)
   │ error              │ apk   │   –     │ "Coba Lagi"        │
   └────────────────────┴───────┴─────────┴───────────────────┘
```

Kanal APK diperiksa **lebih dulu**; bila server menyediakan paket baru, kanal
modul web tidak dievaluasi. Badge hijau "Paket APK 1.0.3 siap dipasang" muncul
di bawah tombol, memberi instruksi eksplisit — satu tombol, tanpa menebak.

---

## 8. Model Data (PostgreSQL lokal)

### 8.1 `app_versions` — metadata rilis

| Kolom | Tipe | Isi untuk v1.0.3 |
|---|---|---|
| `id` | `uuid` | PK |
| `version` | `text` UNIQUE | `1.0.3` (harus cocok `^\d+\.\d+\.\d+$`) |
| `download_url` | `text` | `/files/apks/app-1.0.3.apk` (relatif) |
| `release_date` | `timestamptz` | timestamp publikasi |
| `release_notes` | `text` | catatan rilis |
| `is_force_update` | `boolean` | `false` (manual, tidak dipaksa) |
| `min_version` | `text` | `1.0.2` |
| `apk_size` | `bigint` | `16361480` |
| `apk_hash` | `text` | SHA-256 hex `0ffac76a…` |
| `apk_version_name` | `text` | `1.0.3` (nama versi **di dalam** APK) |
| `apk_version_code` | `integer` | `12` (kode versi **di dalam** APK) |
| `created_at` / `updated_at` | `timestamptz` | default `now()` |

> **`version` itu UNIQUE.** consequence: satu versi hanya boleh terbit satu
> kali. Publish kedua untuk versi yang sama ditolak `500` — lihat
> `cheatsheet.md` §4.

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
 PETUGAS               SERVER INTRANET            DISK            ANDROID
   │                        │                     │                 │
   │── buka Profil ─────────┤                     │                 │
   │── tekan "Cek & Perbarui" ▶│                  │                 │
   │                        │── SELECT app_versions (latest) ─▶ DB    │
   │                        │◀─ 1.0.3, hash, url ──────────────│      │
   │◀─ 200 metadata ────────│                     │                 │
   │                        │                     │                 │
   │── GET /files/apks/app-1.0.3.apk ────────────▶│                 │
   │◀─ binary 16 MB ─────────────────────────────│                 │
   │  [verifikasi SHA-256 vs apkHash]             │                 │
   │  simpan → getFilesDir()/updates/app-1.0.3.apk                  │
   │                        │                     │                 │
   │── tekan "Perbarui Sekarang" ─────────────────────────────────────▶│
   │                        │                     │   ACTION_VIEW   │
   │                        │                     │   FileProvider   │
   │── setujui dialog ──────────────────────────────────────────────▶│
   │                        │                     │   terpasang      │
   │── app dibuka lagi → App.getInfo() = 1.0.3 ─────────────────────▶│
   │                        │◀─ POST /report-version {1.0.3} ──│      │
   │   "Aplikasi sudah versi terbaru"                                  │
```

---

## 10. Kenapa Arsitektur Ini

* **Satu endpoint, satu sumber kebenaran** (tabel `app_versions`), tanpa
  risiko manifest modul yang hilang seperti pada OTA lawas.
* **Full package (bukan delta)** → tidak ada state patch parsial yang bisa
  rusak, dan tidak ada cache lawas di WebView yang menuntut "Clear Data".
* **SHA-256 diverifikasi sebelum installer ditawarkan** → paket rusak atau
  terpotong terdeteksi, bukan dipasang.
* **Metadata & biner dipisah** → query versi tetap ringan walau APK 16 MB.
* **Berkas di disk kantor** → pembaruan tetap bisa ditarik saat internet mati.
* **Pemicu manual** → petugas tidak pernah dipaksa mengunduh 16 MB tanpa ia
  tahu.

---

## 11. Catatan & Kendala Aktual

* Kanal modul web (`src/services/ota.ts`, `/ota-manifest`, `/publish-ota`,
  tabel `ota_bundles`, berkas `version.json` versi `1.0.5+…`) **masih hidup**
  sebagai kanal cadangan dan hanya dipanggil bila kanal APK tidak
  menyediakan paket baru. **Jangan** menaikkan versi APK ke nilai `version.json`
  — keduanya dua garis versi yang terpisah.
* `app_versions.version` **wajib** semver murni (`1.0.3`, tanpa `+timestamp`)
  karena `publish-version` menolak format lain.
* APK harus ditandatangani **keystore yang sama** dengan versi yang terpasang
  di HP, dan `versionCode` harus naik. Keduanya dicek sebelum rilis (lihat
  `cheatsheet.md` §3).
* Endpoint `publish-version` **menyimpan berkas ke disk lebih dulu, baru
  menulis baris database**. Bila baris gagal ditulis (versi sudah ada),
  berkas baru sudah ada di disk sementara hash di database masih yang lama →
  perangkat reporting "Hash APK tidak cocok". Pakai `publish-apk-republish.mjs`
  untuk|Publication ulang versi yang sama.

---

## 12. Rujukan File

| Topik | Lokasi |
|---|---|
| Handler versi | `server/api/handlers/appVersion.ts` |
| Routing endpoint | `server/api/index.ts` (bagian "app update / OTA") |
| Penyimpanan berkas lokal | `server/api/_db.ts` (`serveStoredFile`, `db.storage`) |
| Server intranet (Deno) | `server/api/local_server.ts` |
| State machine update | `src/services/updateService.ts` |
| Adapter installer | `src/services/apkInstaller.ts` |
| Controller Above UI | `src/services/appUpdate.ts` |
| Halaman Profil | `src/pages/mobile/ProfileScreen.tsx` |
| Plugin native | `android/app/src/main/java/com/plantation/tripangkut/ApkInstallerPlugin.java` |
| Manifest & FileProvider | `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/xml/file_paths.xml` |
| Versi build | `android/app/build.gradle` (`versionCode` / `versionName`), `package.json` |
| Skrip rilis | `scripts/publish-apk.mjs`, `scripts/publish-apk-republish.mjs`, `scripts/sync-version.mjs`, `scripts/publish-ota-server.mjs` |
| Dokumen lain | `user guide/workflow.md`, `user guide/cheatsheet.md` |
