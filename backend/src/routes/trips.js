const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const { authenticate } = require('../middleware/auth');

// Generate trip number
function generateTripNo() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TRP${dateStr}${random}`;
}

// Create trip
router.post('/', authenticate, (req, res) => {
  try {
    const { statusMuatan, routeFrom, routeTo, keterangan, fotoKosongPath } = req.body;
    const { officerId, regionId } = req.officer;

    if (!statusMuatan) {
      return res.status(400).json({ error: 'statusMuatan wajib diisi' });
    }

    const tripId = uuidv4();
    const noTrip = generateTripNo();

    // trips.dermaga_id wajib terisi, tapi klien mobile tidak pernah mengirim
    // dermaga (layar mobile tidak memilih dermaga). Ambil dari penugasan
    // petugas, lalu fallback ke dermaga mana pun di region-nya, terakhir null
    // (kolom kini nullable — lihat migrasi di db.js).
    const dermagaId =
      req.body.dermagaId ||
      (db.prepare(`SELECT dermaga_id FROM officer_dermagas WHERE officer_id = ? LIMIT 1`).get(officerId)?.dermaga_id) ||
      (db.prepare(`SELECT id FROM dermagas WHERE region_id = ? LIMIT 1`).get(regionId)?.id) ||
      (db.prepare(`SELECT id FROM dermagas LIMIT 1`).get()?.id) ||
      null;

    db.prepare(`
      INSERT INTO trips (id, no_trip, officer_id, region_id, dermaga_id, status_muatan, route_from, route_to, keterangan, foto_kosong_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tripId, noTrip, officerId, regionId, dermagaId, statusMuatan, routeFrom, routeTo, keterangan, fotoKosongPath);

    res.status(201).json({ id: tripId, noTrip });
  } catch (error) {
    console.error('Create trip error:', error);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

// Add vehicle to trip
router.post('/:tripId/vehicles', authenticate, (req, res) => {
  try {
    const { tripId } = req.params;
    const { noPolisi, vehicleType, golongan, hasLoad, tariffAmount, fotoPath, latitude, longitude } = req.body;

    // Prices are owned by admins: the server computes the amount from the
    // master tariff whenever the vehicle type matches. The client-sent
    // amount is only a fallback (legacy/offline data).
    const masterTariff = db.prepare(`
      SELECT * FROM tariffs WHERE vehicle_type = ? AND is_active = 1 LIMIT 1
    `).get(vehicleType);

    const amount = masterTariff
      ? (hasLoad ? masterTariff.loaded_tariff : masterTariff.empty_tariff)
      : (tariffAmount || 0);

    const vehicleId = uuidv4();
    db.prepare(`
      INSERT INTO vehicles (id, no_polisi, vehicle_type, golongan, trip_id, has_load, tariff_id, tariff_amount, foto_path, latitude, longitude)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vehicleId, noPolisi, vehicleType, golongan, tripId,
      hasLoad ? 1 : 0, masterTariff ? masterTariff.id : null, amount,
      fotoPath, latitude, longitude
    );

    // Link to trip
    db.prepare(`
      INSERT INTO trip_vehicles (id, trip_id, vehicle_id)
      VALUES (?, ?, ?)
    `).run(uuidv4(), tripId, vehicleId);

    res.status(201).json({ id: vehicleId, noPolisi });
  } catch (error) {
    console.error('Add vehicle error:', error);
    res.status(500).json({ error: 'Failed to add vehicle' });
  }
});

// Get trips — officers see their region, admins see everything
router.get('/', authenticate, (req, res) => {
  try {
    const { regionId, role } = req.officer;
    const { date } = req.query;

    const isAdmin = role === 'admin';

    let query = `
      SELECT t.*,
        o.name as officer_name,
        r.code as region_code,
        (SELECT COUNT(*) FROM trip_vehicles tv WHERE tv.trip_id = t.id) as vehicle_count
      FROM trips t
      LEFT JOIN officers o ON t.officer_id = o.id
      LEFT JOIN regions r ON t.region_id = r.id
      WHERE ${isAdmin ? '1 = 1' : 't.region_id = ?'}
    `;
    const params = isAdmin ? [] : [regionId];

    if (date) {
      query += ` AND DATE(t.created_at) = ?`;
      params.push(date);
    }

    query += ` ORDER BY t.created_at DESC LIMIT 100`;

    const trips = db.prepare(query).all(...params);
    res.json(trips);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
});

// Get trip detail
router.get('/:id', authenticate, (req, res) => {
  try {
    const trip = db.prepare(`
      SELECT t.*, o.name as officer_name
      FROM trips t
      JOIN officers o ON t.officer_id = o.id
      WHERE t.id = ?
    `).get(req.params.id);

    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const vehicles = db.prepare(`
      SELECT v.*, tv.id as trip_vehicle_id
      FROM vehicles v
      JOIN trip_vehicles tv ON v.id = tv.vehicle_id
      WHERE tv.trip_id = ?
    `).all(req.params.id);

    res.json({ ...trip, vehicles });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch trip' });
  }
});

module.exports = router;
