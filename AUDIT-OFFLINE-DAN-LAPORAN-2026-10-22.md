# Audit Mendalam: Offline-First Mobile, Backend Supabase, Master Tarif & Laporan Trip

> Tanggal audit: 2026-10-22 · Commit baseline: `bf41c03` ("kayaknya")
> Ruang lingkup: seluruh modul mobile (`src/pages/mobile`, `src/services`), backend
> Supabase Edge Functions (`supabase/functions/api`), dan Admin Dashboard
> (`src/pages/admin`).
> **Status dokumen: HASIL AUDIT — belum ada perbaikan kode yang diterapkan.**
> Acuan spesifikasi: `OFFLINE-FIRST-ARCHITECTURE.md` dan `ALUR_APLIKASI.md`.

---

## 1. Ringkasan Eksekutif

### 1.1 Status per skenario yang diminta

| # | Skenario | Status | Temuan utama |
|---|----------|--------|--------------|
| 1 | Online: inisialisasi & tarik data master utuh | **SEBAGIAN** | `prefetch.ts` menarik rute/geofence/tarif/dermaga/roster, tapi **plat & region tidak termasuk**; cap "fresh" ditulis walau pull gagal → cache basi bertahan 3 menit |
| 2 | Offline: login divalidasi lokal + scope dermaga & rute | **SEBAGIAN** | Login PIN lokal + bcrypt **sudah benar**; tetapi **filter rute bocor scope** saat cache rute per dermaga kosong |
| 3 | Offline: trip kosong (geofence lokal, foto wajib, submit) | **SEBAGIAN** | Geofence lokal & foto wajib **sudah benar**; tetapi **tidak ada durasi/timer** yang dihapus (lihat 3.4) dan rute tidak terkunci ke `SJRE→SBDZ` seperti SOP |
| 4 | Offline: trip bermuatan (loop kendaraan, swafoto wajib) | **GAGAL** | Loop kendaraan & foto per unit **sudah benar**; **swafoto (selfie) tidak ada sama sekali** — tidak ada UI ambil, tidak ada validasi, tidak dikirim ke server |
| 5 | Riwayat dari basis data lokal + cache state optimal | **GAGAL** | Riwayat dibaca dari React state, sumber tunggal `localStorage` berisi foto base64; **store `trips` di IndexedDB tidak pernah ditulis** → kuota localStorage habis = trip hilang dari riwayat |
| 6 | Online kembali: sinkronisasi dua arah otomatis | **SEBAGIAN** | Pull master + upload antrean otomatis jalan; tetapi **kategori kendaraan hilang** di payload dan tarif memakai master lama, bukan Master Tarif terkini |
| 7 | Master Tarif → laporan tidak lagi Rp 0 | **GAGAL** | Pendapatan laporan dihitung dari `vehicles.tariff_amount` beku + lookup kunci yang bisa miss; **Tarif Terpusat per region (Internal/Lokal/Eksternal) tidak pernah dipakai** di perhitungan pendapatan |
| 8 | Laporan menampilkan semua foto dokumentasi kendaraan | **SEBAGIAN** | Viewer di tab Laporan sudah collects semua foto, tapi **baris tabel hanya menampilkan thumbnail foto bukti trip** |
| 9 | Laporan: jenis kendaraan, plat, status muatan transparan | **TERPENUHI** (sejak perubahan 2026-10-22) | Sudah tampil di `ReportSheet.tsx` (tabel gabungan) dan `ReportsTab.tsx` |

### 1.2 Distribusi temuan

| Severity | Jumlah |
|----------|--------|
| BLOKIR   | 4 |
| TINGGI   | 9 |
| SEDANG   | 8 |
| RENDER   | 5 |

---

## 2. Temuan Mobile (Skenario 1-6)

### A-01 · BLOKIR · Swafoto (selfie) tidak pernah ada — syarat "End Trip" tidak terpenuhi
- **Lokasi**: `src/pages/store.tsx:65-66` (field `selfieUrl`/`selfieCapturedAt`),
  `src/pages/store.tsx:91-93` (draft), `src/pages/store.tsx:655` (disalin ke trip),
  `src/pages/store.tsx:98` (`cameraMode: 'photo' | 'ocr'` — tidak ada mode `selfie`).
