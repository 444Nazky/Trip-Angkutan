# Cara Kerja Update Aplikasi — Trip Angkutan

> **Ruang lingkup:** Alur **full-package APK** untuk transisi `1.0.2` → `1.0.3`.
> **Pemicu:** 100% manual — petugas menekan tombol di halaman **Profil**.
> **Server rilis:** `http://192.168.1.123:3000/api` (intranet kantor).
> **Dokumen ini bukan panduan pengguna**; ini spesifikasi alur teknis yang dapat diuji.

---

## 0. Ringkasan Satu Paragraf

Aplikasi selalu membaca versi native-nya sendiri (`App.getInfo()` → `1.0.2`)
dan membandingkannya dengan versi terbaru yang dilaporkan server (`1.0.3`).
Saat petugas menekan **"Cek & Perbarui"** di halaman Profil, aplikasi meminta
metadata ke `GET /app-version`, melihat `updateAvailable: true`, mengunduh paket
APK penuh (±16 MB) dari disk server intranet, memverifikasi SHA-256-nya, lalu
menampilkan tombol **"Perbarui Sekarang"**. Baru setelah petugas menekan tombol
itu, aplikasi membuka installer paket Android (`ACTION_VIEW` lewat
`FileProvider`) dan Android meminta persetujuan pengguna. Setelah paket
terpasang, versi native menjadi `1.0.3`, dilaporkan ke server, dan aplikasi
menampilkan "Aplikasi sudah versi terbaru".

Bagian A (tahap 1–9) menjelaskan apa yang terjadi **di dalam aplikasi**.
Bagian B menjelaskan apa yang harus dilakukan **olehsj operator** supaya
perangkat mendeteksi versi baru.

---

# BAGIAN A — Yang Terjadi di Dalam Aplikasi

## 1. Prasyarat (harus terpenuhi sebelum uji)

| # | Prasyarat | Cara verifikasi |
|---|---|---|
| 1 | Berkas `apks/app-1.0.3.apk` ada di disk server | `curl -sI http://192.168.1.123:3000/files/apks/app-1.0.3.apk` → `200` |
| 2 | Baris `app_versions` untuk `1.0.3` ada | `GET /app-version?current=1.0.2` → `latestVersion: "1.0.3"` |
| 3 | `apk_hash` di DB cocok dengan SHA-256 berkas | bandingkan dengan `sha256sum` berkas hasil unduhan |
| 4 | `versionName` **di dalam** APK = `1.0.3` | `aapt2 dump badging` → `versionName='1.0.3'` |
| 5 | `versionCode` APK 1.0.3 lebih besar dari APK 1.0.2 terpasang | 1.0.2 = code `11`; 1.0.3 = code `12` → OK |
| 6 | Sertifikat tanda tangan sama dengan versi terpasang | `apksigner verify --print-certs` → SHA-256 `09f181c1…` |
| 7 | Ponsel petugas masih menjalankan **1.0.2** | `App.getInfo().version` = `1.0.2` |

Prasyarat 4–6 adalah yang paling sering menggagalkan. Detail dan perintahnya
ada di `cheatsheet.md`.

---

## 2. Alur Detail — 9 Tahap

### Tahap 1 — Pembacaan versi lokal (otomatis, saat aplikasi hidup)

**Pemicu:** `App.tsx` → `CapacitorApp.addListener('appStateChange', { isActive: true })`.

```
appUpdate.syncInstalledVersion()
  └─ updateService.refreshInstalledVersion()
       └─ App.getInfo()  →  { version: "1.0.2" }
            ├─ native !== currentVersion?
            │     ├─ setStoredVersion(native)
            │     └─ reportVersionToServer(native)   [POST /report-version]
            └─ pendingVersion masih ada?
                 ├─ native >= pending → pending dibuang, state = 'up-to-date'
                 └─ native <  pending → state = 'ready' + pesan
                                              "Pemasangan belum selesai — aplikasi masih versi 1.0.2"
```

**Penting:** versi **tidak pernah** diambil dari `localStorage` sebagai acuan di
perangkat native. `localStorage` hanya cadangan untuk konteks web. Ini mencegah
klaim "sudah update" yang palsu, karena nilai yang ditulis setelah unduhan
(bukan setelah pemasangan) tidak dipercaya.

**Tidak ada request jaringan** pada tahap ini. Yang dikirim hanya laporan versi
(POST) bila versinya memang berubah.

---

