<!-- coord:start -->
## Team coordination

This repo is set up for team coordination between agents working in shared
sessions. Follow these rules:

- Before starting non-trivial work, publish a plan with `publish_plan`.
- Keep step status current as you go, using `update_step`.
- If the injected context shows an overlap warning, coordinate before you
  edit (spec Law 3, Rev 28) — never silently duplicate the work. If it is the
  same task and you have not started, join their session: register on their
  branch, or offer `propose_work_request` — the server auto-accepts only
  when every step is provably unstarted and unassigned, so a safe join needs
  no human. If the work is related, claim only unstarted, unassigned steps
  the same way. Never take started or assigned work. Stop and ask your human
  only when your permission mode requires approval or no safe action exists.
- When you discover something non-obvious (a gotcha, a decision, a fact
  someone else would need), write it down with `remember` so the team
  keeps it.
- When something is a teammate’s job rather than yours — their area, their
  decision, a question only they can answer — hand it to them with
  `assign_work` instead of asking your human to relay a message. Use
  `list_people` to turn a name into an assignee id, put the whole brief
  in the note, and tell your human who you handed it to. Their own agent is
  told at its next prompt. This is free: no model call, no sponsor, nothing
  to pay for.
- When you hit a bug, a blocker, or something that plainly wants a different
  specialist, open it with `report_opportunity` and close it with
  `resolve_opportunity` when it is handled. Nothing reads your transcript
  looking for these, so a problem you only describe in your answer reaches
  nobody; reporting it is what lets the team's Brain offer it to whoever fits.
  Reporting is not notifying — it may reach no one — so do not tell your human
  a teammate was alerted.
<!-- coord:end -->

<!-- project-notes:start -->
## Project notes

Commands:

```bash
npm run test:unit                                  # vitest, 260 tests
npm run lint                                       # angular eslint
npx tsc --noEmit -p tsconfig.app.json
deno test --allow-env --allow-net --allow-read --allow-write server/api/
```

Tariff model (do not regress):

- Resolution order in `server/api/handlers/tariffRules.ts` → `resolveTariff`:
  Internal (Rp 0) → `region_tariff_rows` override → master `tariffs` (BADAU)
  → flat `region_tariffs` → Rp 0. A region without an override inherits BADAU,
  so no row copying is needed when adding a region.
- Per-region prices live in `region_tariff_rows`, unique on
  `(region_id, golongan, vehicle_type)`. BADAU keeps using master `tariffs`;
  every other region writes through `PUT /api/region-tariffs/:regionId`.
- Bulk + hapus baris tarif (dipakai tab Master Tarif di admin):
  `POST /api/region-tariffs/bulk` (satu jenis kendaraan ditulis ke banyak
  region sekaligus; `scope: "all"` = semua region, `scope: "existing"` =
  hanya region yang sudah punya baris itu) dan
  `DELETE /api/region-tariffs/:regionId/rows/:vehicleType` (hapus baris satu
  jenis). Keduanya mencocokkan `vehicle_type` secara case-insensitive
  (`normalizeVehicleType`) supaya "Truk Kecil" = "truk kecil"; baris yang
  sudah ada di-update memakai ejaan yang tersimpan di DB (tidak bikin duplikat).
- Gotcha: a Deno `Request` body can be read only once. Parse `req.json()`
  once in a handler and pass the parsed object into helpers — a second read
  throws and silently degrades to `{}`.
- SNAPSHOT HARGA (aturan owner, jangan regresi): perubahan tarif di admin
  hanya berlaku untuk trip SELANJUTNYA. Trip yang sudah terkirim memakai
  harga yang tercatat saat dikirim (`vehicles.tariff_amount` +
  `vehicles.tarif_source`). Laporan (`server/api/handlers/reports.ts` →
  `snapshotTariff`) TIDAK boleh menghitung ulang tarif dari master/region
  yang berlaku sekarang; recompute hanya untuk baris lawas tanpa harga
  tersimpan. Resolver dipakai saat INSERT trip (`trips.ts` →
  `insertVehicleRow`).
  Backfill baris lawas (sekali jalan, idempoten): dijalankan OTOMATIS oleh
  `restart-all-ubuntu.sh` (langkah "backfill snapshot", setelah migrasi DB).
  Manual kalau perlu: `docker compose exec api-intranet deno run --allow-env
  --allow-net --node-modules-dir=none api/scripts/backfill_tariff_snapshot.ts`
  (tambah `--dry-run=1` untuk melihat rencana dulu).
