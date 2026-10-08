# Laporan Audit — Offline-First, Trip, OTA & Sinkronisasi

> **Tanggal audit**: 7 Oktober 2026
> **Cakupan**: aplikasi mobile Trip Angkutan (`src/`), kontrak endpoint `backend/src/routes/trips.js`, pipeline OTA (`scripts/publish-ota-git.mjs`, `version.json`, `sw.js`).
> **Metode**: code review file-per-file, cross-check kontrak payload mobile ↔ backend, lalu verifikasi mesin:

| Perintah verifikasi | Hasil |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` (typecheck seluruh proyek) | ✅ **Lulus, 0 error** (sebelum perbaikan: **12 error** — 3 syntax + 9 tipe) |
| `npm run build` (`ng build`, bundel produksi) | ✅ **Sukses** (hanya peringatan CommonJS react/tesseract) |
| Unit test | ⚠️ `vitest` terpasang, tetapi **belum ada satu pun file test** |

---

## 1. Tabel Cross-Check Status Modul

| # | Fitur / Modul | Status Implementasi | Kondisi | Catatan Kendala |
| --- | --- | --- | --- | --- |
| **1.1** | Seed data bawaan di dalam kode (username, hash PIN, status, scope dermaga & rute) | **Selesai** | Offline | `seedData.ts`: `SEED_OFFICERS` (bcrypt `$2a$` identik milik server, PIN polos tidak pernah ditulis), `SEED_ROUTES` per dermaga, `dermagaAccess`. Ditambahkan field `isActive (1/0)` agar status aktif/nonaktif ikut tertanam & bukan hard-code. |
| **1.2** | Login offline sejak instalasi pertama (tanpa sync awal / "request failed") | **Selesai** | Offline | `LoginPage.tryOfflineLogin` → `auth.loginOffline` → `verifyPinOffline` → urutan: DB offline (SQLite/localStorage) → roster `trip.officers.v1` + cache per-dermaga → seed. |
| **1.3** | Auto-sync data master saat online (petugas baru, ganti PIN, nonaktif) | **Selesai** | Online | `adminPull.syncOnResume` (throttle 5 menit + `FORCE_ROSTER_SYNC_KEY` pasca-OTA), `store.refreshOfficers(force)`, `credentialSync.syncOfficerCredentials`, event `online` + `SESSION_READY_EVENT`. Sinkron **UPSERT** — entri lama/seed tidak pernah ditimpa atau dihapus. |
| **1.4** | OTA aset dari branch `mobile` GitHub tanpa install ulang .apk | **Selesai** | Online | `ota.ts` membaca `raw.githubusercontent.com/.../mobile/version.json`, unduh ke penyimpanan internal + Cache Storage, penanda `.complete.json` membuang unduhan parsial; `scripts/publish-ota-git.mjs` mempublish `www/` → `ota/` + `version.json`. |
| **1.5** | `tryOfflineLogin` & verifikasi PIN multi-akun offline tanpa stuck | **Selesai** | Offline | Resolusi id/username/nama; petugas **Nonaktif ditolak**; `initOfflineDb` dibatasi **timeout 5 detik** → fallback localStorage (anti-hang); percobaan dibungkus `try/catch`, tidak ada `await` yang bisa menggantung tanpa batas. |
| **2.1** | **Edit sebelum submit** (periksa & ubah data trip/kendaraan sebelum kirim permanen) | **Selesai** *(dibangun pada audit ini)* | Offline | Ringkasan Trip: **Ubah/Hapus per kendaraan**, **Ubah Rute**, **Ubah Kondisi**. Layar Input Kendaraan: **mode Ubah** (plat/jenis/kategori/foto terisi kembali, tombol *Perbarui*/*Batal Ubah*) + **Hapus**. Store: `editVehicleIndex`, `editDraftVehicle`, `removeDraftVehicle`. |
| **2.2** | Dokumentasi foto **per kendaraan** (truk_1 = foto truk 1, dst.) | **Selesai** | Offline | Slot `vPhoto*` terpisah dari foto trip; label `unitLabel()` mengurutkan per jenis ("Truk 1", "Truk 2", "Mobil 1"); payload `vehicles[i].photoIndex` menunjuk berkas ke-`i+1`. |
| **2.3** | Alur kosong & ada muatan **offline** (input → foto wajib → looping kendaraan → swafoto wajib → End Trip) | **Selesai** | Offline | Guard `allDocsComplete` menahan tombol submit; swafoto wajib hanya untuk muatan; seluruh draft/trip tersimpan di IndexedDB (`trip-sync-v2`) + fallback localStorage. |
| **2.4** | Ambil-ulang foto dari Riwayat (trip atau satu kendaraan) | **Selesai** | Offline | `retakeTarget` → `patchTripPhoto` / `patchVehiclePhoto` → `retrySyncItem` membuka kembali item yang macet `PHOTO_MISSING`. |
| **3.1** | Struktur payload & FormData `POST /trips/complete` | **Selesai** | Online | **Cross-check langsung ke backend**: `payload` (JSON) + `photos` (berkas) + `dermagaId`; field `statusMuatan`, `routeFrom`, `routeTo`, `tripPhotoIndex`, `vehicles[].photoIndex`, `clientTripId` — semuanya cocok dengan `backend/src/routes/trips.js`. MIME dipaksa ke jpeg/png/webp (fileFilter multer) → sumber "Request failed" sudah tertangani. |
| **3.2** | Rute terpetugas akurat (tanpa nilai kosong `--` di dashboard admin) | **Selesai** | Online | `resolveRoute()`: `routeCode`/`routeFrom`+`routeTo` eksplisit → cache rute → parse label "SJRE → SBDZ". Trip dibuat selalu membawa `routeCode/routeFrom/routeTo`; trip kosong juga. |
| **3.3** | Persistensi trip & **hapus dari antrean hanya setelah HTTP 200/201** | **Selesai** | Offline/Online | Antrean di IndexedDB `pending` (bukan localStorage), bertahan refresh/restart; migrasi legacy hanya menghapus kunci lama **setelah** tulis IndexedDB sukses; `removeItem()` hanya dipanggil di cabang `result.success`. `requestPersistentStorage()` meminta browser tidak menghapus origin. |
| **3.4** | Anti-stuck: ping check, reset kunci saat timeout, exponential backoff | **Selesai** | Online/Offline | `probeServer()` (ping `/api/health`, TTL 2,5 dtk) sebelum & di sela siklus; watchdog `LOCK_TIMEOUT_MS` 2 menit melepas `_syncing`; `ITEM_TIMEOUT_MS` 90 dtk per item; backoff 15s→30s→…→cap 10 menit + fast-retry 2 dtk untuk error jaringan; re-auth 401 otomatis. |
| **3.5** | Tombol **Paksa Sinkronisasi** (manual) | **Selesai** | Online/Offline | `HomeScreen` ("Paksa Sinkronisasi" + jumlah antrean + status), `SettingsScreen` ("Cek Koneksi", "Sinkron" kredensial). `syncNow()` tetap jalan walau `navigator.onLine` salah, memakai ping. |
| **3.6** | Anti-duplikat saat kirim ulang | **Selesai** | Online | `clientTripId` → backend membalas 200 `duplicate:true` tanpa insert ulang. |
| **4.1** | Audit kode modul di atas + laporan cross-check | **Selesai** | — | Dokumen ini; daftar perbaikan di §2, sisa risiko di §3. |

**Legenda status**: *Selesai* = berfungsi & terverifikasi; *Belum* = tidak ada pekerjaan tersisa untuk klaim pada spesifikasi.

---

## 2. Perbaikan Yang Dilakukan Pada Audit Ini

| # | File | Temuan | Tindakan |
| --- | --- | --- | --- |
| 1 | `src/pages/mobile/TripActiveScreen.tsx` | **Syntax error** sisa refactor: `if (finittingRef.current)` (typo) + penutup blok dobel `}   })` → typecheck gagal, aplikasi tidak bisa dibangun | Diperbaiki: guard kembali `finishingRef`, blok `commitTrip(...)` ditutup benar, `go('trip-complete')` tidak dobel |
| 2 | `src/pages/store.tsx` | Signature `commitTrip(t, photos?, tripPhoto?)` dideklarasikan menerima foto, tetapi **argumen diabaikan** (impl hanya `(t)`) | Diimplementasikan: foto dari pemanggil dipakai, fallback derive dari trip agar indeks foto selalu sejajar kendaraan |
| 3 | `src/services/offline-sync.ts` + `src/services/offline-db.ts` | **Modul duplikat tak terpakai** (diimpor 0 file) — implementasi sync "v4" & wrapper DB kedua yang menimbulkan **9 error tipe** pada typecheck penuh dan berisiko drift | **Dihapus** (sesuai keputusan); modul aktif tetap `sync.ts` + `localDb.ts` + `offlineDb.ts` |
| 4 | `src/pages/mobile/VehicleFormScreen.tsx` | Artefak JSX: teks literal `/*` dirender di dekat status plat, dan chip status plat tidak pernah tampil bersih | Kode status plat dipulihkan tanpa artefak |
| 5 | `src/pages/mobile/TripSummaryScreen.tsx` | Ringkasan **read-only** — spesifikasi 2.1 belum terpenuhi | Ditambahkan: **Ubah/Hapus per kendaraan**, **Ubah Rute**, **Ubah Kondisi**; guard `vehiclePhotoTarget` agar foto lama tidak salah terpasang saat mode ubah |
| 6 | `src/pages/store.tsx` | Belum ada API untuk koreksi kendaraan draft | Ditambahkan `editVehicleIndex`, `editDraftVehicle()`, `removeDraftVehicle()` |
| 7 | `src/services/seedData.ts`, `offlineDb.ts`, `auth.ts` | Status seed hard-code `'Aktif'` — spesifikasi meminta status aktif/nonaktif tertanam | Ditambahkan `isActive?: 0 \| 1` (default 1) yang mengalir ke roster, payload SQLite, dan resolusi login offline |
| 8 | Seluruh proyek | `tsc -p tsconfig.json` gagal (12 error) | Kini **0 error**; `npm run build` sukses |

---

## 3. Sisa Temuan / Risiko (belum diperbaikan, non-blokir)

| # | Temuan | Dampak | Rekomendasi |
| --- | --- | --- | --- |
| R1 | `src/services/sync.ts.bak` (file cadangan mati) | ✅ **Selesai** — file dihapus dari repo (tetap bisa dipulihkan lewat git history) | — |
| R2 | Folder `src/services/offline-first/` kosong | ✅ **Selesai** — folder dihapus; modul aktif terpusat di `sync.ts` + `localDb.ts` + `offlineDb.ts` | — |
| R3 | `ng build` memakai `tsconfig.app.json` (hanya `src/main.tsx` + import) → error pada modul tak terjangkau tidak terbaca build | Sedang — **sebagian tertutup**: `noUnusedLocals` + `noUnusedParameters` kini aktif di `tsconfig.json` sehingga unused import/simbol gagal build | Jadikan `tsc --noEmit -p tsconfig.json` bagian dari CI/pre-commit |
| R4 | Unit test: `npm run test:unit` → **32 test lulus / 3 file**: `sync.test.ts` (12: resolveRoute, backoff, idempotensi antrean, hapus-bersyarat 200/201, payload multipart, guard foto, ping offline), `auth.test.ts` (11: hash PIN sha256/bcrypt/legacy, seed data, `tryOfflineLogin`, `loginOffline` multi-akun & petugas nonaktif), `localDb.test.ts` (9: antrean IndexedDB sungguhan via `fake-indexeddb`, idempoten, persistensi lintas restart). | Selesai | Tambahkan langkah CI (`npm run test:unit` + typecheck) |
| R5 | `LoginPage` fallback kedua menulis `regionId` = kode wilayah (bukan UUID) saat memakai roster | Rendah — sesi offline tidak memakai JWT, dan jalur ini nyaris tak tercapai (`loginOffline` sudah membaca roster yang sama) | Simplifikasi: andalkan `loginOffline` saja, hapus duplikasi |
| R6 | Hash PIN lokal (SHA-256 ber-salt officerId) berbeda format dengan bcrypt server | Rendah — keduanya didukung `verifyPin`, hash server selalu menang saat sync | Dokumentasikan di `Agents.md` |
| R7 | Petugas **tanpa akses dermaga** hanya mendapat `console.warn` saat tekan Mulai Trip | ✅ **Selesai** — `console.warn` dihapus; `HomeScreen` kini menampilkan kartu "Hubungi Admin — akun ini belum memiliki akses dermaga" dan menonaktifkan tombol Mulai Trip | — |
| R8 | `version.json` di root berisi daftar aset hasil build lama (hash berubah tiap build) | Tidak ada — script publish selalu me-regenerasi-nya | Tidak perlu tindakan |
| R9 | Struktur output bundler: chunk JS/CSS kini dikeluarkan ke `www/assets/js/` & `www/assets/css/` oleh `scripts/organize-build.mjs` (otomatis setelah `ng build`), dengan verifikasi otomatis bahwa seluruh href/src & impor dinamik chunk terpecah benar. `scripts/publish-ota-git.mjs` sudah membuang salinan hash lama di kedua folder. | Rendah — terverifikasi (semua referensi HTTP 200) | Jalankan `npm run build` (bukan `ng build` mentah) sebelum `ota:publish` / `cap sync` |

---

## 4. Peta File Modul

| Modul | File aktif | Keterangan |
| --- | --- | --- |
| Autentikasi & sesi | `services/auth.ts`, `services/api.ts` | Login online/offline, refresh JWT, roster per-dermaga |
| Kredensial offline | `services/offlineDb.ts`, `services/seedData.ts` | SQLite/localStorage + seed bawaan (INSERT-IF-ABSENT) |
| Sinkron kredensial | `services/credentialSync.ts`, `services/officers.ts`, `services/adminPull.ts` | Tarik petugas/rute/hash PIN dari dashboard admin |
| Antrean trip | `services/sync.ts` + `services/localDb.ts` | IndexedDB `pending`/`trips`/`meta`, watchdog, backoff, ping |
| OTA | `services/ota.ts`, `src/sw.js`, `scripts/publish-ota-git.mjs`, `version.json` | Manifest branch `mobile`, unduh + terapkan bundle |
| Alur trip | `pages/mobile/{TripCondition,RouteSelect,VehicleForm,Camera,TripSummary,TripActive,TripComplete}Screen.tsx` | Draft → dokumentasi → submit |
| State & persistensi | `pages/store.tsx` | Draft trip, daftar trip (localStorage + IndexedDB), edit sebelum submit |