### Tahap 2 — Petugas menekan "Cek & Perbarui" (Halaman Profil)

**Lokasi:** `src/pages/mobile/ProfileScreen.tsx` → `checkNow()`.

```tsx
const checkNow = async () => {
  setBusy(true);
  try {
    const result = await appUpdate.check();      // → AppUpdateController.check()
  } finally {
    setBusy(false);
    await appUpdate.refreshVersions();
  }
}
```

`AppUpdateController.check()` menerapkan dua guard:

* `LOCALHOST_UPDATE_DISABLED` — bila dijalankan di `localhost` atau port dev
  (`5173`, `5174`, `3000`, `4200`, `8080`), seluruh alur dilewati dan state =
  `up-to-date`. Build lokal tidak pernah memicu unduhan APK.
* `_checking` — bila pemeriksaan sedang berjalan, promise yang sama dikembalikan.
  Klik ganda tidak memicu dua proses unduh.

State UI setelah menekan: `checking` → tombol menjadi **"Memeriksa…"** dan
nonaktif.

---

### Tahap 3 — Permintaan metadata versi ke server

```
GET http://192.168.1.123:3000/api/app-version?current=1.0.2&t=<timestamp>
Accept: application/json
```

**Sisi server** (`server/api/handlers/appVersion.ts` → `getAppVersion()`):

1. Baca tabel `app_versions`, ambil 50 baris terakhir.
2. Urutkan dengan `compareVersions()` (semver + stempel numerik).
3. Ambil baris tertinggi = `latest`.
4. Bandingkan: `compareVersionFilter(compareVersionsNoStamp(current), latest.version) === 1` → `updateAvailable`.
5. Susun respons: `latestVersion`, `updateAvailable`, `isForceUpdate`, `downloadUrl`, `releaseNotes`, `apkSize`, `apkHash`, `minVersion`, `releaseDate`, `apkAvailable`.

**Sisi klien** (`updateService.checkVersionFromServer()`):

| Hasil | Tindakan klien |
|---|---|
| `200` + `latestVersion` berupa string | lanjut sebagai metadata update |
| `200` + bentuk JSON tidak dikenali | dianggap `NETWORK_ERROR` (bukan "terbaru") |
| `404` | dianggap `up-to-date` — API versi belum tersedia, bukan error |
| `500` / gagal jaringan | `NETWORK_ERROR` dengan pesan "Gagal menghubungi server update" |

**Catatan teknis penting:** hanya header `Accept` yang dikirim. Header
`Cache-Control`, `Pragma`, dan `Expires` memicu preflight CORS sehingga
seluruh cek versi gagal diam-diam. Anti-cache diwujudkan lewat
`cache: 'no-store'` pada `fetch` dan parameter `t=` pada URL.

Ada dua jalur HTTP di klien: `CapacitorHttp.request` (native) dengan fallback
otomatis ke `fetch` WebView. Fallback ini penting — plugin native bisa gagal
dalam milidetik pada build tertentu, dan tanpa fallback cek versi selalu gagal
tanpa pesan.

---

### Tahap 4 — Deteksi ketidakcocokan versi & unduhan APK

`updateService.checkForUpdate()` mengevaluasi hasil server:

```
if (!info.updateAvailable)  → state = 'up-to-date', selesai
else:
    localStorage['trip.update.info']    = JSON.stringify(info)
    localStorage['trip.update.lastCheck']= now
    state = 'downloading'
    pendingVersion = info.latestVersion      // "1.0.3"
    if (!info.downloadUrl) → state='error', DOWNLOAD_FAILED
                            "Server menyatakan ada versi baru, tetapi paket APK-nya tidak tersedia."
    else → downloadUpdate(info.latestVersion, info.downloadUrl, info.apkHash)
```

**Unduhan:**

```
Filesystem.downloadFile({
  url: `${resolveDownloadUrl(downloadUrl)}?t=${Date.now()}`,
  path: 'updates/app-1.0.3.apk',
  directory: Directory.Data          // = getFilesDir(), storage privat aplikasi
})
```

Sebelum mengunduh, `cleanupOldApkFiles('1.0.3')` menghapus seluruh `app-*.apk`
dengan versi lain, sehingga storage tidak menumpuk paket lama.

**Kebijakan unduhan:**

* `downloadUrl` absolut dipakai apa adanya. `downloadUrl` relatif ditempel ke
  `api.baseUrl` (bukan ke origin) agar path `/api/...` tidak menjadi
  `/api/api/...` — kesalahan ini membuat unduhan APK selalu gagal.
