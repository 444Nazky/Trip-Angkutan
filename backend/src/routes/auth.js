const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');

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

// Member/officer login with username/password
// Maps to seeded officer data: budi=1, andi=2, siti=3, rizky=4, dewi=5
const OFFICER_USERNAME_MAP = {
  'budi': 1,
  'andi': 2,
  'siti': 3,
  'rizky': 4,
  'dewi': 5
};

router.post('/member-login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const memberPass = process.env.MEMBER_PASSWORD || 'budi123';

    if (username !== 'budi' || password !== memberPass) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const officerId = OFFICER_USERNAME_MAP[username.toLowerCase()];
    if (!officerId) {
      return res.status(401).json({ error: 'Officer not found' });
    }

    // Get officer from database (only if active)
    const officer = db.prepare(`
      SELECT o.*, r.name as region_name, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      WHERE o.id = ? AND o.is_active = 1
    `).get(String(officerId));

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
        // Selalu string — id petugas di DB bisa UUID (bukan hanya angka)
        id: String(officer.id),
        name: officer.name,
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
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get officers by region (for device lock)
router.get('/officers/:regionCode', (req, res) => {
  try {
    const { regionCode } = req.params;

    const officers = db.prepare(`
      SELECT o.id, o.name, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      WHERE r.code = ? AND o.is_active = 1
    `).all(regionCode);

    res.json(officers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch officers' });
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

module.exports = router;