- **Bukti**: `grep -rn "selfie" src/` → hanya definisi field &penyalinan; **tidak ada
  satu pun layar/aksi yang mengisi `draft.selfieUrl`**. `CameraScreen` hanya mendukung
  `photo` dan `ocr`.
- **Dampak**: Persyaratan "swafoto wajib sebelum End Trip lokal dieksekusi" **tidak
  terpenuhi**. Karena `finishMuatanTrip()` (`store.tsx:611-620`) tidak memeriksa
  `selfieUrl`, `trip` selesai tanpa swafoto. Data swafoto juga tidak dikirim ke
  server (tidak ada field di payload `sync.ts:566-585`), jadi tidak bisa diaudit admin.
- **Perbaikan**: (a) tambah `cameraMode: 'selfie'` di `store.tsx:98` + mode kamera
  `facingMode: 'user'` di `CameraScreen`; (b) gate submit di `TripSummaryScreen.tsx:124`
  → `canSubmit = hasTripPhoto && allVehiclePhotos && draft.selfieUrl`; (c) validasi
 同样的 di `store.tsx:611` (`finishMuatanTrip`) supaya tidak bisa dilewati lewat jalur lain;
  (d) kirim `selfieIndex`/blob ke `/trips/complete` dan simpan ke kolom baru
  `selfie_path` pada `vehicles`/`trips`.

### A-02 · BLOKIR · Riwayat trip hilang saat localStorage penuh (foto base64)
- **Lokasi**: `src/pages/store.tsx:396-401`, `src/pages/store.tsx:551-566`
  (`commitTrip` → `setTrips`), `src/services/localDb.ts:10` (store `trips`).
- **Bukti**:
  ```ts
  // store.tsx:396-401
  try { localStorage.setItem(LS.trips, JSON.stringify(trips)) }
  catch (err) { console.warn('[store] localStorage penuh — data aman di IndexedDB:', err) }
  ```
  Pesan log ini **menyesatkan**: tidak ada satu pun `dbPut('trips', …)` di seluruh
  aplikasi (`grep -rn "dbPut('trips'" src/` → nihil). Store IndexedDB `trips`
  (`localDb.ts:10`) hanya dideklarasikan, tidak pernah diisi. Trip beserta
  `photoUrl` base64 (1-3 MB/trip) hanya hidup di `localStorage` yang limite ~5 MB.
- **Dampak**: 3-5 trip foto sudah memenuhi kuota. Setelah itu `setItem` gagal → trip
  **tidak tersimpan** → tidak muncul di riwayat, padahal sudah masuk antrean sync
  (`addToSyncQueue` di IndexedDB) → petugas melihat "trip hilang" di HP padahal
  kemungkinan besar sudah masuk server. Melanggar syarat "rekap data akurat dari basis data lokal".
- **Perbaikan**: (a) pindahkan penyimpanan trip ke IndexedDB store `trips`
  (`dbPut('trips', trip)` saat `commitTrip`, `dbAll('trips')` saat memuat);
  (b) simpan **blob foto** (bukan dataURL) di store terpisah `photos`;
  (c) `HistoryScreen`/`HistoryDetailScreen` membaca `dbAll('trips')` +
  `useLiveQuery`-like invalidasi saat ada perubahan, dengan `localStorage` hanya
  cache ringkas metadata; (d) hapus `seedTrips` sebagai fallback tampilan.

### A-03 · BLOKIR · Scope rute bocor saat cache rute per dermaga kosong (offline)
- **Lokasi**: `src/pages/mobile/RouteSelectScreen.tsx:60-64` dan `:227`.
- **Bukti**:
  ```ts
  const dermagaFiltered = dockId ? routes.filter(r => r.dermagaId === dockId) : []
  // ...
  const list = dermagaFiltered.length ? dermagaFiltered : routes   // ← fallback ke SEMUA rute
  ```
  `accessibleDermagas` (`RouteSelectScreen.tsx:31`) hanya dipakai untuk mencari
  **nama** dermaga, tidak pernah memfilter daftar rute.
- **Dampak**: Offline (cache rute per dermaga belum terisi) → petugas melihat dan
  dapat memilih **rute milik dermaga lain**, melanggar syarat "mencocokkan scope
  akses dermaga dan rute yang telah tersimpan di cache lokal".