* Maksimum **3 percobaan**, dengan jeda *exponential backoff* `2^n × 1000 ms`
  (2 detik, 4 detik).
* Kegagalan setelah 3 percobaan → `DOWNLOAD_FAILED` dengan pesan "Gagal
  mengunduh setelah 3 percobaan".

**Status UI selama tahap ini:** `downloading` → tombol **"Mengunduh…"** nonaktif,
catatan "Mengunduh pembaruan…".

---

### Tahap 5 — Verifikasi integritas (SHA-256)

Sebelum installer ditawarkan, paket diverifikasi:

```
Filesystem.readFile({ path: 'updates/app-1.0.3.apk', directory: Data })
  → base64 → Uint8Array
  → crypto.subtle.digest('SHA-256', bytes)
  → hex lowercase
  → bandingkan dengan info.apkHash
```

| Kondisi | Hasil |
|---|---|
| Hash cocok | lanjut ke `ready` |
| Hash **tidak** cocok | berkas dihapus, state = `error`, `HASH_MISMATCH` — "Hash APK tidak cocok (file rusak/tidak lengkap). Unduh ulang pembaruan 1.0.3." |
| Server tidak mengirim hash | unduhan tetap diterima, hanya log peringatan (integritas tidak diverifikasi) |
| Platform `web` | verifikasi dilewati (berkas APK tidak bisa dibaca via FilesystemWeb) |
| WebCrypto tidak tersedia | verifikasi dilewati, log peringatan |

Penting: pada tahap ini versi **belum** ditulis. Menulis versi setelah unduhan
akan membuat aplikasi (dan server) mengklaim sudah ter-update padahal masih
versi lama. Versi resmi hanya berubah bila APK benar-benar terpasang.

> **Pola tanda tangan server.** `apk_hash` di database harus persis sama dengan
> SHA-256 berkas yang tersimpan di disk server. Kalau keduanya berbeda (mis.
> karena berkas di server diganti tanpa baris database diperbarui), perangkat
> **tidak akan pernah bisa memasang** update — errornya `HASH_MISMATCH`.
> Inilah alasan skrip `publish-apk-republish.mjs` ada.

**Status UI setelah tahap ini:** `ready`, `kind: 'apk'`, `version: '1.0.3'` →
tombol berubah menjadi **"Perbarui Sekarang"** (hijau) dan badge hijau muncul:
*"Paket APK 1.0.3 siap dipasang — tekan tombol untuk memulai."*

---

### Tahap 6 — Petugas menekan "Perbarui Sekarang"

```tsx
const applyNow = async () => {
  setBusy(true);
  try {
    await appUpdate.apply();          // → applyApk()
  } finally { setBusy(false); }
}
```

```
appUpdate.applyApk()
  └─ state = 'installing'
  └─ updateService.installUpdate()
       ├─ pendingVersion kosong? → error 'Tidak ada update yang siap diinstal'
       ├─ !isNativeAndroid()?     → error INSTALL_FAILED
       │     "Pemasangan APK hanya bisa dari aplikasi Android. Buka aplikasi di HP petugas, lalu tekan Update di sana."
       ├─ Filesystem.stat(path)
       │     ├─ tidak ada            → DOWNLOAD_FAILED "Berkas APK tidak ditemukan di perangkat."
       │     └─ size < 1.000.000 byte → DOWNLOAD_FAILED "Berkas APK cacat (N byte) — kemungkinan respons error server."
       ├─ Filesystem.getUri({ path: 'updates/app-1.0.3.apk', directory: Data })
       └─ openApkInstaller(uri)
```

Pemeriksaan ukuran < 1 MB ada karena kegagalan unduhan (misalnya respons 404
berbentuk JSON beberapa ratus byte) pernah dianggap "berhasil" dan tetap
dibuka sebagai APK.

`openApkInstaller()`:

1. Normalisasi path: `file:///data/...` → `/data/...` (dilepas skemanya, di-decode).
2. Guard `isNativeAndroid()` — di luar Android hasilnya **gagal eksplisit**,
   bukan "berhasil" palsu yang membuat tombol tampak memasang padahal tidak
   terjadi apa-apa.
3. Panggil plugin native `ApkInstaller.install({ path })`.
4. Bila plugin gagal, ada jaring pengaman `legacyOpen()` untuk
   `window.cordova.plugins.fileOpener2` (plugin Cordova lama) — hanya untuk
   build lama yang masih membundelkannya.

