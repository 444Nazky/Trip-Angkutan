-- ============================================
-- SUPABASE MIGRATION: Trip Angkutan
-- Project: https://bmiruktfruunegtbydyw.supabase.co
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CORE TABLES
-- ============================================

-- Regions (Wilayah)
CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  password TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Dermagas (Ports/Ferry Terminals)
CREATE TABLE IF NOT EXISTS dermagas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  region_id UUID NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  username TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region_id, code)
);

-- Routes (Rute)
CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dermaga_id UUID NOT NULL REFERENCES dermagas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  route_from TEXT NOT NULL,
  route_to TEXT NOT NULL,
  distance TEXT,
  duration TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Officers (Petugas)
CREATE TABLE IF NOT EXISTS officers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  username TEXT,
  pin TEXT NOT NULL,
  region_id UUID NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Officer-Dermaga Assignment
CREATE TABLE IF NOT EXISTS officer_dermagas (
  officer_id UUID NOT NULL REFERENCES officers(id) ON DELETE CASCADE,
  dermaga_id UUID NOT NULL REFERENCES dermagas(id) ON DELETE CASCADE,
  PRIMARY KEY (officer_id, dermaga_id)
);

-- Officer-Region Assignment
CREATE TABLE IF NOT EXISTS officer_regions (
  officer_id UUID NOT NULL REFERENCES officers(id) ON DELETE CASCADE,
  region_id UUID NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  PRIMARY KEY (officer_id, region_id)
);

-- Tariffs (Tarif)
CREATE TABLE IF NOT EXISTS tariffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  golongan TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  loaded_tariff INTEGER DEFAULT 0,
  empty_tariff INTEGER DEFAULT 0,
  description TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(golongan, vehicle_type)
);

-- Trips (Perjalanan)
-- ponytail: dibuat SEBELUM vehicles — vehicles punya FK ke trips(id), dulu urutannya
-- dibalik sehingga SQL editor menolak seluruh file ("relation trips does not exist").
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  no_trip TEXT NOT NULL UNIQUE,
  officer_id UUID NOT NULL REFERENCES officers(id),
  region_id UUID NOT NULL REFERENCES regions(id),
  dermaga_id UUID REFERENCES dermagas(id),
  route_id UUID REFERENCES routes(id),
  status_muatan TEXT NOT NULL,
  route_from TEXT,
  route_to TEXT,
  keterangan TEXT,
  foto_kosong_path TEXT,
  foto_captured_at TEXT,
  foto_latitude REAL,
  foto_longitude REAL,
  started_at TEXT,
  completed_at TEXT,
  client_trip_id TEXT,
  is_synced INTEGER DEFAULT 1 CHECK (is_synced IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Vehicles (Kendaraan)
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  no_polisi TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  golongan TEXT NOT NULL,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  has_load INTEGER DEFAULT 0 CHECK (has_load IN (0, 1)),
  tariff_id UUID REFERENCES tariffs(id),
  tariff_amount INTEGER DEFAULT 0,
  foto_path TEXT,
  foto_captured_at TEXT,
  latitude REAL,
  longitude REAL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Trip-Vehicles Junction
CREATE TABLE IF NOT EXISTS trip_vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(trip_id, vehicle_id)
);

-- Geofences
CREATE TABLE IF NOT EXISTS geofences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  location_name TEXT,
  dermaga_id UUID REFERENCES dermagas(id),
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius_meters INTEGER DEFAULT 100,
  allowed_route_codes TEXT DEFAULT '',
  allowed_directions TEXT DEFAULT '',
  description TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1 CHECK (enabled IN (0, 1)),
  strict_enforce_outside INTEGER DEFAULT 1 CHECK (strict_enforce_outside IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Vehicle Plates (Plat Kendaraan)
CREATE TABLE IF NOT EXISTS vehicle_plates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plate TEXT NOT NULL,
  owner TEXT DEFAULT '',
  origin_region_id UUID REFERENCES regions(id),
  status TEXT NOT NULL DEFAULT 'internal',
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Region Tariffs (Tarif per Wilayah)
CREATE TABLE IF NOT EXISTS region_tariffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  region_id UUID NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  tariff_type TEXT NOT NULL,
  nominal_tariff INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE(region_id, tariff_type)
);

