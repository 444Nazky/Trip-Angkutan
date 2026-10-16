# Sistem Update — Custom Self-Hosted API Update System (Purge-First Full-Package)

> **Status:** PRODUKSI — Mengganti sistem OTA pihak ketiga yang sering mengalami kegagalan patch/update sekunder.

> **Catatan 2026-10-16 — UNIFIKASI & PEMBARUAN DOKUMEN INI:**
> Bagian di bawah masih menggambarkan kanal OTA yang lama (manifest di GitHub raw,
> dua tombol terpisah). Sejak 2026-10-16 keduanya sudah berubah:
>
> - **Satu tombol** `Cek & Perbarui Aplikasi` (`src/services/appUpdate.ts`) memeriksa
>   kanal modul web DAN kanal paket APK sekaligus. Tombol terpisah dihapus.
> - **Manifest & aset modul dilayani server API sendiri**, bukan GitHub raw:
>   `GET /api/v1/ota-manifest` dan `GET /ota/<versi>/<berkas>`.
> - **Publikasi** memakai `npm run ota:publish` → `scripts/publish-ota-server.mjs`
>   (POST `/api/v1/publish-ota`, secret `PUBLISH_SECRET`). Skrip `publish-ota-git.mjs` dihapus.
>
> Detail lengkap + langkah verifikasi: `audits/update-unification-audit-2026-10-16.md`.

**Tanggal Overhaul:** 2026-10-14

---

## 0. Alasan Perombakan Total

### Sistem Lama: Third-Party OTA Plugin
- Sering mengalami kegagalan patch/update sekunder di APK Mobile Native
- Webview Android agresif menyimpan Cache Storage & Filesystem
- Update pertama (V1.0.0 → V1.0.1) berhasil, update berikutnya (V1.0.1 → V1.0.2) selalu gagal
- Memerlukan "Clear Data" manual di Settings Android untuk pulih

### Sistem Baru: Custom Self-Hosted API Update System
- Arsitektur 100% custom-built untuk kebutuhan spesifik proyek
- Strategi **Purge-First Full-Package** — hapus semua versi lama sebelum instalasi versi baru
- Tidak bergantung pada plugin OTA pihak ketiga
- Full APK download (bukan delta/patch) untuk menjamin integritas
- Verifikasi SHA-256 untuk setiap berkas

---

## 1. Arsitektur Sistem Update

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MOBILE CLIENT (Ionic/Capacitor)                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │ @capacitor   │    │  @capacitor  │    │   Native     │               │
│  │    app       │───▶│  filesystem  │───▶│   Intent     │               │
│  │ (version)    │    │  (download)  │    │  (install)   │               │
│  └──────────────┘    └──────────────┘    └──────────────┘               │
│         │                    │                                           │
│         │                    ▼                                           │
│         │            ┌──────────────┐                                   │
│         │            │ Directory.   │                                   │
│         │            │   Data       │                                   │
│         │            │ (durable)    │                                   │
│         │            └──────────────┘                                   │
└─────────┼─────────────────────────────────────────────────────────────────┘
          │ HTTP GET /api/v1/app-version
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BACKEND SERVER (Express.js/Railway)                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │  Version     │    │   APK File   │    │  Release    │               │
│  │  Check API  │───▶│  Storage     │───▶│  Notes API  │               │
│  └──────────────┘    └──────────────┘    └──────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Alur Kerja 2 Arah (Bidirectional Flow)

### 2.1 Client → Server: Cek Versi

```
Mobile App                          Backend API
    │                                    │
    │── GET /api/v1/app-version ────────▶│
    │   ?current=1.0.0                    │
    │                                    │
    │◀── 200 OK (JSON) ──────────────────│
    │   {
    │     "latestVersion": "1.0.1",
    │     "updateAvailable": true,
    │     "isForceUpdate": false,
    │     "downloadUrl": "/api/v1/app-download/1.0.1",
    │     "releaseNotes": "Perbaikan bug dan peningkatan performa",
    │     "apkSize": 15728640,
    │     "apkHash": "sha256:abc123..."
    │   }
```

**Endpoint:** `GET /api/v1/app-version?current=:version`

**Headers:**
- `Cache-Control: no-cache, no-store`
- `Pragma: no-cache`

### 2.2 Server → Client: Response Schema

