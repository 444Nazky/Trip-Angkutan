const express = require('express')
const router = express.Router()
const { randomUUID } = require('crypto')
const { db } = require('../db')
const { authenticate, requireAdmin } = require('../middleware/auth')

/**
 * Koersi koordinat ke number yang VALID, atau null bila tidak layak.
 * Menolak: kosong, null, NaN, string placeholder ('Otomatis dari Link Maps'),
 * dan nilai di luar rentang lat ±90 / lng ±180. Angka dalam string diterima.
 */
function numericCoordinate(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n)) return null
  return n
}

function validLatLng(lat, lng) {
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

/** Radius wajib bilangan real 1–10000 meter; di luar itu → fallback 100 (default). */
function clampRadius(value) {
  const n = numericCoordinate(value)
  if (n === null || n < 1 || n > 10000) return 100
  return n
}

/** Bentuk baris SQLite → kontrak JSON camelCase yang dipakai mobile & dashboard admin. */
function shape(rows) {
  return (rows || []).map(r => ({
    id: r.id,
    locationName: r.location_name,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    radiusMeters: clampRadius(r.radius_meters),
    allowedRouteCodes: String(r.allowed_route_codes ?? '').split(',').map(s => s.trim()).filter(Boolean),
    allowedDirections: String(r.allowed_directions ?? '').split(',').map(s => s.trim()).filter(Boolean),
    description: r.description ?? '',
  }))
}

// GET /geofences — semua rule (admin dashboard; mobile menyinkronkan via endpoint ini)
router.get('/', authenticate, (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM geofence_rules ORDER BY location_name ASC').all()
    res.json(shape(rules))
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch geofence rules' })
  }
})

// GET /geofences/config — config lengkap untuk sinkronisasi mobile (kompatibilitas lama)
router.get('/config', authenticate, (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM geofence_rules ORDER BY location_name ASC').all()
    const cfg = db.prepare('SELECT key, value FROM geofence_config').all()
    const config = Object.fromEntries(cfg.map(r => [r.key, JSON.parse(r.value ?? 'null')]))
    res.json({
      maxAccuracyMeters: config.maxAccuracyMeters ?? 100,
      defaultRadiusMeters: config.defaultRadiusMeters ?? 100,
      rules: shape(rules),
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch geofence config' })
  }
})

// POST /geofences — buat rule baru (admin)
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { id, locationName, latitude, longitude, radiusMeters, allowedRouteCodes, allowedDirections, description } = req.body ?? {}
    const lat = numericCoordinate(latitude)
    const lng = numericCoordinate(longitude)
    if (!locationName || String(locationName).trim() === '') {
      return res.status(400).json({ error: 'locationName wajib diisi' })
    }
    if (!validLatLng(lat, lng)) {
      return res.status(400).json({
        error: 'latitude & longitude wajib angka valid (bukan kosong/placeholder) — lat ±90, lng ±180',
      })
    }
    const ruleId = id || randomUUID()
    db.prepare(`
      INSERT INTO geofence_rules (id, location_name, latitude, longitude, radius_meters, allowed_route_codes, allowed_directions, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ruleId,
      String(locationName).trim(),
      lat,
      lng,
      clampRadius(radiusMeters),
      Array.isArray(allowedRouteCodes) ? allowedRouteCodes.join(',') : String(allowedRouteCodes ?? ''),
      Array.isArray(allowedDirections) ? allowedDirections.join(',') : String(allowedDirections ?? ''),
      description ? String(description) : '',
    )
    res.status(201).json({ id: ruleId })
  } catch (error) {
    res.status(500).json({ error: 'Failed to create geofence rule' })
  }
})

// PUT /geofences/:id — perbarui rule (admin)
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    const existing = db.prepare('SELECT id FROM geofence_rules WHERE id = ?').get(id)
    if (!existing) return res.status(404).json({ error: 'Rule tidak ditemukan' })

    const b = req.body ?? {}
    const lat = b.latitude !== undefined ? numericCoordinate(b.latitude) : undefined
    const lng = b.longitude !== undefined ? numericCoordinate(b.longitude) : undefined
    // Koordinat: bila dikirim, WAJIB angka valid (tolak placeholder/kosong)
    if ((b.latitude !== undefined && lat === null) || (b.longitude !== undefined && lng === null)) {
      return res.status(400).json({ error: 'latitude & longitude wajib angka valid (bukan kosong/placeholder)' })
    }
    if (lat !== undefined && lng !== undefined && !validLatLng(lat, lng)) {
      return res.status(400).json({ error: 'Koordinat di luar rentang valid — lat ±90, lng ±180' })
    }

    db.prepare(`
      UPDATE geofence_rules SET
        location_name = COALESCE(?, location_name),
        latitude = COALESCE(?, latitude),
        longitude = COALESCE(?, longitude),
        radius_meters = COALESCE(?, radius_meters),
        allowed_route_codes = COALESCE(?, allowed_route_codes),
        allowed_directions = COALESCE(?, allowed_directions),
        description = COALESCE(?, description)
      WHERE id = ?
    `).run(
      b.locationName !== undefined ? String(b.locationName).trim() : null,
      lat ?? null,
      lng ?? null,
      b.radiusMeters !== undefined ? clampRadius(b.radiusMeters) : null,
      b.allowedRouteCodes !== undefined
        ? (Array.isArray(b.allowedRouteCodes) ? b.allowedRouteCodes.join(',') : String(b.allowedRouteCodes))
        : null,
      b.allowedDirections !== undefined
        ? (Array.isArray(b.allowedDirections) ? b.allowedDirections.join(',') : String(b.allowedDirections))
        : null,
      b.description !== undefined ? String(b.description ?? '') : null,
      id,
    )
    res.json({ id, success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to update geofence rule' })
  }
})

// DELETE /geofences/:id (admin)
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    db.prepare('DELETE FROM geofence_rules WHERE id = ?').run(id)
    res.json({ id, success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete geofence rule' })
  }
})

module.exports = router