- **Perbaikan**: filter berdasarkan `accessibleDermagas` sebagai sumber kebenaran
  kedua: `routes.filter(r => dockId ? r.dermagaId === dockId : accessibleIds.has(r.dermagaId))`;
  bila hasil kosong → tampilkan empty state "Rute untuk dermaga ini belum
  tersinkron", bukan seluruh daftar.

### A-04 · BLOKIR · Pendapatan Rp 0: tarif Master & Tarif Terpusat tidak pernah dipakai utuh
- **Lokasi**:
  - `supabase/functions/api/handlers/reports.ts:36-79` (`getAllActiveTariffs`,
    `calculateTariffAmount`), `:209-218` (re-hitung hanya bila `tariff_amount` 0/null),
    `:285` (`trip_revenue` = jumlah `tariff_amount`).
  - `supabase/functions/api/handlers/trips.ts:95-111` (`getTariff` + simpan `golongan`).
  - `src/pages/mobile/VehicleFormScreen.tsx:127` (`tariff: tariffFor(vehicleType).loadedNum`).
  - `src/pages/store.tsx:274-276` (`golonganFor` → gol master dari cache tarif).
- **Bukti — tiga sumber tarif yang tidak pernah dipertemukan**:
  1. **Master tarif** (`tariffs`: `golongan`, `vehicle_type`, `loaded_tariff`,
     `empty_tariff`) — dipakai mobile saat input kendaraan (`VehicleFormScreen.tsx:127`)
     dan dipakai backend saat insert (`trips.ts:95`).
  2. **Tarif Terpusat per region** (`region_tariffs`: `lokal`, `eksternal`) — dikonfigurasi
     di Admin (TariffTab) dan dipakai **hanya** oleh `plates.ts:165-177` saat cek plat;
     **tidak pernah dipakai** di `reports.ts` maupun `trips.ts`.
  3. **Tarif hasil cek plat** (`plates.ts` → `tariffAmount` per kategori
     Internal/Lokal/Eksternal) — **diabaikan** mobile; `VehicleFormScreen` tetap memakai
     master tarif.
- **Mekanisme “Rp 0”** (terverifikasi di kode):
  - `reports.ts:209-218` re-hitung hanya bila `tariff_amount` 0/null.
  - `calculateTariffAmount` (`reports.ts:111`) mencoba `"vehicle_type|golongan"`, lalu
    fallback `"vehicle_type|"`. Bila `tariffs` **kosong** atau `vehicle_type` berbeda
    penulisan (mis. `Truck Besar` vs `Truk`), **dua-duanya miss → 0**.
  - `trips.ts:97-103`: bila `getTariff` null, nilaitaken dari client **hanya bila > 0**;
    bila tarif client 0 (cache tarif belum ter-pull) → **disimpan 0** → laporan 0.
- **Dampak**: Admin sudah mengisi Master Tarif, tetapi laporan tetap Rp 0; sebaliknya
  tarif kategori/region yang dikonfigurasi di "Tarif Terpusat" justru tidak pernah
  dipakai dalam perhitungan pendapatan laporan.
- **Perbaikan** (lihat Bagian 4 P0-1/P0-2).

### A-05 · TINGGI · Kategori kendaraan (Internal/Eksternal/Lokal) hilang saat sync
- **Lokasi**: `src/services/sync.ts:549` → `golongan: v.golongan ?? v.category ?? ''`;
  `src/pages/mobile/VehicleFormScreen.tsx:126` (`golongan: golonganFor(vehicleType)`);
  `supabase/functions/api/handlers/trips.ts:111` (simpan `golongan: vehicle.golongan`).
- **Bukti**: `v.golongan` selalu terisi (gol master I..V dari `golonganFor`), sehingga
  `v.category` **tidak pernah terkirim**. Tabel `vehicles` juga **tidak punya kolom
  kategori** → backend tidak bisa membedakan kendaraan Internal (gratis) dari
  Lokal/Eksternal.
- **Dampak**: (a) laporan hanya bisa menampilkan gol master, bukan kategori yang
  dipilih petugas; (b) kendaraan Internal **tetap ditagih** tarif master, padahal
  kebijakan bisnis menyatakan Internal = Rp 0.
- **Perbaikan**: kirim `kategori` terpisah di payload, simpan di kolom baru
  `vehicles.kategori` (atau ganti `golongan` menjadi kategori dan simpan gol master
  di `golongan_master`), lalu jadikan kategori sebagai penentu tarif (Internal → 0).

