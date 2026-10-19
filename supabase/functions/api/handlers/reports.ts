// Reports handlers (port of backend/src/routes/reports.js) — admin only.
import { db, json, requireAdmin } from "../_shared.ts";

function dateRange(url: URL): { start?: string; end?: string } {
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  if (!startDate || !endDate) return {};
  return { start: `${startDate}T00:00:00`, end: `${endDate}T23:59:59` };
}

// GET /reports/summary
export async function summary(req: Request, url: URL): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const range = dateRange(url);

    let tripQuery = db.from("trips").select("id", { count: "exact", head: true });
    let vehicleQuery = db
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .not("trip_id", "is", null);
    let revenueQuery = db.from("vehicles").select("tariff_amount").not("trip_id", "is", null);

    if (range.start && range.end) {
      tripQuery = tripQuery.gte("created_at", range.start).lte("created_at", range.end);
      vehicleQuery = vehicleQuery.gte("created_at", range.start).lte("created_at", range.end);
      revenueQuery = revenueQuery.gte("created_at", range.start).lte("created_at", range.end);
    }

    const [tripResult, vehicleResult, revenueResult] = await Promise.all([tripQuery, vehicleQuery, revenueQuery]);

    return json({
      totalTrips: tripResult.count || 0,
      totalVehicles: vehicleResult.count || 0,
      totalRevenue: (revenueResult.data ?? []).reduce((s: number, v: any) => s + (v.tariff_amount || 0), 0),
    });
  } catch (error) {
    console.error("Summary error:", error);
    return json({ error: "Failed to fetch summary" }, 500);
  }
}

// GET /reports/trips
export async function tripsReport(req: Request, url: URL): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const range = dateRange(url);
    const regionId = url.searchParams.get("regionId");
    const status = url.searchParams.get("status");
    const golongan = url.searchParams.get("golongan");
    const vehicleType = url.searchParams.get("vehicleType");
    const route = url.searchParams.get("route");

    let query = db
      .from("trips")
      .select("*, officers(name), regions(name, code)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (range.start && range.end) query = query.gte("created_at", range.start).lte("created_at", range.end);
    if (regionId) query = query.eq("region_id", regionId);
    if (status) query = query.eq("status_muatan", status);

    const { data: trips, error } = await query;
    if (error) throw error;

    const tripIds = (trips ?? []).map((t: any) => t.id);
    let vehicles: any[] = [];

    if (tripIds.length) {
      const { data: tvData } = await db
        .from("trip_vehicles")
        .select("trip_id, vehicles(*)")
        .in("trip_id", tripIds);
      vehicles = (tvData ?? []).map((tv: any) => ({ ...tv.vehicles, trip_id: tv.trip_id }));
    }

    let filtered = vehicles;
    if (golongan) filtered = filtered.filter((v) => v.golongan === golongan);
    if (vehicleType) filtered = filtered.filter((v) => v.vehicle_type === vehicleType);

    const vehiclesByTrip = new Map<string, any[]>();
    for (const v of filtered) {
      if (!vehiclesByTrip.has(v.trip_id)) vehiclesByTrip.set(v.trip_id, []);
      vehiclesByTrip.get(v.trip_id)!.push(v);
    }

    let result = (trips ?? []).map((t: any) => {
      const tv = vehiclesByTrip.get(t.id) ?? [];
      return {
        ...t,
        officer_name: t.officers?.name,
        region_name: t.regions?.name,
        region_code: t.regions?.code,
        vehicles: tv,
        vehicle_count: tv.length,
        trip_revenue: tv.reduce((s, v) => s + (v.tariff_amount || 0), 0),
      };
    });

    if (route) {
      const upperRoute = route.toUpperCase();
      result = result.filter(
        (t: any) =>
          (t.route_from && t.route_from.toUpperCase().includes(upperRoute)) ||
          (t.route_to && t.route_to.toUpperCase().includes(upperRoute)),
      );
    }

    return json(result);
  } catch (error) {
    console.error("Report error:", error);
    return json({ error: "Failed to fetch report" }, 500);
  }
}

// GET /reports/trips/filters
export async function tripFilters(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { data: tariffs, error } = await db
      .from("tariffs")
      .select("golongan, vehicle_type")
      .eq("is_active", 1)
      .order("golongan", { ascending: true });
    if (error) throw error;

    return json({
      golongan: [...new Set((tariffs ?? []).map((t: any) => t.golongan).filter(Boolean))].sort(),
      vehicleTypes: [...new Set((tariffs ?? []).map((t: any) => t.vehicle_type).filter(Boolean))].sort(),
    });
  } catch (error) {
    console.error("Filters error:", error);
    return json({ error: "Failed to fetch filter options" }, 500);
  }
}
