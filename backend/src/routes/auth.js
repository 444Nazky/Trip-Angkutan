const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { authenticate } = require('../middleware/auth');
const { JWT_SECRET } = require('../middleware/auth');



// ponytail: sesi PETUGAS tidak praktis pernah kedaluwarsa (permintaan operasional:
// petugas di lapangan tidak boleh tiba-tiba "belum login" saat mau input trip atau
// sync geofence hanya karena token 24 jam habis). Token dashboard/admin tetap 24 jam.
const OFFICER_TOKEN_TTL = '3650d';



// ponytail: map memori, redis bila multi
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



let adminTableReady = false;



function ensureAdminCredentialsTable() {
  if (adminTableReady) return;
  db.prepare(`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      id       INTEGER PRIMARY KEY,
      username TEXT,
      password TEXT
    )
  `).run();
  adminTableReady = true;
}



function adminGetCredentials() {
  ensureAdminCredentialsTable();
  const stmt = db.prepare(`SELECT id, username, password FROM admin_credentials LIMIT 1`);
  const row = stmt.get();
  return row ?? null;
}



function adminSetCredentials(username, passwordHash) {
  ensureAdminCredentialsTable();
  db.prepare(`DELETE FROM admin_credentials`).run();
  db.prepare(`INSERT INTO admin_credentials (username, password) VALUES (?, ?)`)
    .run(username, passwordHash);
}



function bootstrapAdminIfNeeded() {
  try {
    const row = adminGetCredentials();
    if (row) return;
    if (process.env.ADMIN_PASSWORD) {
      return;
    }
    const crypto = require('crypto');
    const generated = crypto.randomBytes(15).toString('base64url').slice(0, 20);
    const hash = bcrypt.hashSync(generated, 10);
    adminSetCredentials('admin', hash);
    console.log('══════════════════════════════════════════════════════════════');
    console.log('[auth] ADMIN PASSWORD BARU DIBUAT (cetak SEKALI, catat sekarang):');
    console.log(`[auth]   username: admin`);
    console.log(`[auth]   password: ${generated}`);
    console.log('[auth] Setelah dicatat, jalur env ADMIN_PASSWORD tidak diperlukan.');
    console.log('══════════════════════════════════════════════════════════════');
  } catch (e) {
    console.warn('[auth] bootstrap admin gagal:', e.message);
  }
}



