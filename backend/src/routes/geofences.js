const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');



const csv = (v) => (Array.isArray(v) ? v.join(',') : String(v ?? ''));
const splitCsv = (v) => String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);



function toRule(row) {
  return {
    id: row.id,
    locationName: row.location_name,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMeters: row.radius_meters,
    allowedRouteCodes: splitCsv(row.allowed_route_codes),
    allowedDirections: splitCsv(row.allowed_directions),
    description: row.description || '',
  };
}



function validCoords(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}



router.get('/', authenticate, requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT * FROM geofences ORDER BY location_name ASC`).all();
  res.json(rows.map(toRule));
});



router.get('/resolve-link', authenticate, async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'url harus http(s)' });
  }
  try {
    const result = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    res.json({ url: result.url });
  } catch (e) {
    res.status(502).json({ error: `Gagal resolve link: ${e.message}` });
  }
});



router.post('/', authenticate, requireAdmin, (req, res) => {
  const { locationName, latitude, longitude, radiusMeters, allowedRouteCodes, allowedDirections, description } = req.body || {};
  const lat = Number(latitude);
  const lon = Number(longitude);
  const rad = Number(radiusMeters);

  if (!String(locationName || '').trim()) {
    return res.status(400).json({ error: 'locationName wajib diisi' });
  }
  if (!validCoords(lat, lon)) {
    return res.status(400).json({ error: 'latitude/longitude tidak valid' });
  }
  if (!Number.isFinite(rad) || rad <= 0 || rad > 10000) {
    return res.status(400).json({ error: 'radiusMeters harus 1–10000' });
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO geofences (id, location_name, latitude, longitude, radius_meters, allowed_route_codes, allowed_directions, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, String(locationName).trim(), lat, lon, rad,
    csv(allowedRouteCodes), csv(allowedDirections), String(description || '').trim()
  );
  res.json({ id });
});



router.put('/:id', authenticate, requireAdmin, (req, res) => {
  const row = db.prepare(`SELECT * FROM geofences WHERE id = ?`).get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Titik geofence tidak ditemukan' });

  const { locationName, latitude, longitude, radiusMeters, allowedRouteCodes, allowedDirections, description } = req.body || {};
  const lat = latitude === undefined ? row.latitude : Number(latitude);
  const lon = longitude === undefined ? row.longitude : Number(longitude);
  const rad = radiusMeters === undefined ? row.radius_meters : Number(radiusMeters);

  if (locationName !== undefined && !String(locationName).trim()) {
    return res.status(400).json({ error: 'locationName tidak boleh kosong' });
  }
  if (!validCoords(lat, lon)) {
    return res.status(400).json({ error: 'latitude/longitude tidak valid' });
  }
  if (!Number.isFinite(rad) || rad <= 0 || rad > 10000) {
    return res.status(400).json({ error: 'radiusMeters harus 1–10000' });
  }

  db.prepare(`
    UPDATE geofences
       SET location_name = ?, latitude = ?, longitude = ?, radius_meters = ?,
           allowed_route_codes = ?, allowed_directions = ?, description = ?
     WHERE id = ?
  `).run(
    locationName === undefined ? row.location_name : String(locationName).trim(),
    lat, lon, rad,
    allowedRouteCodes === undefined ? row.allowed_route_codes : csv(allowedRouteCodes),
    allowedDirections === undefined ? row.allowed_directions : csv(allowedDirections),
    description === undefined ? row.description : String(description || '').trim(),
    row.id
  );
  res.json({ ok: true });
});



router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  const info = db.prepare(`DELETE FROM geofences WHERE id = ?`).run(String(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Titik geofence tidak ditemukan' });
  res.json({ ok: true });
});



module.exports = router;
