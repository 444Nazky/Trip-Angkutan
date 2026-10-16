# Sistem Pembaruan OTA — Arsitektur v4 (Purge-First / Full-Package)

> **Catatan 2026-10-16 — sebagian dokumen ini sudah tidak berlaku.**
> Sejak unifikasi sistem update, manifest & aset modul **tidak lagi** dipublikasikan ke
> cabang `mobile` (GitHub raw). Yang berlaku sekarang:
>
> - `GET /api/v1/ota-manifest` + `GET /ota/<versi>/<berkas>` di server API sendiri.
> - Publikasi: `npm run ota:publish` → `scripts/publish-ota-server.mjs` (POST `/api/v1/publish-ota`).
>   `scripts/publish-ota-git.mjs` dan seluruh alur `git add -f version.json` di bawah **sudah dihapus**.
> - Satu tombol `Cek & Perbarui Aplikasi` menggabungkan kanal modul + kanal paket APK.
>
> Rincian + bukti verifikasi: `audits/update-unification-audit-2026-10-16.md`.
> Bagian di bawah tetap berguna sebagai catatan arsitektur klien (staging, hash, purge, SW).

Dokumen ini menjelaskan cara kerja `src/services/ota.ts` + `src/sw.js` **versi v4**, bug
lapangan yang diperbaiki, dan langkah rilis yang benar.

---

## 0. Root cause paling menentukan: manifest tidak pernah ikut ter-publish

`.gitignore` cabang ini punya blok "Build output" (commit `e3fe52c`, 2026-10-12 13:11)
yang mengabaikan berkas publikasi:

```
/chunk-*.js  /main-*.js  /main-*.css  /styles-*.css
/index.html  /sw.js  /version.json
```

Akibatnya `git add -A` di publisher **tidak pernah men-stage `version.json`**. Skrip tetap
mencetak `✅ OTA assets + version.json pushed`, commit tetap dibuat (karena folder `ota/`
berubah), tetapi `version.json` **tidak ada** di cabang `mobile`:

```
$ git show origin/mobile:version.json
fatal: path 'version.json' exists on disk, but not in 'origin/mobile'
```

Klien yang mem-fetch manifest menerima **404** → `fetchManifest()` mengembalikan
`not-found` → aplikasi menyimpulkan "tidak ada pembaruan" **selamanya**, berapa kali pun
rilis dibuat. Inilah sebab paling langsung dari "update berikutnya selalu gagal dan tidak
tampil". Perbaikan: `scripts/publish-ota-git.mjs` sekarang men-stage berkas wajib itu
dengan `git add -f` (`version.json`, `index.html`, `sw.js`) dan menghitung hash SHA-256
untuk **setiap** aset (manifest tanpa `integrity` lengkap akan menolak publish).

Diverifikasi dengan menjalankan publisher sungguhan terhadap remote tiruan:

| | `version.json` di cabang publish |
|---|---|
| sebelum perbaikan | **TIDAK ADA** (klien → 404) |
| sesudah perbaikan | ADA — `assets: 17`, `integrity: 17` |

> Setelah publish pertama dengan skrip baru, perangkat langsung bisa mendeteksi rilis
> kembali. Ini juga sebabnya tombol **Reset App Cache** tidak akan pernah bisa
> menolong pada kasus ini — masalahnya ada di sisi server publikasi, bukan device.

---

## 1. Masalah lain yang diperbaiki

