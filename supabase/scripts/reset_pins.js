#!/usr/bin/env node
/**
 * Reset all officer PINs to "123456"
 *
 * Usage:
 *   1. Via Supabase Dashboard SQL Editor - copy contents of reset_officer_pins.sql
 *   2. Via Supabase CLI:
 *      supabase db execute -f supabase/scripts/reset_officer_pins.sql
 *   3. This script (requires @supabase/supabase-js):
 *      node supabase/scripts/reset_pins.js
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import bcrypt from 'https://esm.sh/bcryptjs@2.4.3';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bmiruktfruunegtbydyw.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  console.error('Set it with: export SUPABASE_SERVICE_ROLE_KEY=your_key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

async function resetPins() {
  console.log('Generating bcrypt hash for "123456"...');
  const pinHash = bcrypt.hashSync('123456', 10);
  console.log('Hash:', pinHash);

  console.log('\nUpdating all officers PINs...');
  const { data, error } = await supabase
    .from('officers')
    .update({ pin: pinHash })
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all (fake filter)

  if (error) {
    console.error('Error updating PINs:', error);
    process.exit(1);
  }

  console.log('Successfully updated all officer PINs to "123456"');

  // Verify
  const { data: officers, error: fetchError } = await supabase
    .from('officers')
    .select('id, name, username, is_active')
    .order('name');

  if (fetchError) {
    console.error('Error verifying:', fetchError);
    process.exit(1);
  }

  console.log(`\nVerified: ${officers.length} officers in database`);
  console.log('\nOfficers list:');
  officers.forEach(o => {
    console.log(`  - ${o.name} (@${o.username}) - ${o.is_active ? 'Aktif' : 'Nonaktif'}`);
  });
}

resetPins().catch(console.error);
