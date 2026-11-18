-- Foto bukti muatan: jepretan kedua setelah swafoto petugas.
-- Terpisah dari foto_kosong_path (foto dokumentasi trip) dan selfie_path.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS proof_path text;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS proof_captured_at text;

COMMENT ON COLUMN trips.proof_path IS 'Path foto bukti muatan yang diwajibkan sebelum trip dikirim';
COMMENT ON COLUMN trips.proof_captured_at IS 'Waktu jepret foto bukti muatan (ISO string dari perangkat)';
