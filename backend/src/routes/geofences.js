const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { randomUUID } = require('crypto');

/**
 * Koersi koordinat ke number yang VALID, atau null bila tidak layak.
 * Menolak: kosong, null, NaN, string placeholder ('Otomatis dari Link Maps'),
 * dan nilai di luar rentang lat ±90 / lng ±180. Angka dalam string diterima.
 */
function numericCoordinate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  return n;
}
function validLatLng(lat, lng) {
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

// ── Resolve short-link Google Maps (server-side, bebas CORS) ─────────────────
// GET /api/geofences/resolve-link?url=https://maps.app.goo.gl/xxxx
// Mengikuti redirect di server, lalu mengekstrak koordinat dari URL final
// maupun dari HTML halaman (Google kadang menyajikan halaman consent).
function parseCoordsFromText(text) {
  if (!text) return null;
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|destination|daddr|ll|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /"(-?\d+\.\d{4,})",\s*(-?\d+\.\d{4,})"/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { latitude: lat, longitude: lng };
      }
    }
  }
  return null;
}

router.get('/resolve-link', authenticate, async (req, res) => {
  const raw = String(req.query.url || '').trim();
  if (!/^https?:\/\//i.test(raw)) {
    return res.status(400).json({ error: 'url wajib berupa http(s) URL' });
  }
  try {
    const response = await fetch(raw, {
      redirect: 'follow',
      headers: {
        // UA desktop agar Google tidak menyajikan halaman app-redirect kosong
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      },
    });
    const finalUrl = response.url || raw;
    // 1) Koordinat dari URL final (kasus normal)
    const fromUrl = parseCoordsFromText(finalUrl);
    if (fromUrl) return res.json({ url: finalUrl, ...fromUrl });

    // 2) Fallback: baca body HTML (max 256 KB) dan cari koordinat di dalamnya
    const html = await response.text();
    const fromHtml = parseCoordsFromText(html.slice(0, 262144));
    if (fromHtml) return res.json({ url: finalUrl, ...fromHtml });

    return res.json({ url: finalUrl });
  } catch (error) {
    console.error('Resolve maps link error:', error && error.message);
    return res.status(502).json({ error: 'Gagal membuka link — periksa koneksi atau tempel URL penuh Google Maps' });
  }
});
// Bentuk baris SQLite → kontrak JSON yang dipakai mobile & dashboard admin.
function shape(rows) {
  return (rows || []).map(r => ({
    id: r.id,
    locationName: r.location_name,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    radiusMeters: Number(r.radius_meters) || 100,
    allowedRouteCodes: String(r.allowed_route_codes ?? '').split(',').map(s => s.trim()).filter(Boolean),
    allowedDirections: String(r.allowed_directions ?? '').split(',').map(s => s.trim()).filter(Boolean),
    description: r.description ?? '',
  }));
}

// GET semua rule — publik untuk petugas (tanpa data sensitif); admin juga bisa.
router.get('/', authenticate, (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM geofences ORDER BY location_name`).all();
    res.json(shape(rows));
  } catch (error) {
    console.error('Get geofences error:', error);
    res.status(500).json({ error: 'Failed to fetch geofences' });
  }
});

// POST rule baru (admin)
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { locationName, latitude, longitude, radiusMeters, allowedRouteCodes, allowedDirections, description } = req.body || {};
    const lat = numericCoordinate(latitude);
    const lng = numericCoordinate(longitude);
    if (!locationName || String(locationName).trim() === '') {
      return res.status(400).json({ error: 'locationName wajib diisi' });
    }
    if (!validLatLng(lat, lng)) {
      return res.status(400).json({
        error: 'latitude & longitude wajib angka valid (bukan kosong/placeholder) — lat ±90, lng ±180',
      });
    }
    const id = randomUUID();
    db.prepare(`
      INSERT INTO geofences (id, location_name, latitude, longitude, radius_meters, allowed_route_codes, allowed_directions, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `    ).run(
      id,
      String(locationName).trim(),
      lat,
      lng,
      numericCoordinate(radiusMeters) || 100,
      Array.isArray(allowedRouteCodes) ? allowedRouteCodes.join(',') : String(allowedRouteCodes ?? ''),
      Array.isArray(allowedDirections) ? allowedDirections.join(',') : String(allowedDirections ?? ''),
      description ? String(description) : '',
    );
    res.status(201).json({ id });
  } catch (error) {
    console.error('Create geofence error:', error);
    res.status(500).json({ error: 'Failed to create geofence' });
  }
});

// PUT rule (admin) — update sebagian kolom
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const id = String(req.params.id);
    const row = db.prepare(`SELECT id FROM geofences WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: 'Geofence not found' });

    const b = req.body || {};
    const sets = [];
    const args = [];

    // Koordinat: bila dikirim, WAJIB angka valid (tolak placeholder/kosong)
    const lat = b.latitude !== undefined ? numericCoordinate(b.latitude) : undefined;
    const lng = b.longitude !== undefined ? numericCoordinate(b.longitude) : undefined;
    if ((b.latitude !== undefined && lat === null) || (b.longitude !== undefined && lng === null)) {
      return res.status(400).json({ error: 'latitude & longitude wajib angka valid (bukan kosong/placeholder)' });
    }
    if (lat !== undefined && lng !== undefined && !validLatLng(lat, lng)) {
      return res.status(400).json({ error: 'Koordinat di luar rentang valid — lat ±90, lng ±180' });
    }

    if (b.locationName !== undefined) { sets.push('location_name = ?'); args.push(String(b.locationName).trim()); }
    if (lat !== undefined) { sets.push('latitude = ?'); args.push(lat); }
    if (lng !== undefined) { sets.push('longitude = ?'); args.push(lng); }
    if (b.radiusMeters !== undefined) { sets.push('radius_meters = ?'); args.push(numericCoordinate(b.radiusMeters) || 100); }
    if (b.allowedRouteCodes !== undefined) {
      sets.push('allowed_route_codes = ?');
      args.push(Array.isArray(b.allowedRouteCodes) ? b.allowedRouteCodes.join(',') : String(b.allowedRouteCodes));
    }
    if (b.allowedDirections !== undefined) {
      sets.push('allowed_directions = ?');
      args.push(Array.isArray(b.allowedDirections) ? b.allowedDirections.join(',') : String(b.allowedDirections));
    }
    if (b.description !== undefined) { sets.push('description = ?'); args.push(String(b.description ?? '')); }

    if (sets.length) {
      args.push(id);
      db.prepare(`UPDATE geofences SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Update geofence error:', error);
    res.status(500).json({ error: 'Failed to update geofence' });
  }
});

// DELETE rule (admin)
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    db.prepare(`DELETE FROM geofences WHERE id = ?`).run(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete geofence' });
  }
});

module.exports = router;
