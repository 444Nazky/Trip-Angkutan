/**
 * Officers Routes - Supabase Version
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET ALL OFFICERS
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = supabaseAdmin || supabase;

    // Get all officers with region info
    const { data: officers, error } = await client
      .from('officers')
      .select(`
        id, name, username, region_id, is_active,
        regions!officers_region_id_fkey(name, code)
      `)
      .order('name', { ascending: true });

    if (error) throw error;

    // Get dermagas and regions for each officer
    const result = [];
    for (const o of (officers || [])) {
      // Get officer regions
      const { data: officerRegions } = await client
        .from('officer_regions')
        .select('regions(id, name, code)')
        .eq('officer_id', o.id);

      // Get officer dermagas
      const { data: officerDermagas } = await client
        .from('officer_dermagas')
        .select('dermagas(id, name, code, region_id)')
        .eq('officer_id', o.id);

      result.push({
        ...o,
        region_name: o.regions?.name,
        region_code: o.regions?.code,
        regions: officerRegions?.map(or => or.regions).filter(Boolean) || [],
        dermagas: officerDermagas?.map(od => od.dermagas).filter(Boolean) || [],
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Fetch officers error:', error);
    res.status(500).json({ error: 'Failed to fetch officers' });
  }
});

// GET OFFICERS IN MY REGION
router.get('/my-region', authenticate, async (req, res) => {
  try {
    const meId = String(req.user.officerId ?? '');
    if (!meId) return res.status(401).json({ error: 'Not authenticated' });

    const client = supabaseAdmin || supabase;

    // Get my regions
    const { data: myOfficerRegions } = await client
      .from('officer_regions')
      .select('region_id')
      .eq('officer_id', meId);

    const myRegionIds = new Set((myOfficerRegions || []).map(r => r.region_id));

    // Get all officers
    const { data: officers } = await client
      .from('officers')
      .select(`
        *,
        regions!officers_region_id_fkey(name, code)
      `)
      .order('name', { ascending: true });

    const result = [];

    for (const o of (officers || [])) {
      // Get this officer's regions
      const { data: officerRegions } = await client
        .from('officer_regions')
        .select('regions(id, name, code)')
        .eq('officer_id', o.id);

      // Get this officer's dermagas
      const { data: officerDermagas } = await client
        .from('officer_dermagas')
        .select('dermagas(id, name, code, region_id)')
        .eq('officer_id', o.id);

      const regions = officerRegions?.map(or => or.regions).filter(Boolean) || [];
      const dermagas = officerDermagas?.map(od => od.dermagas).filter(Boolean) || [];

      // Check if shares region with me
      const sharesRegion = regions.some(r => myRegionIds.has(r.id)) ||
        myRegionIds.has(o.region_id);

      if (sharesRegion || String(o.id) === meId) {
        result.push({
          ...o,
          region_name: o.regions?.name,
          region_code: o.regions?.code,
          regions,
          dermagas,
        });
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Fetch my-region officers error:', error);
    res.status(500).json({ error: 'Failed to fetch officers' });
  }
});

// CREATE OFFICER
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, username, pin, regionId, regionIds, dermagaIds } = req.body || {};
    const cleanName = String(name ?? '').trim();

    if (!cleanName) return res.status(400).json({ error: 'Nama wajib diisi' });
    if (!pin || String(pin).length < 4) {
      return res.status(400).json({ error: 'PIN minimal 4 digit' });
    }

    const client = supabaseAdmin || supabase;

    // Generate username
    const base = String(username ?? '').trim().toLowerCase().replace(/\s+/g, '')
      || cleanName.toLowerCase().replace(/\s+/g, '');

    // Check if username exists
    let candidate = base;
    let n = 2;
    while (true) {
      const { data: existing } = await client
        .from('officers')
        .select('id')
        .ilike('username', candidate)
        .limit(1);

      if (!existing?.length) break;
      candidate = `${base}-${n++}`;
    }

    const hashedPin = bcrypt.hashSync(String(pin), 10);
    const id = helpers.uuid();
    const primaryRegionId = Array.isArray(regionIds) && regionIds.length > 0
      ? regionIds[0]
      : regionId;

    // Insert officer
    const { error: insertError } = await client
      .from('officers')
      .insert({
        id,
        name: cleanName,
        username: candidate,
        pin: hashedPin,
        region_id: primaryRegionId,
      });

    if (insertError) throw insertError;

    // Link regions
    const ids = Array.isArray(regionIds) && regionIds.length > 0
      ? regionIds
      : [primaryRegionId];

    if (ids.length) {
      const regionLinks = ids.map(rid => ({
        officer_id: id,
        region_id: rid,
      }));
      await client.from('officer_regions').upsert(regionLinks, { ignoreDuplicates: true });
    }

    // Link dermagas
    if (Array.isArray(dermagaIds) && dermagaIds.length > 0) {
      const dermagaLinks = dermagaIds.filter(Boolean).map(dmId => ({
        officer_id: id,
        dermaga_id: dmId,
      }));
      await client.from('officer_dermagas').upsert(dermagaLinks, { ignoreDuplicates: true });
    }

    res.status(201).json({ id, name: cleanName, username: candidate, regionIds: ids });
  } catch (error) {
    console.error('Create officer error:', error);
    res.status(500).json({ error: 'Failed to create officer' });
  }
});

// UPDATE OFFICER DERMAGAS
router.put('/:id/dermagas', authenticate, requireAdmin, async (req, res) => {
  try {
    const { dermagaIds } = req.body || {};
    if (!Array.isArray(dermagaIds)) {
      return res.status(400).json({ error: 'dermagaIds harus berupa array' });
    }

    const officerId = String(req.params.id);
    const client = supabaseAdmin || supabase;

    // Delete existing
    await client
      .from('officer_dermagas')
      .delete()
      .eq('officer_id', officerId);

    // Insert new
    const links = dermagaIds.filter(Boolean).map(dmId => ({
      officer_id: officerId,
      dermaga_id: String(dmId),
    }));

    if (links.length) {
      await client.from('officer_dermagas').upsert(links, { ignoreDuplicates: true });
    }

    res.json({ success: true, dermagaIds: dermagaIds.filter(Boolean).map(String) });
  } catch (error) {
    console.error('Update officer dermagas error:', error);
    res.status(500).json({ error: 'Failed to update officer dermagas' });
  }
});

// UPDATE OFFICER REGIONS
router.put('/:id/regions', authenticate, requireAdmin, async (req, res) => {
  try {
    const { regionIds } = req.body || {};
    if (!Array.isArray(regionIds) || regionIds.length === 0) {
      return res.status(400).json({ error: 'regionIds harus berupa array dan tidak kosong' });
    }

    const officerId = String(req.params.id);
    const client = supabaseAdmin || supabase;

    // Delete existing
    await client
      .from('officer_regions')
      .delete()
      .eq('officer_id', officerId);

    // Insert new
    const links = regionIds.map(rid => ({
      officer_id: officerId,
      region_id: String(rid),
    }));

    await client.from('officer_regions').upsert(links, { ignoreDuplicates: true });

    // Update primary region
    await client
      .from('officers')
      .update({ region_id: String(regionIds[0]) })
      .eq('id', officerId);

    res.json({ success: true, regionIds: regionIds.map(String) });
  } catch (error) {
    console.error('Update officer regions error:', error);
    res.status(500).json({ error: 'Failed to update officer regions' });
  }
});

// UPDATE OFFICER PIN
router.put('/:id/pin', authenticate, requireAdmin, async (req, res) => {
  try {
    const { pin } = req.body;
    const hashedPin = bcrypt.hashSync(String(pin), 10);

    const client = supabaseAdmin || supabase;
    const { error } = await client
      .from('officers')
      .update({ pin: hashedPin })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update PIN' });
  }
});

// UPDATE OFFICER STATUS
router.put('/:id/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const { isActive } = req.body;
    const client = supabaseAdmin || supabase;

    const { error } = await client
      .from('officers')
      .update({ is_active: isActive ? 1 : 0 })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE OFFICER
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const officerId = String(req.params.id);
    const client = supabaseAdmin || supabase;

    await client.from('officer_regions').delete().eq('officer_id', officerId);
    await client.from('officer_dermagas').delete().eq('officer_id', officerId);
    const { error } = await client.from('officers').delete().eq('id', officerId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete officer' });
  }
});

module.exports = router;
