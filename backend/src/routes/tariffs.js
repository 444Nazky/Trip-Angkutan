const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Get all tariffs — price details are admin-only
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const tariffs = db.prepare(`
      SELECT * FROM tariffs WHERE is_active = 1 ORDER BY golongan, vehicle_type
    `).all();
    res.json(tariffs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tariffs' });
  }
});

// Create tariff
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { golongan, vehicleType, loadedTariff, emptyTariff, description } = req.body;

    const id = uuidv4();
    db.prepare(`
      INSERT INTO tariffs (id, golongan, vehicle_type, loaded_tariff, empty_tariff, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, golongan, vehicleType, loadedTariff, emptyTariff, description || '');

    res.status(201).json({ id, golongan, vehicleType, loadedTariff, emptyTariff, description: description || '' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create tariff' });
  }
});

// Update tariff — full row (admin form edits golongan/type/desc too, not just prices)
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const existing = db.prepare(`SELECT * FROM tariffs WHERE id = ?`).get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Tariff not found' });
    }

    const golongan = req.body.golongan ?? existing.golongan;
    const vehicleType = req.body.vehicleType ?? existing.vehicle_type;
    const loadedTariff = req.body.loadedTariff ?? existing.loaded_tariff;
    const emptyTariff = req.body.emptyTariff ?? existing.empty_tariff;
    const description = req.body.description ?? existing.description;
    const isActive = req.body.isActive === undefined ? existing.is_active : (req.body.isActive ? 1 : 0);

    db.prepare(`
      UPDATE tariffs
      SET golongan = ?, vehicle_type = ?, loaded_tariff = ?, empty_tariff = ?, description = ?, is_active = ?
      WHERE id = ?
    `).run(golongan, vehicleType, loadedTariff, emptyTariff, description, isActive, req.params.id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update tariff' });
  }
});

// Delete tariff
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const existing = db.prepare(`SELECT * FROM tariffs WHERE id = ?`).get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Tariff not found' });
    }

    db.prepare(`DELETE FROM tariffs WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete tariff' });
  }
});

module.exports = router;
