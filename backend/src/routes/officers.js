const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Get all officers — officer database is admin-only
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const officers = db.prepare(`
      SELECT o.id, o.name, o.region_id, o.is_active, r.name as region_name, r.code as region_code
      FROM officers o
      JOIN regions r ON o.region_id = r.id
      ORDER BY o.name
    `).all();

    // Many-to-many: setiap petugas membawa daftar region yang ditanganinya
    const regionsStmt = db.prepare(`
      SELECT r.id, r.name, r.code
      FROM regions r
      JOIN officer_regions orr ON r.id = orr.region_id
      WHERE orr.officer_id = ?
      ORDER BY r.name
    `);
    for (const o of officers) {
      let regions = regionsStmt.all(o.id);
      // Fallback untuk baris lama yang belum termigrasi ke junction
      if (regions.length === 0) regions = [{ id: o.region_id, name: o.region_name, code: o.region_code }];
      o.regions = regions;
    }

    res.json(officers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch officers' });
  }
});

// Create officer
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { name, pin, regionId, regionIds } = req.body;
    const { v4: uuidv4 } = require('uuid');

    const hashedPin = bcrypt.hashSync(pin, 10);
    const id = uuidv4();

    // regionIds (banyak) untuk many-to-many; regionId tunggal = fallback lama
    const ids = Array.isArray(regionIds) && regionIds.length > 0
      ? regionIds.map(String)
      : [String(regionId)];

    db.prepare(`
      INSERT INTO officers (id, name, pin, region_id)
      VALUES (?, ?, ?, ?)
    `).run(id, name, hashedPin, ids[0]);

    const link = db.prepare(`INSERT OR IGNORE INTO officer_regions (officer_id, region_id) VALUES (?, ?)`);
    for (const rid of ids) link.run(id, rid);

    res.status(201).json({ id, name, regionIds: ids });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create officer' });
  }
});

// Atur banyak region untuk satu petugas (many-to-many)
router.put('/:id/regions', authenticate, requireAdmin, (req, res) => {
  try {
    const { regionIds } = req.body || {};
    if (!Array.isArray(regionIds) || regionIds.length === 0) {
      return res.status(400).json({ error: 'regionIds harus berupa array dan tidak kosong' });
    }

    const officer = db.prepare(`SELECT id FROM officers WHERE id = ?`).get(String(req.params.id));
    if (!officer) return res.status(404).json({ error: 'Officer not found' });

    db.prepare(`DELETE FROM officer_regions WHERE officer_id = ?`).run(String(req.params.id));
    const link = db.prepare(`INSERT OR IGNORE INTO officer_regions (officer_id, region_id) VALUES (?, ?)`);
    for (const rid of regionIds) link.run(String(req.params.id), String(rid));

    // officers.region_id (dipakai JWT & kompatibilitas lama) = region pertama
    db.prepare(`UPDATE officers SET region_id = ? WHERE id = ?`).run(String(regionIds[0]), String(req.params.id));

    res.json({ success: true, regionIds: regionIds.map(String) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update officer regions' });
  }
});

// Update officer PIN
router.put('/:id/pin', authenticate, requireAdmin, (req, res) => {
  try {
    const { pin } = req.body;
    const hashedPin = bcrypt.hashSync(pin, 10);

    db.prepare(`UPDATE officers SET pin = ? WHERE id = ?`).run(hashedPin, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update PIN' });
  }
});

// Toggle officer status
router.put('/:id/status', authenticate, requireAdmin, (req, res) => {
  try {
    const { isActive } = req.body;
    db.prepare(`UPDATE officers SET is_active = ? WHERE id = ?`).run(isActive ? 1 : 0, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Delete officer
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    db.prepare(`DELETE FROM officer_regions WHERE officer_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM officers WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete officer' });
  }
});

module.exports = router;