### A-06 · TINGGI · Master Tarif offline di Admin hilang diam-diam (tidak ada antrean)
- **Lokasi**: `src/pages/admin/tabs/TariffTab.tsx:33-67`; `src/pages/admin/AdminDashboard.tsx:27,77-79,146-150`.
- **Bukti**:
  ```ts
  // TariffTab.tsx:36-43
  if (serverState === 'online') { const id = await createTariff(row); if (id) row.id = id }
  onSaveTariffs([...tariffs, row])
  showToast('Tarif ditambahkan')          // ← tetap sukses walau server gagal/offline
  ```
  `onSaveTariffs` = `setTariffs` (state React saja). **Tidak ada** localStorage,
  **tidak ada** antrean offline untuk master tarif (bandingkan `sync.ts` yang punya
  antrean IndexedDB untuk trip).
- **Dampak**: Admin offline mengedit tarif → percakapan "Tarif diupdate" → **perubahan
  hilang** saat tab ditutup/refesh, dan tidak pernah naik ke server. Di sisi lain
  `AdminDashboard.tsx:77-79` hanya menerapkan hasil server bila `tarr.length > 0`,
  sehingga tabel server yang kosong membuat perubahan lokal lenyap.
- **Perbaikan**: antrean master (pattern `localDb` store `pending` + `processSyncQueue`),
  toast "Tersimpan lokal, akan dikirim saat online", dan reconciles saat online.

### A-07 · TINGGI · Cap "prefetch fresh" ditulis walau sebagian pull gagal
- **Lokasi**: `src/services/prefetch.ts:139-146`.
- **Bukti**:
  ```ts
  if (routesResult.status === 'rejected') errors.push('Routes: ' + …)
  …
  const success = errors.length === 0
  markPrefetched()          // ← tetap ditulis walau errors.length > 0
  ```
- **Dampak**: satu endpoint gagal → 3 menit berikutnya `prefetchAllCriticalData()`
  mengembalikan cache **lama/tidak lengkap** tanpa mencoba pull lagi → petugas
  bekerja dengan rute/geofence/tarif yang tidak sinkron di lapangan.
- **Perbaikan**: `markPrefetched()` hanya bila `success`, atau simpan cap per-domain
  (`trip.prefetch.lastAt.routes` dst.) sehingga domain yang gagal dicoba lagi.

### A-08 · TINGGI · Master plat & region tidak pernah ditarik ke cache perangkat
- **Lokasi**: `src/services/prefetch.ts:96-137` (5 pull: rute, geofence, tarif,
  akses dermaga, roster); `src/services/adminPull.ts:132` (`pullRegionsToLocal` hanya
  dipanggil dari `silentMasterSync`).
- **Bukti**: tidak ada `pullPlatesToLocal` di mana pun; `src/services/plates.ts`
  hanya punya `fetchPlates()` (dipakai Admin). Regions pun hanya ditarik lewat
  `silentMasterSync()` yang tidak dipanggil dari alur `prefetch`.
- **Dampak**: (a) cek status plat **tidak bisa jalan offline** (butuh `/plates/check`);
  (b) dropdown "Region asal" di `VehicleFormScreen` kosong offline → petugas tidak
  bisa mencatat kendaraan eksternal; (c) `region_tariffs` (kategori tarif) tidak
  pernah ada di perangkat.
- **Perbaikan**: tambahkan pull `vehicle_plates` + `regions` + `region_tariffs` ke
  `prefetchAllCriticalData()`, dan sediakan `checkPlateOffline()` yang memakai
  cache plat (status internal/lokal/eksternal) saat server tidak terjangkau.

### A-09 · TINGGI · Rute trip kosong tidak terkunci sesuai SOP
- **Lokasi**: `src/pages/mobile/TripConditionScreen.tsx:11` (`EMPTY_ROUTE_CODE = 'SJRE-SBDZ'`);
  `src/pages/mobile/RouteSelectScreen.tsx:239-249` (`handleContinue`).
- **Bukti**: `RouteSelectScreen.handleContinue` untuk kondisi `kosong` hanya
  `patchDraft({ routeCode: validSelected … })` — **tidak mengunci** ke `EMPTY_ROUTE_CODE`;
  daftar rute untuk kondisi kosong tidak difilter ke rute locked (berdasarkan
  `ALUR_APLIKASI.md` §1.4 seharusnya hanya 1 rute terkunci).
