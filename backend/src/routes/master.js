const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate } = require('../middleware/auth');



/**
 * Master data yang dibaca HP petugas lapangan.
 *
 * Beda dengan /api/tariffs (khusus admin, requireAdmin): di sini cukup token
 * petugas yang valid. Petugas harus menyimpan tarif di perangkatnya supaya
 * nominal muatan/kosong tetap benar saat sinyal hilang — sebelumnya tarif hanya
 * hidup di sisi admin, jadi HP jatuh ke angka contoh di data.ts.
 */
router.get('/tariffs', authenticate, (req, res) => {
  try {
    const tariffs = db.prepare(`
      SELECT id, golongan, vehicle_type, loaded_tariff, empty_tariff, description
      FROM tariffs
      WHERE is_active = 1
      ORDER BY golongan, vehicle_type
    `).all();
    res.json(tariffs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tariffs' });
  }
});



module.exports = router;
