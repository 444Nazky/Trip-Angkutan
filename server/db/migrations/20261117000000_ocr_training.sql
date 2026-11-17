-- Data latih OCR plat nomor dari dashboard admin (/ocr).
--
-- Setiap foto yang diunggah admin disimpan sebagai satu baris + berkas gambar
-- di `data/storage/ocr-samples`. Model hasil pelatihan disimpan sebagai berkas
-- JSON (`data/storage/ocr/plate-model.json`) dan versinya dicatat di sini.
--
-- Tabel ini TIDAK diisi data contoh: kosong sampai admin benar-benar
-- mengunggah foto. Idempoten.

BEGIN;

CREATE TABLE IF NOT EXISTS ocr_samples (
  id uuid PRIMARY KEY,
  -- Nama berkas di bucket `ocr-samples` (bukan path absolut).
  image_path text NOT NULL,
  -- Bacaan model sebelum dikoreksi (boleh kosong kalau admin tidak mengisi).
  predicted text NOT NULL DEFAULT '',
  -- Label ground truth: plat yang benar menurut admin.
  corrected text NOT NULL,
  -- 'admin' atau nama petugas yang mengunggah.
  source text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ocr_samples_corrected_not_blank CHECK (btrim(corrected) <> '')
);

CREATE INDEX IF NOT EXISTS ocr_samples_created_idx
  ON ocr_samples (created_at DESC);

CREATE TABLE IF NOT EXISTS ocr_models (
  version integer PRIMARY KEY,
  samples integer NOT NULL,
  plates integer NOT NULL,
  -- Persentase sampel yang sudah benar sebelum koreksi model (indikator kasar).
  accuracy numeric(5, 2),
  model_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
