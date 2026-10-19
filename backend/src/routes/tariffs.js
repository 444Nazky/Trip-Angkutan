/**
 * Tariffs Routes - Supabase Version
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET ALL TARIFFS
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await (supabaseAdmin || supabase)
      .from('tariffs')
      .select('*')
      .eq('is_active', 1)
      .order('golongan', { ascending: true })
      .order('vehicle_type', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tariffs' });
  }
});

// CREATE TARIFF
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { golongan, vehicleType, loadedTariff, emptyTariff, description } = req.body;
    const client = supabaseAdmin || supabase;

    const { data, error } = await client
      .from('tariffs')
      .insert({
        golongan,
        vehicle_type: vehicleType,
        loaded_tariff: loadedTariff,
        empty_tariff: emptyTariff,
        description: description || '',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create tariff' });
  }
});

// UPDATE TARIFF
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const client = supabaseAdmin || supabase;

    // Check if exists
    const { data: existing } = await client
      .from('tariffs')
      .select('*')
      .eq('id', id)
      .limit(1);

    if (!existing?.length) {
      return res.status(404).json({ error: 'Tariff not found' });
    }

    const existingTariff = existing[0];
    const { golongan, vehicleType, loadedTariff, emptyTariff, description, isActive } = req.body;

    const updateData = {};
    if (golongan !== undefined) updateData.golongan = golongan;
    if (vehicleType !== undefined) updateData.vehicle_type = vehicleType;
    if (loadedTariff !== undefined) updateData.loaded_tariff = loadedTariff;
    if (emptyTariff !== undefined) updateData.empty_tariff = emptyTariff;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.is_active = isActive ? 1 : 0;

    const { error } = await client
      .from('tariffs')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update tariff' });
  }
});

// DELETE TARIFF
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const client = supabaseAdmin || supabase;

    const { error } = await client
      .from('tariffs')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete tariff' });
  }
});

module.exports = router;
