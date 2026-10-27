-- Skema database lokal (PostgreSQL) untuk API Trip Angkutan.
--
-- Sumber: deskripsi OpenAPI Supabase yang sedang berjalan. Struktur tabel,
-- tipe kolom, nilai default, primary key, dan foreign key disalin apa adanya.
-- Nama constraint FK mengikuti konvensi PostgreSQL karena dipakai sebagai
-- petunjuk relasi oleh PostgREST (mis. regions!officers_region_id_fkey).
--
-- Yang tidak ikut tersalin (tidak terekspos lewat OpenAPI): check constraint,
-- trigger, RLS, dan policy. Tidak ada RLS karena database hanya diakses API
-- di jaringan lokal.

BEGIN;

CREATE TABLE IF NOT EXISTS regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  code text,
  password text,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dermagas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id uuid CONSTRAINT dermagas_region_id_fkey REFERENCES regions(id) ON DELETE SET NULL,
  name text,
  code text,
  username text,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dermaga_id uuid CONSTRAINT routes_dermaga_id_fkey REFERENCES dermagas(id) ON DELETE CASCADE,
  name text,
  route_from text,
  route_to text,
  distance text,
  duration text,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS officers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  username text,
  pin text,
  region_id uuid CONSTRAINT officers_region_id_fkey REFERENCES regions(id) ON DELETE SET NULL,
  is_active integer DEFAULT 1,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS officer_regions (
  officer_id uuid NOT NULL CONSTRAINT officer_regions_officer_id_fkey REFERENCES officers(id) ON DELETE CASCADE,
  region_id uuid NOT NULL CONSTRAINT officer_regions_region_id_fkey REFERENCES regions(id) ON DELETE CASCADE,
  PRIMARY KEY (officer_id, region_id)
);

CREATE TABLE IF NOT EXISTS officer_dermagas (
  officer_id uuid NOT NULL CONSTRAINT officer_dermagas_officer_id_fkey REFERENCES officers(id) ON DELETE CASCADE,
  dermaga_id uuid NOT NULL CONSTRAINT officer_dermagas_dermaga_id_fkey REFERENCES dermagas(id) ON DELETE CASCADE,
  PRIMARY KEY (officer_id, dermaga_id)
);

CREATE TABLE IF NOT EXISTS tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  golongan text,
  vehicle_type text,
  loaded_tariff integer DEFAULT 0,
  empty_tariff integer DEFAULT 0,
  description text DEFAULT '',
  is_active integer DEFAULT 1,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS region_tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id uuid CONSTRAINT region_tariffs_region_id_fkey REFERENCES regions(id) ON DELETE CASCADE,
  tariff_type text,
  nominal_tariff integer DEFAULT 0,
  is_active integer DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  no_trip text UNIQUE,
  officer_id uuid CONSTRAINT trips_officer_id_fkey REFERENCES officers(id) ON DELETE SET NULL,
  region_id uuid CONSTRAINT trips_region_id_fkey REFERENCES regions(id) ON DELETE SET NULL,
  dermaga_id uuid CONSTRAINT trips_dermaga_id_fkey REFERENCES dermagas(id) ON DELETE SET NULL,
  route_id uuid CONSTRAINT trips_route_id_fkey REFERENCES routes(id) ON DELETE SET NULL,
  status_muatan text,
  route_from text,
  route_to text,
  keterangan text,
  foto_kosong_path text,
  foto_captured_at text,
  foto_latitude real,
  foto_longitude real,
  started_at text,
  completed_at text,
  client_trip_id text,
  is_synced integer DEFAULT 1,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  selfie_path text,
  selfie_captured_at timestamptz
);

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  no_polisi text,
  vehicle_type text,
  golongan text,
  trip_id uuid CONSTRAINT vehicles_trip_id_fkey REFERENCES trips(id) ON DELETE CASCADE,
  has_load integer DEFAULT 0,
  tariff_id uuid CONSTRAINT vehicles_tariff_id_fkey REFERENCES tariffs(id) ON DELETE SET NULL,
  tariff_amount integer DEFAULT 0,
  foto_path text,
  foto_captured_at text,
  latitude real,
  longitude real,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  kategori text,
  tarif_source text
);

