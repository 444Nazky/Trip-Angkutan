-- Revisi master jenis kendaraan (23 Nov 2026).
--
-- Daftar yang dipakai sekarang:
--   Motor, Mobil, LV, Pickup, Truk 7 Ton, Tanki Besar, Trado, Truk Besar
--
-- Jenis lama yang TIDAK lagi dipakai (Truk Kecil, Truk Sedang, Truk Trailer)
-- dinonaktifkan, bukan dihapus: baris tarifnya tetap tersimpan (tidak ada
-- data yang hilang) tetapi tidak lagi muncul di dropdown petugas/admin.
-- Menghapusnya akan ikut menghapus baris tarif (lihat deleteVehicleType),
-- sehingga harga lama hilang tanpa jejak.
--
-- Idempoten: aman dijalankan berulang pada database yang sudah ada.

BEGIN;

-- 1. Nonaktifkan jenis lama.
UPDATE vehicle_types
SET is_active = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE key IN ('trukkecil', 'truksedang', 'truktrailer')
  AND is_active <> 0;

-- 2. Tambahkan jenis baru (atau aktifkan kembali bila sudah ada).
INSERT INTO vehicle_types (name, key, sort_order, is_active)
VALUES
  ('LV',           'lv',         3, 1),
  ('Pickup',       'pickup',     4, 1),
  ('Truk 7 Ton',   'truk7ton',   5, 1),
  ('Tanki Besar',  'tankibesar', 6, 1),
  ('Trado',        'trado',      7, 1)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active = 1,
    updated_at = CURRENT_TIMESTAMP;

-- 3. Urutan final: Motor, Mobil, LV, Pickup, Truk 7 Ton, Tanki Besar,
--    Trado, Truk Besar.
UPDATE vehicle_types SET sort_order = 1, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE key = 'motor';
UPDATE vehicle_types SET sort_order = 2, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE key = 'mobil';
UPDATE vehicle_types SET sort_order = 3, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE key = 'lv';
UPDATE vehicle_types SET sort_order = 4, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE key = 'pickup';
UPDATE vehicle_types SET sort_order = 5, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE key = 'truk7ton';
UPDATE vehicle_types SET sort_order = 6, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE key = 'tankibesar';
UPDATE vehicle_types SET sort_order = 7, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE key = 'trado';
UPDATE vehicle_types SET sort_order = 8, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE key = 'trukbesar';

COMMIT;
