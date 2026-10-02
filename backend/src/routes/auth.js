const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { authenticate } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'trip-angkut-secret-key';

// Admin login (username/password) — issues a JWT with role: 'admin'
// Credentials come from env with the same defaults as the frontend login screen
router.post('/admin-login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

    if (username !== adminUser || password !== adminPass) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { role: 'admin', username: adminUser },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, admin: { username: adminUser, role: 'admin' } });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Admin login failed' });
  }
});

// ── Revisi #4: Login wilayah (langkah 1) ───────────────────────────────────────
// Login memakai kode wilayah + password wilayah (contoh: BADAU / badau123).
// Jika berhasil, kembalikan daftar petugas wilayah tersebut (TANPA PIN/hash)
// — langkah berikutnya memilih petugas lalu verifikasi PIN masing-masing.
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

    // Password disimpan ter-hash (bcrypt); fallback plain-text untuk skrip lama.
    const stored = region.password || `${String(region.code).toLowerCase()}123`;
    let valid = false;
    try {
      valid = bcrypt.compareSync(pass, stored);
    } catch { /* bukan hash → cek plain */ }
    if (!valid) valid = pass === stored;

    if (!valid) {
      return res.status(401).json({ error: 'Password wilayah salah' });
    }

    // Daftar petugas aktif di wilayah ini — sengaja tanpa PIN/hashed pin.
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

// Member/officer login with username/password
// Now uses username from officers table (migrated from hardcoded map)
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
    const normalizedUsername = username?.toLowerCase();
    const memberPass = process.env.MEMBER_PASSWORD || '123456';

    if (password !== memberPass) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // First try DB username field, fallback to legacy map
    let officerName = null;
    let officerUsername = normalizedUsername;

    const officerByUsername = db.prepare(`SELECT * FROM officers WHERE LOWER(username) = ? AND is_active = 1`).get(normalizedUsername);
    if (officerByUsername) {
      officerName = officerByUsername.name;
      officerUsername = officerByUsername.username?.toLowerCase() || normalizedUsername;
    } else {
      // Fallback to legacy map
      officerName = OFFICER_USERNAME_MAP[normalizedUsername];
    }

    if (!officerName) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get full officer from database
    const officer = db.prepare(`
      SELECT o.*, r.name as region_name, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      WHERE LOWER(o.name) = LOWER(?) AND o.is_active = 1
    `).get(officerName);

    if (!officer) {
      return res.status(401).json({ error: 'Officer not found in database' });
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
        username: officer.username || officerUsername,
        regionId: officer.region_id,
        regionName: officer.region_name,
        regionCode: officer.region_code
      }
    });
  } catch (error) {
    console.error('Member login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Login with PIN
router.post('/login', (req, res) => {
  try {
    const { officerId, pin } = req.body;

    if (!officerId || !pin) {
      return res.status(400).json({ error: 'Officer ID and PIN required' });
    }

    // Always query by string to match SQLite storage
    const officer = db.prepare(`
      SELECT o.*, r.name as region_name, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      WHERE o.id = ? AND o.is_active = 1
    `).get(String(officerId));

    if (!officer) {
      return res.status(401).json({ error: 'Officer not found' });
    }

    const validPin = bcrypt.compareSync(pin, officer.pin);
    if (!validPin) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    // Get officer's accessible dermagas
    const dermagas = db.prepare(`
      SELECT d.id, d.name, d.code, r.name as region_name, r.code as region_code
      FROM officer_dermagas od
      JOIN dermagas d ON od.dermaga_id = d.id
      JOIN regions r ON d.region_id = r.id
      WHERE od.officer_id = ?
    `).all(String(officerId));

    // Get routes for each dermaga
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

// Select dermaga for dual-access officers
router.post('/select-dermaga', authenticate, (req, res) => {
  try {
    const { dermagaId } = req.body;

    if (!dermagaId) {
      return res.status(400).json({ error: 'Dermaga ID required' });
    }

    // Verify officer has access to this dermaga
    const access = db.prepare(`
      SELECT 1 FROM officer_dermagas WHERE officer_id = ? AND dermaga_id = ?
    `).get(String(req.user.officerId), String(dermagaId));

    if (!access) {
      return res.status(403).json({ error: 'Access denied to this dermaga' });
    }

    // Get dermaga and routes
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

// Get officers by region (for device lock)
router.get('/officers/:regionCode', (req, res) => {
  try {
    const { regionCode } = req.params;

    const officers = db.prepare(`
      SELECT o.id, o.name, o.username, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      WHERE r.code = ? AND o.is_active = 1
    `).all(regionCode);

    res.json(officers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch officers' });
  }
});

// Terbitkan ulang token petugas dari klaim terbaru di database, tanpa PIN.
// Dipakai mobile setelah sinkronisasi petugas: jika admin memindahkan wilayah
// atau menonaktifkan akun, trip berikutnya harus memakai klaim terbaru.
// Akun nonaktif ditolak di sini (401) sehingga sesi lama langsung kedaluwarsa.
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

// Verify token
router.get('/verify', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ valid: false });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const officer = db.prepare(`
      SELECT o.*, r.name as region_name, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      WHERE o.id = ?
    `).get(decoded.officerId);

    if (!officer) {
      return res.status(401).json({ valid: false });
    }

    res.json({
      valid: true,
      officer: {
        id: String(officer.id),
        name: officer.name,
        regionId: officer.region_id,
        regionName: officer.region_name,
        regionCode: officer.region_code
      }
    });
  } catch (error) {
    res.status(401).json({ valid: false });
  }
});

// ── Admin credentials store (SQLite, tidak perlu migrasi manual) ──────────────
// Menyimpan hashed password admin di SQLite, bukan environment variable.
// Ini memungkinkan perubahan password tanpa restart server.
try {
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      id       INTEGER PRIMARY KEY,
      username TEXT,
      password TEXT
    )
  `)
} catch (_) { /* idempotent */ }

function adminGetCredentials() {
  const stmt = db.prepare(`SELECT id, username, password FROM admin_credentials LIMIT 1`)
  const row = stmt.get()
  return row ?? null
}

function adminSetCredentials(username, passwordHash) {
  try {
    db.run(`DELETE FROM admin_credentials`)
    db.run(`INSERT INTO admin_credentials (username, password) VALUES (?, ?)`, [username, passwordHash])
    db.saveDb?.()
  } catch (_) { /* jika db.saveDb tidak tersedia */
  }
}

// ── POST /auth/change-admin-password ────────────────────────────────────────────
// Body: { currentPassword, newPassword }
// Menyimpan password hash baru di SQLite, validasi password lama terhadap entry di tabel ini
// atau terhadap default admin/admin123 di environment.
router.post(`/change-admin-password`, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {}

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: `Password lama dan baru wajib diisi` })
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: `Password baru minimal 6 karakter` })
  }

  const row = adminGetCredentials()
  const storedHash = row?.password ?? null

  // Kalau tidak ada di SQLite, fallback ke env / hardcoded default (admin/admin123)
  let valid = false
  if (storedHash) {
    try { valid = bcrypt.compareSync(currentPassword, storedHash) } catch (_) { valid = false }
  } else {
    // credential default admin/admin123, atau ADMIN_PASSWORD di env
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
})

module.exports = router;