- **Dampak**: petugas dapat mengirim trip kosong pada rute yang salah; laporan
  rekap jadi tidak konsisten dengan SOP.
- **Perbaikan**: pada `draft.condition === 'kosong'`, paksa `routeCode = EMPTY_ROUTE_CODE`
  dan nonaktifkan pemilih rute (tampilkan label "Terkunci (Trip Kosong)").

### A-10 · SEDANG · Antrean sync bisa macet pada satu item
- **Lokasi**: `src/services/sync.ts:686-723` (`processItem`), `:737-777` (`processSyncQueue`).
- **Bukti**: `processItem` menerima error 4xx (non-401/408) sebagai `permanent: true`
  → item **tidak dihapus dari antrean**, `attempts` naik, `needsAttention` → backoff
  `MAX_BACKOFF_MS`. Item permanent tidak pernah "dibuang" atau dipisahkan ke daftar
  perhatian, dan `processSyncQueue` tetap mencoba memprosesnya tiap siklus.
- **Dampak**: satu trip dengan foto rusak (mis. >5MB, `PHOTO_TYPES` salah) →
  `trips.ts:144` menolak 400 → item itu **terkunci permanen**; antrean lain tetap
  jalan (loop `for` tidak `break`), tetapi UI menampilkan "gagal" permanen tanpa
  jalan perbaikan yang jelas.
- **Perbaikan**: pisahkan item `permanent` ke store `failed` dengan aksi "perbaiki/
  hapus" di Riwayat; jangan retry tanpa batas.

### A-11 · SEDANG · Sesi offline: `renewSessionIfNeeded` bisa menggantung
- **Lokasi**: `src/services/auth.ts:164-217` (`loginWithPin` → `api.post`), dipanggil
  dari `renewSessionIfNeeded` (`auth.ts:421-433`).
- **Bukti**: `loginWithPin` melakukan POST `/auth/login` **tanpa timeout eksplisit**;
  dipanggil dari `syncOnResume` (`adminPull.ts:27`) dan `ensureSessionForQueue`
  (`sync.ts:726-733`). `api.post` memakai `withTimeout`? — perlu dipastikan; bila
  tidak, koneksi yang menggantung (bukan refused) membuat `syncOnResume` menggantung
  dan `prefetch` tidak pernah dijalankan.
- **Perbaikan**: bungkus dengan `withTimeout` (pola yang sudah dipakai `sync.ts:112`)
  agar jalur offline tidak menunggu tanpa batas.

### A-12 · SEDANG · Riwayat tidak pernah membaca IndexedDB / tidak ada invalidasi cache
- **Lokasi**: `src/pages/mobile/HistoryScreen.tsx:65-70`; `src/pages/store.tsx:377`.
- **Bukti**: `HistoryScreen` memakai `trips` dari `useApp()`; state diisi
  `load(LS.trips, seedTrips)` sekali saat mount. Tidak ada `dbAll('trips')` di
  seluruh aplikasi, tidak ada listener perubahan dari IndexedDB.
- **Dampak**: rekap riwayat hanya akurat insofar state Reactsinkron; setelah restart
  aplikasi, data yang gagal ditulis localStorage **tidak pernah muncul lagi**.
- **Perbaikan**: lihat A-02 (pindahkan sumber ke IndexedDB + invalidasi saat sync
  selesai/trip baru).

### A-13 · SEDANG · `navigator.onLine` dipakai sebagai penentu online
- **Lokasi**: `src/services/prefetch.ts:244`, `src/services/sync.ts:793-820`.
- **Bukti**: `if (typeof navigator !== 'undefined' && !navigator.onLine) return`.
  `navigator.onLine` hanya menyatakan ada interface jaringan, bukan ada internet
  (karakteristik umum captive portal / Wi-Fi tanpa uplink).
- **Dampak**: di area tanpa uplink, auto-sync & auto-prefetch terus mencoba
  (boros) dan misleading ("Online" di UI padahal server tak terjangkau).
- **Perbaikan**: andalkan `probeServer()` (`sync.ts:346`) sebagai penentu tunggal,
  `navigator.onLine` hanya sebagai pemicu percobaan.

