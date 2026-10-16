# Audit — Unifikasi Sistem Update (Poin 1)

**Tanggal:** 2026-10-16
**Ruang lingkup:** Mobile client (Ionic/Capacitor) + Backend Express
**Status:** Selesai & terverifikasi — poin 2 (persistensi lokal penuh) dan poin 3 (silent auto-sync) belum dikerjakan.

---

## 1. Masalah sebelum perubahan

| Kanal | Manifest | UI |
|---|---|---|
| Modul web (OTA) | `raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/version.json` | tombol "Periksa/Pasang" di Profil |
| Paket APK | `GET /api/v1/app-version` (server sendiri) | toast `UpdateNotifier` + blok "Cek Versi" di Profil |

Tiga tombol/permukaan berbeda untuk satu kebutuhan pengguna ("apakah aplikasi saya terbaru?"),
dan kanal modul bergantung pada repo GitHub publik yang tidak dikontrol server.

---

## 2. Arsitektur baru

```
        ┌─────────────── TOMBOL TUNGGAL: "Cek & Perbarui Aplikasi" ───────────────┐
        │                       src/services/appUpdate.ts                        │
        └───────────────┬───────────────────────────────┬────────────────────────┘
                        ▼                               ▼
        kanal APK (prioritas)                 kanal modul web
        /api/v1/app-version                   /api/v1/ota-manifest
        /api/v1/app-download/<versi>          /ota/<versi>/<berkas>
        unduh + verifikasi hash → installer   purge-first staging → aktivasi + reload
```

Aturan pemilihan kanal: **paket APK baru selalu menang**. Bila hanya modul yang baru,
modul diterapkan tanpa mengganti APK. Bila keduanya terbaru, status berhenti di
`up-to-date` dan tombol tidak melakukan apa pun.

---

## 3. Perubahan berkas

**Mobile (`mobile-trip Mobile Branch`)**
- `src/services/appUpdate.ts` (baru) — pengendali tunggal dua kanal + state machine.
- `src/components/UpdateNotifier.tsx` — ditulis ulang memakai `appUpdate`; ekspor `useAppUpdate`.
- `src/pages/mobile/ProfileScreen.tsx` — dua seksi update (modul & versi aplikasi) → satu seksi.
- `src/services/ota.ts` — `MANIFEST_URL`/`ASSETS_BASE` GitHub raw → `manifestUrl()`/`assetsBase()` dari `api.baseUrl`; unduhan aset kini berversi (`/ota/<versi>/<berkas>`).
- `src/App.tsx` — `updateService.refreshInstalledVersion()` → `appUpdate.syncInstalledVersion()`.
- `scripts/publish-ota-server.mjs` (baru) — publikasi bundel ke server; `ota:publish` diarahkan ke sini.
- `scripts/publish-ota-git.mjs` — dihapus (kanal GitHub bukan lagi sumber acuan).
- `src/services/appUpdate.test.ts` (baru, 6 tes), `src/services/ota.test.ts` — URL harness disesuaikan.

**Backend Express (3 salinan: `endpoint-trip`, `mobile-trip`, `Aplikasi-Trip-Main`)**
- `src/routes/otaBundle.js` (baru) — `GET /ota-manifest`, `GET /ota-versions`, `POST /publish-ota`.
- `src/ota-dir.js` (baru) — lokasi bundel (`OTA_DIR`, default `public/ota`).
- `src/index.js` — mount statis `/ota` + router `/api/v1`; parser JSON longgar untuk endpoint publikasi.

---

## 4. Bukti verifikasi

| Uji | Hasil |
|---|---|
| `node --check` (semua berkas backend tersentuh) | lulus |
| `npx tsc --noEmit` (mobile) | exit 0, tanpa error |
| `npx vitest run` (mobile) | 12 berkas, **148 tes lulus** (142 lama + 6 baru) |
| Publish nyata ke server lokal (`OTA_DIR=/tmp/ota-test`) | 200, `Modul 1.0.26+… dipublikasikan` |
| Secret salah pada `POST /publish-ota` | 401 `UNAUTHORIZED` |
| `GET /api/v1/ota-manifest` | 200 + `version`, `assets`, `integrity`, `publishedAt` |
| Unduh 17 aset memakai skema URL `ota.ts` + cocokkan SHA-256 | **17/17 terverifikasi** |
| Versi tak ada di disk (`/ota/9.9.9/index.html`) | 404 |
| Publikasi beruntun ×4 → prune | hanya 3 versi terbaru tersimpan, yang dibuang versi tertua |
| `publish-ota-server.mjs` | bundel `www/` 17 berkas → tersimpan & termanifest |

Perbaikan ikutan: aturan 10kb `express.json` membuat `POST /publish-version` (APK base64)
selalu 413 di backend `endpoint`; kini endpoint publikasi memakai parser 64mb.

---

## 5. Langkah pasang

1. **Redeploy backend** cabang `endpoint` (Railway) — berisi `/api/v1/ota-manifest`, `/ota`, `/publish-ota`.
2. Set env bila perlu: `PUBLISH_SECRET` (default `trip-angkut-secret`), `OTA_DIR` (default `public/ota`), `OTA_KEEP_VERSIONS` (default 3).
3. Publikasikan modul: `npm run build && npm run ota:publish -- --server=https://<host>`.
4. APK tetap: `node scripts/publish-apk.mjs --apk=... --version=...`.

---

## 6. Batasan yang harus diketahui

- **Filesystem Railway ephemeral**: `public/ota` ikut terhapus saat redeploy. Untuk
  tahan-restart, arahkan `OTA_DIR` ke volume persisten (atau unggah ulang bundel setelah
  redeploy). Perilaku ini sama dengan direktori `apks/` yang sudah ada.
- Perangkat memakai kode lama sampai APK/OTA baru terpasang; setelah itu tombol tunggal
  yang berlaku.
- Poin 2 & 3 (master data penuh di lokal + silent auto-sync) belum dikerjakan — lihat
  rencana `GET /api/v1/master-bundle` + `dataVersion` pada sesi berikutnya.