CREATE TABLE IF NOT EXISTS trip_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid CONSTRAINT trip_vehicles_trip_id_fkey REFERENCES trips(id) ON DELETE CASCADE,
  vehicle_id uuid CONSTRAINT trip_vehicles_vehicle_id_fkey REFERENCES vehicles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicle_plates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate text,
  owner text DEFAULT '',
  origin_region_id uuid CONSTRAINT vehicle_plates_origin_region_id_fkey REFERENCES regions(id) ON DELETE SET NULL,
  status text DEFAULT 'internal',
  is_active integer DEFAULT 1,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plate_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate text,
  status text,
  origin_region_id uuid CONSTRAINT plate_scans_origin_region_id_fkey REFERENCES regions(id) ON DELETE SET NULL,
  checkpoint_region_id uuid CONSTRAINT plate_scans_checkpoint_region_id_fkey REFERENCES regions(id) ON DELETE SET NULL,
  tariff_amount integer DEFAULT 0,
  officer_id uuid CONSTRAINT plate_scans_officer_id_fkey REFERENCES officers(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS geofences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  location_name text,
  dermaga_id uuid CONSTRAINT geofences_dermaga_id_fkey REFERENCES dermagas(id) ON DELETE CASCADE,
  latitude real,
  longitude real,
  radius_meters integer DEFAULT 100,
  allowed_route_codes text DEFAULT '',
  allowed_directions text DEFAULT '',
  description text DEFAULT '',
  enabled integer DEFAULT 1,
  strict_enforce_outside integer DEFAULT 1,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_credentials (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  username text,
  password text
);

CREATE TABLE IF NOT EXISTS app_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text UNIQUE,
  download_url text,
  release_date timestamptz DEFAULT now(),
  release_notes text,
  is_force_update boolean DEFAULT false,
  min_version text,
  apk_size bigint,
  apk_hash text,
  apk_version_name text,
  apk_version_code integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ota_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text,
  manifest jsonb,
  published_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_versions (
  device_id text PRIMARY KEY,
  version text,
  platform text,
  report_count integer DEFAULT 1,
  first_seen timestamptz DEFAULT CURRENT_TIMESTAMP,
  last_seen timestamptz DEFAULT CURRENT_TIMESTAMP
);

-- Index untuk lookup yang dipanggil API (bukan bagian dari OpenAPI).
CREATE INDEX IF NOT EXISTS trips_client_trip_id_idx ON trips (client_trip_id);
-- Lookup retry: client_trip_id selalu dibatasi per petugas (lihat trips.ts).
CREATE INDEX IF NOT EXISTS trips_officer_client_trip_idx ON trips (officer_id, client_trip_id);
CREATE INDEX IF NOT EXISTS trips_officer_created_idx ON trips (officer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trips_created_at_idx ON trips (created_at DESC);
CREATE INDEX IF NOT EXISTS vehicles_trip_id_idx ON vehicles (trip_id);
CREATE INDEX IF NOT EXISTS vehicles_created_at_idx ON vehicles (created_at DESC);
CREATE INDEX IF NOT EXISTS trip_vehicles_trip_id_idx ON trip_vehicles (trip_id);
CREATE INDEX IF NOT EXISTS trip_vehicles_vehicle_id_idx ON trip_vehicles (vehicle_id);
CREATE INDEX IF NOT EXISTS plate_scans_created_at_idx ON plate_scans (created_at DESC);
CREATE INDEX IF NOT EXISTS routes_dermaga_id_idx ON routes (dermaga_id);
CREATE INDEX IF NOT EXISTS dermagas_region_id_idx ON dermagas (region_id);
CREATE INDEX IF NOT EXISTS geofences_dermaga_id_idx ON geofences (dermaga_id);
CREATE INDEX IF NOT EXISTS ota_bundles_published_at_idx ON ota_bundles (published_at DESC);
CREATE INDEX IF NOT EXISTS officer_regions_region_id_idx ON officer_regions (region_id);
CREATE INDEX IF NOT EXISTS officer_dermagas_dermaga_id_idx ON officer_dermagas (dermaga_id);
CREATE INDEX IF NOT EXISTS plate_scans_plate_idx ON plate_scans (plate);
CREATE INDEX IF NOT EXISTS app_versions_version_idx ON app_versions (version);

COMMIT;