### A-14 · RENDER · Sprint/animasi & teks emoji
- **Lokasi**: `src/pages/mobile/VehicleFormScreen.tsx` (emoji ikon kendaraan pada
  dokumentasi `ALUR_APLIKASI.md` §1.5), `src/pages/admin/tabs/ReportsTab.tsx`.
- **Catatan**: emoji pada beberapa label/ikon legacy perlu dibersihkan agar
  konsisten dengan permintaan "tulisan bersih tanpa emoji".

---

## 3. Temuan Backend (Supabase Edge Functions)

### B-01 · TINGGI · Backend tidak pernah menyimpan kategori kendaraan
- **Lokasi**: `supabase/functions/api/handlers/trips.ts:104-120` (`insertVehicle`).
- **Bukti**: kolom yang di-insert: `golongan: vehicle.golongan` — tidak ada
  `kategori`; tabel `vehicles` tidak punya kolom kategori.
- **Dampak**: lihat A-05 — laporan tidak bisa menampilkan/menagih sesuai kategori.

### B-02 · TINGGI · Lookup tarif memakai kunci `vehicle_type|golongan` yang rapuh
- **Lokasi**: `supabase/functions/api/handlers/reports.ts:36-53` (`getAllActiveTariffs`),
  `:111-131` (`calculateTariffAmount`); `supabase/functions/api/handlers/trips.ts:36-53`
  (`getTariff`).
- **Bukti**: kunci `"${vehicle_type}|${golongan}"` dan fallback `"${vehicle_type}|"`.
  Bila `tariffs` kosong / `vehicle_type` berbeda ejaan → **0**.
- **Dampak**: sumber langsung symptoms "Rp 0" di laporan.
- **Perbaikan**: satu fungsi tarif tunggal di backend
  (`resolveTariff(vehicleType, hasLoad, kategori, regionId)`) dengan urutan:
  1. kategori Internal → 0;
  2. tarif terpusat region (Lokal/Eksternal) bila kategori cocok & aktif;
  3. master tarif (vehicle_type, golongan) → loaded/empty;
  4. fallback `vehicle_type` saja.
  Dan **re-hitung saat baca laporan** (bukan hanya saat `tariff_amount` 0) agar
  selalu mengikuti Master Tarif terkini.

### B-03 · SEDANG · Tarif tidak pernah di-"snapshot" per trip
- **Lokasi**: `supabase/functions/api/handlers/trips.ts:95-103`.
- **Bukti**: `vehicles.tariff_id` diisi dari tariff yang cocok, tetapi `tariff_amount`
  disimpan sebagai angka beku.
- **Dampak**: mengubah Master Tarif tidak mengubah laporan trip lama —-admin
  bisa melihat "kalkulasi tidak dinamis".
- **Perbaikan**: simpan `tariff_id` + `tariff_amount` (audit), tapi hitung nilai
  tampil di laporan dari master tarif terkini (kolom `tarif_terpakai` =
  nilai master saat ini) sehingga jelas mana angka historis vs aplikasi master.

### B-04 · SEDANG · `plate_scans`/master plat dipakai sebagai sumber kategori (workaround)
- **Lokasi**: `supabase/functions/api/handlers/reports.ts` (fungsi
  `fetchPlateCategories`).
- **Catatan**: implementasi 2026-10-22 membaca kategori dari pindaian plat
  terbaru karena kolom kategori belum ada di `vehicles`. Begitu A-05/B-01 diperbaiki,
  workaround ini sebaiknya diganti sumber tunggal `vehicles.kategori`.

### B-05 · SEDANG · Endpoint admin-login memakai kredensial default yang di-hardcode
- **Lokasi**: `src/services/auth.ts:805-812`.
- **Bukti**:
  ```ts
  body: JSON.stringify({ username: 'admin', password: 'admin123456' })
  ```
  Token admin di-mint otomatis oleh browser; kredensial default ada di bundle
  frontend (terbaca siapa pun).
- **Dampak**: siapa pun yang bisa membuka bundle admin dapat mengambil token admin
  penuh (baca master tarif, ubah tarif, hapus rute).
- **Perbaikan**: token admin tidak boleh di-mint diam-diam dari browser; ganti
  dengan login admin eksplisit (password + session cookie/JWT), minimal ubah
  kredensial default dan beri peringatan di server saat `ADMIN_PASSWORD` masih default.

