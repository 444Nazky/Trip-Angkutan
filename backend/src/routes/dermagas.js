const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

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