- Migrations for this: `server/db/migrations/20261026000000_region_tariff_rows.sql`
  and `20261027000000_seed_region_tariff_rows.sql`; apply them to the office DB
  before deploying. Rebuild containers after backend changes:
  `docker compose build api-intranet web && docker compose up -d`.

Aturan aplikasi mobile (dipakai petugas lapangan) — jangan regresi:

- DRAFT MAKSIMAL 15 MENIT (bisa diubah dari dashboard admin). Nilai
  *bawaan* ada di `src/services/tripDraft.ts` → `DRAFT_TTL_MS =
  15 * 60 * 1000`, dihitung dari `createdAt` (bukan waktu edit terakhir, supaya
  draft tidak bisa diperpanjang hanya dengan menyentuh form). Setelah lewat
  batas tersebut draft **dibekukan**, bukan dihapus: `store.tsx` mengekspos
  `draftLocked`, dan semua layar yang bisa mengubah isian (kondisi muatan,
  rute, form kendaraan, kamera) mengarahkan balik ke Ringkasan. Yang boleh
  setelahnya: **Kirim Trip** atau **Batalkan**.
- BATAS DURASI DRAFT BISA DIATUR DARI DASHBOARD ADMIN (aturan owner).
  Nilai yang dipakai perangkat berasal dari server, bukan dari kode:
  - Server: `GET /api/settings` (baca, semua user login) + `PUT
    /api/settings` (tulis, admin saja) — handler
    `server/api/handlers/settings.ts`, tabel `app_settings` (key-value),
    migrasi `server/db/migrations/20261102000000_app_settings.sql`.
  - Admin: tab **"Pengaturan"** → panel "Batas Umur Draft Trip"
    (`src/pages/admin/components/AppSettingsPanel.tsx`).
  - Mobile: `src/services/appSettings.ts` menarik nilai saat aplikasi
    dibuka, menyimpannya di localStorage (`trip.appSettings.v1`), dan
    `store.tsx` memakainya untuk menghitung `expiresAt` +status
    `draftLocked`. Kalau server tidak bisa dihubungi, nilai TERSIMPAN
    dipakai (bukan ditimpa nilai bawaan) supaya pengaturan tidak hilang
    hanya karena sinyal hilang sesaat.
  - `DRAFT_MAX_MINUTES` (konstanta) hanya nilai bawaan untuk UI — jangan
    dipakai sebagai sumber kebenaran.
- DRAFT PER PETUGAS. Kunci penyimpanan `trip.draft.v2:<officerId>` (IndexedDB
  meta). Perangkat yang dipakai berganti petugas tidak boleh menampilkan
  draft orang lain. Draft lama (`trip.draft.v1`) dimigrasi sekali ke petugas
  yang sedang aktif lalu dihapus.
- DRAFT BARU "BERHITUNG" ADA MINIMAL 1 KENDARAAN (aturan owner). Dua
  helper berbeda di `src/services/tripDraft.ts`:
  - `hasDraftContent(d)` = isian apa pun (dipakai untuk PENYIMPANAN lokal,
    supaya isian yang sudah diketik tidak hilang saat aplikasi ditutup).
  - `hasCountedDraft(d)` = draft sungguhan: minimal 1 kendaraan; untuk trip
    KOSONG (yang alurnya tidak menambah kendaraan) minimal foto bukti.
  Yang "berhitung" menentukan: kartu draft di Riwayat, kunci tombol
  "Mulai Trip" di Beranda, dan apakah jam 15 menit sudah berjalan. Isian yang
  baru berupa status muatan/rute BELUM dihitung: tidak mengunci tombol, tidak
  tampil di Riwayat, jam 15 menit belum mulai (bermula saat kendaraan
  pertama ditambahkan).
