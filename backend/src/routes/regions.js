/**
 * Regions Routes - Supabase Version
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET ALL REGIONS
router.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await (supabaseAdmin || supabase)
      .from('regions')
      .select('id, name, code')
      .order('name', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch regions' });
  }
});

// CREATE REGION
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, code } = req.body;
    const client = supabaseAdmin || supabase;

    const { data, error } = await client
      .from('regions')
      .insert({ name, code })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create region' });
  }
});

// UPDATE REGION
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, password } = req.body;
    const client = supabaseAdmin || supabase;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code;
    if (password !== undefined) updateData.password = password;

    const { error } = await client
      .from('regions')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update region' });
  }
});

// DELETE REGION
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const client = supabaseAdmin || supabase;

    const { error } = await client
      .from('regions')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete region' });
  }
});

module.exports = router;