-- Plate Scans
CREATE TABLE IF NOT EXISTS plate_scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plate TEXT NOT NULL,
  status TEXT NOT NULL,
  origin_region_id UUID REFERENCES regions(id),
  checkpoint_region_id UUID REFERENCES regions(id),
  tariff_amount INTEGER DEFAULT 0,
  officer_id UUID REFERENCES officers(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Device Versions (for OTA)
CREATE TABLE IF NOT EXISTS device_versions (
  device_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  platform TEXT DEFAULT 'unknown',
  report_count INTEGER DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Admin Credentials
CREATE TABLE IF NOT EXISTS admin_credentials (
  id SERIAL PRIMARY KEY,
  username TEXT,
  password TEXT
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_trips_officer_id ON trips(officer_id);
CREATE INDEX IF NOT EXISTS idx_trips_region_id ON trips(region_id);
CREATE INDEX IF NOT EXISTS idx_trips_created_at ON trips(created_at);
CREATE INDEX IF NOT EXISTS idx_trips_no_trip ON trips(no_trip);
CREATE INDEX IF NOT EXISTS idx_trips_client_trip_id ON trips(client_trip_id) WHERE client_trip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_trip_id ON vehicles(trip_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_no_polisi ON vehicles(no_polisi);

CREATE INDEX IF NOT EXISTS idx_officers_region_id ON officers(region_id);
CREATE INDEX IF NOT EXISTS idx_officers_username ON officers(LOWER(username));

CREATE INDEX IF NOT EXISTS idx_dermaga_region_id ON dermagas(region_id);

CREATE INDEX IF NOT EXISTS idx_routes_dermaga_id ON routes(dermaga_id);

CREATE INDEX IF NOT EXISTS idx_geofences_dermaga_id ON geofences(dermaga_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Explicit ordering: parent tables first so FK references are valid when
-- junction tables are altered/secured.

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dermagas ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer_dermagas ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_plates ENABLE ROW LEVEL SECURITY;
ALTER TABLE region_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE plate_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_credentials ENABLE ROW LEVEL SECURITY;

-- Public read access for app
CREATE POLICY "Public read all" ON regions FOR SELECT USING (true);
CREATE POLICY "Public read all" ON dermagas FOR SELECT USING (true);
CREATE POLICY "Public read all" ON routes FOR SELECT USING (true);
CREATE POLICY "Public read all" ON officers FOR SELECT USING (true);
CREATE POLICY "Public read all" ON officer_dermagas FOR SELECT USING (true);
CREATE POLICY "Public read all" ON officer_regions FOR SELECT USING (true);
CREATE POLICY "Public read all" ON tariffs FOR SELECT USING (true);
CREATE POLICY "Public read all" ON geofences FOR SELECT USING (true);
CREATE POLICY "Public read all" ON device_versions FOR SELECT USING (true);

-- Authenticated write for officers/regions
CREATE POLICY "Auth insert trips" ON trips FOR INSERT WITH CHECK (true);
CREATE POLICY "Auth update trips" ON trips FOR UPDATE USING (true);
CREATE POLICY "Auth insert vehicles" ON vehicles FOR INSERT WITH CHECK (true);
CREATE POLICY "Auth update vehicles" ON vehicles FOR UPDATE USING (true);
CREATE POLICY "Auth insert trip_vehicles" ON trip_vehicles FOR INSERT WITH CHECK (true);
CREATE POLICY "Auth update device_versions" ON device_versions FOR UPDATE USING (true);
CREATE POLICY "Auth insert device_versions" ON device_versions FOR INSERT WITH CHECK (true);

-- Admin only policies
CREATE POLICY "Admin full access" ON regions FOR ALL USING (true);
CREATE POLICY "Admin full access" ON dermagas FOR ALL USING (true);
CREATE POLICY "Admin full access" ON routes FOR ALL USING (true);
CREATE POLICY "Admin full access" ON officers FOR ALL USING (true);
CREATE POLICY "Admin full access" ON officer_dermagas FOR ALL USING (true);
CREATE POLICY "Admin full access" ON officer_regions FOR ALL USING (true);
CREATE POLICY "Admin full access" ON tariffs FOR ALL USING (true);
CREATE POLICY "Admin full access" ON vehicles FOR ALL USING (true);
CREATE POLICY "Admin full access" ON trips FOR ALL USING (true);
CREATE POLICY "Admin full access" ON trip_vehicles FOR ALL USING (true);
CREATE POLICY "Admin full access" ON geofences FOR ALL USING (true);
CREATE POLICY "Admin full access" ON vehicle_plates FOR ALL USING (true);
CREATE POLICY "Admin full access" ON region_tariffs FOR ALL USING (true);
CREATE POLICY "Admin full access" ON plate_scans FOR ALL USING (true);
CREATE POLICY "Admin full access" ON admin_credentials FOR ALL USING (true);

-- ============================================
-- SEED DATA: Initial Tariffs
-- ============================================

INSERT INTO tariffs (golongan, vehicle_type, loaded_tariff, empty_tariff) VALUES
  ('I', 'Motor', 15000, 8000),
  ('II', 'Mobil', 45000, 20000),
  ('III', 'Truck Kecil', 120000, 55000),
  ('IV', 'Truck Sedang', 280000, 130000),
  ('V', 'Truck Besar', 450000, 200000)
ON CONFLICT (golongan, vehicle_type) DO NOTHING;

-- ============================================
-- SEED DATA: Regions (Wilayah)
-- ============================================

INSERT INTO regions (name, code) VALUES
  ('Entikong', 'ENTIKONG'),
  ('Badau', 'BADAU'),
  ('Belitung', 'BELITUNG'),
  ('Kelapa Kampit', 'KELAPAKAMPIT')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- SEED DATA: Dermagas (Ports)
-- ============================================

INSERT INTO dermagas (region_id, name, code)
SELECT r.id, 'Dermaga 1', 'D1' FROM regions r WHERE r.code = 'BADAU'
ON CONFLICT (region_id, code) DO NOTHING;

INSERT INTO dermagas (region_id, name, code)
SELECT r.id, 'Dermaga 2', 'D2' FROM regions r WHERE r.code = 'BADAU'
ON CONFLICT (region_id, code) DO NOTHING;

INSERT INTO dermagas (region_id, name, code)
SELECT r.id, 'Dermaga 1', 'D1' FROM regions r WHERE r.code = 'BELITUNG'
ON CONFLICT (region_id, code) DO NOTHING;

INSERT INTO dermagas (region_id, name, code)
SELECT r.id, 'Dermaga 2', 'D2' FROM regions r WHERE r.code = 'BELITUNG'
ON CONFLICT (region_id, code) DO NOTHING;

INSERT INTO dermagas (region_id, name, code)
SELECT r.id, 'Dermaga 1', 'D1' FROM regions r WHERE r.code = 'KELAPAKAMPIT'
ON CONFLICT (region_id, code) DO NOTHING;

INSERT INTO dermagas (region_id, name, code)
SELECT r.id, 'Dermaga 2', 'D2' FROM regions r WHERE r.code = 'KELAPAKAMPIT'
ON CONFLICT (region_id, code) DO NOTHING;

INSERT INTO dermagas (region_id, name, code)
SELECT r.id, 'Dermaga 1', 'D1' FROM regions r WHERE r.code = 'ENTIKONG'
ON CONFLICT (region_id, code) DO NOTHING;

INSERT INTO dermagas (region_id, name, code)
SELECT r.id, 'Dermaga 2', 'D2' FROM regions r WHERE r.code = 'ENTIKONG'
ON CONFLICT (region_id, code) DO NOTHING;

-- ============================================
-- SEED DATA: Routes
-- ============================================

-- Badau Routes
INSERT INTO routes (dermaga_id, name, route_from, route_to, distance, duration)
SELECT d.id, 'Sijangkung → Sabadi', 'SJRE', 'SBDZ', '42 km', '1j 10m'
FROM dermagas d JOIN regions r ON d.region_id = r.id WHERE r.code = 'BADAU' AND d.code = 'D1'
ON CONFLICT DO NOTHING;

INSERT INTO routes (dermaga_id, name, route_from, route_to, distance, duration)
SELECT d.id, 'Sabadi → Sijangkung', 'SBDZ', 'SJRE', '42 km', '1j 10m'
FROM dermagas d JOIN regions r ON d.region_id = r.id WHERE r.code = 'BADAU' AND d.code = 'D1'
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED DATA: Officers (Default PIN: 123456)
-- bcrypt hash for '123456': $2a$10$...
-- ============================================

INSERT INTO officers (name, pin, region_id, is_active)
SELECT 'Budi Santoso', '$2a$10$rOvHPLUm5hVHvJQJxBxB5uXv7z3z6J5y2xZQjN0r2gZvFJD9F8v3e', r.id, 1
FROM regions r WHERE r.code = 'BADAU'
ON CONFLICT DO NOTHING;

INSERT INTO officers (name, pin, region_id, is_active)
SELECT 'Andi Pratama', '$2a$10$rOvHPLUm5hVHvJQJxBxB5uXv7z3z6J5y2xZQjN0r2gZvFJD9F8v3e', r.id, 1
FROM regions r WHERE r.code = 'BADAU'
ON CONFLICT DO NOTHING;

-- Assign default dermaga to officers
INSERT INTO officer_dermagas (officer_id, dermaga_id)
SELECT o.id, d.id
FROM officers o
JOIN regions r ON o.region_id = r.id
JOIN dermagas d ON d.region_id = r.id AND d.code = 'D1'
ON CONFLICT DO NOTHING;

INSERT INTO officer_regions (officer_id, region_id)
SELECT o.id, o.region_id FROM officers o
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED DATA: Geofences (Default Badau)
-- ============================================

INSERT INTO geofences (name, location_name, dermaga_id, latitude, longitude, radius_meters, allowed_route_codes)
SELECT 'Badau Dermaga 1', 'Badau Dermaga 1', d.id, -0.8506, 108.8338, 100, 'SJRE,SBDZ'
FROM dermagas d JOIN regions r ON d.region_id = r.id WHERE r.code = 'BADAU' AND d.code = 'D1'
ON CONFLICT DO NOTHING;

INSERT INTO geofences (name, location_name, dermaga_id, latitude, longitude, radius_meters, allowed_route_codes)
SELECT 'Badau Dermaga 2', 'Badau Dermaga 2', d.id, -0.8412, 108.8551, 100, 'SBDZ,SJRE'
FROM dermagas d JOIN regions r ON d.region_id = r.id WHERE r.code = 'BADAU' AND d.code = 'D2'
ON CONFLICT DO NOTHING;

-- ============================================
-- FUNCTION: Generate Trip Number
-- ============================================

CREATE OR REPLACE FUNCTION generate_trip_no()
RETURNS TEXT AS $$
DECLARE
  date_str TEXT;
  random_str TEXT;
BEGIN
  date_str := TO_CHAR(NOW(), 'YYYYMMDD');
  random_str := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
  RETURN 'TRP' || date_str || random_str;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Get Officer Dermagas
-- ============================================

CREATE OR REPLACE FUNCTION get_officer_dermagas(p_officer_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  code TEXT,
  region_name TEXT,
  region_code TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT d.id, d.name, d.code, r.name as region_name, r.code as region_code
  FROM officer_dermagas od
  JOIN dermagas d ON od.dermaga_id = d.id
  JOIN regions r ON d.region_id = r.id
  WHERE od.officer_id = p_officer_id;
END;
$$ LANGUAGE plpgsql;
