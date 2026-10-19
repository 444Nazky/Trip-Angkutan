# Remediasi Supabase Security Advisor

Ditemukan oleh Supabase Security Advisor (sekali jalan di SQL Editor):

1. `RLS Disabled in Public` — 16 tabel:
   - public.admin_credentials
   - public.vehicle_plates
   - public.region_tariffs
   - public.plate_scans
   - public.device_versions
   - public.routes
   - public.regions
   - public.dermagas
   - public.officers
   - public.officer_dermagas
   - public.officer_regions
   - public.tariffs
   - public.trips
   - public.trip_vehicles
   - public.vehicles
   - public.geofences

2. `Sensitive Columns Exposed` — 2 entitas:
   - public.admin_credentials
   - public.regions

## Yang diubah (hanya di repo)

- `backend/migrations/001_initial_schema.sql`
  - Ditulis ulang sehingga berisi:
    - 1× `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`
    - 16× `CREATE TABLE IF NOT EXISTS`
    - 1 blok RLS yang urut: parent tabel dulu, lalu junction, lalu admin_credentials terakhir
    - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` untuk 16 tabel
    - Kebijakan:
      - Public read untuk 9 tabel
      - Authenticated insert/update untuk trips, vehicles, trip_vehicles, device_versions
      - Admin full access untuk 16 tabel
    - 2 fungsi: `generate_trip_no()` dan `get_officer_dermagas(p_officer_id)`

## Tindakan di Supabase (wajib 1x di SQL Editor)

Jalankan di Supabase SQL Editor:

```sql
-- Project: https://bmiruktfruunegtbydyw.supabase.co
-- File: backend/migrations/001_initial_schema.sql
```

Jika tabel sudah ada, `IF NOT EXISTS` akan skip pembuatan ulang, tetapi `ENABLE ROW LEVEL SECURITY` dan `CREATE POLICY` tetap akan dijalankan ulang di tabel yang sudah ada.

Catatan: karena migration memakai `CREATE POLICY` biasa, jika kebijakan dengan nama sama sudah ada di tabel, SQL Editor bisa menolak dengan error duplicate-policy. Jika itu terjadi, sesuaikan dengan `CREATE OR REPLACE POLICY` atau hapus kebijakan lama dulu.

## Bukti di repo

- Jumlah tabel = 16
- Jumlah `ENABLE ROW LEVEL SECURITY` = 16
- Jumlah `CREATE POLICY` = 31
- Jumlah fungsi = 2
