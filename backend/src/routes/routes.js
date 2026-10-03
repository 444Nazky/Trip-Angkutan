const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Rute milik petugas yang sedang login — dipakai layar "Pilih Rute" mobile
// agar daftar rute selalu sinkron dengan Master Rute terbaru tanpa re-login.
router.get('/mine', authenticate, (req, res) => {
  try {
    const officerId = req.user && req.user.officerId;
    if (!officerId) {
      return res.status(403).json({ error: 'Officer access required' });
    }
    const rows = db.prepare(`
      SELECT r.id, r.name, r.route_from, r.route_to, r.distance, r.duration,
             d.id AS dermaga_id, d.name AS dermaga_name, d.code AS dermaga_code
      FROM officer_dermagas od
      JOIN dermagas d ON od.dermaga_id = d.id
      JOIN routes r ON r.dermaga_id = d.id
      WHERE od.officer_id = ?
      ORDER BY d.code, r.name
    `).all(String(officerId));
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch officer routes' });
  }
});

// Get all routes with dermaga info
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const routes = db.prepare(`
      SELECT r.*, d.name as dermaga_name, d.code as dermaga_code, reg.name as region_name
      FROM routes r
      JOIN dermagas d ON r.dermaga_id = d.id
      JOIN regions reg ON d.region_id = reg.id
      ORDER BY reg.name, d.name, r.name
    `).all();
    res.json(routes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
});

// Create route
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { dermaga_id, name, route_from, route_to, distance, duration } = req.body;
    const { v4: uuidv4 } = require('uuid');

    const id = uuidv4();
    db.prepare(`
      INSERT INTO routes (id, dermaga_id, name, route_from, route_to, distance, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, dermaga_id, name, route_from, route_to, distance || null, duration || null);

    const route = db.prepare(`SELECT * FROM routes WHERE id = ?`).get(id);
    res.status(201).json(route);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create route' });
  }
});

// Update route
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const { name, route_from, route_to, distance, duration } = req.body;
    db.prepare(`
      UPDATE routes SET name = ?, route_from = ?, route_to = ?, distance = ?, duration = ?
      WHERE id = ?
    `).run(name, route_from, route_to, distance || null, duration || null, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update route' });
  }
});

// Delete route
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    db.prepare(`DELETE FROM routes WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete route' });
  }
});

module.exports = router;
