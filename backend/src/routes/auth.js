/**
 * Auth Routes - Supabase Version
 * Replace sql.js with @supabase/supabase-js
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

const OFFICER_TOKEN_TTL = '3650d'; // 10 years for officers

const rateBuckets = new Map();

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let hits = rateBuckets.get(key) || [];
    hits = hits.filter(t => now - t < windowMs);
    if (hits.length >= max) {
      return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    if (rateBuckets.size > 10000) {
      for (const [k, v] of rateBuckets) {
        if (v.every(t => now - t >= windowMs)) rateBuckets.delete(k);
      }
    }
    next();
  };
}

const authRateLimiter = rateLimit(5, 60_000);
const strictRateLimiter = rateLimit(3, 60_000);

// ============================================
// ADMIN LOGIN
// ============================================

router.post('/admin-login', authRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const adminUser = process.env.ADMIN_USERNAME || 'admin';

    // Get admin credentials from database
    const client = supabaseAdmin || supabase;
    const { data: adminRow, error } = await client
      .from('admin_credentials')
      .select('username, password')
      .limit(1)
      .single();

    let valid = false;
    let effectiveUser = adminUser;

    if (adminRow?.password) {
      effectiveUser = adminRow.username || adminUser;
      if (username === effectiveUser) {
        try { valid = bcrypt.compareSync(password, adminRow.password); }
        catch (_) { valid = false; }
      }
    } else {
      if (!process.env.ADMIN_PASSWORD) {
        return res.status(503).json({ error: 'Admin credentials not configured' });
      }
      valid = username === adminUser && password === process.env.ADMIN_PASSWORD;
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { role: 'admin', username: effectiveUser },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, admin: { username: effectiveUser, role: 'admin' } });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Admin login failed' });
  }
});

// ============================================
// REGION LOGIN
// ============================================

router.post('/region-login', authRateLimiter, async (req, res) => {
  try {
    const { regionCode, password } = req.body || {};
    const code = String(regionCode || '').trim();
    const pass = String(password || '');

    if (!code || !pass) {
      return res.status(400).json({ error: 'Kode wilayah dan password wajib diisi' });
    }

    const { data: region, error } = await (supabaseAdmin || supabase)
      .from('regions')
      .select('*')
      .ilike('code', code)
      .limit(1)
      .single();

    if (error || !region?.password) {
      return res.status(401).json({ error: 'Kode wilayah atau password salah' });
    }

    let valid = false;
    try { valid = bcrypt.compareSync(pass, region.password); }
    catch (_) { valid = false; }

    if (!valid) {
      return res.status(401).json({ error: 'Kode wilayah atau password salah' });
    }

    // Get officers for this region
    const { data: officers, error: officersError } = await (supabaseAdmin || supabase)
      .from('officers')
      .select('id, name')
      .eq('region_id', region.id)
      .eq('is_active', 1)
      .order('name', { ascending: true });

    if (officersError) {
      console.error('Get officers error:', officersError);
    }

    res.json({
      region: {
        id: String(region.id),
        name: region.name,
        code: region.code
      },
      officers: (officers || []).map(o => ({ id: String(o.id), name: o.name }))
    });
  } catch (error) {
    console.error('Region login error:', error);
    res.status(500).json({ error: 'Login wilayah gagal' });
  }
});

// ============================================
// MEMBER LOGIN (Officer by username)
// ============================================

router.post('/member-login', authRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const normalizedUsername = String(username || '').toLowerCase();
    const pin = String(password || '');

    if (!normalizedUsername || !pin) {
      return res.status(400).json({ error: 'Username dan PIN wajib diisi' });
    }

    // Find officer by username
    const { data: officerRows, error } = await (supabaseAdmin || supabase)
      .from('officers')
      .select('*, regions!officers_region_id_fkey(name, code)')
      .ilike('username', normalizedUsername)
      .eq('is_active', 1);

    if (error || !officerRows?.length) {
      return res.status(401).json({ error: 'Username tidak terdaftar' });
    }

    // Find officer with valid PIN
    let officer = null;
    for (const r of officerRows) {
      if (!r.pin) continue;
      try {
        if (bcrypt.compareSync(pin, r.pin)) {
          officer = r;
          break;
        }
      } catch (_) { /* hash damaged */ }
    }

    if (!officer) {
      return res.status(401).json({ error: 'PIN salah' });
    }

    // Get officer's dermagas and routes (same as /login endpoint)
    const dermagas = await helpers.getOfficerDermagas(officer.id);

    // Get routes for each dermaga
    const routesMap = {};
    for (const dm of dermagas) {
      routesMap[dm.id] = await helpers.getDermagaRoutes(dm.id);
    }

    const isDualAccess = dermagas.length > 1;

    const token = jwt.sign(
      { officerId: officer.id, regionId: officer.region_id, role: 'officer' },
      JWT_SECRET,
      { expiresIn: OFFICER_TOKEN_TTL }
    );

    res.json({
      token,
      officer: {
        id: String(officer.id),
        name: officer.name,
        username: officer.username || normalizedUsername,
        regionId: officer.region_id,
        regionName: officer.regions?.name,
        regionCode: officer.regions?.code,
        // Include dermagaAccess for mobile app geofencing
        dermagaAccess: dermagas.map(d => ({ id: d.id, name: d.name, code: d.code })),
      },
      // Include dermagas and routes for mobile app (same as /login endpoint)
      dermagas,
      routes: routesMap,
      isDualAccess,
    });
  } catch (error) {
    console.error('Member login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============================================
// LOGIN (Officer by ID + PIN)
// ============================================

router.post('/login', authRateLimiter, async (req, res) => {
  try {
    const { officerId, pin } = req.body;

    if (!officerId || !pin) {
      return res.status(400).json({ error: 'Officer ID and PIN required' });
    }

    const { data: officer, error } = await (supabaseAdmin || supabase)
      .from('officers')
      .select('*, regions!officers_region_id_fkey(name, code)')
      .eq('id', officerId)
      .eq('is_active', 1)
      .limit(1)
      .single();

    if (error || !officer) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let validPin = false;
    try { validPin = bcrypt.compareSync(String(pin), officer.pin); }
    catch (_) { validPin = false; }

    if (!validPin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get officer's dermagas
    const dermagas = await helpers.getOfficerDermagas(officerId);

    // Get routes for each dermaga
    const routesMap = {};
    for (const dm of dermagas) {
      routesMap[dm.id] = await helpers.getDermagaRoutes(dm.id);
    }

    const isDualAccess = dermagas.length > 1;

    const token = jwt.sign(
      { officerId: officer.id, regionId: officer.region_id, role: 'officer', isDualAccess },
      JWT_SECRET,
      { expiresIn: OFFICER_TOKEN_TTL }
    );

    res.json({
      token,
      officer: {
        id: String(officer.id),
        name: officer.name,
        username: officer.username,
        regionId: officer.region_id,
        regionName: officer.regions?.name,
        regionCode: officer.regions?.code
      },
      dermagas,
      routes: routesMap,
      isDualAccess
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============================================
// SELECT DERMAGA
// ============================================

router.post('/select-dermaga', authenticate, async (req, res) => {
  try {
    const { dermagaId } = req.body;

    if (!dermagaId) {
      return res.status(400).json({ error: 'Dermaga ID required' });
    }

    // Verify officer has access to this dermaga
    const { data: access, error: accessError } = await (supabaseAdmin || supabase)
      .from('officer_dermagas')
      .select('1')
      .eq('officer_id', req.user.officerId)
      .eq('dermaga_id', dermagaId)
      .limit(1);

    if (accessError || !access?.length) {
      return res.status(403).json({ error: 'Access denied to this dermaga' });
    }

    // Get dermaga details
    const { data: dermaga, error: dermagaError } = await (supabaseAdmin || supabase)
      .from('dermagas')
      .select('*, regions!officers_region_id_fkey(name, code)')
      .eq('id', dermagaId)
      .limit(1)
      .single();

    if (dermagaError || !dermaga) {
      return res.status(404).json({ error: 'Dermaga not found' });
    }

    // Get routes
    const routes = await helpers.getDermagaRoutes(dermagaId);

    res.json({
      dermaga: {
        id: String(dermaga.id),
        name: dermaga.name,
        code: dermaga.code,
        region_name: dermaga.regions?.name,
        region_code: dermaga.regions?.code
      },
      routes
    });
  } catch (error) {
    console.error('Select dermaga error:', error);
    res.status(500).json({ error: 'Failed to select dermaga' });
  }
});

// ============================================
// REFRESH TOKEN
// ============================================

router.post('/refresh', authenticate, async (req, res) => {
  try {
    const { data: officer, error } = await (supabaseAdmin || supabase)
      .from('officers')
      .select('*, regions!officers_region_id_fkey(name, code)')
      .eq('id', req.user.officerId)
      .eq('is_active', 1)
      .limit(1)
      .single();

    if (error || !officer) {
      return res.status(401).json({ error: 'Officer not found or inactive' });
    }

    const token = jwt.sign(
      { officerId: officer.id, regionId: officer.region_id, role: 'officer' },
      JWT_SECRET,
      { expiresIn: OFFICER_TOKEN_TTL }
    );

    res.json({
      token,
      officer: {
        id: String(officer.id),
        name: officer.name,
        regionId: officer.region_id,
        regionName: officer.regions?.name,
        regionCode: officer.regions?.code
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// ============================================
// CHANGE ADMIN PASSWORD
// ============================================

router.post('/change-admin-password', strictRateLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Password lama dan baru wajib diisi' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Password baru minimal 8 karakter' });
    }

    const client = supabaseAdmin || supabase;
    const { data: row, error } = await client
      .from('admin_credentials')
      .select('username, password')
      .limit(1)
      .single();

    let valid = false;
    if (row?.password) {
      try { valid = bcrypt.compareSync(currentPassword, row.password); }
      catch (_) { valid = false; }
    } else if (process.env.ADMIN_PASSWORD) {
      valid = currentPassword === process.env.ADMIN_PASSWORD;
    }

    if (!valid) {
      return res.status(401).json({ error: 'Password lama salah' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    const username = row?.username || process.env.ADMIN_USERNAME || 'admin';

    await client
      .from('admin_credentials')
      .upsert({ username, password: hashed });

    res.json({ success: true, username });
  } catch (error) {
    console.error('change-admin-password error:', error);
    res.status(500).json({ error: 'Gagal memproses permintaan' });
  }
});

module.exports = router;
