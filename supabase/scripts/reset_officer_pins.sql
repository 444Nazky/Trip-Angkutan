-- Reset all officer PINs to "123456"
-- Run this migration via Supabase Dashboard SQL Editor or:
--   supabase db execute -f supabase/scripts/reset_officer_pins.sql

-- The bcrypt hash for "123456" (cost factor 10)
-- Hash generated with: bcrypt.hashSync('123456', 10)
UPDATE officers
SET pin = '$2b$10$uJvyypn3huZHokoxV5ctfOkZ.wg0C5dD34yHFPPmaEwAvj5gW7jW2'
WHERE is_active = 1;

-- Also update any inactive officers (in case they get reactivated)
UPDATE officers
SET pin = '$2b$10$uJvyypn3huZHokoxV5ctfOkZ.wg0C5dD34yHFPPmaEwAvj5gW7jW2'
WHERE pin IS NULL OR pin = '';

-- Verify the update
SELECT id, name, username, is_active,
       CASE WHEN pin IS NOT NULL THEN 'SET' ELSE 'NULL' END as pin_status
FROM officers
ORDER BY name;
