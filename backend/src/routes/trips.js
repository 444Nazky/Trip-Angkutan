const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');




const router = express.Router();
const { randomUUID } = require('crypto');
const { db } = require('../db');
const { authenticate } = require('../middleware/auth');




const photoExtension = (mimetype) => ({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}[mimetype]);

const { UPLOADS_DIR } = require('../uploads-dir');
const uploadDocumentation = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${photoExtension(file.mimetype) || '.jpg'}`),
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




function generateTripNo() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = require('crypto').randomBytes(4).toString('hex').toUpperCase();
  return `TRP${dateStr}${random}`;
}




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

    const clientTripId = typeof payload.clientTripId === 'string' && payload.clientTripId.trim()
      ? payload.clientTripId.trim()
      : null;
    if (clientTripId) {
      const existing = db.prepare(
        `SELECT id, no_trip FROM trips WHERE client_trip_id = ? LIMIT 1`,
      ).get(clientTripId);
      if (existing) {
        const tripPhotoIndexDup = validPhotoIndex(payload.tripPhotoIndex, files);
        const vehiclePhotoIndexesDup = vehicles.map(v => validPhotoIndex(v.photoIndex, files));
        if (tripPhotoIndexDup === null || tripPhotoIndexDup === undefined ||
            vehiclePhotoIndexesDup.some(i => i === null || i === undefined) ||
            new Set([tripPhotoIndexDup, ...vehiclePhotoIndexesDup]).size !== files.length) {
          cleanupFiles();
          return res.status(400).json({ error: 'Payload duplikat tidak valid' });
        }

        const oldVehicleRows = db.prepare(`SELECT foto_path FROM vehicles WHERE trip_id = ?`).all(existing.id);
        const oldTrip = db.prepare(`SELECT foto_kosong_path FROM trips WHERE id = ?`).get(existing.id);
        const oldPaths = [oldTrip?.foto_kosong_path, ...oldVehicleRows.map(r => r.foto_path)].filter(Boolean);
        const photoPathsDup = files.map(file => `/uploads/${file.filename}`);

        const { officerId, regionId } = req.officer;
        const dermagaId =
          req.body.dermagaId ||
          (db.prepare(`SELECT dermaga_id FROM officer_dermagas WHERE officer_id = ? LIMIT 1`).get(officerId)?.dermaga_id) ||
          (db.prepare(`SELECT id FROM dermagas WHERE region_id = ? LIMIT 1`).get(regionId)?.id) ||
          (db.prepare(`SELECT id FROM dermagas LIMIT 1`).get()?.id) || null;

        db.transaction(() => {
          db.prepare(`
            UPDATE trips SET status_muatan=?, route_from=?, route_to=?, keterangan=?,
              dermaga_id=?, foto_kosong_path=?, foto_captured_at=?, foto_latitude=?, foto_longitude=?,
              started_at=?, completed_at=?
            WHERE id=?
          `).run(
            payload.statusMuatan, payload.routeFrom || null, payload.routeTo || null, payload.keterangan || null,
            dermagaId, photoPathsDup[tripPhotoIndexDup], payload.tripPhotoCapturedAt || null,
            numericCoordinate(payload.tripPhotoLatitude), numericCoordinate(payload.tripPhotoLongitude),
            payload.startedAt || null, payload.completedAt || null, existing.id,
          );
          db.prepare(`DELETE FROM trip_vehicles WHERE trip_id = ?`).run(existing.id);
          db.prepare(`DELETE FROM vehicles WHERE trip_id = ?`).run(existing.id);
          vehicles.forEach((vehicle, index) => {
            const masterTariff = db.prepare(`
              SELECT * FROM tariffs WHERE vehicle_type = ? AND is_active = 1 LIMIT 1
            `).get(vehicle.vehicleType);
            const amount = masterTariff
              ? (vehicle.hasLoad ? masterTariff.loaded_tariff : masterTariff.empty_tariff)
              : (vehicle.tariffAmount || 0);
            const vehicleId = randomUUID();
            const photoIndex = vehiclePhotoIndexesDup[index];
            db.prepare(`
              INSERT INTO vehicles (
                id, no_polisi, vehicle_type, golongan, trip_id, has_load, tariff_id,
                tariff_amount, foto_path, foto_captured_at, latitude, longitude
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              vehicleId, vehicle.noPolisi, vehicle.vehicleType, vehicle.golongan, existing.id,
              vehicle.hasLoad ? 1 : 0, masterTariff ? masterTariff.id : null, amount,
              photoPathsDup[photoIndex], vehicle.photoCapturedAt || null,
              numericCoordinate(vehicle.latitude), numericCoordinate(vehicle.longitude)
            );
            db.prepare(`INSERT INTO trip_vehicles (id, trip_id, vehicle_id) VALUES (?, ?, ?)`)
              .run(randomUUID(), existing.id, vehicleId);
          });
        })();
        for (const p of oldPaths) {
          try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(p))); } catch { /* ignore */ }
        }
        return res.status(200).json({ id: existing.id, noTrip: existing.no_trip, updated: true });
      }
    }

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

    const tripId = randomUUID();
    const noTrip = generateTripNo();
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
      payload.startedAt || null, payload.completedAt || null, clientTripId
    );

    vehicles.forEach((vehicle, index) => {
      const masterTariff = db.prepare(`
        SELECT * FROM tariffs WHERE vehicle_type = ? AND is_active = 1 LIMIT 1
      `).get(vehicle.vehicleType);
      const amount = (typeof vehicle.tariffAmount === 'number' && vehicle.tariffAmount > 0)
        ? vehicle.tariffAmount
        : (masterTariff
            ? (vehicle.hasLoad ? masterTariff.loaded_tariff : masterTariff.empty_tariff)
            : 0);
      const vehicleId = randomUUID();
      const photoIndex = vehiclePhotoIndexes[index];
      db.prepare(`
        INSERT INTO vehicles (
          id, no_polisi, vehicle_type, golongan, trip_id, has_load, tariff_id,
          tariff_amount, foto_path, foto_captured_at, latitude, longitude
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        vehicleId, vehicle.noPolisi, vehicle.vehicleType, vehicle.golongan, tripId,
        vehicle.hasLoad ? 1 : 0, masterTariff ? masterTariff.id : null, amount,
        photoPaths[photoIndex], vehicle.photoCapturedAt || null,
        numericCoordinate(vehicle.latitude), numericCoordinate(vehicle.longitude)
      );
      db.prepare(`INSERT INTO trip_vehicles (id, trip_id, vehicle_id) VALUES (?, ?, ?)`)
        .run(randomUUID(), tripId, vehicleId);
    });

    return res.status(201).json({ id: tripId, noTrip });
  } catch (error) {
    cleanupFiles();
    console.error('Complete trip submission error:', error);
    return res.status(500).json({ error: 'Failed to submit complete trip documentation' });
  }
});




router.post('/', authenticate, (req, res) => {
  try {
    const { statusMuatan, routeFrom, routeTo, keterangan, fotoKosongPath } = req.body;
    const { officerId, regionId } = req.officer;

    if (!statusMuatan) {
      return res.status(400).json({ error: 'statusMuatan wajib diisi' });
    }

    const tripId = randomUUID();
    const noTrip = generateTripNo();

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




module.exports = router;
