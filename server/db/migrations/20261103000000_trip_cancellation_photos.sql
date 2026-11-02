-- Foto draft yang dilampirkan saat petugas membatalkan trip.
--
-- MASALAH yang diperbaiki migrasi ini:
--   Dokumen pembatalan hanya menyimpan `photo_count`. Admin tahu ADA foto,
--   tetapi tidak bisa melihatnya — padahal foto kondisi/kendaraan adalah
--   bukti utama saat pembatalan dipertanyakan.
--
-- PERBAIKAN:
--   Kolom `photos` berisi array JSON `[{ url, label }]` (URL publik berkas di
--   storage `trip-photos`), dikirim dari aplikasi mobile bersama dokumen
--   pembatalan.
--
-- Idempoten: aman dijalankan berulang pada database yang sudah ada.

BEGIN;

ALTER TABLE trip_cancellations
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
