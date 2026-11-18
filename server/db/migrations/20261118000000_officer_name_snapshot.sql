-- Simpan nama petugas di dalam baris trip/pembatalan.
--
-- Petugas sekarang boleh dihapus walaupun sudah pernah mengirim trip.
-- Relasi trips.officer_id memakai ON DELETE SET NULL, jadi setelah petugas
-- hilang nama di laporan ikut kosong. Kolom snapshot ini menyimpan nama
-- terakhir sebelum penghapusan, dan laporan memakai snapshot itu sebagai
-- fallback. Data trip sendiri tidak pernah ikut terhapus.

ALTER TABLE trips ADD COLUMN IF NOT EXISTS officer_name text;
ALTER TABLE trip_cancellations ADD COLUMN IF NOT EXISTS officer_name text;

-- Isi snapshot untuk trip lama yang petugasnya masih ada.
UPDATE trips t
SET officer_name = o.name
FROM officers o
WHERE t.officer_id = o.id
  AND (t.officer_name IS NULL OR btrim(t.officer_name) = '');

UPDATE trip_cancellations c
SET officer_name = o.name
FROM officers o
WHERE c.officer_id = o.id
  AND (c.officer_name IS NULL OR btrim(c.officer_name) = '');
