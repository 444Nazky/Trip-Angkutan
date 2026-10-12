const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { authenticate } = require('../middleware/auth');

const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET
  if (!s) {
    console.error('[auth] JWT_SECRET environment variable is required — server cannot start without it')
    process.exit(1)
  }
  return s
})()

// Admin login (username/password) — issues a JWT with role: 'admin'
//
// Deteksi kredensial khusus admin, dua lapis:
//   1. Hasil "Ganti Password" di dashboard (tabel admin_credentials, bcrypt)
//      — diprioritaskan; setelah password diganti, password lama SUDAH MATI.
//   2. Env vars ADMIN_USERNAME + ADMIN_PASSWORD harus diset.
router.post('/admin-login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const adminUser = process.env.ADMIN_USERNAME
    const adminPass = process.env.ADMIN_PASSWORD

    if (!adminUser || !adminPass) {
      return res.status(500).json({ error: 'ADMIN_USERNAME and ADMIN_PASSWORD environment variables are required' })
    }

    let row = null;
    try { row = adminGetCredentials(); } catch (_) { row = null; }

    let valid = false;
    let effectiveUser = adminUser;

    if (row && row.password) {
      // Password sudah pernah diganti → HANYA password baru yang berlaku.
      effectiveUser = String(row.username || adminUser);
      if (String(username ?? '') === effectiveUser) {
        try { valid = bcrypt.compareSync(String(password ?? ''), row.password); }
        catch (_) { valid = false; }
      }
    } else {
      // Tidak ada hash tersimpan dan tidak ada env — tolak (tidak ada fallback default)
      return res.status(401).json({ error: 'Invalid admin credentials' })
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

// Member/officer login with username + PIN (not shared password).
// Requires officer to exist in DB with a configured PIN.
// For devices that only have officerId + PIN (mobile app), use POST /auth/login instead.
router.post('/member-login', (req, res) => {
  try {
    const { username, pin } = req.body || {}

    if (!username || !pin) {
      return res.status(400).json({ error: 'Username and PIN are required' })
    }

    const normalizedUsername = String(username).toLowerCase().trim()
    if (!normalizedUsername) {
      return res.status(400).json({ error: 'Username is required' })
    }

    const officer = db.prepare(`
      SELECT o.*, r.name as region_name, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      WHERE LOWER(o.username) = ? AND o.is_active = 1
    `).get(normalizedUsername)

    if (!officer) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (!officer.pin) {
      return res.status(401).json({ error: 'PIN not configured for this officer' })
    }

    // Verify PIN against the bcrypt hash stored in the officers table
    let validPin = false
    try { validPin = bcrypt.compareSync(String(pin ?? ''), officer.pin) }
    catch (_) { validPin = false }

    if (!validPin) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = jwt.sign(
      { officerId: officer.id, regionId: officer.region_id, role: 'officer' },
      JWT_SECRET,
      { expiresIn: '24h' }
    )

    res.json({
      token,
      officer: {
        id: String(officer.id),
        name: officer.name,
        username: officer.username || normalizedUsername,
        regionId: officer.region_id,
        regionName: officer.region_name,
        regionCode: officer.region_code,
      },
    })
  } catch (error) {
    console.error('Member login error:', error)
    res.status(500).json({ error: 'Login failed' })
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

// ── Admin credentials store (SQLite, tidak perlu migrasi manual) ──────────────
// Menyimpan hashed password admin di SQLite, bukan environment variable.
// Ini memungkinkan perubahan password tanpa restart server.//
// CATATAN: wrapper db.js HANYA punya prepare()/exec() — tidak ada db.run().
// Versi lama memakai db.run() yang melempar "db.run is not a function" dan
// ditelan catch kosong → tabel tidak pernah terbentuk → request pertama ke
// /change-admin-password membunuh proses Node (async handler tanpa try).
// Sekarang tabel dibuat lazy memakai API wrapper yang benar.
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

// ── POST /auth/change-admin-password ────────────────────────────────────────────
// Body: { currentPassword, newPassword }
// Menyimpan password hash baru di SQLite, validasi password lama terhadap entry di tabel ini
// terhadap ADMIN_PASSWORD di environment.
router.post(`/change-admin-password`, async (req, res) => {
  // Error di handler async TIDAK ditangkap Express 4 → unhandled rejection →
  // proses Node mati. Semua langkah dibungkus try agar balas 500, bukan crash.
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

    // Kalau tidak ada di SQLite, fallback ke env / hardcoded default (admin/admin123)
    let valid = false
    if (storedHash) {
      try { valid = bcrypt.compareSync(currentPassword, storedHash) } catch (_) { valid = false }
    } else {
      // ADMIN_PASSWORD di environment variable.
      const defAdminPass = process.env.ADMIN_PASSWORD ?? null
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
