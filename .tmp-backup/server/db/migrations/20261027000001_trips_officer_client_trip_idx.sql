-- Idempotensi POST /trips/complete: server mencari trip lama berdasarkan
-- (officer_id, client_trip_id) lalu membandingkan completed_at. Index
-- gabungan membuat pencarian itu tetap cepat setelah data bertahun-tahun.
--
-- Idempoten: aman dijalankan berulang pada database yang sudah ada.
CREATE INDEX IF NOT EXISTS trips_officer_client_trip_idx
  ON trips (officer_id, client_trip_id);
