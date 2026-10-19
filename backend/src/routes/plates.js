/**
 * Plates Routes - Supabase Version
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

function normalizePlate(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// GET ALL PLATES
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { plate } = req.query;
    const client = supabaseAdmin || supabase;

    let query = client
      .from('vehicle_plates')
      .select(`
        *,
        regions:origin_region_id(id, code, name)
      `)
      .order('plate', { ascending: true });

    if (plate) {
      query = query.ilike('plate', `%${normalizePlate(plate)}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const result = (data || []).map(p => ({
      ...p,
      origin_region_code: p.regions?.code,
      origin_region_name: p.regions?.name,
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch plates' });
  }
});

// CREATE PLATE
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { plate, owner, originRegionId, status } = req.body || {};
    const norm = normalizePlate(plate);
    if (!norm) return res.status(400).json({ error: 'Nomor plat wajib diisi' });

    const client = supabaseAdmin || supabase;

    // Check duplicate
    const { data: existing } = await client
      .from('vehicle_plates')
      .select('id')
      .ilike('plate', norm)
      .limit(1);

    if (existing?.length) {
      return res.status(409).json({ error: 'Plat sudah terdaftar' });
    }

    const st = ['internal', 'lokal', 'eksternal'].includes(status) ? status : 'internal';
    const { data, error } = await client
      .from('vehicle_plates')
      .insert({
        plate: String(plate).trim().toUpperCase(),
        owner: owner || null,
        origin_region_id: originRegionId || null,
        status: st,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ id: data.id, plate: data.plate, status: data.status });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create plate' });
  }
});

// UPDATE PLATE
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { plate, owner, originRegionId, status, isActive } = req.body || {};
    const client = supabaseAdmin || supabase;

    // Check exists
    const { data: existing } = await client
      .from('vehicle_plates')
      .select('*')
      .eq('id', id)
      .limit(1)
      .single();

    if (!existing) return res.status(404).json({ error: 'Plate not found' });

    const norm = plate != null ? normalizePlate(plate) : null;
    if (plate != null && !norm) return res.status(400).json({ error: 'Nomor plat wajib diisi' });

    // Check duplicate
    if (norm) {
      const { data: dup } = await client
        .from('vehicle_plates')
        .select('id')
        .ilike('plate', norm)
        .neq('id', id)
        .limit(1);

      if (dup?.length) return res.status(409).json({ error: 'Plat sudah terdaftar' });
    }

    const updateData = {};
    if (plate !== undefined) updateData.plate = String(plate).trim().toUpperCase();
    if (owner !== undefined) updateData.owner = owner || null;
    if (originRegionId !== undefined) updateData.origin_region_id = originRegionId || null;
    if (status !== undefined) updateData.status = ['internal', 'lokal', 'eksternal'].includes(status) ? status : existing.status;
    if (isActive !== undefined) updateData.is_active = isActive ? 1 : 0;

    const { error } = await client
      .from('vehicle_plates')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update plate' });
  }
});

// DELETE PLATE
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = supabaseAdmin || supabase;
    const { error } = await client
      .from('vehicle_plates')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete plate' });
  }
});

// CHECK PLATE
router.post('/check', authenticate, async (req, res) => {
  try {
    const { plate, originRegionId } = req.body || {};
    const norm = normalizePlate(plate);
    if (!norm) return res.status(400).json({ error: 'Nomor plat wajib diisi' });

    const checkpointRegionId = req.user?.regionId || null;
    const client = supabaseAdmin || supabase;

    // Find registered plate
    const { data: registered } = await client
      .from('vehicle_plates')
      .select('*')
      .eq('is_active', 1)
      .limit(1)
      .single();

    let status;
    let origin;
    if (registered?.status === 'internal') {
      status = 'internal';
      origin = registered.origin_region_id || checkpointRegionId;
    } else if (registered?.status) {
      status = registered.status;
      origin = registered.origin_region_id || originRegionId || checkpointRegionId;
      if (status === 'lokal' && origin && checkpointRegionId && origin !== checkpointRegionId) {
        status = 'eksternal';
      }
    } else {
      origin = originRegionId || checkpointRegionId;
      status = origin && checkpointRegionId && origin !== checkpointRegionId ? 'eksternal' : 'lokal';
    }

    const jenisTarif = status === 'internal' ? null : status;
    let tariffAmount = 0;
    if (jenisTarif && checkpointRegionId) {
      const { data: regionTariff } = await client
        .from('region_tariffs')
        .select('nominal_tariff')
        .eq('region_id', checkpointRegionId)
        .eq('tariff_type', jenisTarif)
        .eq('is_active', 1)
        .limit(1)
        .single();
      tariffAmount = regionTariff?.nominal_tariff || 0;
    }

    // Record scan
    try {
      await client.from('plate_scans').insert({
        plate: norm,
        status,
        origin_region_id: origin,
        checkpoint_region_id: checkpointRegionId,
        tariff_amount: tariffAmount,
        officer_id: req.user?.officerId || null,
      });
    } catch (_) {}

    // Get region codes
    let originRegionCode = null;
    let checkpointRegionCode = null;

    if (origin) {
      const { data: originRow } = await client.from('regions').select('code').eq('id', origin).limit(1).single();
      originRegionCode = originRow?.code;
    }
    if (checkpointRegionId) {
      const { data: cpRow } = await client.from('regions').select('code').eq('id', checkpointRegionId).limit(1).single();
      checkpointRegionCode = cpRow?.code;
    }

    res.json({
      found: !!registered,
      plate: registered?.plate || norm,
      owner: registered?.owner || null,
      status,
      jenisTarif,
      originRegionId: origin,
      originRegionCode,
      checkpointRegionId,
      checkpointRegionCode,
      tariffAmount,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check plate' });
  }
});

module.exports = router;
