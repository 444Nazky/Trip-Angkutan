const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Kode rute pada aplikasi mobile memakai 'BDAU', sedangkan kode region di
// database adalah 'BADAU'. Dipetakan agar nama tempat tampil akurat.
const ROUTE_CODE_ALIAS = { BDAU: 'BADAU' };

function placeNameSubquery(col) {
  return `(SELECT rg.name FROM regions rg
           WHERE rg.code = CASE ${col} WHEN 'BDAU' THEN 'BADAU' ELSE ${col} END
           LIMIT 1)`;
}

// Get summary stats — revenue reporting is admin-only
router.get('/summary', authenticate, requireAdmin, (req, res) => {
  try {
    const { startDate, endDate, regionId } = req.query;

    let dateFilter = '';
    const params = [];

    if (startDate && endDate) {
      dateFilter = 'AND DATE(t.created_at) BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    // Total trips
    const tripCount = db.prepare(`
      SELECT COUNT(*) as count FROM trips t
      WHERE 1=1 ${dateFilter}
    `).get(...params);

    // Total vehicles
    const vehicleCount = db.prepare(`
      SELECT COUNT(*) as count FROM vehicles v
      JOIN trips t ON v.trip_id = t.id
      WHERE 1=1 ${dateFilter}
    `).get(...params);

    // Total revenue (from external tariffs only)
    const revenue = db.prepare(`
      SELECT COALESCE(SUM(v.tariff_amount), 0) as total FROM vehicles v
      JOIN trips t ON v.trip_id = t.id
      WHERE v.golongan = 'Eksternal' ${dateFilter}
    `).get(...params);

    res.json({
      totalTrips: tripCount.count,
      totalVehicles: vehicleCount.count,
      totalRevenue: revenue.total
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Filter laporan bersama (dipakai /trips dan /trips/export) supaya hasilnya konsisten.
// - golongan     : cocokkan golongan master tarif (I..V) ATAU kolom golongan lama
// - vehicleType  : jenis kendaraan (Motor, Mobil, Truck ...)
function buildFilters(query) {
  const { startDate, endDate, route, golongan, vehicleType, status, regionId } = query;
  let sql = '';
  const params = [];

  if (startDate && endDate) {
    sql += ' AND DATE(t.created_at) BETWEEN ? AND ?';
    params.push(startDate, endDate);
  }

  if (route) {
    // Dukung kode rute mobile ('BDAU') maupun kode region ('BADAU')
    const alias = ROUTE_CODE_ALIAS[route] || route;
    const alt = Object.keys(ROUTE_CODE_ALIAS).find(k => ROUTE_CODE_ALIAS[k] === route) || route;
    const variants = Array.from(new Set([route, alias, alt]));
    sql += ` AND (${variants.map(() => '(t.route_from = ? OR t.route_to = ?)').join(' OR ')})`;
    for (const v of variants) params.push(v, v);
  }

  if (golongan) {
    sql += ` AND EXISTS (
      SELECT 1 FROM vehicles v
      LEFT JOIN tariffs tf ON tf.vehicle_type = v.vehicle_type
      WHERE v.trip_id = t.id AND (tf.golongan = ? OR v.golongan = ?)
    )`;
    params.push(golongan, golongan);
  }

  if (vehicleType) {
    sql += ' AND EXISTS (SELECT 1 FROM vehicles v WHERE v.trip_id = t.id AND v.vehicle_type = ?)';
    params.push(vehicleType);
  }

  if (status) {
    sql += ' AND t.status_muatan = ?';
    params.push(status);
  }

  if (regionId) {
    sql += ' AND t.region_id = ?';
    params.push(regionId);
  }

  return { sql, params };
}

// Get trips report — contains revenue, admin-only
// Menyertakan detail tempat (wilayah + asal/tujuan) dan waktu yang akurat.
router.get('/trips', authenticate, requireAdmin, (req, res) => {
  try {
    const { sql: filterSql, params } = buildFilters(req.query);

    let query = `
      SELECT t.*, r.name as region_name, r.code as region_code,
        o.name as officer_name,
        ${placeNameSubquery('t.route_from')} as route_from_name,
        ${placeNameSubquery('t.route_to')} as route_to_name,
        t.route_from as route_from_code, t.route_to as route_to_code,
        (SELECT COUNT(*) FROM trip_vehicles tv WHERE tv.trip_id = t.id) as vehicle_count,
        (SELECT SUM(v.tariff_amount) FROM vehicles v WHERE v.trip_id = t.id) as trip_revenue
      FROM trips t
      JOIN regions r ON t.region_id = r.id
      LEFT JOIN officers o ON t.officer_id = o.id
      WHERE 1=1
    ` + filterSql + ' ORDER BY t.created_at DESC LIMIT 200';

    const trips = db.prepare(query).all(...params);

    // Attach full vehicle detail and documentation per trip.
    const vehStmt = db.prepare(`
      SELECT v.id, v.no_polisi, v.vehicle_type, v.golongan, v.has_load, v.tariff_amount,
        v.foto_path, v.foto_captured_at, v.latitude, v.longitude,
        (SELECT tf.golongan FROM tariffs tf WHERE tf.vehicle_type = v.vehicle_type LIMIT 1) as master_golongan
      FROM vehicles v
      WHERE v.trip_id = ?
    `);
    for (const t of trips) {
      t.vehicles = vehStmt.all(t.id);
      if (t.trip_revenue == null) {
        t.trip_revenue = t.vehicles.reduce((s, v) => s + (v.tariff_amount || 0), 0);
      }
    }

    res.json(trips);
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// Rekapitulasi terpusat per wilayah operasional (region + dermaga).
// Trip dari petugas BERBEDA tetapi satu region/dermaga digabung jadi satu baris;
// Daftar opsi filter laporan (golongan + jenis kendaraan dari master tarif)
router.get('/trips/filters', authenticate, requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT golongan, vehicle_type FROM tariffs WHERE is_active = 1 ORDER BY golongan, vehicle_type
    `).all();

    const golongan = [];
    const vehicleTypes = [];
    for (const r of rows) {
      if (r.golongan && !golongan.includes(r.golongan)) golongan.push(r.golongan);
      if (r.vehicle_type && !vehicleTypes.includes(r.vehicle_type)) vehicleTypes.push(r.vehicle_type);
    }
    res.json({ golongan, vehicleTypes });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});

module.exports = router;