### B-06 · RENDER · Pesan error backend tidak dikodekan dengan rapi
- **Lokasi**: `supabase/functions/api/handlers/trips.ts:142-148`.
- **Catatan**: validasi foto memakai `PHOTO_TYPES` & batas 5 MB; pesan error
  masih bahasa campuran dan beberapa field tidak tervalidasi (mis. `statusMuatan`
  bebas string) → perlakukan sebagai daftar putih nilai.

---

## 4. Temuan Admin Dashboard (Master Tarif & Laporan Trip)

### C-01 · TINGGI · Master Tarif: nilai yang tersimpan server bisa tetap 0
- **Lokasi**: `src/pages/admin/tabs/TariffTab.tsx:111-116` (form), `:33-44` (simpan).
- **Bukti**: form "Muatan (Rp)"/"Kosong (Rp)" memakai `parseInt(e.target.value) || 0`;
  tidak ada validasi > 0 dan **tidak ada pesan error** bila 0 tersimpan. `createTariff`
  gagal diam-diam (return null → tanpa toast error, lihat A-06).
- **Dampak**: baris tarif dengan 0 tersimpan → semua trip memakai tipe itu bernilai 0
  → laporan Rp 0.
- **Perbaikan**: validasi nominal minimum (>= 0, dan > 0 untuk non-Internal), konfirmasi
  bila 0, serta toast error bila server menolak.

### C-02 · TINGGI · Master Tarif tidak pernah menampilkan nilai yang dipakai server
- **Lokasi**: `src/pages/admin/AdminDashboard.tsx:77-79`.
- **Bukti**:
  ```ts
  const [tarr, tri] = await Promise.all([fetchTariffs(), fetchTrips()])
  if (tarr !== null && tarr.length > 0) setTariffs(tarr)
  ```
  Bila server kosong/gagal → state tetap `[]` (atau nilai lama) tanpa indikator
  "data server tidak termuat". Admin bisa saja mengira sudah mengatur tarif padahal
  yang berlaku di server berbeda.
- **Perbaikan**: tampilkan badge status sinkronisasi per baris + sumber nilai
  (server/lokal), dan refuse edit yang tidak akan naik ke server.

### C-03 · SEDANG · Laporan Trip: baris tabel hanya menampilkan 1 foto
- **Lokasi**: `src/pages/admin/tabs/ReportsTab.tsx:437-449` (thumbnail
  `t.foto_kosong_path`), `:328-344` (tombol "Foto (N)" memang membuka viewer berisi
  semua foto).
- **Bukti**: viewer sudah benar (semua foto kendaraan + foto bukti trip), tetapi
  **di dalam tabel** hanya foto bukti trip yang terlihat.
- **Dampak**: admin harus klik tombol untuk melihat dokumentasi kendaraan.
- **Perbaikan**: tampilkan strip thumbnail (maks. 3 + "+N") pada sel foto, atau
  kolom foto dengan jumlah per unit.

### C-04 · SEDANG · Laporan: kolom "Kategori" masih menampilkan gol master
- **Lokasi**: `src/pages/admin/tabs/ReportsTab.tsx:486`, `src/services/trips.ts:87-95`.
- **Catatan**: sudah diperbaiki pada 2026-10-22 (memakai `reportGolongan()`), tetapi
  masih bergantung pada workaround `plate_scans` (B-04) sampai A-05/B-01 beres.

### C-05 · SEDANG · Laporan: total pendapatan memakai sumber berbeda dari baris
- **Lokasi**: `src/pages/admin/ReportSheet.tsx` (footer TOTAL memakai `vehicleRows`
  = hasil filter klien), `src/pages/admin/tabs/ReportsTab.tsx` (rekap memakai
  `trip_revenue` server).
- **Dampak**: bila filter kategori memfilter kendaraan, footer "TOTAL" menghitung
  hanya kendaraan yang lolos filter, sedangkan rekap per tanggal di tab Laporan
  memakai total server → dua angka berbeda untuk data yang sama.
- **Perbaikan**: gunakan satu sumber (server) untuk semua total, atau labeli
  dengan jelas "total terfilter".

