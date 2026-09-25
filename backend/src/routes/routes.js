const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

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
