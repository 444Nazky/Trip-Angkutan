const express = require('express')
const router = express.Router()
const { randomUUID } = require('crypto');
const { db } = require('../db')
const { authenticate, requireAdmin } = require('../middleware/auth')

// GET /geofences — semua rule (admin dashboard)
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM geofence_rules ORDER BY location_name ASC').all()
    res.json(rules)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch geofence rules' })
  }
})

// GET /geofences/config — config lengkap untuk sinkronisasi mobile
router.get('/config', authenticate, (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM geofence_rules ORDER BY location_name ASC').all()
    const cfg = db.prepare('SELECT key, value FROM geofence_config').all()
    const config = Object.fromEntries(cfg.map(r => [r.key, JSON.parse(r.value ?? 'null')]))
    res.json({
      maxAccuracyMeters: config.maxAccuracyMeters ?? 100,
      defaultRadiusMeters: config.defaultRadiusMeters ?? 100,
      rules: rules.map(r => ({
        id: r.id,
        locationName: r.location_name,
        latitude: r.latitude,
        longitude: r.longitude,
        radiusMeters: r.radius_meters ?? 100,
        allowedRouteCodes: r.allowed_route_codes ? r.allowed_route_codes.split(',') : [],
        allowedDirections: r.allowed_directions ? r.allowed_directions.split(',') : [],
        description: r.description ?? '',
      })),
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch geofence config' })
  }
})

// POST /geofences — buat rule baru (admin)
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { id, locationName, latitude, longitude, radiusMeters, allowedRouteCodes, allowedDirections, description } = req.body ?? {}
    if (!locationName || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'locationName, latitude, longitude wajib' })
    }
    const ruleId = id || randomUUID()
    db.prepare(`
      INSERT INTO geofence_rules (id, location_name, latitude, longitude, radius_meters, allowed_route_codes, allowed_directions, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ruleId,
      locationName,
      latitude,
      longitude,
      radiusMeters ?? 100,
      (allowedRouteCodes ?? []).join(','),
      (allowedDirections ?? []).join(','),
      description ?? '',
    )
    res.status(201).json({ id: ruleId })
  } catch (error) {
    res.status(500).json({ error: 'Failed to create geofence rule' })
  }
})

// PUT /geofences/:id — perbarui rule
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    const { locationName, latitude, longitude, radiusMeters, allowedRouteCodes, allowedDirections, description } = req.body ?? {}
    const existing = db.prepare('SELECT id FROM geofence_rules WHERE id = ?').get(id)
    if (!existing) return res.status(404).json({ error: 'Rule tidak ditemukan' })
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
      locationName ?? null,
      latitude,
      longitude,
      radiusMeters ?? null,
      allowedRouteCodes ? allowedRouteCodes.join(',') : null,
      allowedDirections ? allowedDirections.join(',') : null,
      description ?? null,
      id,
    )
    res.json({ id })
  } catch (error) {
    res.status(500).json({ error: 'Failed to update geofence rule' })
  }
})

// DELETE /geofences/:id
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    db.prepare('DELETE FROM geofence_rules WHERE id = ?').run(id)
    res.json({ id })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete geofence rule' })
  }
})

module.exports = router