**Status UI selama tahap ini:** `installing` → tombol **"Memasang…"** nonaktif,
catatan "Menunggu pemasangan APK…".

---

### Tahap 7 — Installer paket Android dibuka

Plugin native `ApkInstallerPlugin.install()` (Java):

```java
File apk = new File(path);
if (!apk.exists())  → call.reject("Berkas APK tidak ditemukan di perangkat: " + path)
if (apk.length() <= 0) → call.reject("Berkas APK kosong (0 byte) — unduh ulang pembaruan.")

Uri uri = FileProvider.getUriForFile(
        getContext(),
        getContext().getPackageName() + ".fileprovider",   // com.plantation.tripangkut.fileprovider
        apk);

Intent intent = new Intent(Intent.ACTION_VIEW);
intent.setDataAndType(uri, "application/vnd.android.package-archive");
intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
getContext().startActivity(intent);
```

Android menampilkan dialog sistem "Pasang aplikasi ini?" milik Package
Installer. **Pengguna yang memutuskan** — petugas bisa membatalkan.

Yang perlu dipastikan agar langkah ini berhasil:

* `FileProvider` terdaftar di `AndroidManifest.xml` dengan
  `android:authorities="${applicationId}.fileprovider"` dan
  `grantUriPermissions="true"`.
* `res/xml/file_paths.xml` memuat `<files-path name="app_files" path="." />`.
  Tanpa ini: `IllegalArgumentException: Failed to find configured root`.
* Manifest memuat `REQUEST_INSTALL_PACKAGES`. Tanpa ini, intent ditolak sistem.
* APK signed dengan sertifikat yang **sama** dengan versi terpasang (lihat §4).

---

### Tahap 8 — Pengguna menyetujui, paket terpasang

Android mengganti paket lama dengan yang baru. Syarat: `versionCode` baru harus
lebih besar dari yang terpasang.

| Dari | Ke | versionCode | Hasil |
|---|---|---|---|
| 1.0.2 (code 11) | 1.0.3 (code 12) | naik | OK terpasang |
| 1.0.2 (code 11) | 1.0.3 (code 11) | sama | Ditolak (`INSTALL_FAILED_VERSION_DOWNGRADE`) |
| 1.0.3 (code 12) | 1.0.3 (code 12) | sama | reinstall, `versionCode` tidak boleh turun |

Aplikasi tidak melakukan verifikasi ulang pada saat itu — status `installing`
tetap menggantung di keputusan pengguna sampai aplikasi hidup lagi.

`appUpdate.applyApk()` menjadwalkan `syncInstalledVersion()` 5 detik kemudian,
tetapi itu hanya pembaruan tampilan; nilai yang sah tetap berasal dari
`App.getInfo()`.

---

### Tahap 9 — Aplikasi hidup lagi, versi tersinkron

```
App.getInfo().version  →  "1.0.3"
  ├─ native ("1.0.3") !== currentVersion ("1.0.2")
  │    ├─ setStoredVersion("1.0.3")
  │    └─ reportVersionToServer("1.0.3")     [POST /report-version]
  └─ pendingVersion ("1.0.3") masih ada?
       └─ isNewerVersion("1.0.3", "1.0.3") === false  → sudah terpasang
            ├─ pendingVersion = null
            ├─ updateInfo = null
            └─ state = 'up-to-date'
```

**Laporan ke server:**

```
POST /api/report-version
{ "deviceId": "<uuid>", "version": "1.0.3", "platform": "android" }
→ upsert ke tabel device_versions (device_id, version, platform, last_seen)
```

Tampilan akhir di halaman Profil: **"Aplikasi sudah versi terbaru"**, tombol
"Sudah Terbaru" nonaktif, baris versi "Versi APK 1.0.3 · modul …".

---

## 3. Diagram State Machine

```
                    ┌─────────┐
                    │  idle   │◀──────────────────────────────┐
                    └────┬────┘                               │
                         │ [tombol "Cek & Perbarui"]          │
                         ▼                                    │
                    ┌──────────┐   !updateAvailable           │
                    │ checking ├──────────────────────▶ ┌───────────┐
                    └────┬─────┘                          │ up-to-date│
                         │ ok                            └───────────┘
                         ▼
                  ┌─────────────┐  404 / offline
                  │ downloading ├──────────────▶ ┌────────┐
                  └──────┬──────┘                │ error  │
                         │ hash cocok            └────────┘
                         ▼
                    ┌────────┐
                    │ ready  │  [tombol "Perbarui Sekarang"]
                    └───┬────┘
                        ▼
                  ┌─────────────┐
                  │ installing │
                  └─────┬──────┘
                        │ pengguna menyetujui
                        ▼
                  ┌───────────┐
                  │ up-to-date│  (setelah app hidup lagi & App.getInfo()=1.0.3)
                  └───────────┘
```