```typescript
interface AppVersionResponse {
  latestVersion: string;        // Semantic Versioning (semver)
  updateAvailable: boolean;    // true jika latestVersion > currentVersion
  isForceUpdate: boolean;      // true = pengguna HARUS update
  downloadUrl: string;         // Path ke file APK
  releaseNotes: string;        // Catatan rilis dalam Bahasa Indonesia
  apkSize: number;             // Ukuran file dalam bytes
  apkHash: string;             // SHA-256 hash untuk verifikasi
  minVersion?: string;         // Versi minimum yang didukung (opsional)
}
```

### 2.3 Client → Server: Download APK

```
Mobile App                          Backend API
    │                                    │
    │── GET /api/v1/app-download/1.0.1 ─▶│
    │   (binary stream)                   │
    │                                    │
    │◀── 200 OK (application/vnd.android.package-archive) ──│
    │   (APK file binary)                 │
```

**Penyimpanan:** 
- Target: `Directory.Data` (Capacitor) — penyimpanan **durable**
- Path: `{Directory.Data}/updates/app-{version}.apk`

### 2.4 Client → Native: Instalasi APK

```
Mobile App                          Android OS
    │                                    │
    │── Intent.ACTION_VIEW ──────────────▶│
    │   MIME: application/vnd.android.package-archive
    │   URI: file://{Directory.Data}/updates/app-1.0.1.apk
    │                                    │
    │◀── Install Dialog ─────────────────│
    │   (user confirmation)              │
    │                                    │
    │◀── App Restart ────────────────────│
```

---

## 3. Mekanisme Anti-Cache

### 3.1 Version Check (Selalu Segar)

```typescript
// Selalu ambil manifest terbaru
const timestamp = Date.now();
const url = `${API_BASE}/api/v1/app-version?current=${currentVersion}&t=${timestamp}`;

const response = await CapacitorHttp.request({
  url,
  method: 'GET',
  headers: {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  }
});
```

### 3.2 APK Download dengan Cache-Buster

```typescript
const downloadUrl = `${API_BASE}/api/v1/app-download/${version}?t=${Date.now()}`;

// Download ke Directory.Data (durable storage)
const result = await Filesystem.downloadFile({
  url: downloadUrl,
  path: `updates/app-${version}.apk`,
  directory: Directory.Data
});
```

---

## 4. Strategi Purge-First Full-Package

### 4.1 Auto-Purge Sebelum Install

```typescript
async function installUpdate(version: string): Promise<void> {
  // 1. Hapus APK versi lama
  const existingFiles = await Filesystem.readDir({
    path: 'updates',
    directory: Directory.Data
  });
  
  for (const file of existingFiles.files) {
    if (file.name.startsWith('app-') && file.name.endsWith('.apk')) {
      await Filesystem.deleteFile({
        path: `updates/${file.name}`,
        directory: Directory.Data
      });
    }
  }
  
  // 2. Hapus localStorage metadata OTA lama
  localStorage.removeItem('trip.ota.currentVersion');
  localStorage.removeItem('trip.ota.pendingVersion');
  
  // 3. Bersihkan cache browser (jika ada)
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      if (name.startsWith('trip-ota-')) {
        await caches.delete(name);
      }
    }
  }
  
  // 4. Download APK baru
  await downloadApk(version);
  
  // 5. Verifikasi hash SHA-256
  const isValid = await verifyApkHash(version);
  if (!isValid) {
    throw new Error('Verifikasi APK gagal — checksum tidak cocok');
  }
  
  // 6. Trigger install
  await triggerApkInstall(version);
}
```

### 4.2 Verifikasi SHA-256

```typescript
async function verifyApkHash(version: string): Promise<boolean> {
  const apkPath = `updates/app-${version}.apk`;
  
  // Baca file APK
  const fileResult = await Filesystem.readFile({
    path: apkPath,
    directory: Directory.Data
  });
  
  // Konversi base64 ke ArrayBuffer
  const binaryString = atob(fileResult.data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Hitung SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Bandingkan dengan hash dari server
  const expectedHash = await fetchExpectedHash(version);
  return `sha256:${hashHex}` === expectedHash;
}
```

---

## 5. Semantic Versioning (semver) Comparison

### 5.1 Version Check Logic