| # | Gejala di lapangan | Akar masalah (arsitektur lama / v3) | Perbaikan v4 |
|---|---|---|---|
| 1 | Update **pertama** berhasil, update **kedua/berikutnya tidak pernah muncul** tanpa *Clear Data* manual | Hanya ada **satu** nama cache tetap (`trip-ota-active`). Versi baru menulis ke nama yang sama, sehingga sisa entri versi lama masih bisa "menang" saat `cache.match()` | **Satu cache per versi** (`trip-ota-v<versi>`). Versi baru = nama baru → mustahil tercampur. Perpindahan versi = menulis **satu berkas meta** (switch atomik) |
| 2 | `version.json` tidak terdeteksi berubah | `index.html`, `sw.js`, `version.json` diambil tanpa pembeda versi → CDN (Fastly/GitHub raw) & cache WebView menyajikan salinan lama | Setiap unduhan memakai URL unik `?ota=<versi>&t=<timestamp>&n=<attempt>` + header `Cache-Control: no-cache, no-store` & `Pragma` (via `CapacitorHttp` di native) |
| 3 | "Integritas berkas mismatch" / chunk setengah jadi | (a) `Filesystem.writeFile` menulis base64 **dengan** `Encoding.UTF8` tetapi dibaca sebagai base64 → byte rusak; (b) unduhan parsial tidak diverifikasi | (a) base64 ditulis **tanpa** `encoding`; (b) setiap berkas diverifikasi **SHA-256** terhadap `manifest.integrity`; gagal → update dibatalkan + rollback |
| 4 | Setelah *Clear Data* / OS bersih-bersih, update hilang | Bundle disimpan di `Directory.Cache` (OS boleh menghapus kapan saja) | Penyimpanan primer `Directory.Data` (**durable**) + **self-heal** saat boot (`restoreBundleFromStorage()`) |
| 5 | Tampilan campur aduk (sebagian UI lama, sebagian baru) | Service Worker menyajikan apa pun yang ada di cache; berkas yang hilang diam-diam jatuh ke bundel bawaan APK | SW **hanya** menyajikan dari cache **versi aktif** (dibaca dari meta). Versi lain tidak pernah disajikan |
| 6 | Reload menampilkan halaman lama | `location.reload()` bisa dilayani HTTP cache WebView / bfcache | Reload ke URL ber-versi `/?ota=<versi>` lewat `location.replace()` + `SKIP_WAITING`/`SET_ACTIVE` ke SW |

---

## 2. Alur satu siklus pembaruan (selalu FULL-PACKAGE)

```
1. CEK     manifest segar (anti-cache, 3x retry) → remote.version > local.version ?
2. PURGE   SEMUA versi lain dibuang lebih dulu (Cache Storage `trip-ota-v*` + direktori
           Directory.Data/ota/<versi-lain> + sisa arsitektur v3). Versi yang SEDANG
           aktif dipertahankan sampai versi baru lulus verifikasi (aplikasi tidak
           pernah rusak di tengah proses).
3. UNDUH   SELURUH berkas bundle (bukan sebagian/chunk-delta), URL ber-versi, retry 3x.
4. VERIFIKASI  SHA-256 tiap berkas vs manifest.integrity. Satu berkas gagal → unduh
           ulang 2x dengan cache-buster baru; masih gagal → update DIBATALKAN,
           staging dibuang, versi lama tetap jalan (fallback aman).
5. TULIS   berkas → cache versi baru + salinan durable Directory.Data/ota/<versi>/
           + marker `.complete.json`.
6. AKTIVASI (atomik)  verifikasi ulang seluruh berkas → tulis meta `__active__.json`
           → purge versi lama → catat versi lokal + flag persist.
7. RELOAD  `SKIP_WAITING` + `SET_ACTIVE` ke SW → `location.replace('/?ota=<versi>')`.
```

Kegagalan jaringan di langkah mana pun **tidak pernah** meninggalkan versi setengah
jadi: yang ada di cache hanya versi yang sudah lulus verifikasi penuh.

---

## 3. Peta berkas

| Berkas | Peran |
|---|---|
| `src/services/ota.ts` | Mesin OTA: cek manifest, purge, unduh penuh, verifikasi, aktivasi, reset, diagnostik (`auditOta`) |
| `src/sw.js` | Service Worker penyaji bundel: hanya cache versi aktif; pesan `SKIP_WAITING`, `PURGE_ALL`, `SET_ACTIVE`; bypass `?ota_bypass=1` |
| `src/services/otaReload.ts` | Reload atomik ber-versi + pemberitahuan SW |
| `src/components/UpdateNotifier.tsx` | UI status (progress, versi lama → baru), tombol **Reset App Cache** yang muncul di setiap status masalah (mengunduh, gagal, offline) |
| `src/pages/mobile/SettingsScreen.tsx` | Cek/terapkan pembaruan manual dari menu Pengaturan |
| `scripts/publish-ota-git.mjs` | Publisher: bersihkan semua chunk lama → salin `www/` ke `ota/` & root → tulis `version.json` + hash SHA-256 |

### Nama penyimpanan
- `trip-ota-v<versi>` — Cache Storage berisi seluruh berkas satu versi (di-key dengan URL kanonik tanpa query).
- `trip-ota-meta/__active__.json` — penanda versi aktif (dibaca SW setiap fetch).
- `Directory.Data/ota/<versi>/…` — salinan durable berkas bundle.
- localStorage: `trip.ota.currentVersion`, `trip.ota.state`, `trip.ota.appliedVersion`, `trip.ota.persistActive`, `trip.ota.lastError`.

