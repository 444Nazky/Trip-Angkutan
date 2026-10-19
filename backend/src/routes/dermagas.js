/**
 * Dermagas Routes - Supabase Version
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET ALL DERMAGAS
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from('dermagas')
      .select(`
        *,
        regions(name, code)
      `)
      .order('name', { ascending: true });

    if (error) throw error;

    const result = (data || []).map(d => ({
      ...d,
      region_name: d.regions?.name,
      region_code: d.regions?.code,
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dermagas' });
  }
});

// CREATE DERMAGA
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { region_id, name, code } = req.body;
    const client = supabaseAdmin || supabase;

    const { data, error } = await client
      .from('dermagas')
      .insert({
        region_id,
        name,
        code,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create dermaga' });
  }
});

// UPDATE DERMAGA
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code } = req.body;
    const client = supabaseAdmin || supabase;

    const { error } = await client
      .from('dermagas')
      .update({ name, code })
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update dermaga' });
  }
});

// DELETE DERMAGA
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const client = supabaseAdmin || supabase;

    // Delete related records first
    await client.from('routes').delete().eq('dermaga_id', id);
    await client.from('officer_dermagas').delete().eq('dermaga_id', id);
    await client.from('dermagas').delete().eq('id', id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete dermaga' });
  }
});

module.exports = router;
