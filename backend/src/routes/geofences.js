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



// peta kode rute (ASAL-TUJUAN) → dermaga & wilayah pemiliknya
function buildRouteIndex() {
  const rows = db.prepare(`
    SELECT r.route_from, r.route_to, r.dermaga_id, d.region_id, d.name AS dermaga_name, d.code AS dermaga_code
    FROM routes r
    JOIN dermagas d ON r.dermaga_id = d.id
  `).all();

  const index = new Map();
  for (const row of rows) {
    const from = String(row.route_from ?? '').trim().toUpperCase();
    const to = String(row.route_to ?? '').trim().toUpperCase();
    if (!from || !to) continue;
    const code = `${from}-${to}`;

    const hit = index.get(code);
    if (hit) {
      if (!hit.dermagaIds.includes(row.dermaga_id)) hit.dermagaIds.push(row.dermaga_id);
      continue;
    }
    index.set(code, {
      dermagaIds: [row.dermaga_id],
      regionId: row.region_id,
      dermagaName: row.dermaga_name,
      dermagaCode: row.dermaga_code,
    });
  }
  return index;
}



// dermaga yang jadi penugasan petugas
function ownedDermagaIds(user) {
  const officerId = user && user.officerId ? String(user.officerId) : '';
  if (!officerId) return [];
  try {
    return db.prepare(`SELECT dermaga_id FROM officer_dermagas WHERE officer_id = ?`)
      .all(officerId)
      .map(r => String(r.dermaga_id));
  } catch {
    return [];
  }
}



// batas kode rute yang boleh dibaca pemanggil — null = tanpa filter (master lengkap)
function scopeRouteCodes(user, query, index) {
  const isAdmin = user && user.role === 'admin';
  const askedDermaga = String(query.dermagaId || query.dermaga_id || '').trim();
  const askedRegion = String(query.regionId || query.region_id || '').trim();
  const wantAll = String(query.scope || '').toLowerCase() === 'all';

  // dashboard admin tanpa filter tetap dapat master lengkap
  if (isAdmin && (wantAll || (!askedDermaga && !askedRegion))) return null;

  const owned = ownedDermagaIds(user);

  let dermagaIds = [];
  let regionId = '';

  if (askedDermaga) {
    if (!isAdmin && !owned.includes(askedDermaga)) return { denied: true };
    dermagaIds = [askedDermaga];
  } else if (askedRegion) {
    if (!isAdmin && user && user.regionId && askedRegion !== String(user.regionId)) return { denied: true };
    regionId = askedRegion;
  } else if (owned.length) {
    dermagaIds = owned;
  } else {
    regionId = String((user && user.regionId) || '');
  }

  const codes = new Set();
  for (const [code, info] of index) {
    if (dermagaIds.length) {
      if (!info.dermagaIds.some(id => dermagaIds.includes(id))) continue;
    } else if (info.regionId !== regionId) {
      continue;
    }
    codes.add(code);
  }
  return { codes, dermagaIds, regionId };
}



// sisakan hanya geofence yang rutenya masuk penugasan
function withinScope(rows, scope, index) {
  if (!scope) return rows || [];

  const codes = scope.codes || new Set();
  return (rows || []).filter(row => {
    const own = String(row.allowed_route_codes ?? '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
      .filter(code => codes.has(code));
    return own.length > 0;
  });
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



function shape(rows, index) {
  return (rows || []).map(r => {
    const allowedRouteCodes = String(r.allowed_route_codes ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const owner = allowedRouteCodes
      .map(code => index.get(String(code).toUpperCase()))
      .find(Boolean) || null;

    return {
      id: r.id,
      locationName: r.location_name,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      radiusMeters: clampRadius(r.radius_meters),
      allowedRouteCodes,
      allowedDirections: String(r.allowed_directions ?? '').split(',').map(s => s.trim()).filter(Boolean),
      description: r.description ?? '',
      dermagaId: owner ? owner.dermagaIds[0] : null,
      dermagaName: owner ? owner.dermagaName : null,
      dermagaCode: owner ? owner.dermagaCode : null,
      regionId: owner ? owner.regionId : null,
    };
  });
}



router.get('/', authenticate, (req, res) => {
  try {
    const query = req.query || {};
    const index = buildRouteIndex();
    const scope = scopeRouteCodes(req.user, query, index);

    if (scope && scope.denied) {
      return res.status(403).json({ error: 'Dermaga di luar wilayah penugasan Anda' });
    }

    const rows = db.prepare(`SELECT * FROM geofences ORDER BY location_name`).all();
    res.json(shape(withinScope(rows, scope, index), index));
  } catch (error) {
    console.error('Get geofences error:', error);
    res.status(500).json({ error: 'Failed to fetch geofences' });
  }
});



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
    `).run(
      id,
      String(locationName).trim(),
      lat,
      lng,
      clampRadius(radiusMeters),
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
      return res.status(400).json({ error: 'latitude & longitude wajib angka valid (bukan kosong/placeholder)' });
    }
    if (lat !== undefined && lng !== undefined && !validLatLng(lat, lng)) {
      return res.status(400).json({ error: 'Koordinat di luar rentang valid — lat ±90, lng ±180' });
    }

    if (b.locationName !== undefined) { sets.push('location_name = ?'); args.push(String(b.locationName).trim()); }
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