- TOMBOL "MULAI TRIP" TERKUNCI KALAU ADA DRAFT (aturan owner). Di Beranda
  (`src/pages/mobile/HomeScreen.tsx`) tombol "Mulai Trip (terkunci)" +
  notifikasi panduan (`src/components/DraftLockToast.tsx`) memberi tahu:
  lanjutkan draft ATAU hapus/batalkan draft di halaman Riwayat. Draft yang
  lewat batas umur tetap bisa dikirim/dibatalkan; membatalkan = dokumen
  pembatalan (bukan hapus diam-diam).
- TRIP YANG SUDAH SELESAI = FINAL. Begitu trip selesai, tidak ada lagi tombol
  "Ubah" (plat/jenis/golongan) maupun ambil ulang foto — **walaupun trip
  belum sinkron ke server intranet**. Server bisa sudah menerima versi
  pertama; membiarkan perangkat mengubah isi membuat server & perangkat tidak
  sinkron. Koreksi dilakukan lewat pembatalan + trip baru.
- PEMBATALAN = DOKUMEN, BUKAN HAPUS. Tombol "Hapus" di kartu draft diganti
  "Batalkan"; alasan pembatalan WAJIB dipilih (`CANCEL_REASONS` di
  `src/services/tripCancel.ts`). Pembatalan membuat dokumen (alasan +
  keterangan + rincian trip) yang dikirim ke `POST /api/trips/cancel`, disimpan
  di tabel `trip_cancellations` (migrasi
  `server/db/migrations/20261101000000_trip_cancellations.sql`), dan tampil di
  tab admin **"Pembatalan Trip"** (`src/pages/admin/tabs/CancellationsTab.tsx`
  — filter rentang/alasan/cari, kartu statistik, grafik per alasan & per hari,
  tabel dokumen + rincian kendaraan, ekspor .xlsx). Server: `GET
  /api/trips/cancellations` (`?mode=summary` = ringkasan, `?startDate=
  &endDate=&reason=&q=` = filter; batas tanggal pakai offset WIB +07:00
  eksplisit). Daftar alasan dipindahkan ke modul ringan
  `src/services/cancelReasons.ts` (bukan `tripCancel.ts`) supaya halaman admin
  tidak menarik modul antrean offline (IndexedDB) ke bundle dashboard. Di
  Riwayat muncul baris "Dibatalkan".

Master jenis kendaraan (satu-satunya daftar yang sah):