Kode status error yang mungkin muncul di UI:

| `error.code` | Pesan |
|---|---|
| `NETWORK_ERROR` | "Gagal menghubungi server update (http://192.168.1.123:3000/api)" |
| `DOWNLOAD_FAILED` | "Gagal mengunduh setelah 3 percobaan" / "Berkas APK tidak ditemukan di perangkat." / "Berkas APK cacat (N byte)…" |
| `HASH_MISMATCH` | "Hash APK tidak cocok (file rusak/tidak lengkap). Unduh ulang pembaruan 1.0.3." |
| `INSTALL_FAILED` | "Pemasangan APK hanya bisa dari aplikasi Android…" / "Gagal membuka installer APK: …" / "Pemasangan belum selesai — aplikasi masih versi 1.0.2…" |
| `STORAGE_FULL` | storage penuh (tidak dipakai di jalur APK; storage privat) |
| `PERMISSION_DENIED` | izin instalasi ditolak pengguna di pengaturan sistem |
| `UNKNOWN` | "Tidak ada update yang siap diinstal" |

---

## 4. Syarat Upgrade di Android (yang sering bikin gagal)

1. **Sertifikat tanda tangan harus sama.** APK 1.0.2 dan 1.0.3 keduanya
   ditandatangani `CN=Trip Angkutan, OU=Mobile, O=444Nazky, L=Pontianak, C=ID`,
   SHA-256 `09f181c1c6fba02473345cfd515e49d0cc360c1dc6462eba7ddd3f72d4d3bce9`.
   APK dengan sertifikat berbeda ditolak
   (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) meski `versionCode` lebih besar.
2. **`versionCode` harus naik.** 1.0.2 = code `11`, 1.0.3 = code `12`.
3. **`applicationId` harus sama.** `com.plantation.tripangkut` untuk keduanya.
4. **Izin `REQUEST_INSTALL_PACKAGES` harus ada** di APK baru.
5. **Android 8+** meminta persetujuan "install unknown apps" per aplikasi. Bila
   ditolak, installer gagal dibuka. Alur ini **tidak** memakai
   `ACTION_MANAGE_UNKNOWN_APP_SOURCES` secara otomatis — petugas harus
   mengaktifkan izin tersebut di Pengaturan.

---

## 5. Kasus Uji (Test Case)

| # | Skenario | Ekspektasi |
|---|---|---|
| TC-01 | Perangkat di 1.0.2, server 1.0.3, tekan "Cek & Perbarui" | Badge hijau "Paket APK 1.0.3 siap"; tombol "Perbarui Sekarang" |
| TC-02 | Tekan "Cek & Perbarui" dua kali cepat | Satu proses unduh saja (guard `_checking`) |
| TC-03 | Server `apkHash` dis purposely salah | `HASH_MISMATCH`, berkas dihapus, tombol "Coba Lagi" |
| TC-04 | `downloadUrl` null di server | `DOWNLOAD_FAILED` "paket APK-nya tidak tersedia" |
| TC-05 | Mematikan data jaringan, tekan "Cek & Perbarui" | `NETWORK_ERROR`, **bukan** "Aplikasi sudah versi terbaru" |
| TC-06 | Server mengembalikan 404 | `up-to-date` (bukan error) |
| TC-07 | Di web/browser, tekan "Perbarui Sekarang" | `INSTALL_FAILED` "Pemasangan APK hanya bisa dari aplikasi Android" |
| TC-08 | Pengguna membatalkan dialog installer | Installer tertutup; versi tetap 1.0.2; saat app hidup lagi state `ready` + pesan "Pemasangan belum selesai — aplikasi masih versi 1.0.2" |
| TC-09 | APK terpasang, app dibuka lagi | `up-to-date`, `POST /report-version` terkirim dengan `1.0.3` |
| TC-10 | Berjalan di `localhost:5173` | Cek update dilewati, tidak ada unduhan |
| TC-11 | Klik "Cek & Perbarui" saat app tidak sedang foreground | Tetap manual — tidak ada polling background |
| TC-12 | Publish ulang versi yang sama tanpa memperbarui `apk_hash` di database | `HASH_MISMATCH` — perangkat berhenti sebelum installer dibuka |
| TC-13 | APK dilabeli 1.0.3, tetapi `versionName` di dalamnya 1.0.2 | Setelah dipasang versi tidak naik → "Pemasangan belum selesai" |