```typescript
function isUpdateAvailable(current: string, latest: string): boolean {
  const [currMajor, currMinor, currPatch] = current.split('.').map(Number);
  const [latestMajor, latestMinor, latestPatch] = latest.split('.').map(Number);
  
  if (latestMajor > currMajor) return true;
  if (latestMajor === currMajor && latestMinor > currMinor) return true;
  if (latestMajor === currMajor && latestMinor === currMinor && latestPatch > currPatch) return true;
  
  return false;
}
```

### 5.2 Force Update Logic

```typescript
function shouldForceUpdate(current: string, minVersion?: string): boolean {
  if (!minVersion) return false;
  return isUpdateAvailable(current, minVersion);
}
```

---

## 6. Komponen UI

### 6.1 UpdateNotifier Component

**Lokasi:** `src/components/UpdateNotifier.tsx`

**Props:**
```typescript
interface UpdateNotifierProps {
  onUpdateAvailable?: (info: UpdateInfo) => void;
  onUpdateDownloaded?: (version: string) => void;
  onUpdateError?: (error: Error) => void;
}
```

**States:**
| State | Tampilan | Aksi |
|-------|----------|------|
| `checking` | Spinner "Mengecek pembaruan..." | Auto |
| `available` | "Pembaruan tersedia: vX.X.X" + tombol "Update" | User tap |
| `downloading` | Progress bar + "Mengunduh: XX%" | Auto |
| `ready` | "Update siap diinstal" + tombol "Pasang" | User tap |
| `installing` | "Memasang pembaruan..." | Auto |
| `up-to-date` | Tidak ada notifikasi | Auto |
| `error` | "Gagal: [error]" + tombol "Coba Lagi" | User tap |
| `offline` | "Offline — update saat online" | Auto |

### 6.2 SettingsScreen Integration

**Lokasi:** `src/pages/mobile/SettingsScreen.tsx`

**Fitur:**
- Tombol "Cek Pembaruan" manual
- Tampilkan versi saat ini
- Tampilkan status update terakhir
- Tampilkan catatan rilis

---

## 7. Backend API Specification

### 7.1 GET /api/v1/app-version

**Request:**
```
GET /api/v1/app-version?current=1.0.0
```

**Response (200):**
```json
{
  "latestVersion": "1.0.1",
  "updateAvailable": true,
  "isForceUpdate": false,
  "downloadUrl": "/api/v1/app-download/1.0.1",
  "releaseNotes": "Perbaikan bug geofencing dan peningkatan performa sinkronisasi",
  "apkSize": 15728640,
  "apkHash": "sha256:a1b2c3d4e5f6...",
  "minVersion": "1.0.0",
  "releaseDate": "2026-10-14T00:00:00Z"
}
```

**Response (200 - No Update):**
```json
{
  "latestVersion": "1.0.0",
  "updateAvailable": false,
  "isForceUpdate": false,
  "downloadUrl": null,
  "releaseNotes": null,
  "apkSize": null,
  "apkHash": null,
  "minVersion": null,
  "releaseDate": null
}
```

### 7.2 GET /api/v1/app-download/:version

**Request:**
```
GET /api/v1/app-download/1.0.1
```

**Response (200):**
- Content-Type: `application/vnd.android.package-archive`
- Content-Length: `{size}`
- Body: Binary APK file

**Response (404):**
```json
{
  "error": "APK_NOT_FOUND",
  "message": "File APK versi 1.0.1 tidak ditemukan"
}
```

### 7.3 GET /api/v1/release-notes/:version

**Request:**
```
GET /api/v1/release-notes/1.0.1
```

**Response (200):**
```json
{
  "version": "1.0.1",
  "releaseDate": "2026-10-14T00:00:00Z",
  "notes": [
    {
      "type": "feature",
      "title": "Peningkatan performa sync",
      "description": "Sinkronisasi data 50% lebih cepat"
    },
    {
      "type": "bugfix",
      "title": "Perbaikan geofencing",
      "description": "Geofence tidak lagi melebar di luar radius"
    },
    {
      "type": "security",
      "title": "Update keamanan",
      "description": "Patch vulnerability terbaru"
    }
  ]
}
```

---

## 8. Konfigurasi Native Android

### 8.1 AndroidManifest.xml Permissions

