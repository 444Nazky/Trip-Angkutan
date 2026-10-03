const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Daftar tarif region (gabungan region + baris konfigurasi lokal/eksternal)
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const regions = db.prepare(`
      SELECT r.id, r.name, r.code,
        (SELECT nominal_tariff FROM region_tariffs WHERE region_id = r.id AND tariff_type = 'lokal') as lokal_tariff,
        (SELECT is_active FROM region_tariffs WHERE region_id = r.id AND tariff_type = 'lokal') as lokal_active,
        (SELECT nominal_tariff FROM region_tariffs WHERE region_id = r.id AND tariff_type = 'eksternal') as eksternal_tariff,
        (SELECT is_active FROM region_tariffs WHERE region_id = r.id AND tariff_type = 'eksternal') as eksternal_active
      FROM regions r
      ORDER BY r.name
    `).all();
    res.json(regions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch region tariffs' });
  }
});

// Upsert satu tarif region: { regionId, tariffType: 'lokal'|'eksternal', nominalTariff, isActive }
router.put('/:regionId', authenticate, requireAdmin, (req, res) => {
  try {
    const { regionId } = req.params;
    const { tariffType, nominalTariff, isActive } = req.body || {};

    if (!['lokal', 'eksternal'].includes(tariffType)) {
      return res.status(400).json({ error: "tariffType harus 'lokal' atau 'eksternal'" });
    }

    const region = db.prepare(`SELECT id FROM regions WHERE id = ?`).get(regionId);
    if (!region) return res.status(404).json({ error: 'Region not found' });

    const existing = db.prepare(
      `SELECT * FROM region_tariffs WHERE region_id = ? AND tariff_type = ?`
    ).get(regionId, tariffType);

    const nominal = Number.isFinite(Number(nominalTariff)) ? Number(nominalTariff) : 0;
    const active = isActive === undefined ? 1 : (isActive ? 1 : 0);

    if (existing) {
      db.prepare(
        `UPDATE region_tariffs SET nominal_tariff = ?, is_active = ? WHERE id = ?`
      ).run(nominal, active, existing.id);
    } else {
      db.prepare(
        `INSERT INTO region_tariffs (id, region_id, tariff_type, nominal_tariff, is_active) VALUES (?, ?, ?, ?, ?)`
      ).run(`${regionId}:${tariffType}`, regionId, tariffType, nominal, active);
    }

    res.json({ success: true, regionId, tariffType, nominalTariff: nominal, isActive: active });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update region tariff' });
  }
});

module.exports = router;
