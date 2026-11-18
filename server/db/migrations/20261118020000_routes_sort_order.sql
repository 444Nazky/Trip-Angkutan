-- Urutan rute yang bisa disusun admin lewat drag-and-drop di dashboard.
-- Urutan disimpan per dermaga: rute dalam satu dermaga punya sort_order 1..n.
--
-- Migrasi ini idempoten dan aman dijalankan ulang setiap restart:
--   - rute lama yang sort_order-nya masih 0 diberi urutan berdasarkan nama,
--   - rute yang sudah punya sort_order (hasil susunan admin) TIDAK diubah.

DO $$
BEGIN
  IF to_regclass('public.routes') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE routes ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

  WITH numbered AS (
    SELECT id, dermaga_id,
           ROW_NUMBER() OVER (PARTITION BY dermaga_id ORDER BY name, id) AS rn
    FROM routes
    WHERE sort_order = 0
  ),
  base AS (
    SELECT dermaga_id, COALESCE(MAX(sort_order), 0) AS max_order
    FROM routes
    GROUP BY dermaga_id
  )
  UPDATE routes r
  SET sort_order = base.max_order + numbered.rn
  FROM numbered
  JOIN base ON base.dermaga_id IS NOT DISTINCT FROM numbered.dermaga_id
  WHERE r.id = numbered.id;

  CREATE INDEX IF NOT EXISTS routes_dermaga_sort_idx
    ON routes (dermaga_id, sort_order);
END $$;