**File:** `android/app/src/main/AndroidManifest.xml`

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    
    <!-- Permission untuk instalasi APK dari luar Play Store -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
    
    <!-- Permission lain yang sudah ada -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    
</manifest>
```

### 8.2 FileProvider Configuration

```xml
<!-- android/app/src/main/res/xml/file_paths.xml -->
<paths>
    <external-path name="external_files" path="." />
    <files-path name="files" path="." />
    <cache-path name="cache" path="." />
    <external-files-path name="external_files_path" path="." />
    <external-cache-path name="external_cache_path" path="." />
    
    <!-- Direktori update APK -->
    <files-path name="updates" path="updates/" />
</paths>
```

### 8.3 MainActivity Intent Filter

```java
// android/app/src/main/java/com/example/app/MainActivity.java

package com.example.app;

import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;

public class MainActivity extends BridgeActivity {
    
    @Override
    protected void onResume() {
        super.onResume();
        
        // Handle install result
        int status = getIntent().getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
        if (status == PackageInstaller.STATUS_SUCCESS) {
            // Update berhasil
            Log.d("OTA", "APK install success");
        } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            // Install dibatalkan user
            Log.d("OTA", "APK install aborted by user");
        }
    }
    
    // Method untuk trigger install dari Capacitor plugin
    public void installApk(String apkPath) {
        File apkFile = new File(apkPath);
        Uri apkUri = FileProvider.getUriForFile(
            this,
            getPackageName() + ".fileprovider",
            apkFile
        );
        
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (getPackageManager().canRequestPackageInstalls()) {
                startActivity(intent);
            } else {
                // Redirect ke settings untuk enable install unknown apps
                Intent settingsIntent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())
                );
                startActivity(settingsIntent);
            }
        } else {
            startActivity(intent);
        }
    }
}
```

---

## 9. Penanganan Dialog Sideloading (Unknown Sources)

### 9.1 Alur User Guidance

```
┌─────────────────────────────────────────┐
│  1. User tap "Update" di aplikasi       │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  2. Android tampilkan dialog:           │
│  "Izinkan instalasi dari sumber ini?"   │
│                                         │
│  [Batal]  [Pengaturan]  [Izinkan]       │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  3a. Jika user tap "Izinkan":          │
│      → Instalasi berlanjut              │
│                                         │
│  3b. Jika user tap "Pengaturan":        │
│      → Redirect ke Settings > Security   │
│      → User enable "Unknown Sources"    │
│      → Kembali ke aplikasi              │
│      → Tap "Update" lagi                │
│                                         │
│  3c. Jika user tap "Batal":             │
│      → Update dibatalkan                │
│      → User bisa coba lagi nanti         │
└─────────────────────────────────────────┘
```

### 9.2 UI Helper Text

```typescript
// src/components/UpdateSideloadingHelper.tsx