> TC-12 dan TC-13 adalah dua jebakan yang paling sering muncul saat uji
> lapangan; keduanya dicegah oleh `publish-apk-republish.mjs` (hash) dan
> oleh `--version` + validasi `versionName` (label).

---

## 6. Logging untuk Diagnosis

Prefix yang dipakai kode — berguna saat menelusuri `adb logcat` atau log aplikasi:

| Prefix | Sumber |
|---|---|
| `[Update]` | `updateService.ts` (unduh, hash, state) |
| `[Version]` | `reportVersionToServer` (laporan versi ke server) |
| `[OTA]` | kanal modul web (`ota.ts`) — kanal cadangan |
| `[Profile]` | `ProfileScreen.tsx` (cek & apply) |
| `ApkInstaller` | `ApkInstallerPlugin.java` (Android logcat) |

Contoh baris yang diharapkan pada alur sukses:

```
[Update] Versi terpasang: 1.0.2
[Update] APK downloaded to: /data/user/0/com.plantation.tripangkut/files/updates/app-1.0.3.apk
[Update] Hash APK 1.0.3 terverifikasi
[Version] Berhasil laporkan versi 1.0.3 ke server
ApkInstaller: Installer APK dibuka: /data/user/0/…/files/updates/app-1.0.3.apk
```

---

# BAGIAN B — Yang Harus Dilakukan Operator (Sisi Server)

Alur ini yang membuat perangkat **mendeteksi** versi baru. Ringkasnya:

```
ubah versi  →  build APK  →  terbitkan ke server  →  perangkat mendeteksi  →  petugas menekan tombol
```

| Langkah | Perintah | Rinci |
|---|---|---|
| 1. Naikkan versi | `node scripts/sync-version.mjs 1.0.3 --code=12` | `cheatsheet.md` §2 |
| 2. Build | `npm run build && npx cap sync android && (cd android && ./gradlew assembleRelease)` | `cheatsheet.md` §3 |
| 3. Verifikasi paket | `aapt2 dump badging` + `apksigner verify` + `sha256sum` | `cheatsheet.md` §3 |
| 4. Terbitkan | `node scripts/publish-apk.mjs …` (versi baru) atau `node scripts/publish-apk-republish.mjs …` (versi yang sudah ada) | `cheatsheet.md` §4 |
| 5. Pastikan terdeteksi | `curl "http://192.168.1.123:3000/api/app-version?current=1.0.2"` → `updateAvailable: true` | `cheatsheet.md` §6 |

Dua hal yang **wajib** benar agar perangkat benar-benar bisa memasang:

1. **Hash di database = hash berkas di disk server.** Bila berbeda, perangkat
   berhenti di `HASH_MISMATCH`.
2. **`versionName` di dalam APK = versi yang dipublikasikan.** Bila berbeda,
   versi di HP tidak pernah naik dan update terus muncul.

Keduanya dijamin oleh skrip publish yang dipakai (masing-masing menolak
penerbitan dengan label/isi yang tidak cocok).

---

## 7. Rujukan File

| Topik | Lokasi |
|---|---|
| State machine update | `src/services/updateService.ts` |
| Adapter installer | `src/services/apkInstaller.ts` |
| Controller di atas UI | `src/services/appUpdate.ts` |
| Halaman Profil (tombol pemicu) | `src/pages/mobile/ProfileScreen.tsx` |
| Plugin native installer | `android/app/src/main/java/com/plantation/tripangkut/ApkInstallerPlugin.java` |
| Manifest & FileProvider | `android/app/src/main/AndroidManifest.xml`, `res/xml/file_paths.xml` |
| Handler versi server | `server/api/handlers/appVersion.ts` |
| Penyimpanan berkas | `server/api/_db.ts` (`serveStoredFile`) |
| Skrip publish | `scripts/publish-apk.mjs`, `scripts/publish-apk-republish.mjs` |
| Dokumen lain | `user guide/architecture.md`, `user guide/cheatsheet.md` |
