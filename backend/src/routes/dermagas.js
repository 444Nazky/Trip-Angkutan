const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Daftar petugas yang memiliki akses ke dermaga ini.
// Dipakai mobile saat login ONLINE untuk meng-cache seluruh petugas satu
// dermaga ke penyimpanan lokal (verifikasi PIN & ganti petugas saat offline).
// Tidak butuh token admin — petugas biasa pun boleh membaca daftar ini.
router.get('/:id/officers', authenticate, (req, res) => {
  try {
    const dermagaId = String(req.params.id);
    const officers = db.prepare(`
      SELECT o.id, o.name, o.username, o.region_id, o.is_active,
             r.name AS region_name, r.code AS region_code
      FROM officer_dermagas od
      JOIN officers o ON o.id = od.officer_id
      JOIN regions r ON r.id = o.region_id
      WHERE od.dermaga_id = ?
      ORDER BY o.name
    `).all(dermagaId);

    const regionsStmt = db.prepare(`
      SELECT r.id, r.name, r.code
      FROM regions r
      JOIN officer_regions orr ON r.id = orr.region_id
      WHERE orr.officer_id = ?
      ORDER BY r.name
    `);
    const dermagaStmt = db.prepare(`
      SELECT d.id, d.name, d.code, d.region_id
      FROM officer_dermagas od
      JOIN dermagas d ON od.dermaga_id = d.id
      WHERE od.officer_id = ?
      ORDER BY d.code
    `);

    const out = officers.map(o => {
      let regions = regionsStmt.all(String(o.id));
      if (!regions.length) regions = [{ id: o.region_id, name: o.region_name, code: o.region_code }];
      return { ...o, regions, dermagas: dermagaStmt.all(String(o.id)) };
    });

    res.json({ officers: out });
  } catch (error) {
    console.error('Fetch dermaga officers error:', error);
    res.status(500).json({ error: 'Failed to fetch dermaga officers' });
  }
});

// Get all dermagas with region info
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const dermagas = db.prepare(`
      SELECT d.*, r.name as region_name, r.code as region_code
      FROM dermagas d
      JOIN regions r ON d.region_id = r.id
      ORDER BY r.name, d.name
    `).all();
    res.json(dermagas);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dermagas' });
  }
});

// Create dermaga
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { region_id, name, code } = req.body;
    const { v4: uuidv4 } = require('uuid');

    const id = uuidv4();
    db.prepare(`INSERT INTO dermagas (id, region_id, name, code) VALUES (?, ?, ?, ?)`).run(id, region_id, name, code);

    const dermaga = db.prepare(`SELECT * FROM dermagas WHERE id = ?`).get(id);
    res.status(201).json(dermaga);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create dermaga' });
  }
});

// Update dermaga
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const { name, code } = req.body;
    db.prepare(`UPDATE dermagas SET name = ?, code = ? WHERE id = ?`).run(name, code, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update dermaga' });
  }
});

// Delete dermaga
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    // Delete related routes first
    db.prepare(`DELETE FROM routes WHERE dermaga_id = ?`).run(req.params.id);
    // Delete officer access
    db.prepare(`DELETE FROM officer_dermagas WHERE dermaga_id = ?`).run(req.params.id);
    // Delete dermaga
    db.prepare(`DELETE FROM dermagas WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete dermaga' });
  }
});

module.exports = router;
