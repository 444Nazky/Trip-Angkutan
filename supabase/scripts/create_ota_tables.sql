-- ============================================
-- Create missing OTA tables
-- Run via Supabase Dashboard SQL Editor or:
--   supabase db push --linked
-- ============================================

-- Table for APK version releases
CREATE TABLE IF NOT EXISTS app_versions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    version TEXT NOT NULL UNIQUE,
    download_url TEXT,
    release_date TIMESTAMPTZ DEFAULT NOW(),
    release_notes TEXT,
    is_force_update BOOLEAN DEFAULT FALSE,
    min_version TEXT,
    apk_size BIGINT,
    apk_hash TEXT,
    apk_version_name TEXT,
    apk_version_code INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for OTA web bundle releases
CREATE TABLE IF NOT EXISTS ota_bundles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    version TEXT NOT NULL UNIQUE,
    manifest JSONB NOT NULL,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE app_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota_bundles ENABLE ROW LEVEL SECURITY;

-- Public read access for app_versions (needed for mobile app version check)
CREATE POLICY "Public read app_versions" ON app_versions
    FOR SELECT USING (true);

-- Public read access for ota_bundles (needed for mobile OTA manifest check)
CREATE POLICY "Public read ota_bundles" ON ota_bundles
    FOR SELECT USING (true);

-- Admin write access for app_versions (managed via Edge Functions with service role)
CREATE POLICY "Admin write app_versions" ON app_versions
    FOR ALL USING (true);

-- Admin write access for ota_bundles (managed via Edge Functions with service role)
CREATE POLICY "Admin write ota_bundles" ON ota_bundles
    FOR ALL USING (true);

-- Insert sample APK version (will be updated with actual APK URL)
INSERT INTO app_versions (version, download_url, release_notes, is_force_update)
VALUES (
    '1.0.0',
    NULL,
    'Versi awal aplikasi Trip Angkut',
    FALSE
) ON CONFLICT (version) DO NOTHING;

-- ============================================
-- Verify tables created
-- ============================================
SELECT 'app_versions' as table_name, COUNT(*) as row_count FROM app_versions
UNION ALL
SELECT 'ota_bundles', COUNT(*) FROM ota_bundles;
