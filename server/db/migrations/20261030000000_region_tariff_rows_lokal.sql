-- Tarif lokal per jenis kendaraan (bukan satu nilai datar per region).
-- Nilai 0 = belum diisi -> resolver memakai tarif flat region_tariffs.
ALTER TABLE region_tariff_rows
  ADD COLUMN IF NOT EXISTS lokal_tariff integer NOT NULL DEFAULT 0;

-- Salin nilai flat yang sudah ada supaya wilayah yang sudah berjalan tidak
-- berubah harganya sampai admin mengedit per jenis.
UPDATE region_tariff_rows r
SET lokal_tariff = t.nominal_tariff
FROM region_tariffs t
WHERE t.region_id = r.region_id
  AND t.tariff_type = 'lokal'
  AND t.is_active = 1
  AND r.lokal_tariff = 0;
