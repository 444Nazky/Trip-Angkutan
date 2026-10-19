/**
 * Geofences Routes - Supabase Version
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

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

// ============================================
// RESOLVE GOOGLE MAPS LINK
// ============================================

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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
    console.error('Resolve maps link error:', error?.message);
    return res.status(502).json({ error: 'Gagal membuka link' });
  }
});

// ponytail: mobil masih kirim id kode ("BADAU-D1" dari registry lokal), DB pakai
// UUID — resolve sekali di sini, semua client yang pakai kode ikut lega
async function resolveDermagaId(raw) {
  const value = String(raw ?? '').trim();
  if (!value || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  const m = value.match(/^([A-Za-z0-9]+)-D(\d+)$/i);
  if (!m) return value;
  const client = supabaseAdmin || supabase;
  const { data } = await client
    .from('dermagas')
    .select('id, code, regions!inner(code)')
    .eq('code', `D${m[2]}`)
    .eq('regions.code', m[1].toUpperCase())
    .limit(1)
    .maybeSingle();
  return data?.id ?? value;
}

// ============================================
// GET GEOFENCES
// ============================================

router.get('/', authenticate, async (req, res) => {
  try {
    const dermagaId = await resolveDermagaId(req.query.dermagaId);
    const scopeAll = String(req.query.scope ?? '').toLowerCase() === 'all';
    const client = supabaseAdmin || supabase;

    let query = client
      .from('geofences')
      .select('*')
      .order('location_name', { ascending: true, nullsFirst: true });

    // Without filter (or scope=all) = full master list
    if (!dermagaId || scopeAll) {
      const { data, error } = await query;
      if (error) throw error;
      return res.json(shape(data));
    }

    // Get geofences for specific dermaga OR general ones (dermaga_id NULL)
    const { data, error } = await client
      .from('geofences')
      .select('*')
      .or(`dermaga_id.eq.${dermagaId},dermaga_id.is.null`)
      .order('location_name', { ascending: true, nullsFirst: true });

    if (error) throw error;
    res.json(shape(data));
  } catch (error) {
    console.error('Get geofences error:', error);
    res.status(500).json({ error: 'Failed to fetch geofences' });
  }
});

function shape(rows) {
  return (rows || []).map(r => ({
    id: r.id,
    name: r.name || r.location_name,
    locationName: r.location_name || r.name,
    dermagaId: r.dermaga_id ?? null,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    radiusMeters: clampRadius(r.radius_meters),
    allowedRouteCodes: String(r.allowed_route_codes ?? '').split(',').map(s => s.trim()).filter(Boolean),
    allowedDirections: String(r.allowed_directions ?? '').split(',').map(s => s.trim()).filter(Boolean),
    description: r.description ?? '',
    enabled: r.enabled === undefined || r.enabled === null ? true : Number(r.enabled) !== 0,
  }));
}

// ============================================
// CREATE GEOFENCE
// ============================================

router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { locationName, dermagaId, latitude, longitude, radiusMeters, allowedRouteCodes, allowedDirections, description, enabled } = req.body || {};
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

    const id = helpers.uuid();
    const client = supabaseAdmin || supabase;

    const { data, error } = await client
      .from('geofences')
      .insert({
        id,
        name: String(locationName).trim(),
        location_name: String(locationName).trim(),
        dermaga_id: dermagaId ? String(dermagaId) : null,
        latitude: lat,
        longitude: lng,
        radius_meters: clampRadius(radiusMeters),
        allowed_route_codes: Array.isArray(allowedRouteCodes) ? allowedRouteCodes.join(',') : String(allowedRouteCodes ?? ''),
        allowed_directions: Array.isArray(allowedDirections) ? allowedDirections.join(',') : String(allowedDirections ?? ''),
        description: description ? String(description) : '',
        enabled: enabled === undefined || enabled === null ? 1 : (enabled ? 1 : 0),
      })
      .select('id')
      .single();

    if (error) throw error;
    res.status(201).json({ id: data.id });
  } catch (error) {
    console.error('Create geofence error:', error);
    res.status(500).json({ error: 'Failed to create geofence' });
  }
});

// ============================================
// UPDATE GEOFENCE
// ============================================

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const b = req.body || {};
    const client = supabaseAdmin || supabase;

    // Check if exists
    const { data: existing } = await client
      .from('geofences')
      .select('id')
      .eq('id', id)
      .limit(1);

    if (!existing?.length) {
      return res.status(404).json({ error: 'Geofence not found' });
    }

    const updateData = {};

    const lat = b.latitude !== undefined ? numericCoordinate(b.latitude) : undefined;
    const lng = b.longitude !== undefined ? numericCoordinate(b.longitude) : undefined;

    if ((b.latitude !== undefined && lat === null) || (b.longitude !== undefined && lng === null)) {
      return res.status(400).json({ error: 'latitude & longitude wajib angka valid' });
    }
    if (lat !== undefined && lng !== undefined && !validLatLng(lat, lng)) {
      return res.status(400).json({ error: 'Koordinat di luar rentang valid — lat ±90, lng ±180' });
    }

    if (b.locationName !== undefined) {
      const n = String(b.locationName).trim();
      updateData.location_name = n;
      updateData.name = n;
    }
    if (lat !== undefined) updateData.latitude = lat;
    if (lng !== undefined) updateData.longitude = lng;
    if (b.radiusMeters !== undefined) updateData.radius_meters = clampRadius(b.radiusMeters);
    if (b.allowedRouteCodes !== undefined) {
      updateData.allowed_route_codes = Array.isArray(b.allowedRouteCodes) ? b.allowedRouteCodes.join(',') : String(b.allowedRouteCodes);
    }
    if (b.allowedDirections !== undefined) {
      updateData.allowed_directions = Array.isArray(b.allowedDirections) ? b.allowedDirections.join(',') : String(b.allowedDirections);
    }
    if (b.description !== undefined) updateData.description = String(b.description ?? '');
    if (b.dermagaId !== undefined) updateData.dermaga_id = b.dermagaId ? String(b.dermagaId) : null;
    if (b.enabled !== undefined) updateData.enabled = b.enabled ? 1 : 0;

    if (Object.keys(updateData).length) {
      const { error } = await client
        .from('geofences')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update geofence error:', error);
    res.status(500).json({ error: 'Failed to update geofence' });
  }
});

// ============================================
// DELETE GEOFENCE
// ============================================

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = supabaseAdmin || supabase;
    const { error } = await client
      .from('geofences')
      .delete()
      .eq('id', String(req.params.id));

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete geofence' });
  }
});

module.exports = router;
