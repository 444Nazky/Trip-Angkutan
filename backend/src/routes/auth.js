const express = require('express');




const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { authenticate } = require('../middleware/auth');




const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (!s) {
    console.error('[auth] JWT_SECRET environment variable is required — server cannot start without it');
    process.exit(1);
  }
  return s;
})();




router.post('/admin-login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

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
      valid = username === adminUser && password === adminPass;
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
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




router.post('/region-login', (req, res) => {
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

    if (!region) {
      return res.status(401).json({ error: 'Wilayah tidak ditemukan' });
    }

    if (!region || !region.password) {
      return res.status(401).json({ error: 'Kode wilayah atau password salah' });
    }

    let valid = false;
    try {
      valid = bcrypt.compareSync(pass, region.password);
    } catch { valid = false; }

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




router.post('/member-login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const normalizedUsername = username?.toLowerCase().trim();

    if (!normalizedUsername) {
      return res.status(400).json({ error: 'Username wajib diisi' });
    }

    // Cari SEMUA officer dengan username/name yang cocok
    const candidates = db.prepare(`
      SELECT o.*, r.name as region_name, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      WHERE LOWER(o.username) = LOWER(?) OR LOWER(o.name) = LOWER(?)
    `).all(normalizedUsername, normalizedUsername);

    if (candidates.length === 0) {
      // Cek legacy name map
      const legacyName = OFFICER_USERNAME_MAP[normalizedUsername];
      if (legacyName) {
        const legacyCandidates = db.prepare(`
          SELECT o.*, r.name as region_name, r.code as region_code
          FROM officers o
          JOIN regions r ON o.region_id = r.id
          WHERE LOWER(o.name) = LOWER(?)
        `).all(legacyName);
        if (legacyCandidates.length > 0) {
          // Proses legacy candidates
          for (const officer of legacyCandidates) {
            if (!officer.is_active) {
              return res.status(401).json({ error: 'Akun nonaktif' });
            }
            let validPin = false;
            try { validPin = bcrypt.compareSync(String(password ?? ''), officer.pin); } catch (_) {}
            if (validPin) {
              const token = jwt.sign(
                { officerId: officer.id, regionId: officer.region_id, role: 'officer' },
                JWT_SECRET,
                { expiresIn: '24h' }
              );
              return res.json({
                token,
                officer: {
                  id: String(officer.id),
                  name: officer.name,
                  username: officer.username || normalizedUsername,
                  regionId: officer.region_id,
                  regionName: officer.region_name,
                  regionCode: officer.region_code
                }
              });
            }
          }
          return res.status(401).json({ error: 'PIN salah' });
        }
      }
      return res.status(401).json({ error: 'Username tidak terdaftar' });
    }

    // Cek apakah ada yang aktif
    const activeCandidates = candidates.filter(o => o.is_active);
    if (activeCandidates.length === 0) {
      return res.status(401).json({ error: 'Akun nonaktif' });
    }

    // Cocokkan PIN ke semua kandidat aktif sampai ketemu
    for (const officer of activeCandidates) {
      let validPin = false;
      try { validPin = bcrypt.compareSync(String(password ?? ''), officer.pin); } catch (_) {}
      if (validPin) {
        const effectiveUsername = officer.username || normalizedUsername || '';
        const token = jwt.sign(
          { officerId: officer.id, regionId: officer.region_id, role: 'officer' },
          JWT_SECRET,
          { expiresIn: '24h' }
        );
        return res.json({
          token,
          officer: {
            id: String(officer.id),
            name: officer.name,
            username: effectiveUsername,
            regionId: officer.region_id,
            regionName: officer.region_name,
            regionCode: officer.region_code
          }
        });
      }
    }

    // Tidak ada PIN yang cocok
    return res.status(401).json({ error: 'PIN salah' });
  } catch (error) {
    console.error('Member login error:', error);
    res.status(500).json({ error: 'Login gagal' });
  }
});




router.post('/login', (req, res) => {
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
      return res.status(401).json({ error: 'Officer not found' });
    }

    let validPin = false;
    try { validPin = bcrypt.compareSync(String(pin), officer.pin); }
    catch (_) { validPin = false; }
    if (!validPin) {
      return res.status(401).json({ error: 'Invalid PIN' });
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
      { expiresIn: '24h' }
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
      { expiresIn: '24h' }
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




router.post(`/change-admin-password`, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {}

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: `Password lama dan baru wajib diisi` })
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: `Password baru minimal 6 karakter` })
    }

    const row = adminGetCredentials()
    const storedHash = row?.password ?? null

    let valid = false
    if (storedHash) {
      try { valid = bcrypt.compareSync(currentPassword, storedHash) } catch (_) { valid = false }
    } else {
      const defAdminPass = process.env.ADMIN_PASSWORD ?? `admin123`
      valid = currentPassword === defAdminPass
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
