const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Get all vehicles — fleet database is admin-only
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const vehicles = db.prepare(`
      SELECT v.*, t.no_trip
      FROM vehicles v
      LEFT JOIN trips t ON v.trip_id = t.id
      ORDER BY v.created_at DESC
      LIMIT 100
    `).all();
    res.json(vehicles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

module.exports = router;
