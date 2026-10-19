/**
 * Reports Routes - Supabase Version
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../lib/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ============================================
// SUMMARY
// ============================================

router.get('/summary', authenticate, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const client = supabaseAdmin || supabase;

    let tripQuery = client.from('trips').select('id', { count: 'exact', head: true });
    let vehicleQuery = client
      .from('vehicles')
      .select('id, tariff_amount', { count: 'exact', head: true })
      .not('trip_id', 'is', null);

    if (startDate && endDate) {
      const start = `${startDate}T00:00:00`;
      const end = `${endDate}T23:59:59`;
      tripQuery = tripQuery.gte('created_at', start).lte('created_at', end);
      vehicleQuery = vehicleQuery
        .gte('created_at', start)
        .lte('created_at', end);
    }

    const [tripResult, vehicleResult] = await Promise.all([
      tripQuery,
      vehicleQuery,
    ]);

    // Get revenue from vehicles
    let revenueQuery = client
      .from('vehicles')
      .select('tariff_amount')
      .not('trip_id', 'is', null);

    if (startDate && endDate) {
      const start = `${startDate}T00:00:00`;
      const end = `${endDate}T23:59:59`;
      revenueQuery = revenueQuery.gte('created_at', start).lte('created_at', end);
    }

    const { data: vehicles } = await revenueQuery;
    const totalRevenue = (vehicles || []).reduce((sum, v) => sum + (v.tariff_amount || 0), 0);

    res.json({
      totalTrips: tripResult.count || 0,
      totalVehicles: vehicleResult.count || 0,
      totalRevenue,
    });
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ============================================
// TRIPS REPORT
// ============================================

router.get('/trips', authenticate, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, route, golongan, vehicleType, status, regionId } = req.query;
    const client = supabaseAdmin || supabase;

    let query = client
      .from('trips')
      .select(`
        *,
        officers(name),
        regions(name, code)
      `)
      .order('created_at', { ascending: false })
      .limit(200);

    if (startDate && endDate) {
      query = query.gte('created_at', `${startDate}T00:00:00`).lte('created_at', `${endDate}T23:59:59`);
    }
    if (regionId) {
      query = query.eq('region_id', regionId);
    }
    if (status) {
      query = query.eq('status_muatan', status);
    }

    const { data: trips, error } = await query;
    if (error) throw error;

    // Get vehicles for each trip
    const tripIds = (trips || []).map(t => t.id);
    let vehicles = [];

    if (tripIds.length) {
      const { data: tvData } = await client
        .from('trip_vehicles')
        .select('trip_id, vehicles(*)')
        .in('trip_id', tripIds);

      vehicles = (tvData || []).map(tv => ({
        ...tv.vehicles,
        trip_id: tv.trip_id,
      }));
    }

    // Filter by vehicle type/golongan if specified
    let filteredVehicles = vehicles;
    if (golongan) {
      filteredVehicles = filteredVehicles.filter(v => v.golongan === golongan);
    }
    if (vehicleType) {
      filteredVehicles = filteredVehicles.filter(v => v.vehicle_type === vehicleType);
    }

    // Group vehicles by trip
    const vehiclesByTrip = {};
    for (const v of filteredVehicles) {
      if (!vehiclesByTrip[v.trip_id]) {
        vehiclesByTrip[v.trip_id] = [];
      }
      vehiclesByTrip[v.trip_id].push(v);
    }

    // Format response
    let result = (trips || []).map(t => ({
      ...t,
      officer_name: t.officers?.name,
      region_name: t.regions?.name,
      region_code: t.regions?.code,
      vehicles: vehiclesByTrip[t.id] || [],
      vehicle_count: (vehiclesByTrip[t.id] || []).length,
      trip_revenue: (vehiclesByTrip[t.id] || []).reduce((sum, v) => sum + (v.tariff_amount || 0), 0),
    }));

    // Filter by route
    if (route) {
      const upperRoute = route.toUpperCase();
      result = result.filter(t =>
        (t.route_from && t.route_from.toUpperCase().includes(upperRoute)) ||
        (t.route_to && t.route_to.toUpperCase().includes(upperRoute))
      );
    }

    res.json(result);
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// ============================================
// FILTER OPTIONS
// ============================================

router.get('/trips/filters', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = supabaseAdmin || supabase;

    const { data: tariffs } = await client
      .from('tariffs')
      .select('golongan, vehicle_type')
      .eq('is_active', 1)
      .order('golongan', { ascending: true });

    const golongan = [...new Set((tariffs || []).map(t => t.golongan).filter(Boolean))].sort();
    const vehicleTypes = [...new Set((tariffs || []).map(t => t.vehicle_type).filter(Boolean))].sort();

    res.json({ golongan, vehicleTypes });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});

module.exports = router;
