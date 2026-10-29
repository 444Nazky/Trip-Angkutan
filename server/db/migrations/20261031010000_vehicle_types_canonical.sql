-- Kanonisasi nama & urutan master jenis kendaraan.
--
-- MASALAH yang diperbaiki migrasi ini:
--   Migrasi 20261031000000 (yang mengisi tabel `vehicle_types`) menyimpan nama
--   persis seperti tertulis di data lama: sebagian huruf kecil
--   ("truk kecil", "truk besar"), dan `sort_order` untuk jenis yang tidak
--   ada di master tarif berakhir 999. Akibatnya:
--     - dashboard admin dan aplikasi petugas menampilkan "truk kecil" /
--       "truk trailer" (beda gaya dengan "Motor"/"Mobil"),
--     - urutan jenis di dropdown tidak lagi master ->小了 -> acak.
--
-- PERBAIKAN:
--   1. Nama dinormalisasi jadi satu gaya: huruf pertama tiap kata kapital,
--      dan ejaan Inggris "Truck ..." -> "Truk ...". Tidak ada daftar nama
--      yang diketik manual: nama dihitung dari nama yang sudah ada.
--   2. `sort_order` dihitung ulang dari urutan kemunculan jenis di data
--      (master tarif, lalu baris tarif region) - jenis yang paling lama
--      dipakai urutannya paling atas.
--   3. Ejaan yang sama ikut diterapkan ke `tariffs.vehicle_type` dan
--      `region_tariff_rows.vehicle_type`, jadi admin, aplikasi petugas, dan
--      baris tarif memakai SATU string untuk satu jenis.
--
-- Idempoten: aman dijalankan berulang pada database yang sudah ada.

BEGIN;

-- 1. Buang duplikat baris tarif region per (region, jenis) - ejaan berbeda
--    = jenis yang sama. Yang dipertahankan = baris paling baru.
DELETE FROM region_tariff_rows a
USING region_tariff_rows b
WHERE a.region_id = b.region_id
  AND a.id <> b.id
  AND regexp_replace(replace(lower(btrim(coalesce(a.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g')
    = regexp_replace(replace(lower(btrim(coalesce(b.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g')
  AND (a.updated_at, a.id) < (b.updated_at, b.id);

-- 2. Tentukan nama kanonik + urutan untuk tiap jenis.
CREATE TEMP TABLE vt_canon ON COMMIT DROP AS
WITH src AS (
  SELECT
    btrim(vehicle_type) AS name,
    regexp_replace(replace(lower(btrim(coalesce(vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g') AS key,
    1 AS prio,
    -- Lapis 1 = jenis yang punya baris di master tarif. Jenis ini urutannya
    -- mengikuti urutan master (urutan pemakaian), jadi "Truk Trailer" yang
    -- hanya muncul di baris tarif region berakhir di akhir daftar.
    1 AS tier,
    created_at AS seq
  FROM tariffs
  WHERE btrim(coalesce(vehicle_type, '')) <> ''
  UNION ALL
  SELECT
    btrim(vehicle_type),
    regexp_replace(replace(lower(btrim(coalesce(vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g'),
    2,
    2,
    updated_at
  FROM region_tariff_rows
  WHERE btrim(coalesce(vehicle_type, '')) <> ''
  UNION ALL
  SELECT
    btrim(name),
    regexp_replace(replace(lower(btrim(coalesce(name, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g'),
    3,
    3,
    created_at
  FROM vehicle_types
  WHERE btrim(coalesce(name, '')) <> ''
),
best AS (
  SELECT DISTINCT ON (key)
    key,
    -- "truck ..." -> "truk ..." (bahasa Indonesia), lalu huruf kapital di awal
    -- tiap kata.-initcap menurunkan huruf besar di tengah kata, jadi ejaan
    -- dicapitalkan dari bentuk yang sudah dibersihkan.
    initcap(regexp_replace(btrim(name), '\ytruck\y', 'truk', 'gi')) AS name
  FROM src
  ORDER BY
    key,
    prio,
    (name = lower(name)) ASC,
    name ASC
),
seq AS (
  SELECT
    s.key,
    b.name,
    row_number() OVER (
      ORDER BY min(s.tier), min(s.seq), b.name
    ) AS rn
  FROM src s
  JOIN best b ON b.key = s.key
  GROUP BY s.key, b.name
)
SELECT key, name, rn::integer AS sort_order FROM seq;

-- 3. Tulis nama kanonik + urutan ke master.
UPDATE vehicle_types vt
SET name = c.name,
    sort_order = c.sort_order,
    updated_at = CURRENT_TIMESTAMP
FROM vt_canon c
WHERE vt.key = c.key
  AND (vt.name IS DISTINCT FROM c.name OR vt.sort_order IS DISTINCT FROM c.sort_order);

-- 4. Samakan ejaan di master tarif.
UPDATE tariffs t
SET vehicle_type = c.name
FROM vt_canon c
WHERE regexp_replace(replace(lower(btrim(coalesce(t.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g') = c.key
  AND t.vehicle_type IS DISTINCT FROM c.name;

-- 5. Samakan ejaan di baris tarif region.
UPDATE region_tariff_rows r
SET vehicle_type = c.name,
    updated_at = CURRENT_TIMESTAMP
FROM vt_canon c
WHERE regexp_replace(replace(lower(btrim(coalesce(r.vehicle_type, ''))), 'truck', 'truk'), '[^a-z0-9]', '', 'g') = c.key
  AND r.vehicle_type IS DISTINCT FROM c.name;

COMMIT;
