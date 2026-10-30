-- Master jenis kendaraan (satu-satunya daftar yang sah).
--
-- MASALAH yang diperbaiki migrasi ini:
--   Daftar jenis kendaraan sebelumnya hidup di TIGA tempat sekaligus:
--     1. hardcode di dashboard admin  -> 'motor, mobil, truk kecil, ...'
--     2. hardcode di aplikasi petugas -> 'Motor, Mobil, Truck Kecil, ...'
--     3. baris tarif per region (region_tariff_rows) -> tiap region boleh
--        punya ejaan sendiri ("Truk Kecil" vs "truk kecil")
--   Akibatnya pilihan jenis kendaraan di admin dan di HP tidak sinkron, dan
--   satu jenis bisa muncul sebagai dua baris berbeda di satu region.
--
-- PERBAIKAN:
--   Tabel `vehicle_types` jadi sumber tunggal. Daftar TIDAK diketik manual
--   di sini: jenis kendaraan yang sudah dipakai (di master tarif, di baris
--   tarif region, atau di riwayat kendaraan) yang menjadi daftar ini. Jadi
--   migrasi ini tidak pernah memasukkan data palsu.
--
-- Aturan ejaan kanonik (satu jenis = satu string):
--   - "Truck Besar", "TruckBesar", "truk besar" -> kunci "trukbesar"
--   - ejaan yang dipakai: prioritas master `tariffs` > baris tarif region >
--     riwayat kendaraan; di dalam satu prioritas, ejaan Indonesia ("Truk ...")
--     menang atas ejaan Inggris ("Truck ..."), lalu huruf kapital ("Truk
--     Besar") menang atas huruf kecil ("truk besar").
--
-- Idempoten: aman dijalankan berulang pada database yang sudah ada.

BEGIN;

-- 1. Tabel master jenis kendaraan.
CREATE TABLE IF NOT EXISTS vehicle_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  is_active integer NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tentukan ejaan kanonik per jenis DARI SELURUH SPELLING yang ada.
--    Dilakukan SEBELUM duplikat dihapus, supaya ejaan terbaik tetap dipakai
--    walau baris dengan ejaan itu kebetulan yang dihapus (mis. "Truk Kecil"
--    lebih rapi daripada "truk kecil").
CREATE TEMP TABLE vt_canonical ON COMMIT DROP AS
WITH cand AS (
  SELECT
    btrim(vehicle_type) AS name,
    regexp_replace(replace(lower(btrim(coalesce(vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g') AS key,
    1 AS prio
  FROM tariffs
  WHERE btrim(coalesce(vehicle_type, '')) <> ''
  UNION ALL
  SELECT
    btrim(vehicle_type),
    regexp_replace(replace(lower(btrim(coalesce(vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g'),
    2
  FROM region_tariff_rows
  WHERE btrim(coalesce(vehicle_type, '')) <> ''
),
best AS (
  SELECT DISTINCT ON (key)
    key,
    -- Ejaan Inggris "Truck ..." dipakai ke bahasa Indonesia "Truk ...".
    regexp_replace(name, '\m(truck)\M', 'Truk', 'gi') AS name_id
  FROM cand
  ORDER BY
    key,
    prio,
    -- ejaan Indonesia menang atas ejaan Inggris
    (name ILIKE '%truck%') ASC,
    -- huruf kapital menang atas huruf kecil
    (name = lower(name)) ASC,
    name ASC
)
SELECT key, name_id AS name FROM best;

-- 3. Buang duplikat master tarif per jenis (ejaan berbeda = jenis yang sama).
--    Yang dipertahankan = baris paling baru (ketentuan admin terakhir).
DELETE FROM tariffs a
USING tariffs b
WHERE a.id <> b.id
  AND regexp_replace(replace(lower(btrim(coalesce(a.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g')
    = regexp_replace(replace(lower(btrim(coalesce(b.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g')
  AND (a.created_at, a.id) < (b.created_at, b.id);

-- 4. Buang duplikat baris tarif region per (region, jenis). Baris yang
--    dipertahankan = yang paling baru diperbarui. Baris lain DIHAPUS, bukan
--    dijumlahkan, supaya harga tidak pernah fiktif.
DELETE FROM region_tariff_rows a
USING region_tariff_rows b
WHERE a.region_id = b.region_id
  AND a.id <> b.id
  AND regexp_replace(replace(lower(btrim(coalesce(a.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g')
    = regexp_replace(replace(lower(btrim(coalesce(b.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g')
  AND (a.updated_at, a.id) < (b.updated_at, b.id);

-- 5. Isi tabel master dari data yang sudah ada (tidak ada daftar hardcode).
--    `sort_order` mengikuti urutan master tarif yang sudah ada, supaya urutan
--    di dashboard tetap sama seperti sebelumnya.
INSERT INTO vehicle_types (name, key, sort_order, is_active)
SELECT
  c.name,
  c.key,
  COALESCE(
    (SELECT rn.rn
       FROM (SELECT row_number() OVER (ORDER BY t.created_at, t.vehicle_type, t.id) AS rn,
                    regexp_replace(replace(lower(btrim(coalesce(t.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g') AS key
               FROM tariffs t
              WHERE btrim(coalesce(t.vehicle_type, '')) <> '') rn
      WHERE rn.key = c.key),
    999
  ),
  1
FROM vt_canonical c
ON CONFLICT (key) DO NOTHING;

-- 6. Jenis yang hanya muncul di riwayat kendaraan (lama) tetap dicatat,
--    tapi NONAKTIF: tidak boleh muncul sebagai pilihan baru di HP.
INSERT INTO vehicle_types (name, key, sort_order, is_active)
SELECT
  v.name,
  v.key,
  999,
  0
FROM (
  SELECT DISTINCT
    btrim(vehicle_type) AS name,
    regexp_replace(replace(lower(btrim(coalesce(vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g') AS key
  FROM vehicles
  WHERE btrim(coalesce(vehicle_type, '')) <> ''
) v
WHERE NOT EXISTS (SELECT 1 FROM vehicle_types vt WHERE vt.key = v.key)
ON CONFLICT (key) DO NOTHING;

-- 7. Samakan ejaan semua baris tarif ke ejaan kanonik. Setelah langkah 3-4
--    tidak ada lagi duplikat per (region, jenis), jadi unique index aman.
UPDATE tariffs t
   SET vehicle_type = vt.name
  FROM vehicle_types vt
 WHERE regexp_replace(replace(lower(btrim(coalesce(t.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g') = vt.key
   AND btrim(coalesce(t.vehicle_type, '')) <> vt.name;

UPDATE region_tariff_rows r
   SET vehicle_type = vt.name
  FROM vehicle_types vt
 WHERE regexp_replace(replace(lower(btrim(coalesce(r.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g') = vt.key
   AND btrim(coalesce(r.vehicle_type, '')) <> vt.name;

-- 8. Jaga unique index satu baris per (region, jenis).
CREATE UNIQUE INDEX IF NOT EXISTS region_tariff_rows_region_type_key
  ON region_tariff_rows (region_id, vehicle_type);

CREATE INDEX IF NOT EXISTS vehicle_types_active_idx
  ON vehicle_types (is_active, sort_order);

COMMIT;
