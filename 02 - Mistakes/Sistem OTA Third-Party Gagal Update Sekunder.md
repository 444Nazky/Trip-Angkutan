# Sistem OTA Third-Party — Kegagalan Patch/Update Sekunder

**Tanggal:** 2026-10-14  
**Kategori:** Arsitektur / Overhaul  
**Severity:** Critical (Blocking Production)

---

## Ringkasan Masalah

Third-party OTA plugin yang sebelumnya digunakan untuk sistem update aplikasi mobile mengalami kegagalan patch/update sekunder yang konsisten di APK Mobile Native Android.

## Gejala

1. **Update pertama berhasil** (V1.0.0 → V1.0.1)
2. **Update sekunder gagal** (V1.0.1 → V1.0.2)
3. Memerlukan "Clear Data" manual di Settings Android untuk pulih
4. Update berikutnya tetap tidak konsisten

## Analisis Root Cause

### Penyebab Teknis:
1. **WebView Cache Aggressive:** Android WebView menyimpan Cache Storage & Filesystem secara agresif
2. **Delta/Patch Strategy:** Strategi update delta/chunk memicu file integrity mismatch
3. **Cache Isolation:** Versi lama tidak sepenuhnya dibersihkan sebelum instalasi versi baru
4. **Service Worker Cache:** SW cache tidak merespon perubahan dengan benar

### Mengapa Plugin Pihak Ketiga Gagal:
1. Tidak dirancang untuk kebutuhan spesifik proyek
2. Kurang fleksibel dalam penanganan edge case Android
3. Update sekunder selalu gagal karena state management yang buruk
4. Tidak ada mekanisme "Purge-First" yang konsisten

## Solusi yang Diterapkan

### Overhaul Total ke Custom Self-Hosted API Update System

**Arsitektur Baru:**
```
Mobile Client (Ionic/Capacitor) ←→ Backend API (Express.js/Railway)
```

**Komponen:**
1. `@capacitor/app` — Version check
2. `@capacitor/filesystem` — APK download ke Directory.Data
3. Native Intent — APK installation

**Strategi:**
- **Purge-First:** Hapus semua versi lama SEBELUM instalasi versi baru
- **Full-Package:** Download APK utuh (bukan delta)
- **SHA-256 Verification:** Verifikasi hash sebelum install
- **Durable Storage:** Directory.Data (bukan Cache Storage)

**Endpoint API:**
- `GET /api/v1/app-version?current=:version`
- `GET /api/v1/app-download/:version`

**Native Permission:**
```xml
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

## Files yang Dibuat/Diperbarui

| File | Action |
|------|--------|
| `mobile-trip Mobile Branch/UPDATE-SYSTEM-ARCHITECTURE.md` | DIBUAT (dokumentasi lengkap) |
| `mobile-trip Mobile Branch/android/app/src/main/AndroidManifest.xml` | DITAMBAH permission |
| `README.md` utama | DITAMBAH ringkasan arsitektur baru |
| `PRD.md` | Diperbarui seksi OTA Update System |

## Lessons Learned

1. **Third-party plugins tidak selalu cocok** untuk kebutuhan spesifik proyek
2. **Purge-first strategy** penting untuk sistem update mobile
3. **Durable storage** (Directory.Data) lebih reliable dari Cache Storage
4. **Full-package download** lebih robust dari delta/patch untuk mobile
5. **Custom solution** memberikan kontrol penuh atas alur update

## Referensi

- Dokumentasi lengkap: `mobile-trip Mobile Branch/UPDATE-SYSTEM-ARCHITECTURE.md`
- Log book: `/home/nazky/Documents/Obsidian Vault/Intern/log book/2026-10-14.md`
