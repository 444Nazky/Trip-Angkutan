const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Get all regions
router.get('/', (req, res) => {
  try {
    const regions = db.prepare(`SELECT * FROM regions ORDER BY name`).all();
    res.json(regions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch regions' });
  }
});

// Create region
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { name, code } = req.body;
    const { v4: uuidv4 } = require('uuid');

    const id = uuidv4();
    db.prepare(`INSERT INTO regions (id, name, code) VALUES (?, ?, ?)`).run(id, name, code);

    res.status(201).json({ id, name, code });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create region' });
  }
});

module.exports = router;
