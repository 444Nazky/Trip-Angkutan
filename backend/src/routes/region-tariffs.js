/**
 * Region Tariffs Routes - Supabase Version
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET ALL REGION TARIFFS
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = supabaseAdmin || supabase;

    const { data: regions, error } = await client
      .from('regions')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    const regionIds = (regions || []).map(r => r.id);

    // Get all tariffs
    const { data: tariffs } = await client
      .from('region_tariffs')
      .select('*')
      .in('region_id', regionIds);

    const tariffsByRegion = {};
    for (const t of (tariffs || [])) {
      if (!tariffsByRegion[t.region_id]) {
        tariffsByRegion[t.region_id] = {};
      }
      tariffsByRegion[t.region_id][t.tariff_type] = t;
    }

    const result = (regions || []).map(r => ({
      id: r.id,
      name: r.name,
      code: r.code,
      lokal_tariff: tariffsByRegion[r.id]?.lokal?.nominal_tariff || 0,
      lokal_active: tariffsByRegion[r.id]?.lokal?.is_active || 0,
      eksternal_tariff: tariffsByRegion[r.id]?.eksternal?.nominal_tariff || 0,
      eksternal_active: tariffsByRegion[r.id]?.eksternal?.is_active || 0,
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch region tariffs' });
  }
});

// UPDATE REGION TARIFF
router.put('/:regionId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { regionId } = req.params;
    const { tariffType, nominalTariff, isActive } = req.body || {};

    if (!['lokal', 'eksternal'].includes(tariffType)) {
      return res.status(400).json({ error: "tariffType harus 'lokal' atau 'eksternal'" });
    }

    const client = supabaseAdmin || supabase;

    // Check region exists
    const { data: region } = await client
      .from('regions')
      .select('id')
      .eq('id', regionId)
      .limit(1);

    if (!region?.length) {
      return res.status(404).json({ error: 'Region not found' });
    }

    // Check existing tariff
    const { data: existing } = await client
      .from('region_tariffs')
      .select('id')
      .eq('region_id', regionId)
      .eq('tariff_type', tariffType)
      .limit(1)
      .single();

    const nominal = Number.isFinite(Number(nominalTariff)) ? Number(nominalTariff) : 0;
    const active = isActive === undefined ? 1 : (isActive ? 1 : 0);

    if (existing) {
      await client
        .from('region_tariffs')
        .update({ nominal_tariff: nominal, is_active: active })
        .eq('id', existing.id);
    } else {
      await client
        .from('region_tariffs')
        .insert({
          id: `${regionId}:${tariffType}`,
          region_id: regionId,
          tariff_type: tariffType,
          nominal_tariff: nominal,
          is_active: active,
        });
    }

    res.json({ success: true, regionId, tariffType, nominalTariff: nominal, isActive: active });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update region tariff' });
  }
});

module.exports = router;
