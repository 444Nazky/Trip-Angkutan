const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');



router.post('/admin-login', (req, res) => {
  try {
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

    if (error.code === 'ERR_JWT_SECRET_NOT_IN_PEM') {
      console.error('JWT_SECRET appears to be invalid. Check your environment variables.');
    }
    res.status(500).json({ error: 'Admin login failed' });
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
  return db.prepare(`SELECT id, username, password FROM admin_credentials LIMIT 1`).get() ?? null;
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
