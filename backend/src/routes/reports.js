const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

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
    sql += ' AND (t.route_from = ? OR t.route_to = ?)';
    params.push(route, route);
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
        rf.name as route_from_name, rf.code as route_from_code,
        rt.name as route_to_name, rt.code as route_to_code,
        (SELECT COUNT(*) FROM trip_vehicles tv WHERE tv.trip_id = t.id) as vehicle_count,
        (SELECT SUM(v.tariff_amount) FROM vehicles v WHERE v.trip_id = t.id) as trip_revenue
      FROM trips t
      JOIN regions r ON t.region_id = r.id
      LEFT JOIN regions rf ON rf.code = t.route_from
      LEFT JOIN regions rt ON rt.code = t.route_to
      LEFT JOIN officers o ON t.officer_id = o.id
      WHERE 1=1
    ` + filterSql + ' ORDER BY t.created_at DESC LIMIT 200';

    const trips = db.prepare(query).all(...params);

    // Attach full vehicle detail per trip (plat, jenis, golongan, kategori, tarif)
    const vehStmt = db.prepare(`
      SELECT v.no_polisi, v.vehicle_type, v.golongan, v.has_load, v.tariff_amount,
        tf.golongan as master_golongan
      FROM vehicles v
      LEFT JOIN tariffs tf ON tf.vehicle_type = v.vehicle_type
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

// Export trips as CSV (simple implementation) — revenue included, admin-only
router.get('/trips/export', authenticate, requireAdmin, (req, res) => {
  try {
    const { sql: filterSql, params } = buildFilters(req.query);

    const query = `
      SELECT t.no_trip, t.status_muatan, t.route_from, t.route_to, t.keterangan, t.created_at,
        r.name as region_name, r.code as region_code,
        rf.name as route_from_name, rt.name as route_to_name,
        o.name as officer_name,
        (SELECT COUNT(*) FROM trip_vehicles tv WHERE tv.trip_id = t.id) as vehicle_count,
        (SELECT SUM(v.tariff_amount) FROM vehicles v WHERE v.trip_id = t.id) as revenue
      FROM trips t
      JOIN regions r ON t.region_id = r.id
      LEFT JOIN regions rf ON rf.code = t.route_from
      LEFT JOIN regions rt ON rt.code = t.route_to
      LEFT JOIN officers o ON t.officer_id = o.id
      WHERE 1=1
    ` + filterSql + ' ORDER BY t.created_at DESC';

    const trips = db.prepare(query).all(...params);

    const headers = [
      'No Trip', 'Tanggal (WIB)', 'Tempat / Wilayah', 'Rute Asal', 'Rute Tujuan',
      'Petugas', 'Status Muatan', 'Kategori', 'Unit', 'Pendapatan'
    ];
    const rows = trips.map(t => [
      t.no_trip,
      t.created_at,
      t.region_name ? `${t.region_name} (${t.region_code})` : '',
      t.route_from_name ? `${t.route_from_name} (${t.route_from})` : (t.route_from || ''),
      t.route_to_name ? `${t.route_to_name} (${t.route_to})` : (t.route_to || ''),
      t.officer_name || '',
      t.status_muatan,
      t.keterangan || '-',
      t.vehicle_count,
      t.revenue || 0
    ]);

    const csv = [headers, ...rows].map(row =>
      row.map(cell => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=trips-report.csv');
    // BOM agar Excel membaca UTF-8 dengan benar
    res.send('\uFEFF' + csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export' });
  }
});

module.exports = router;
