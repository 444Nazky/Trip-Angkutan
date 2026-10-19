/**
 * Trips Routes - Supabase Version
 * Replace sql.js with @supabase/supabase-js
 */

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
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
    filename: (_req, file, cb) => cb(null, `${helpers.uuid()}${photoExtension(file.mimetype) || '.jpg'}`),
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

// ============================================
// COMPLETE TRIP (POST /api/trips/complete)
// ============================================

router.post('/complete', authenticate, uploadDocumentation.array('photos', 50), async (req, res) => {
  const files = req.files || [];
  const writtenFiles = files.map(file => file.path);
  const cleanupFiles = () => writtenFiles.forEach(filePath => {
    try { fs.unlinkSync(filePath); } catch {}
  });

  try {
    const payload = JSON.parse(req.body.payload || '{}');
    const vehicles = Array.isArray(payload.vehicles) ? payload.vehicles : [];

    if (!payload.statusMuatan) {
      cleanupFiles();
      return res.status(400).json({ error: 'statusMuatan wajib diisi' });
    }

    const clientTripId = typeof payload.clientTripId === 'string' ? payload.clientTripId.trim() : '';

    // Check for existing trip
    let existingTrip = null;
    if (clientTripId) {
      const { data } = await (supabaseAdmin || supabase)
        .from('trips')
        .select('id, no_trip')
        .eq('client_trip_id', clientTripId)
        .eq('officer_id', String(req.user?.officerId ?? ''))
        .limit(1);
      existingTrip = data?.[0];
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

    const { officerId, regionId } = req.user;
    const client = supabaseAdmin || supabase;

    // Get officer's dermaga
    let dermagaId = req.body.dermagaId;
    if (!dermagaId) {
      const { data: od } = await client
        .from('officer_dermagas')
        .select('dermaga_id')
        .eq('officer_id', officerId)
        .limit(1);
      if (od?.[0]) {
        dermagaId = od[0].dermaga_id;
      } else {
        const { data: d } = await client
          .from('dermagas')
          .select('id')
          .eq('region_id', regionId)
          .limit(1);
        dermagaId = d?.[0]?.id;
      }
    }

    const photoPaths = files.map(file => `/uploads/${file.filename}`);
    const tripId = existingTrip ? existingTrip.id : helpers.uuid();
    const noTrip = existingTrip ? existingTrip.no_trip : helpers.generateTripNo();

    if (existingTrip) {
      // Update existing trip
      await client
        .from('trips')
        .update({
          status_muatan: payload.statusMuatan,
          route_from: payload.routeFrom || null,
          route_to: payload.routeTo || null,
          keterangan: payload.keterangan || null,
          foto_kosong_path: photoPaths[tripPhotoIndex],
          foto_captured_at: payload.tripPhotoCapturedAt || null,
          foto_latitude: numericCoordinate(payload.tripPhotoLatitude),
          foto_longitude: numericCoordinate(payload.tripPhotoLongitude),
          started_at: payload.startedAt || null,
          completed_at: payload.completedAt || null,
        })
        .eq('id', tripId);

      // Delete old vehicles
      const { data: oldVehicles } = await client
        .from('trip_vehicles')
        .select('vehicle_id')
        .eq('trip_id', tripId);

      if (oldVehicles?.length) {
        await client
          .from('trip_vehicles')
          .delete()
          .eq('trip_id', tripId);

        for (const row of oldVehicles) {
          await client.from('vehicles').delete().eq('id', row.vehicle_id);
        }
      }

      // Insert new vehicles
      for (let i = 0; i < vehicles.length; i++) {
        const vehicle = vehicles[i];
        const vehicleId = helpers.uuid();
        const photoIndex = vehiclePhotoIndexes[i];

        // Get tariff
        const tariff = await helpers.getTariff(vehicle.vehicleType);
        const amount = (typeof vehicle.tariffAmount === 'number' && vehicle.tariffAmount > 0)
          ? vehicle.tariffAmount
          : (tariff ? (vehicle.hasLoad ? tariff.loaded_tariff : tariff.empty_tariff) : 0);

        // Insert vehicle
        const { data: newVehicle } = await client
          .from('vehicles')
          .insert({
            id: vehicleId,
            no_polisi: vehicle.noPolisi,
            vehicle_type: vehicle.vehicleType,
            golongan: vehicle.golongan,
            trip_id: tripId,
            has_load: vehicle.hasLoad ? 1 : 0,
            tariff_id: tariff?.id || null,
            tariff_amount: amount,
            foto_path: photoPaths[photoIndex],
            foto_captured_at: vehicle.photoCapturedAt || null,
            latitude: numericCoordinate(vehicle.latitude),
            longitude: numericCoordinate(vehicle.longitude),
          })
          .select('id')
          .single();

        // Link vehicle to trip
        if (newVehicle) {
          await client
            .from('trip_vehicles')
            .insert({ id: helpers.uuid(), trip_id: tripId, vehicle_id: vehicleId });
        }
      }

      return res.status(200).json({ id: tripId, noTrip, updated: true });
    }

    // Insert new trip
    await client
      .from('trips')
      .insert({
        id: tripId,
        no_trip: noTrip,
        officer_id: officerId,
        region_id: regionId,
        dermaga_id: dermagaId || null,
        status_muatan: payload.statusMuatan,
        route_from: payload.routeFrom || null,
        route_to: payload.routeTo || null,
        keterangan: payload.keterangan || null,
        foto_kosong_path: photoPaths[tripPhotoIndex],
        foto_captured_at: payload.tripPhotoCapturedAt || null,
        foto_latitude: numericCoordinate(payload.tripPhotoLatitude),
        foto_longitude: numericCoordinate(payload.tripPhotoLongitude),
        started_at: payload.startedAt || null,
        completed_at: payload.completedAt || null,
        client_trip_id: clientTripId || null,
      });

    // Insert vehicles
    for (let i = 0; i < vehicles.length; i++) {
      const vehicle = vehicles[i];
      const vehicleId = helpers.uuid();
      const photoIndex = vehiclePhotoIndexes[i];

      const tariff = await helpers.getTariff(vehicle.vehicleType);
      const amount = (typeof vehicle.tariffAmount === 'number' && vehicle.tariffAmount > 0)
        ? vehicle.tariffAmount
        : (tariff ? (vehicle.hasLoad ? tariff.loaded_tariff : tariff.empty_tariff) : 0);

      await client
        .from('vehicles')
        .insert({
          id: vehicleId,
          no_polisi: vehicle.noPolisi,
          vehicle_type: vehicle.vehicleType,
          golongan: vehicle.golongan,
          trip_id: tripId,
          has_load: vehicle.hasLoad ? 1 : 0,
          tariff_id: tariff?.id || null,
          tariff_amount: amount,
          foto_path: photoPaths[photoIndex],
          foto_captured_at: vehicle.photoCapturedAt || null,
          latitude: numericCoordinate(vehicle.latitude),
          longitude: numericCoordinate(vehicle.longitude),
        });

      await client
        .from('trip_vehicles')
        .insert({ id: helpers.uuid(), trip_id: tripId, vehicle_id: vehicleId });
    }

    return res.status(201).json({ id: tripId, noTrip });
  } catch (error) {
    cleanupFiles();
    console.error('Complete trip submission error:', error);
    return res.status(500).json({ error: 'Failed to submit complete trip documentation' });
  }
});

// ============================================
// CREATE TRIP (POST /api/trips)
// ============================================

router.post('/', authenticate, async (req, res) => {
  try {
    const { statusMuatan, routeFrom, routeTo, keterangan, fotoKosongPath } = req.body;
    const { officerId, regionId } = req.user;

    if (!statusMuatan) {
      return res.status(400).json({ error: 'statusMuatan wajib diisi' });
    }

    const tripId = helpers.uuid();
    const noTrip = helpers.generateTripNo();
    const client = supabaseAdmin || supabase;

    // Get officer's dermaga
    let dermagaId = req.body.dermagaId;
    if (!dermagaId) {
      const { data: od } = await client
        .from('officer_dermagas')
        .select('dermaga_id')
        .eq('officer_id', officerId)
        .limit(1);
      if (od?.[0]) {
        dermagaId = od[0].dermaga_id;
      } else {
        const { data: d } = await client
          .from('dermagas')
          .select('id')
          .eq('region_id', regionId)
          .limit(1);
        dermagaId = d?.[0]?.id;
      }
    }

    await client
      .from('trips')
      .insert({
        id: tripId,
        no_trip: noTrip,
        officer_id: officerId,
        region_id: regionId,
        dermaga_id: dermagaId || null,
        status_muatan: statusMuatan,
        route_from: routeFrom,
        route_to: routeTo,
        keterangan: keterangan,
        foto_kosong_path: fotoKosongPath,
      });

    res.status(201).json({ id: tripId, noTrip });
  } catch (error) {
    console.error('Create trip error:', error);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

// ============================================
// GET TRIPS (GET /api/trips)
// ============================================

router.get('/', authenticate, async (req, res) => {
  try {
    const { regionId, role } = req.user;
    const { date } = req.query;
    const isAdmin = role === 'admin';
    const client = supabaseAdmin || supabase;

    let query = client
      .from('trips')
      .select(`
        *,
        officers(name),
        regions(code),
        trip_vehicles(count)
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!isAdmin) {
      query = query.eq('region_id', regionId);
    }

    if (date) {
      // Filter by date (created_at date part)
      const startOfDay = `${date}T00:00:00`;
      const endOfDay = `${date}T23:59:59`;
      query = query.gte('created_at', startOfDay).lte('created_at', endOfDay);
    }

    const { data: trips, error } = await query;

    if (error) {
      console.error('Fetch trips error:', error);
      return res.status(500).json({ error: 'Failed to fetch trips' });
    }

    // Format response
    const formattedTrips = (trips || []).map(t => ({
      ...t,
      officer_name: t.officers?.name,
      region_code: t.regions?.code,
      photo_url: t.foto_kosong_path,
      vehicle_count: t.trip_vehicles?.[0]?.count || 0,
    }));

    res.json(formattedTrips);
  } catch (error) {
    console.error('Get trips error:', error);
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
});

module.exports = router;
