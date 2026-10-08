const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const { authenticate } = require('../middleware/auth');

const photoExtension = (mimetype) => ({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}[mimetype]);

// Folder tujuan foto harus sama dengan yang disajikan static server
// (satu konstanta di backend/src/uploads-dir.js)
const { UPLOADS_DIR } = require('../uploads-dir');
const uploadDocumentation = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, `${uuidv4()}${photoExtension(file.mimetype) || '.jpg'}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 50 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

const validPhotoIndex = (value, files) =>
  value === null || value === undefined
    ? null
    : Number.isInteger(value) && value >= 0 && value < files.length ? value : undefined;

const numericCoordinate = (value) => Number.isFinite(value) ? value : null;

// Generate trip number
function generateTripNo() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TRP${dateStr}${random}`;
}

// Create a trip with its complete photo manifest in one multipart request.
router.post('/complete', authenticate, uploadDocumentation.array('photos', 50), (req, res) => {
  const files = req.files || [];
  const writtenFiles = files.map(file => file.path);
  const cleanupFiles = () => writtenFiles.forEach(filePath => {
    try { fs.unlinkSync(filePath); } catch { /* already removed */ }
  });
  try {
    const payload = JSON.parse(req.body.payload || '{}');
    const vehicles = Array.isArray(payload.vehicles) ? payload.vehicles : [];
    if (!payload.statusMuatan) {
      cleanupFiles();
      return res.status(400).json({ error: 'statusMuatan wajib diisi' });
    }

    // IDEMPOTEN / UPSERT: klien mengirim `clientTripId` (ID trip di perangkat).
    // Bila trip dengan id ini SUDAH ada — baik karena antrean dikirim ulang
    // setelah timeout, maupun karena petugas MENGEDIT trip yang sudah terkirim
    // (ganti plat / ambil ulang foto) — perbarui trip lama, JANGAN insert duplikat.
    // Ini yang membuat hasil edit sampai ke dashboard admin.
    const clientTripId = typeof payload.clientTripId === 'string' ? payload.clientTripId.trim() : '';
    const existingTrip = clientTripId
      ? db.prepare(`SELECT id, no_trip FROM trips WHERE client_trip_id = ? LIMIT 1`).get(clientTripId)
      : undefined;

    const tripPhotoIndex = validPhotoIndex(payload.tripPhotoIndex, files);
    const vehiclePhotoIndexes = vehicles.map(vehicle => validPhotoIndex(vehicle.photoIndex, files));
    if (tripPhotoIndex === null || tripPhotoIndex === undefined || vehiclePhotoIndexes.some(index => index === null || index === undefined)) {
      cleanupFiles();
      return res.status(400).json({ error: 'Semua foto dokumentasi wajib disertakan' });
    }
    const usedIndexes = [tripPhotoIndex, ...vehiclePhotoIndexes];
    if (new Set(usedIndexes).size !== files.length) {
      cleanupFiles();
      return res.status(400).json({ error: 'Payload harus menyertakan seluruh foto dokumentasi tepat satu kali' });
    }

    const { officerId, regionId } = req.officer;
    const dermagaId =
      req.body.dermagaId ||
      (db.prepare(`SELECT dermaga_id FROM officer_dermagas WHERE officer_id = ? LIMIT 1`).get(officerId)?.dermaga_id) ||
      (db.prepare(`SELECT id FROM dermagas WHERE region_id = ? LIMIT 1`).get(regionId)?.id) ||
      (db.prepare(`SELECT id FROM dermagas LIMIT 1`).get()?.id) || null;

    const photoPaths = files.map(file => `/uploads/${file.filename}`);

    const tripId = existingTrip ? existingTrip.id : uuidv4();
    const noTrip = existingTrip ? existingTrip.no_trip : generateTripNo();

    const insertVehicle = (vehicle, index, id) => {
      const masterTariff = db.prepare(`
        SELECT * FROM tariffs WHERE vehicle_type = ? AND is_active = 1 LIMIT 1
      `).get(vehicle.vehicleType);
      const amount = masterTariff
        ? (vehicle.hasLoad ? masterTariff.loaded_tariff : masterTariff.empty_tariff)
        : (vehicle.tariffAmount || 0);
      const photoIndex = vehiclePhotoIndexes[index];
      db.prepare(`
        INSERT INTO vehicles (
          id, no_polisi, vehicle_type, golongan, trip_id, has_load, tariff_id,
          tariff_amount, foto_path, foto_captured_at, latitude, longitude
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, vehicle.noPolisi, vehicle.vehicleType, vehicle.golongan, tripId,
        vehicle.hasLoad ? 1 : 0, masterTariff ? masterTariff.id : null, amount,
        photoPaths[photoIndex], vehicle.photoCapturedAt || null,
        numericCoordinate(vehicle.latitude), numericCoordinate(vehicle.longitude)
      );
      db.prepare(`INSERT INTO trip_vehicles (id, trip_id, vehicle_id) VALUES (?, ?, ?)`)
        .run(uuidv4(), tripId, id);
    };

    if (existingTrip) {
      // ── PERBARUI trip yang sudah ada (edit pasca-kirim / retry) ──────────────
      db.prepare(`
        UPDATE trips SET
          status_muatan = ?, route_from = ?, route_to = ?, keterangan = ?,
          foto_kosong_path = ?, foto_captured_at = ?, foto_latitude = ?, foto_longitude = ?,
          started_at = ?, completed_at = ?
        WHERE id = ?
      `).run(
        payload.statusMuatan, payload.routeFrom || null, payload.routeTo || null, payload.keterangan || null,
        photoPaths[tripPhotoIndex], payload.tripPhotoCapturedAt || null,
        numericCoordinate(payload.tripPhotoLatitude), numericCoordinate(payload.tripPhotoLongitude),
        payload.startedAt || null, payload.completedAt || null, tripId
      );
      // Ganti seluruh kendaraan lama dengan yang baru (foto & plat terbaru).
      const oldVehicles = db.prepare(`SELECT vehicle_id FROM trip_vehicles WHERE trip_id = ?`).all(tripId);
      for (const row of oldVehicles) {
        db.prepare(`DELETE FROM trip_vehicles WHERE trip_id = ? AND vehicle_id = ?`).run(tripId, row.vehicle_id);
        db.prepare(`DELETE FROM vehicles WHERE id = ?`).run(row.vehicle_id);
      }
      vehicles.forEach((vehicle, index) => insertVehicle(vehicle, index, uuidv4()));
      return res.status(200).json({ id: tripId, noTrip, updated: true });
    }

    // ── INSERT trip baru ─────────────────────────────────────────────────────
    db.prepare(`
      INSERT INTO trips (
        id, no_trip, officer_id, region_id, dermaga_id, status_muatan,
        route_from, route_to, keterangan, foto_kosong_path, foto_captured_at,
        foto_latitude, foto_longitude, started_at, completed_at, client_trip_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tripId, noTrip, officerId, regionId, dermagaId, payload.statusMuatan,
      payload.routeFrom || null, payload.routeTo || null, payload.keterangan || null,
      photoPaths[tripPhotoIndex], payload.tripPhotoCapturedAt || null,
      numericCoordinate(payload.tripPhotoLatitude), numericCoordinate(payload.tripPhotoLongitude),
      payload.startedAt || null, payload.completedAt || null, clientTripId || null
    );

    vehicles.forEach((vehicle, index) => insertVehicle(vehicle, index, uuidv4()));

    return res.status(201).json({ id: tripId, noTrip });
  } catch (error) {
    cleanupFiles();
    console.error('Complete trip submission error:', error);
    return res.status(500).json({ error: 'Failed to submit complete trip documentation' });
  }
});

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
        t.foto_kosong_path as photo_url,
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
