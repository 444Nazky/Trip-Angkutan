-- Setiap region punya tarif SENDIRI. Salin sekali nilai master BADAU ke baris
-- milik tiap region supaya admin bisa mengubahnya terpisah (mis. motor BADAU
-- 50.000, BELITUNG 45.000) tanpa ikut mengubah region lain.
-- Idempoten: baris yang sudah ada tidak disentuh.
INSERT INTO region_tariff_rows (region_id, golongan, vehicle_type, muatan_tariff, kosong_tariff, is_active)
SELECT r.id, coalesce(t.golongan, ''), t.vehicle_type, coalesce(t.loaded_tariff, 0), coalesce(t.empty_tariff, 0), 1
FROM regions r
CROSS JOIN tariffs t
WHERE upper(coalesce(r.code, '')) <> 'BADAU'
  AND t.vehicle_type IS NOT NULL
  AND coalesce(t.is_active, 1) = 1
ON CONFLICT (region_id, golongan, vehicle_type) DO NOTHING;
