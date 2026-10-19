/**
 * Routes (Rute) Routes - Supabase Version
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET OFFICER'S ROUTES
router.get('/mine', authenticate, async (req, res) => {
  try {
    const officerId = req.user?.officerId;
    if (!officerId) {
      return res.status(403).json({ error: 'Officer access required' });
    }

    const client = supabaseAdmin || supabase;

    const { data, error } = await client
      .from('officer_dermagas')
      .select(`
        dermagas(
          id,
          name,
          code,
          routes(
            id, name, route_from, route_to, distance, duration
          )
        )
      `)
      .eq('officer_id', officerId);

    if (error) throw error;

    const result = [];
    for (const od of (data || [])) {
      const dm = od.dermagas;
      if (dm?.routes) {
        for (const r of dm.routes) {
          result.push({
            id: r.id,
            name: r.name,
            route_from: r.route_from,
            route_to: r.route_to,
            distance: r.distance,
            duration: r.duration,
            dermaga_id: dm.id,
            dermaga_name: dm.name,
            dermaga_code: dm.code,
          });
        }
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch officer routes' });
  }
});

// GET ALL ROUTES
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = supabaseAdmin || supabase;

    const { data, error } = await client
      .from('routes')
      .select(`
        *,
        dermagas(name, code),
        regions:dermaga.region_id(name)
      `)
      .order('name', { ascending: true });

    if (error) throw error;

    const result = (data || []).map(r => ({
      ...r,
      dermaga_name: r.dermagas?.name,
      dermaga_code: r.dermagas?.code,
      region_name: r.regions?.name,
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
});

// CREATE ROUTE
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { dermaga_id, name, route_from, route_to, distance, duration } = req.body;
    const client = supabaseAdmin || supabase;

    const { data, error } = await client
      .from('routes')
      .insert({
        dermaga_id,
        name,
        route_from,
        route_to,
        distance: distance || null,
        duration: duration || null,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create route' });
  }
});

// UPDATE ROUTE
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, route_from, route_to, distance, duration } = req.body;
    const client = supabaseAdmin || supabase;

    const { error } = await client
      .from('routes')
      .update({
        name,
        route_from,
        route_to,
        distance: distance || null,
        duration: duration || null,
      })
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update route' });
  }
});

// DELETE ROUTE
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = supabaseAdmin || supabase;
    const { error } = await client
      .from('routes')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete route' });
  }
});

module.exports = router;