### C-06 · RENDER · Emoji pada beberapa label/ikon
- **Lokasi**: `src/pages/admin/tabs/*.tsx`, `src/pages/mobile/VehicleFormScreen.tsx`.
- **Perbaikan**: ganti dengan ikon lucide-react agar konsisten.

---

## 5. Prioritas Perbaikan (rencana eksekusi)

### P0 — Fungsi inti (harus selesai sebelum produksi berikutnya)
1. **Tarif tunggal di backend** (B-02 + C-01 + C-02 + A-04):
   `resolveTariff(vehicleType, hasLoad, kategori, regionId)` dipakai oleh
   `trips.ts` (insert) **dan** `reports.ts` (baca laporan) → laporan selalu
   mengikuti Master Tarif terkini, tarif terpusat per region dihormati, Internal = 0.
2. **Simpan kategori kendaraan** (A-05 + B-01): kolom `vehicles.kategori`,
   payload sync mengirim `kategori`, UI form mengirim kategori terpilih.
3. **Riwayat berbasis IndexedDB** (A-02 + A-12): `dbPut('trips')` + foto sebagai
   blob; `HistoryScreen` membaca `dbAll('trips')`.
4. **Swafoto wajib** (A-01): mode kamera `selfie` + gate di UI + validasi store +
   pengiriman ke server.

### P1 — Konsistensi offline & scope
5. Filter rute berbasis scope akses dermaga (A-03).
6. Antrean master tarif di Admin + indikator status sinkron (A-06, C-02).
7. Pull master plat/region/region_tariff + `checkPlateOffline` (A-08).
8. Cap prefetch per-domain (A-07).
9. Kunci rute trip kosong sesuai SOP (A-09).
10. Timeout eksplisit pada `loginWithPin` (A-11).

### P2 — Kebersihan dan Penyajian Laporan
11. Validasi nominal tarif & toast error (C-01).
12. Strip thumbnail semua foto pada tabel Laporan (C-03).
13. Satu sumber total (C-05).
14. Pisahkan item antrean permanent (A-10).
15. Ganti `navigator.onLine` dengan `probeServer()` (A-13).
16. Hardening admin-login (B-05).
17. Pembersihan emoji (A-14, C-06).

---

## 6. Daftar File yang Perlu Diubah

**Mobile — services**
`src/services/sync.ts`, `src/services/prefetch.ts`, `src/services/adminPull.ts`,
`src/services/masterTariffs.ts`, `src/services/plates.ts`, `src/services/offlineDb.ts`,
`src/services/localDb.ts`, `src/services/auth.ts`, `src/services/tariffs.ts`

**Mobile — pages**
`src/pages/store.tsx`, `src/pages/mobile/VehicleFormScreen.tsx`,
`src/pages/mobile/TripSummaryScreen.tsx`, `src/pages/mobile/TripConditionScreen.tsx`,
`src/pages/mobile/RouteSelectScreen.tsx`, `src/pages/mobile/CameraScreen.tsx`,
`src/pages/mobile/HistoryScreen.tsx`, `src/pages/mobile/HistoryDetailScreen.tsx`

**Backend**
`supabase/functions/api/handlers/trips.ts`, `supabase/functions/api/handlers/reports.ts`,
`supabase/functions/api/handlers/master.ts`, `supabase/functions/api/handlers/regionTariffs.ts`,
`supabase/functions/api/handlers/plates.ts`

**Admin**
`src/pages/admin/AdminDashboard.tsx`, `src/pages/admin/tabs/TariffTab.tsx`,
`src/pages/admin/tabs/ReportsTab.tsx`, `src/pages/admin/ReportSheet.tsx`

**Dokumen**
`OFFLINE-FIRST-ARCHITECTURE.md`, `ALUR_APLIKASI.md` (penyelarasan dengan implementasi)

---

## 7. Appendix — Perintah Verifikasi yang Dipakai

```bash
grep -rn "dbPut('trips'" src/            # → kosong (A-02)
grep -rn "selfie" src/                   # → hanya field, tanpa capture (A-01)
grep -rn "createPortal" src/pages/admin  # → pola modal yang benar (lihat fix 2026-10-22)
grep -n "cameraMode" src/pages/store.tsx # → 'photo' | 'ocr' (A-01)
npx tsc --noEmit --skipLibCheck          # → bersih
npx vitest run                           # → 139 test lulus
deno check supabase/functions/api/handlers/reports.ts
```
