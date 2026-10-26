-- Kolom operasional yang dipakai Edge Function `api` (lihat tariffRules.ts).
-- Sebelumnya ditambahkan manual lewat SQL Editor sehingga tidak tercatat di
-- riwayat migrasi. Idempoten: aman dijalankan pada DB yang sudah punya kolom.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS kategori text,
  ADD COLUMN IF NOT EXISTS tarif_source text;

COMMENT ON COLUMN public.vehicles.kategori IS 'Kategori operasional: Internal | Eksternal | Lokal';

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS selfie_path text,
  ADD COLUMN IF NOT EXISTS selfie_captured_at timestamptz;

COMMENT ON COLUMN public.trips.selfie_path IS 'URL foto swafoto petugas (kamera depan)';