---

## 4. ⚠️ Batasan penting: Service Worker ikut dibundel di APK

Permintaan skrip Service Worker **tidak** melewati Service Worker itu sendiri (per spec),
sehingga `sw.js` selalu diambil dari **origin aplikasi** (isi APK), bukan dari bundle OTA.

**Konsekuensinya (wajib dibaca):**

1. Perbaikan ini harus **dipasang sekali lewat APK baru** (`ng build && npx cap sync android`
   → build ulang). APK baru membawa `sw.js` v4 **dan** `ota.ts` v4.
2. Setelah APK v4 terpasang, seluruh pembaruan berikutnya cukup lewat OTA
   (`npm run ota:publish`) — pertama, kedua, ketiga, dan seterusnya.
3. Perangkat dengan APK lama + state OTA rusak bisa dipulihkan dari UI: tombol
   **Reset App Cache** (purge total + lepas registrasi SW + reload ke bundel APK).

---

## 5. Rilis OTA

```bash
npm run build          # ng build + rapikan bundle → www/
npm run ota:publish    # push aset + version.json (versi otomatis naik +1)
```

Publisher menolak publikasi bila `www/` belum dibuild (`index.html` atau jumlah berkas < 3),
bila ada aset yang tidak punya hash SHA-256, dan selalu mem-`git add -f version.json`
(wajib, lihat bagian 0).

---

## 6. Pengujian

```bash
npm run test:unit      # vitest (semua unit test)
node --check src/sw.js # sintaks Service Worker
npx tsc --noEmit -p tsconfig.json
```

Yang dicakup tes OTA (`src/services/ota.test.ts`, `src/sw.test.ts`):

- **Siklus rilis beruntun** V1.0.0 → V1.0.1 → V1.0.2 → V1.0.3 **tanpa reset apa pun**:
  versi baru selalu terdeteksi, terunduh penuh, dan cache versi lama benar-benar hilang.
- **Rollback integritas**: satu berkas rusak → update batal, versi lama tetap aktif, staging dibuang.
- **Self-heal**: Cache Storage dibersihkan WebView → bundle dibangun ulang dari `Directory.Data`
  dan cache versi terisi kembali (SW punya bahan untuk disajikan).
- **Storage rusak** (mis. clear data manual) → boot tidak mengklaim versi OTA;
  aplikasi kembali konsisten ke bundel APK.
- **Service Worker**: chunk versi lama **tidak pernah** disajikan meski masih ada di
  Cache Storage; `?ota_bypass=1` selalu ke jaringan; `PURGE_ALL` mengosongkan semuanya.

Simulasi perangkat fisik (izin GPS, akurasi, cache WebView nyata) tetap perlu
dilakukan manual di APK.

---

## 7. Diagnostik saat ada masalah di lapangan

Aplikasi mencatat siklusnya ke konsol WebView (`chrome://inspect` → tab Console) dengan
awalan `[OTA]`, mis.: `[OTA] Update tersedia: 1.0.1 → 1.0.2 (17 berkas)`,
`[OTA] terunduh & terverifikasi 5/17: assets/js/chunk-….js`, dan
`[OTA] pasca-apply: local= … meta= … remote= … cacheEntries= …`.

Untuk memeriksa keadaan perangkat langsung dari konsol:

```js
// 1. Apa yang diyakini aplikasi & apa yang benar-benar disajikan SW
JSON.parse(localStorage.getItem('trip.ota.state'))
localStorage.getItem('trip.ota.currentVersion')
await caches.open('trip-ota-meta').then(c => c.match('/__active__.json')).then(r => r && r.json())

// 2. Isi cache versi aktif (harus sama jumlahnya dengan manifest.assets)
await caches.keys()
const m = await caches.open('trip-ota-meta').then(c => c.match('/__active__.json')).then(r => r.json())
;(await (await caches.open('trip-ota-v' + m.version)).keys()).length
```

- `meta.version` ≠ `currentVersion` → boot berikutnya menyelaraskan meta ke versi lokal.
- jumlah entri cache versi aktif = 0 padahal versi lokal adalah versi OTA → tekan
  **Reset App Cache**, atau cukup buka ulang aplikasi: `restoreBundleFromStorage()`
  akan membangun ulang cache dari `Directory.Data` tanpa unduh ulang.
- `[OTA] cek gagal: not-found` di konsol = manifest **tidak ada di server** (kasus
  `version.json` belum ter-publish, lihat bagian 0).
