-- Peran titik geofence.
--
--   start = titik awal (petugas berada di sini saat input kendaraan)
--   end   = titik tujuan (petugas berada di sini saat submit / end trip)
--   both  = berlaku untuk keduanya
--
-- Titik yang sudah ada otomatis 'both' agar perilaku lama tidak berubah.
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS point_type text NOT NULL DEFAULT 'both';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'geofences_point_type_check'
  ) THEN
    ALTER TABLE geofences
      ADD CONSTRAINT geofences_point_type_check
      CHECK (point_type IN ('start', 'end', 'both'));
  END IF;
END $$;
