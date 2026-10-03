const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Normalisasi plat: "b 1234 xy" → "B1234XY" (pencocokan tanpa spasi/prefix)
function normalizePlate(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Tarif dari konfigurasi terpusat region_tariffs (region pos & jenis).
// Tidak ada baris / non-aktif → 0 (kebijakan "gratis").
function tariffForRegion(regionId, jenisTarif) {
  if (!regionId) return 0;
  const row = db.prepare(
    `SELECT * FROM region_tariffs WHERE region_id = ? AND tariff_type = ? LIMIT 1`
  ).get(regionId, jenisTarif);
  if (!row || !row.is_active) return 0;
  return row.nominal_tariff || 0;
}

// List plat terdaftar (admin) — ?plate= untuk filter
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { plate } = req.query;
    let query = `
      SELECT p.*, r.code as origin_region_code, r.name as origin_region_name
      FROM vehicle_plates p
      LEFT JOIN regions r ON p.origin_region_id = r.id
    `;
    const params = [];
    if (plate) {
      query += ` WHERE REPLACE(UPPER(p.plate), ' ', '') = ?`;
      params.push(normalizePlate(plate));
    }
    query += ` ORDER BY p.plate`;
    res.json(db.prepare(query).all(...params));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch plates' });
  }
});

// Registrasi plat baru (admin)
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { plate, owner, originRegionId, status } = req.body || {};
    const norm = normalizePlate(plate);
    if (!norm) return res.status(400).json({ error: 'Nomor plat wajib diisi' });

    const dup = db.prepare(
      `SELECT id FROM vehicle_plates WHERE REPLACE(UPPER(plate), ' ', '') = ?`
    ).get(norm);
    if (dup) return res.status(409).json({ error: 'Plat sudah terdaftar' });

    const id = uuidv4();
    const st = ['internal', 'lokal', 'eksternal'].includes(status) ? status : 'internal';
    db.prepare(`
      INSERT INTO vehicle_plates (id, plate, owner, origin_region_id, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, String(plate).trim().toUpperCase(), owner || null, originRegionId || null, st);

    res.status(201).json({ id, plate: String(plate).trim().toUpperCase(), status: st });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create plate' });
  }
});

// Edit plat (admin)
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const existing = db.prepare(`SELECT * FROM vehicle_plates WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Plate not found' });

    const { plate, owner, originRegionId, status, isActive } = req.body || {};
    const norm = plate != null ? normalizePlate(plate) : null;
    if (plate != null && !norm) return res.status(400).json({ error: 'Nomor plat wajib diisi' });

    if (norm) {
      const dup = db.prepare(
        `SELECT id FROM vehicle_plates WHERE REPLACE(UPPER(plate), ' ', '') = ? AND id != ?`
      ).get(norm, req.params.id);
      if (dup) return res.status(409).json({ error: 'Plat sudah terdaftar' });
    }

    const st = ['internal', 'lokal', 'eksternal'].includes(status) ? status : existing.status;
    db.prepare(`
      UPDATE vehicle_plates
      SET plate = ?, owner = ?, origin_region_id = ?, status = ?, is_active = ?
      WHERE id = ?
    `).run(
      plate != null ? String(plate).trim().toUpperCase() : existing.plate,
      owner !== undefined ? (owner || null) : existing.owner,
      originRegionId !== undefined ? (originRegionId || null) : existing.origin_region_id,
      st,
      isActive === undefined ? existing.is_active : (isActive ? 1 : 0),
      req.params.id
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update plate' });
  }
});

// Hapus plat (admin)
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const existing = db.prepare(`SELECT id FROM vehicle_plates WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Plate not found' });
    db.prepare(`DELETE FROM vehicle_plates WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete plate' });
  }
});

// ── Cek plat (petugas) ──────────────────────────────────────────────────────
// Region pos pemeriksaan = region petugas dari JWT (req.user.regionId).
// Aturan:
//   terdaftar 'internal'           → internal, tarif 0
//   tidak terdaftar & asal = pos   → lokal    → tarif konfigurasi LOKAL pos
//   tidak terdaftar & asal ≠ pos   → eksternal→ tarif konfigurasi EKSTERNAL pos
//   terdaftar 'lokal'/'eksternal'  → status menurut registrasi
// Semua hasil scan dicatat ke plate_scans.
router.post('/check', authenticate, (req, res) => {
  try {
    const { plate, originRegionId } = req.body || {};
    const norm = normalizePlate(plate);
    if (!norm) return res.status(400).json({ error: 'Nomor plat wajib diisi' });

    const checkpointRegionId = req.user.regionId || null;

    const rows = db.prepare(`SELECT * FROM vehicle_plates WHERE is_active = 1`).all();
    const registered = rows.find(r => normalizePlate(r.plate) === norm);

    let status;
    let origin;
    if (registered && registered.status === 'internal') {
      status = 'internal';
      origin = registered.origin_region_id || checkpointRegionId;
    } else if (registered && registered.status) {
      status = registered.status;
      origin = registered.origin_region_id || originRegionId || checkpointRegionId;
      // Registered as lokal but origin differs from pos → still follow origin rule
      if (status === 'lokal' && origin && checkpointRegionId && origin !== checkpointRegionId) {
        status = 'eksternal';
      }
    } else {
      // Tidak terdaftar: region asal dari input petugas, default = region pos (lokal)
      origin = originRegionId || checkpointRegionId;
      status = origin && checkpointRegionId && origin !== checkpointRegionId ? 'eksternal' : 'lokal';
    }

    const jenisTarif = status === 'internal' ? null : status;
    const tariffAmount = jenisTarif ? tariffForRegion(checkpointRegionId, jenisTarif) : 0;

    // Catat transaksi scan (jejak audit penarifan)
    try {
      db.prepare(`
        INSERT INTO plate_scans (id, plate, status, origin_region_id, checkpoint_region_id, tariff_amount, officer_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), norm, status, origin, checkpointRegionId, tariffAmount, req.user.officerId ?? null);
    } catch (e) { /* log boleh gagal tanpa membatalkan check */ }

    const originRow = origin ? db.prepare(`SELECT code FROM regions WHERE id = ?`).get(origin) : null;
    const cpRow = checkpointRegionId
      ? db.prepare(`SELECT code FROM regions WHERE id = ?`).get(checkpointRegionId)
      : null;

    res.json({
      found: !!registered,
      plate: registered ? registered.plate : norm,
      owner: registered ? registered.owner : null,
      status,
      jenisTarif,
      originRegionId: origin,
      originRegionCode: originRow ? originRow.code : null,
      checkpointRegionId,
      checkpointRegionCode: cpRow ? cpRow.code : null,
      tariffAmount,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check plate' });
  }
});

module.exports = router;
