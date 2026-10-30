-- Upsert tarif flat (lokal/eksternal) memakai ON CONFLICT (region_id, tariff_type).
-- Tanpa unique constraint, PostgREST menolak upsert -> edit "lokal" gagal 500.
DELETE FROM region_tariffs a
USING region_tariffs b
WHERE a.ctid < b.ctid
  AND a.region_id = b.region_id
  AND a.tariff_type = b.tariff_type;

-- PENTING - kenapa dibungkus DO block:
-- Postgres tidak punya "ADD CONSTRAINT IF NOT EXISTS". Pada database yang sudah
-- hidup, file ini diulang tiap restart -> constraint sudah ada -> error
-- "constraint already exists" -> deploy selalu melaporkan migrasi ini gagal
-- padahal constraint-nya sudah benar. Cek dulu di pg_constraint; kalau sudah
-- ada, lewati saja.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'region_tariffs_region_type_key'
  ) THEN
    ALTER TABLE region_tariffs
      ADD CONSTRAINT region_tariffs_region_type_key UNIQUE (region_id, tariff_type);
  END IF;
END $$;
