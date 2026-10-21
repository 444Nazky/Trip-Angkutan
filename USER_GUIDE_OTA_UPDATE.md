# Panduan Update Aplikasi Mobile - Trip Angkutan

## Cara Kerja Update OTA (Over-The-Air)

1. Aplikasi mobile mendeteksi perbedaan versi dengan server
2. Petugas melihat notifikasi "Update Tersedia" di halaman Profil
3. Petugas klik tombol "Update Aplikasi"
4. Aplikasi mengunduh dan install update otomatis

---

## Cara Mengirim Update ke Server API

### Langkah 1: Build APK Release

```bash
cd /home/nazky/RPL/Intern/Aplikasi-Trip-Main\ Branch

# Update versi di android/app/build.gradle
# versionCode +1, versionName sesuai keinginan

# Build
cd android
./gradlew assembleRelease
```

### Langkah 2: Upload ke Supabase Storage

APK harus diupload ke bucket `apks` di Supabase.

**Opsi A: Via Supabase Dashboard**
1. Buka https://supabase.com/dashboard
2. Pilih project `444Nazky's Project`
3. Storage > Buckets > `apks`
4. Upload file `.apk`

**Opsi B: Via CLI**

```bash
# Login ke Supabase
npx supabase login

# Upload APK
npx supabase storage upload apks "/path/to/Aplikasi-Trip-v1.0.3-release.apk"
```

### Langkah 3: Update Database OTA Version

Upload ke bucket saja tidak cukup. Kita perlu insert/update record di tabel `ota_versions`.

**Via Supabase Dashboard:**
1. Table Editor > `ota_versions`
2. Insert row baru:
   - `version`: `"1.0.3"`
   - `min_version`: `"1.0.0"` (versi minimum yang bisa upgrade)
   - `apk_path`: `"Aplikasi-Trip-v1.0.3-release.apk"` (nama file di storage)
   - `is_mandatory`: `false`
   - `release_notes`: `"Update testing v1.0.3"`

### Langkah 4: Verifikasi

Cek APK tersedia:
```bash
curl -I "https://bmiruktfruunegtbydyw.supabase.co/storage/v1/object/public/apks/Aplikasi-Trip-v1.0.3-release.apk"
```

---

## Struktur Tabel `ota_versions`

| Kolom | Tipe | Deskripsi |
|-------|------|-----------|
| `id` | uuid | ID unik |
| `version` | text | Versi aplikasi (contoh: "1.0.3") |
| `min_version` | text | Versi minimum untuk upgrade |
| `apk_path` | text | Path file di Supabase Storage |
| `is_mandatory` | boolean | Wajib update atau opsional |
| `release_notes` | text | Catatan perubahan |
| `created_at` | timestamp | Waktu pembuatan |

---

## Cara Update Bekerja di Mobile

### Kode yang Relevan

**1. Cek Versi (services/updateService.ts)**
```typescript
// Cek versi terbaru dari server
const latestVersion = await fetchLatestVersion()

// Bandingkan dengan versi local
if (isNewer(latestVersion.version, currentVersion)) {
  showUpdatePrompt()
}
```

**2. Download APK (services/updateService.ts)**
```typescript
// Download APK
const apkUrl = getApkUrl(latestVersion.apk_path)
await downloadApk(apkUrl)
```

**3. Install APK (Capacitor/App)**
```typescript
// Install setelah download selesai
App.installRelease()
```

### Trigger Update

Update dipicu oleh:
1. **Cold start** - Saat aplikasi dibuka
2. **Background sync** - Saat data di-sync
3. **Manual** - Petugas klik tombol "Update"

---

## Troubleshooting

### APK tidak terdeteksi

1. Cek file ada di Supabase Storage bucket `apks`
2. Cek nama file sama persis (case-sensitive)
3. Cek public URL accessible

### Update tidak muncul

1. Cek koneksi internet mobile
2. Cek versi di `ota_versions` sudah benar
3. Cek `min_version` - versi mobile harus >= min_version

### Install gagal

1. Pastikan mobile izinkan "Install dari sumber tidak dikenal"
2. Cek storage mobile cukup
3. Restart mobile dan coba lagi

---

## Contoh Record OTA Version

```json
{
  "version": "1.0.3",
  "min_version": "1.0.0",
  "apk_path": "Aplikasi-Trip-v1.0.3-release.apk",
  "is_mandatory": false,
  "release_notes": "Testing update OTA - versi 1.0.3"
}
```

---

## Catatan Penting

- **Full Package Update**: Setiap update adalah APK lengkap, bukan incremental
- **Tidak ada force update otomatis**: Petugas harus klik tombol "Update"
- **Versi harus unik**: Tidak bisa pakai versi yang sudah ada
- **Storage public**: APK harus di bucket dengan public access
