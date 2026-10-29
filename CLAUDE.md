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
<!-- project-notes:end -->