export function SideloadingHelper(): JSX.Element {
  return (
    <div className="sideloading-helper">
      <h4>📱 Panduan Instalasi APK</h4>
      
      <details>
        <summary>Apa yang harus saya lakukan jika muncul peringatan keamanan?</summary>
        
        <ol>
          <li>
            <strong>Tap "Izinkan"</strong> — Jika Anda melihat tombol ini, aplikasi 
            aman dan terpercaya.
          </li>
          <li>
            <strong>Tap "Pengaturan"</strong> — Jika aplikasi meminta Anda ke Settings:
            <ul>
              <li>Aktifkan "Sumber tidak dikenal" / "Unknown Sources"</li>
              <li>Kembali ke aplikasi</li>
              <li>Tap "Update" lagi</li>
            </ul>
          </li>
        </ol>
        
        <p className="note">
          💡 <strong>Catatan:</strong> Aplikasi Trip Angkutan memerlukan izin ini 
          untuk dapat memperbarui dirinya sendiri di luar Google Play Store. 
          Data Anda tetap aman.
        </p>
      </details>
    </div>
  );
}
```

---

## 10. Error Handling

### 10.1 Error Types

| Error Code | Kondisi | Aksi |
|------------|---------|------|
| `NETWORK_ERROR` | Tidak ada koneksi | Retry otomatis saat online |
| `DOWNLOAD_FAILED` | Gagal download APK | Retry 3x dengan exponential backoff |
| `HASH_MISMATCH` | SHA-256 tidak cocok | Hapus APK corrupt, download ulang |
| `INSTALL_FAILED` | Gagal install APK | Tampilkan error + opsi retry |
| `STORAGE_FULL` | Penyimpanan penuh | Guidance untuk kosongkan storage |
| `PERMISSION_DENIED` | REQUEST_INSTALL_PACKAGES ditolak | Guide ke settings |

### 10.2 Retry Logic

```typescript
async function downloadWithRetry(
  url: string, 
  version: string, 
  maxRetries = 3
): Promise<DownloadResult> {
  
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Exponential backoff: 1s, 2s, 4s
      if (attempt > 1) {
        await sleep(Math.pow(2, attempt - 1) * 1000);
      }
      
      return await downloadApk(url, version);
    } catch (error) {
      lastError = error;
      console.warn(`[OTA] Download attempt ${attempt} failed:`, error);
    }
  }
  
  throw new OTAError('DOWNLOAD_FAILED', `Gagal download setelah ${maxRetries} percobaan`, lastError);
}
```

---

## 11. File Structure

```
mobile-trip Mobile Branch/
├── src/
│   ├── services/
│   │   └── updateService.ts      # Custom Self-Hosted Update System
│   ├── components/
│   │   ├── UpdateNotifier.tsx    # UI notifikasi update
│   │   └── SideloadingHelper.tsx # Panduan sideloading
│   └── pages/
│       └── mobile/
│           └── SettingsScreen.tsx # Cek update manual
│
├── android/
│   └── app/src/main/
│       ├── AndroidManifest.xml   # REQUEST_INSTALL_PACKAGES
│       ├── java/.../MainActivity.java  # installApk() method
│       └── res/xml/
│           └── file_paths.xml    # FileProvider paths
│
├── backend/
│   └── src/
│       └── routes/
│           ├── appVersion.js     # GET /api/v1/app-version
│           └── appDownload.js    # GET /api/v1/app-download/:version
│
└── scripts/
    └── publish-apk.mjs          # Script upload APK ke server
```

---

## 12. Deployment Pipeline

### 12.1 Release New APK

```bash
# 1. Build APK baru
cd "mobile-trip Mobile Branch"
npm run build
npx cap sync android
cd android
./gradlew assembleRelease

# 2. Upload ke backend
npm run publish:apk -- --version=1.0.1 --apk=./app/build/outputs/apk/release/app-release.apk

# 3. Verifikasi
curl "https://api.example.com/api/v1/app-version?current=1.0.0"
```

### 12.2 Backend APK Storage

```
backend/
├── apks/
│   ├── app-1.0.0.apk
│   ├── app-1.0.1.apk
│   └── app-1.0.2.apk
└── metadata/
    ├── versions.json
    └── releases/
        ├── 1.0.0.json
        ├── 1.0.1.json
        └── 1.0.2.json
```

---

## 13. Testing

### 13.1 Unit Tests

```bash
npm run test:unit  # vitest — update service tests
```

### 13.2 Manual Testing Checklist

- [ ] Cek versi saat online → dapat response yang benar
- [ ] Cek versi saat offline → handle gracefully
- [ ] Download APK → berhasil simpan ke Directory.Data
- [ ] Verifikasi SHA-256 → hash cocok
- [ ] Install APK → Native intent terbuka
- [ ] Sideloading dialog → muncul dengan benar
- [ ] Retry download → exponential backoff bekerja
- [ ] Update sekunder (V1.0.1 → V1.0.2) → tanpa Clear Data
- [ ] Force update → user tidak bisa skip
- [ ] Storage penuh → error handling benar

### 13.3 E2E Flow Testing

1. Install APK v1.0.0
2. Publish APK v1.0.1
3. Buka app → notifikasi update muncul
4. Tap "Update" → download + install
5. App restart → versi 1.0.1 aktif
6. Publish APK v1.0.2
7. Buka app → update tersedia (tanpa Clear Data!)
8. Update berhasil → versi 1.0.2 aktif

---

## 14. Changelog

| Tanggal | Versi | Perubahan |
|---------|-------|-----------|
| 2026-10-14 | - | Overhaul total: hapus OTA plugin → Custom API System |

---

*Dokumen ini bagian dari sistem dokumentasi Aplikasi Trip Angkutan.*
*Referensi: PRD.md, README.md utama proyek*
