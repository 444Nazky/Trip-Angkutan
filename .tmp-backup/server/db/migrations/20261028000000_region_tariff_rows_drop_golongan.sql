-- Golongan (I..V) identik dengan jenis kendaraan, jadi dihapus dari baris
-- tarif region. Setiap region kini punya barisnya sendiri (termasuk BADAU);
-- region tanpa baris = tarif 0.
--
-- Idempoten: aman dijalankan berulang.

-- 1. Rapikan duplikat (sisa skema golongan) sebelum unique index baru.
DELETE FROM region_tariff_rows a
USING region_tariff_rows b
WHERE a.region_id = b.region_id
  AND lower(btrim(a.vehicle_type)) = lower(btrim(b.vehicle_type))
  AND (a.updated_at, a.id) < (b.updated_at, b.id);

-- 2. Lepas constraint lama yang masih memakai golongan.
ALTER TABLE region_tariff_rows
  DROP CONSTRAINT IF EXISTS region_tariff_rows_region_id_golongan_vehicle_type_key;

-- 3. Buang kolom golongan.
ALTER TABLE region_tariff_rows DROP COLUMN IF EXISTS golongan;

-- 4. Satu baris per region per jenis kendaraan.
CREATE UNIQUE INDEX IF NOT EXISTS region_tariff_rows_region_type_key
  ON region_tariff_rows (region_id, vehicle_type);

-- 5. Seed BADAU dari master tarif lama supaya harga BADAU tidak hilang.
INSERT INTO region_tariff_rows (region_id, vehicle_type, muatan_tariff, kosong_tariff, is_active)
SELECT DISTINCT ON (lower(t.vehicle_type))
  r.id,
  t.vehicle_type,
  t.loaded_tariff,
  t.empty_tariff,
  1
FROM tariffs t
JOIN regions r ON upper(r.code) = 'BADAU'
WHERE t.is_active = 1
ORDER BY lower(t.vehicle_type), t.id
ON CONFLICT (region_id, vehicle_type) DO NOTHING;
