// ─── Geofence Routes ──────────────────────────────────────────────────────────────
// API endpoints untuk mengelola konfigurasi geofence (titik lokasi & radius).
// Diakses dari Admin Dashboard.

const { Router } = require('express')
const { db } = require('../db')
const { requireAdmin } = require('../middleware/auth')

const router = Router()

// ── Public: Mobile sync geofence points (tanpa auth) ─────────────────────────
router.get('/sync', (req, res) => {
  try {
    const geofences = db.prepare(`
      SELECT id, name, dermaga_id, latitude, longitude, radius_meters, allowed_routes, enabled
      FROM geofences
      WHERE enabled = 1
    `).all()

    const result = geofences.map(g => ({
      id: g.id,
      name: g.name,
      dermagaId: g.dermaga_id,
      latitude: g.latitude,
      longitude: g.longitude,
      radiusMeters: g.radius_meters,
      allowedRoutes: JSON.parse(g.allowed_routes || '[]'),
      enabled: true,
    }))

    res.json({ success: true, geofences: result })
  } catch (err) {
    console.error('[geofence] sync error:', err)
    res.status(500).json({ success: false, error: 'Gagal mengambil data geofence' })
  }
})

// Admin routes (memerlukan auth)
router.use(requireAdmin)

// ── GET /geofences ─────────────────────────────────────────────────────────────
// Ambil semua titik geofence

router.get('/', (req, res) => {
  try {
    const geofences = db.prepare(`
      SELECT id, name, dermaga_id, latitude, longitude, radius_meters, allowed_routes, enabled, created_at, updated_at
      FROM geofences
      ORDER BY name
    `).all()

    const result = geofences.map(g => ({
      id: g.id,
      name: g.name,
      dermagaId: g.dermaga_id,
      latitude: g.latitude,
      longitude: g.longitude,
      radiusMeters: g.radius_meters,
      allowedRoutes: JSON.parse(g.allowed_routes || '[]'),
      enabled: Boolean(g.enabled),
      createdAt: g.created_at,
      updatedAt: g.updated_at,
    }))

    res.json({ success: true, geofences: result })
  } catch (err) {
    console.error('[geofence] GET error:', err)
    res.status(500).json({ success: false, error: 'Gagal mengambil data geofence' })
  }
})

// ── POST /geofences ──────────────────────────────────────────────────────────────
// Tambah titik geofence baru

router.post('/', (req, res) => {
  const { id, name, dermagaId, latitude, longitude, radiusMeters, allowedRoutes, enabled = true } = req.body

  // Validasi
  if (!id || !name || latitude == null || longitude == null) {
    return res.status(400).json({ success: false, error: 'ID, nama, latitude, longitude wajib diisi' })
  }
  if (!Array.isArray(allowedRoutes) || allowedRoutes.length === 0) {
    return res.status(400).json({ success: false, error: 'Minimal satu rute harus diizinkan' })
  }
  if (typeof radiusMeters !== 'number' || radiusMeters < 10 || radiusMeters > 10000) {
    return res.status(400).json({ success: false, error: 'Radius harus antara 10m dan 10km' })
  }

  try {
    // Cek duplikasi ID
    const existing = db.prepare('SELECT id FROM geofences WHERE id = ?').get(id)
    if (existing) {
      return res.status(400).json({ success: false, error: 'ID geofence sudah ada' })
    }

    db.prepare(`
      INSERT INTO geofences (id, name, dermaga_id, latitude, longitude, radius_meters, allowed_routes, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      dermagaId || null,
      latitude,
      longitude,
      radiusMeters,
      JSON.stringify(allowedRoutes),
      enabled ? 1 : 0,
    )

    res.json({ success: true, id })
  } catch (err) {
    console.error('[geofence] POST error:', err)
    res.status(500).json({ success: false, error: 'Gagal membuat geofence' })
  }
})

// ── PUT /geofences/:id ─────────────────────────────────────────────────────────
// Update titik geofence

router.put('/:id', (req, res) => {
  const { id } = req.params
  const { name, dermagaId, latitude, longitude, radiusMeters, allowedRoutes, enabled } = req.body

  try {
    const existing = db.prepare('SELECT * FROM geofences WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Geofence tidak ditemukan' })
    }

    // Validasi
    if (allowedRoutes !== undefined && (!Array.isArray(allowedRoutes) || allowedRoutes.length === 0)) {
      return res.status(400).json({ success: false, error: 'Minimal satu rute harus diizinkan' })
    }
    if (radiusMeters !== undefined && (typeof radiusMeters !== 'number' || radiusMeters < 10 || radiusMeters > 10000)) {
      return res.status(400).json({ success: false, error: 'Radius harus antara 10m dan 10km' })
    }

    db.prepare(`
      UPDATE geofences
      SET name = ?, dermaga_id = ?, latitude = ?, longitude = ?, radius_meters = ?, allowed_routes = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ?? existing.name,
      dermagaId ?? existing.dermaga_id,
      latitude ?? existing.latitude,
      longitude ?? existing.longitude,
      radiusMeters ?? existing.radius_meters,
      allowedRoutes ? JSON.stringify(allowedRoutes) : existing.allowed_routes,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      id,
    )

    res.json({ success: true })
  } catch (err) {
    console.error('[geofence] PUT error:', err)
    res.status(500).json({ success: false, error: 'Gagal memperbarui geofence' })
  }
})

// ── DELETE /geofences/:id ────────────────────────────────────────────────────────
// Hapus titik geofence

router.delete('/:id', (req, res) => {
  const { id } = req.params

  try {
    const existing = db.prepare('SELECT id FROM geofences WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Geofence tidak ditemukan' })
    }

    db.prepare('DELETE FROM geofences WHERE id = ?').run(id)

    res.json({ success: true })
  } catch (err) {
    console.error('[geofence] DELETE error:', err)
    res.status(500).json({ success: false, error: 'Gagal menghapus geofence' })
  }
})

module.exports = router