- Tabel `vehicle_types` (server/db/schema.sql) = sumber tunggal daftar jenis
  kendaraan. Dulu daftar ini hardcode DI DUA tempat: dashboard admin
  ("motor, mobil, truk kecil, ...") dan aplikasi petugas ("Motor, Mobil,
  Truck Kecil, ...") - ejaan dan isinya berbeda, jadi pilihan di admin dan
  HP tidak sinkron. Sekarang KEDUA aplikasi baca dari tabel yang sama.
- Endpoint: `GET /api/vehicle-types` (daftar aktif), `POST` (tambah),
  `PUT /api/vehicle-types/:id` (ubah nama/urutan), `DELETE
  /api/vehicle-types/:id` (hapus + hapus baris tarifnya).
  Handler: `server/api/handlers/vehicleTypes.ts`.
  Frontend: `src/services/vehicleTypes.ts` (admin) + paket offline
  (`GET /api/master/offline` ikut mengirim `vehicleTypes`).
- `key` = bentuk normalisasi (tanpa spasi, "Truck" -> "truk") jadi
  "Truk Kecil" = "truk kecil" = "Truck Kecil" dianggap jenis yang sama.
- Migrasi: `20261031000000_vehicle_types.sql` (buat tabel + isi dari data
  yang SUDAH dipakai - tidak pernah mengarang daftar) dan
  `20261031010000_vehicle_types_canonical.sql` (kanonisasi ejaan +
  `sort_order`). Migrasi dijaga idempoten; urutannya MASTER (jenis yang ada
  di master tarif dulu, jenis yang hanya ada di baris region belakangan).
- Data seed BOHONG sudah dihapus: `src/services/seedData.ts` tidak lagi
  berisi roster petugas contoh, region/demaga ENTIKONG/BELITUNG/KELAPAKAMPIT,
  rute contoh ("AAAA -> BBBB"), maupun PIN default "123456". Jangan
  menambahkannya kembali - data master hanya boleh dari server.
- `PUT /api/officers/:id` (baru) = ubah nama/username petugas. Dulu kolom
  "Nama" di form edit admin bisa diedit tapi TIDAK PERNAH dikirim ke server
  (UI bilang "diupdate", database tetap nama lama).

Token desain admin dashboard (sumber tunggal warna):

- Semua token didefinisikan di `src/index.css` di bawah selector
  `html[data-admin]` (halaman admin selalu punya atribut itu - lihat
  `scripts/organize-build.mjs`). Token di luar selector itu TIDAK ADA,
  jadi jangan pakai `var(--admin-*)` di halaman mobile.
- Token inti: `--admin-surface` (kartu), `--admin-surface-muted`,
  `--admin-surface-sunken`, `--admin-border`, `--admin-border-subtle`,
  `--admin-text` / `-soft` / `-muted` / `-faint`, `--admin-success`,
  `--admin-warning`, `--admin-danger`, `--admin-surface-inverse` (header
  tabel kelompok yang gelap), `--admin-shadow-card`.
- Token AKSIK (`--admin-accent`, `-hover`, `-soft`, `-border`, `-text`,
  `-contrast`) TIDAK ditulis di CSS sebagai sumber utama: nilainya datang
  dari `ACCENT_PALETTE` di `src/services/theme.ts`, ditulis ke `<html>`
  oleh `applyTheme()`. CSS hanya menyimpan fallback biru supaya halaman
  tidak berkedip warna salah sebelum tema diterapkan.
- Cara pakai di TSX: `bg-[var(--admin-surface)]`,
  `text-[var(--admin-text-muted)]`, `border-[var(--admin-border)]`,
  `shadow-[var(--admin-shadow-card)]`. JANGAN pakai modifier opacity
  (`bg-[var(--x)]/60`) - Tailwind tidak bisa mengapalkan nilai `var()`.
- Cakupan sekarang: halaman Dashboard (tab "Dashboard" = `ReportsTab`) +
  komponennya (`BreakdownSummaryCard`, `CurrencyDisplay`, `PhotoViewer`).
  Tab admin lain masih pakai kelas Tailwind langsung.
- Tabel laporan memakai hierarki DUA LEVEL: tanggal → golongan → kendaraan
  (`buildDateGroups()` di `src/pages/admin/tabs/ReportsTab.tsx`).
  Trip tidak lagi jadi baris sendiri: semua kendaraan dari semua trip pada
  tanggal yang sama digabung per golongan, jadi membuka satu grup = seluruh
  kendaraan golongan itu (Internal → Eksternal → Lokal, urutan `GOL_ORDER`).
  Mode buka/tutup: `collapse` (hanya header tanggal), `header` (header
  tanggal + header golongan, kendaraan tertutup - DEFAULT), `all` (semua
  kendaraan tampil). Override per item disimpan di `dateOpenOverrides` /
  `golOpenOverrides` (key golongan = `<tanggal>|<golongan>`) sehingga klik
  individual menimpa mode. Hook test: `data-testid="report-date-header"`,
  `"report-gol-header"` (punya `data-gol`), `"report-vehicle-row"`.
- `CurrencyDisplay` sengaja TIDAK memaksa warna nominal: warna_mewarisi
  `className` pemanggil (dulu dipaksa emerald-600 sehingga nominal di
  header tabel gelap jadi hijau tua yang kontrasnya buruk).
- Test: `BreakdownSummaryCard.test.tsx` mencari kolom lewat
  `[data-testid="breakdown-column-header"]` (bukan selector kelas warna),
  jadi perubahan warna tidak lagi_break test.
<!-- project-notes:end -->
