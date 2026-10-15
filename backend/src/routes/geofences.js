const express = require('express');




const router = express.Router();
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { randomUUID } = require('crypto');




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




function clampRadius(value) {
  const n = numericCoordinate(value);
  if (n === null || n < 1 || n > 10000) return 100;
  return n;
}




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
  let host = '';
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return res.status(400).json({ error: 'url tidak valid' });
  }
  const ALLOWED_HOST_RE = /(^|\.)(goo\.gl|g\.co|google\.com|maps\.app\.goo\.gl)$/i;
  if (!ALLOWED_HOST_RE.test(host)) {
    return res.status(400).json({ error: 'Hanya link Google Maps (goo.gl / maps.app.goo.gl / google.com) yang didukung' });
  }
  try {
    const response = await fetch(raw, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      },
    });
    const finalUrl = response.url || raw;
    const fromUrl = parseCoordsFromText(finalUrl);
    if (fromUrl) return res.json({ url: finalUrl, ...fromUrl });

    const html = await response.text();
    const fromHtml = parseCoordsFromText(html.slice(0, 262144));
    if (fromHtml) return res.json({ url: finalUrl, ...fromHtml });

    return res.json({ url: finalUrl });
  } catch (error) {
    console.error('Resolve maps link error:', error && error.message);
    return res.status(502).json({ error: 'Gagal membuka link — periksa koneksi atau tempel URL penuh Google Maps' });
  }
});




function shape(rows) {
  return (rows || []).map(r => ({
    id: r.id,
    name: r.name || r.location_name,
    locationName: r.location_name || r.name,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    radiusMeters: clampRadius(r.radius_meters),
    allowedRouteCodes: String(r.allowed_route_codes || r.allowed_routes || '').split(',').map(s => s.trim()).filter(Boolean),
    allowedDirections: String(r.allowed_directions ?? '').split(',').map(s => s.trim()).filter(Boolean),
    description: r.description ?? '',
    enabled: r.enabled !== 0 && r.enabled !== false,
    strictEnforceOutsideArea: r.strict_enforce_outside !== 0 && r.strict_enforce_outside !== false,
  }));
}




router.get('/', authenticate, (req, res) => {
  try {
    const { dermagaId, scope } = req.query;
    console.log(`[geofence] GET - officerId: ${req.user.officerId}, role: ${req.user.role}, dermagaId: ${dermagaId}, scope: ${scope}`);

    let rows;
    const isAdmin = req.user.role === 'admin';

    if (dermagaId) {
      // Filter by specific dermagaId - use COALESCE for compatibility
      rows = db.prepare(`
        SELECT * FROM geofences
        WHERE id = ? OR COALESCE(location_name, name, '') LIKE ?
        ORDER BY COALESCE(location_name, name, id)
      `).all(String(dermagaId), `%${String(dermagaId)}%`);
      console.log(`[geofence] GET with dermagaId=${dermagaId}: found ${rows.length} rows`);
    } else if (scope === 'all' && isAdmin) {
      // Admin wants all geofences
      rows = db.prepare(`SELECT * FROM geofences ORDER BY COALESCE(location_name, name, id)`).all();
      console.log(`[geofence] GET admin (all): found ${rows.length} rows`);
    } else {
      // For officers, return all geofences (admin dashboard filters by route codes on client side)
      rows = db.prepare(`SELECT * FROM geofences ORDER BY COALESCE(location_name, name, id)`).all();
      console.log(`[geofence] GET returning ${rows.length} geofences for officer`);
    }

    const shaped = shape(rows);
    console.log(`[geofence] GET returning ${shaped.length} geofences`);
    res.json(shaped);
  } catch (error) {
    console.error('Get geofences error:', error);
    res.status(500).json({ error: 'Failed to fetch geofences' });
  }
});




router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { locationName, name, latitude, longitude, radiusMeters, allowedRouteCodes, allowedDirections, description, dermagaId } = req.body || {};
    const lat = numericCoordinate(latitude);
    const lng = numericCoordinate(longitude);
    const locName = String(locationName || name || '').trim();
    if (!locName) {
      return res.status(400).json({ error: 'locationName/name wajib diisi' });
    }
    if (!validLatLng(lat, lng)) {
      return res.status(400).json({
        error: 'latitude & longitude wajib angka valid — lat ±90, lng ±180',
      });
    }
    const id = randomUUID();
    const routesStr = Array.isArray(allowedRouteCodes) ? allowedRouteCodes.join(',') : String(allowedRouteCodes ?? '');
    const directionsStr = Array.isArray(allowedDirections) ? allowedDirections.join(',') : String(allowedDirections ?? '');

    db.prepare(`
      INSERT INTO geofences (id, location_name, latitude, longitude, radius_meters, allowed_route_codes, allowed_directions, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      locName,
      lat,
      lng,
      clampRadius(radiusMeters),
      routesStr,
      directionsStr,
      description ? String(description) : '',
    );
    res.status(201).json({ id });
  } catch (error) {
    console.error('Create geofence error:', error);
    res.status(500).json({ error: 'Failed to create geofence' });
  }
});




router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const id = String(req.params.id);
    const row = db.prepare(`SELECT id FROM geofences WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: 'Geofence not found' });

    const b = req.body || {};
    const sets = [];
    const args = [];

    const lat = b.latitude !== undefined ? numericCoordinate(b.latitude) : undefined;
    const lng = b.longitude !== undefined ? numericCoordinate(b.longitude) : undefined;
    if ((b.latitude !== undefined && lat === null) || (b.longitude !== undefined && lng === null)) {
      return res.status(400).json({ error: 'latitude & longitude wajib angka valid' });
    }
    if (lat !== undefined && lng !== undefined && !validLatLng(lat, lng)) {
      return res.status(400).json({ error: 'Koordinat di luar rentang valid — lat ±90, lng ±180' });
    }

    if (b.locationName !== undefined || b.name !== undefined) {
      const n = String(b.locationName || b.name || '').trim();
      if (n) { sets.push('location_name = ?'); args.push(n); }
    }
    if (lat !== undefined) { sets.push('latitude = ?'); args.push(lat); }
    if (lng !== undefined) { sets.push('longitude = ?'); args.push(lng); }
    if (b.radiusMeters !== undefined) { sets.push('radius_meters = ?'); args.push(clampRadius(b.radiusMeters)); }
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




router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    db.prepare(`DELETE FROM geofences WHERE id = ?`).run(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete geofence' });
  }
});




module.exports = router;
