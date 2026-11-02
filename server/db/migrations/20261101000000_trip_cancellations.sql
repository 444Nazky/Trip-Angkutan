-- Dokumen pembatalan trip.
--
-- MASALAH yang diperbaiki migrasi ini:
--   Petugas sebelumnya bisa "menghapus" trip (draf) tanpa jejak: tidak ada
--   alasan, tidak ada dokumen, tidak ada yang bisa ditindaklanjuti admin.
--   Trip yang batal karena pelanggan membatalkan / kendaraan tidak ditemukan
--   hilang begitu saja dari perangkat.
--
-- PERBAIKAN:
--   Tabel `trip_cancellations` menyimpan DOKUMEN pembatalan: alasan (wajib),
--   keterangan tambahan, dan rincian trip yang dibatalkan (rute, kendaraan,
--   jumlah foto, jam mulai/batal). Dokumen ini dikirim dari aplikasi mobile
--   lewat `POST /api/trips/cancel` dan dibaca admin lewat
--   `GET /api/trips/cancellations`.
--
-- Idempoten: aman dijalankan berulang pada database yang sudah ada.

BEGIN;

CREATE TABLE IF NOT EXISTS trip_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nomor dokumen pembatalan (ditampilkan ke admin).
  no_cancel text NOT NULL UNIQUE,
  -- Kunci idempoten dari perangkat (UUID): retry tidak boleh membuat
  -- dokumen ganda.
  client_cancel_id text,
  officer_id uuid REFERENCES officers(id),
  region_id uuid REFERENCES regions(id),
  dermaga_id uuid REFERENCES dermagas(id),
  -- Alasan pembatalan (wajib diisi petugas).
  reason text NOT NULL,
  -- Keterangan tambahan dari petugas (opsional).
  note text,
  route_from text,
  route_to text,
  route_code text,
  -- Status muatan trip yang dibatalkan: muatan | kosong.
  condition text,
  vehicle_count integer NOT NULL DEFAULT 0,
  -- Rincian kendaraan yang dibatalkan (jsonb).
  vehicles jsonb NOT NULL DEFAULT '[]'::jsonb,
  photo_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  cancelled_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempoten: satu dokumen per (petugas, client_cancel_id).
CREATE UNIQUE INDEX IF NOT EXISTS trip_cancellations_client_idx
  ON trip_cancellations (officer_id, client_cancel_id)
  WHERE client_cancel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trip_cancellations_officer_idx
  ON trip_cancellations (officer_id, cancelled_at DESC);

CREATE INDEX IF NOT EXISTS trip_cancellations_cancelled_idx
  ON trip_cancellations (cancelled_at DESC);

COMMIT;
