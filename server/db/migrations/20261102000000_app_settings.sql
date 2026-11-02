-- Pengaturan aplikasi (key-value) yang bisa diubah dari dashboard admin.
--
-- Yang pertama dibuat: batas waktu draft trip di aplikasi mobile.
-- Nilai ini tadinya ditulis langsung di kode (15 menit). Admin sekarang bisa
-- mengubahnya (mis. 10 menit) tanpa perlu build baru.
--
-- Idempoten: aman dijalankan berulang pada database yang sudah ada.

BEGIN;

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Nilai bawaan: batas draft 15 menit (sama dengan nilai lama di kode).
INSERT INTO app_settings (key, value)
VALUES ('draft_ttl_minutes', '15')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- Minta PostgREST memuat ulang daftar tabel. Tanpa ini, tabel `app_settings`
-- (baru dibuat di atas) tidak dikenal PostgREST sampai container-nya
-- restart -> INSERT/UPDATE membalas 404 meski tabelnya sudah ada.
-- NOTIFY dikirim saat COMMIT, jadi placement-nya setelah COMMIT sudah aman.
NOTIFY pgrst, 'reload schema';
