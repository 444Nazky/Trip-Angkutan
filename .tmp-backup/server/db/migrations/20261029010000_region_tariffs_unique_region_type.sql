-- Upsert tarif flat (lokal/eksternal) memakai ON CONFLICT (region_id, tariff_type).
-- Tanpa unique constraint, PostgREST menolak upsert -> edit "lokal" gagal 500.
DELETE FROM region_tariffs a
USING region_tariffs b
WHERE a.ctid < b.ctid
  AND a.region_id = b.region_id
  AND a.tariff_type = b.tariff_type;

ALTER TABLE region_tariffs
  ADD CONSTRAINT region_tariffs_region_type_key UNIQUE (region_id, tariff_type);