router.post('/admin-login', authRateLimiter, (req, res) => {
  try {
    bootstrapAdminIfNeeded();
    const { username, password } = req.body || {};
    const adminUser = process.env.ADMIN_USERNAME || 'admin';

    let row = null;
    try { row = adminGetCredentials(); } catch (_) { row = null; }

    let valid = false;
    let effectiveUser = adminUser;

    if (row && row.password) {
      effectiveUser = String(row.username || adminUser);
      if (String(username ?? '') === effectiveUser) {
        try { valid = bcrypt.compareSync(String(password ?? ''), row.password); }
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



router.post('/region-login', authRateLimiter, (req, res) => {
  try {
    const { regionCode, password } = req.body || {};
    const code = String(regionCode || '').trim();
    const pass = String(password || '');

    if (!code || !pass) {
      return res.status(400).json({ error: 'Kode wilayah dan password wajib diisi' });
    }

    const region = db.prepare(
      `SELECT * FROM regions WHERE UPPER(code) = UPPER(?)`
    ).get(code);

    if (!region || !region.password) {
      return res.status(401).json({ error: 'Kode wilayah atau password salah' });
    }

    let valid = false;
    try { valid = bcrypt.compareSync(pass, region.password); }
    catch (_) { valid = false; }

    if (!valid) {
      return res.status(401).json({ error: 'Kode wilayah atau password salah' });
    }

    const officers = db.prepare(`
      SELECT o.id, o.name
      FROM officers o
      WHERE o.region_id = ? AND o.is_active = 1
      ORDER BY o.name ASC
    `).all(region.id);

    res.json({
      region: {
        id: String(region.id),
        name: region.name,
        code: region.code
      },
      officers: officers.map(o => ({ id: String(o.id), name: o.name }))
    });
  } catch (error) {
    console.error('Region login error:', error);
    res.status(500).json({ error: 'Login wilayah gagal' });
  }
});



const OFFICER_USERNAME_MAP = {
  'budi': 'Budi Santoso',
  'andi': 'Andi Pratama',
  'siti': 'Siti Rahayu',
  'rizky': 'Rizky Maulana',
  'dewi': 'Dewi Kusuma'
};



router.post('/member-login', authRateLimiter, (req, res) => {
  try {
    const { username, password } = req.body || {};
    const normalizedUsername = String(username || '').toLowerCase();
    const pin = String(password || '');

    if (!normalizedUsername || !pin) {
      return res.status(400).json({ error: 'Username dan PIN wajib diisi' });
    }

    // ponytail: ambil SEMUA baris username ini — nama kembar bisa menghasilkan
    // username turunan yang sama; PIN dicocokkan ke tiap baris sampai ketemu yang pas.
    // Dulu .get() hanya mengambil baris pertama sembarang → PIN benar pun 401.
    const rows = db.prepare(
      `SELECT * FROM officers WHERE LOWER(username) = ?`
    ).all(normalizedUsername);
    if (!rows.length && OFFICER_USERNAME_MAP[normalizedUsername]) {
      const byName = db.prepare(
        `SELECT * FROM officers WHERE LOWER(name) = LOWER(?) AND is_active = 1`
      ).get(OFFICER_USERNAME_MAP[normalizedUsername]);
      if (byName) rows.push(byName);
    }

    if (!rows.length) {
      return res.status(401).json({ error: 'Username tidak terdaftar' });
    }
    if (!rows.some(r => Number(r.is_active) === 1)) {
      return res.status(401).json({ error: 'Akun nonaktif' });
    }

    let officer = null;
    for (const r of rows) {
      if (Number(r.is_active) !== 1 || !r.pin) continue;
      try { if (bcrypt.compareSync(pin, r.pin)) { officer = r; break; } }
      catch (_) { /* hash rusak — lanjut ke baris berikut */ }
    }

    if (!officer) {
      return res.status(401).json({ error: 'PIN salah' });
    }

    const regionInfo = db.prepare(
      `SELECT name as region_name, code as region_code FROM regions WHERE id = ?`
    ).get(officer.region_id);

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
        regionName: regionInfo?.region_name,
        regionCode: regionInfo?.region_code
      }
    });
  } catch (error) {
    console.error('Member login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});



router.post('/login', authRateLimiter, (req, res) => {
  try {
    const { officerId, pin } = req.body;

    if (!officerId || !pin) {
      return res.status(400).json({ error: 'Officer ID and PIN required' });
    }

    const officer = db.prepare(`
      SELECT o.*, r.name as region_name, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      WHERE o.id = ? AND o.is_active = 1
    `).get(String(officerId));

    if (!officer) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let validPin = false;
    try { validPin = bcrypt.compareSync(String(pin), officer.pin); }
    catch (_) { validPin = false; }
    if (!validPin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const dermagas = db.prepare(`
      SELECT d.id, d.name, d.code, r.name as region_name, r.code as region_code
      FROM officer_dermagas od
      JOIN dermagas d ON od.dermaga_id = d.id
      JOIN regions r ON d.region_id = r.id
      WHERE od.officer_id = ?
    `).all(String(officerId));

    const routesMap = {};
    for (const dm of dermagas) {
      const routes = db.prepare(`
        SELECT id, name, route_from, route_to, distance, duration
        FROM routes
        WHERE dermaga_id = ?
      `).all(dm.id);
      routesMap[dm.id] = routes;
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
        regionName: officer.region_name,
        regionCode: officer.region_code
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



router.post('/select-dermaga', authenticate, (req, res) => {
  try {
    const { dermagaId } = req.body;

    if (!dermagaId) {
      return res.status(400).json({ error: 'Dermaga ID required' });
    }

    const access = db.prepare(`
      SELECT 1 FROM officer_dermagas WHERE officer_id = ? AND dermaga_id = ?
    `).get(String(req.user.officerId), String(dermagaId));

    if (!access) {
      return res.status(403).json({ error: 'Access denied to this dermaga' });
    }

    const dermaga = db.prepare(`
      SELECT d.*, r.name as region_name, r.code as region_code
      FROM dermagas d
      JOIN regions r ON d.region_id = r.id
      WHERE d.id = ?
    `).get(String(dermagaId));

    if (!dermaga) {
      return res.status(404).json({ error: 'Dermaga not found' });
    }

    const routes = db.prepare(`
      SELECT id, name, route_from, route_to, distance, duration
      FROM routes
      WHERE dermaga_id = ?
    `).all(String(dermagaId));

    res.json({ dermaga, routes });
  } catch (error) {
    console.error('Select dermaga error:', error);
    res.status(500).json({ error: 'Failed to select dermaga' });
  }
});



router.post('/refresh', authenticate, (req, res) => {
  try {
    const officer = db.prepare(`
      SELECT o.*, r.name as region_name, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      WHERE o.id = ? AND o.is_active = 1
    `).get(String(req.user.officerId ?? ''));

    if (!officer) {
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
        regionName: officer.region_name,
        regionCode: officer.region_code
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});



router.post(`/change-admin-password`, strictRateLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {}

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: `Password lama dan baru wajib diisi` })
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: `Password baru minimal 8 karakter` })
    }

    const row = adminGetCredentials()
    const storedHash = row?.password ?? null

    let valid = false
    if (storedHash) {
      try { valid = bcrypt.compareSync(currentPassword, storedHash) } catch (_) { valid = false }
    } else if (process.env.ADMIN_PASSWORD) {
      valid = currentPassword === process.env.ADMIN_PASSWORD
    }

    if (!valid) {
      return res.status(401).json({ error: `Password lama salah` })
    }

    const hashed = await bcrypt.hash(newPassword, 10)
    const username = row?.username ?? (process.env.ADMIN_USERNAME ?? `admin`)
    adminSetCredentials(username, hashed)

    res.json({ success: true, username })
  } catch (error) {
    console.error('change-admin-password error:', error?.message || error)
    res.status(500).json({ error: `Gagal memproses permintaan` })
  }
})



module.exports = router;
