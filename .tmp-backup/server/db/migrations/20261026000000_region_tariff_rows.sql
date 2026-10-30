-- Baris tarif per region per golongan/jenis kendaraan (override master BADAU).
--
-- Desain: OVERRIDE saja, tanpa seed. Region tanpa baris otomatis memakai
-- master tarif (tabel `tariffs`) lewat resolver tarifRules.resolveTariff,
-- sehingga region baru otomatis "sama dengan BADAU" tanpa menyalin baris.
-- Baris ini dibuat/diubah saat admin mengedit sel di tabel REGION.
--
-- Kolom muatan_tariff/kosong_tariff mengikuti master (loaded/empty).
-- Idempoten: aman dijalankan berulang pada database yang sudah ada.

CREATE TABLE IF NOT EXISTS region_tariff_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  golongan text NOT NULL DEFAULT '',
  vehicle_type text NOT NULL,
  muatan_tariff integer NOT NULL DEFAULT 0 CHECK (muatan_tariff >= 0),
  kosong_tariff integer NOT NULL DEFAULT 0 CHECK (kosong_tariff >= 0),
  is_active integer NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (region_id, golongan, vehicle_type)
);

CREATE INDEX IF NOT EXISTS idx_region_tariff_rows_region ON region_tariff_rows(region_id);
