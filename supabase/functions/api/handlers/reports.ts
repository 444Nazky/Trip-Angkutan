// Reports handlers (port of backend/src/routes/reports.js) — admin only.
import { db, json, requireAdmin } from "../_shared.ts";

function dateRange(url: URL): { start?: string; end?: string } {
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  if (!startDate || !endDate) return {};
  return { start: `${startDate}T00:00:00`, end: `${endDate}T23:59:59` };
}

// Kategori operasional kendaraan (bukan Golongan master tarif I..V).
const OPERATIONAL_CATEGORIES = ["Internal", "Eksternal", "Lokal"];

// Normalisasi nilai golongan pada tabel vehicles menjadi kategori operasional.
function normalizeGolongan(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("internal")) return "Internal";
  if (s.startsWith("eksternal")) return "Eksternal";
  if (s.startsWith("lokal")) return "Lokal";
  return null;
}

// Status plat pada tabel vehicle_plates / plate_scans memakai huruf kecil.
function normalizePlateStatus(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "internal") return "Internal";
  if (s === "eksternal") return "Eksternal";
  if (s === "lokal") return "Lokal";
  return null;
}

// Samakan bentuk nomor plat agar bisa dibandingkan antar tabel.
function plateKey(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Ambil kategori operasional per plat dari hasil pemindaian plat terbaru.
// Sumber urutan: plate_scans (paling baru) -> vehicle_plates (master plat).
async function fetchPlateCategories(plates: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const keys = [...new Set(plates.map(plateKey).filter(Boolean))];
  if (!keys.length) return map;

  const { data: scans } = await db
    .from("plate_scans")
    .select("*")
    .limit(5000);

  const latest = new Map<string, { status: string; at: string }>();
  for (const row of (scans ?? []) as any[]) {
    const key = plateKey(row.plate);
    const status = normalizePlateStatus(row.status);
    if (!key || !status) continue;
    const at = String(row.created_at ?? row.scanned_at ?? row.checked_at ?? "");
    const prev = latest.get(key);
    if (!prev || at > prev.at) latest.set(key, { status, at });
  }
  for (const [key, v] of latest) map.set(key, v.status);

  const { data: masterPlates } = await db
    .from("vehicle_plates")
    .select("plate, status")
    .limit(5000);

  for (const row of (masterPlates ?? []) as any[]) {
    const key = plateKey(row.plate);
    const status = normalizePlateStatus(row.status);
    if (!key || !status) continue;
    if (!map.has(key)) map.set(key, status);
  }

  return map;
}

// Cocokkan filter golongan: bandingkan kategori operasional, atau nilai mentah
// bila memang kategori lawas (mis. "V") yang dipilih.
function matchesGolongan(raw: unknown, target: string): boolean {
  const t = String(target ?? "").trim().toLowerCase();
  if (!t) return true;
  const norm = normalizeGolongan(raw);
  if (norm) return norm.toLowerCase() === t;
  return String(raw ?? "").trim().toLowerCase() === t;
}

// Fetch all active tariffs for tariff recalculation
async function getAllActiveTariffs(): Promise<Map<string, { loaded: number; empty: number }>> {
  const { data, error } = await db
    .from("tariffs")
    .select("golongan, vehicle_type, loaded_tariff, empty_tariff")
    .eq("is_active", 1);

  if (error || !data) return new Map();

  const tariffMap = new Map<string, { loaded: number; empty: number }>();
  for (const t of data) {
    // Key format: "vehicle_type|golongan" for precise matching
    const key1 = `${t.vehicle_type}|${t.golongan}`;
    const key2 = `${t.vehicle_type}|`; // fallback without golongan
    tariffMap.set(key1, { loaded: t.loaded_tariff, empty: t.empty_tariff });
    if (!tariffMap.has(key2)) {
      tariffMap.set(key2, { loaded: t.loaded_tariff, empty: t.empty_tariff });
    }
  }
  return tariffMap;
}

// Calculate tariff amount for a vehicle based on vehicle_type, golongan, and has_load
function calculateTariffAmount(
  vehicleType: string,
  golongan: string | null,
  hasLoad: number,
  tariffMap: Map<string, { loaded: number; empty: number }>,
): number {
  // Try precise match first (vehicle_type + golongan)
  const key1 = `${vehicleType}|${golongan || ''}`;
  const tariff1 = tariffMap.get(key1);
  if (tariff1) {
    return hasLoad ? tariff1.loaded : tariff1.empty;
  }

  // Fallback: vehicle_type only
  const key2 = `${vehicleType}|`;
  const tariff2 = tariffMap.get(key2);
  if (tariff2) {
    return hasLoad ? tariff2.loaded : tariff2.empty;
  }

  return 0;
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
    const muatan = url.searchParams.get("muatan"); // ada | tanpa (status muatan kendaraan)
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();

    // Fetch active tariffs for recalculation
    const tariffMap = await getAllActiveTariffs();

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

    // Recalculate tariff_amount for vehicles that have 0 or null tariff_amount
    vehicles = vehicles.map((v) => {
      if (!v.tariff_amount || v.tariff_amount === 0) {
        const calculatedAmount = calculateTariffAmount(
          v.vehicle_type,
          v.golongan,
          v.has_load,
          tariffMap,
        );
        return { ...v, tariff_amount: calculatedAmount };
      }
      return v;
    });

    // Kategori operasional kendaraan (Internal / Eksternal / Lokal) diambil dari
    // pindaian plat terbaru; nilai lama pada kolom vehicles dipakai sebagai cadangan.
    const plateCategories = await fetchPlateCategories(
      vehicles.map((v: any) => v.no_polisi),
    );
    vehicles = vehicles.map((v: any) => {
      const fromScan = plateCategories.get(plateKey(v.no_polisi)) ?? null;
      const stored = normalizeGolongan(v.golongan);
      return { ...v, kategori: fromScan ?? stored };
    });

    let filtered = vehicles;
    if (golongan) filtered = filtered.filter((v) => matchesGolongan(v.kategori, golongan));
    if (vehicleType) filtered = filtered.filter((v) => v.vehicle_type === vehicleType);
    if (muatan === "ada") filtered = filtered.filter((v) => Number(v.has_load) > 0);
    if (muatan === "tanpa") filtered = filtered.filter((v) => !Number(v.has_load));

    // Pencarian bebas: cocok di tingkat trip (no trip, petugas, rute, wilayah)
    // atau di tingkat kendaraan (plat, jenis, kategori).
    if (q) {
      const tripMeta = new Map<string, string[]>();
      for (const t of (trips ?? []) as any[]) {
        tripMeta.set(t.id, [
          t.no_trip,
          t.officers?.name,
          t.route_from,
          t.route_to,
          t.route_from_name,
          t.route_to_name,
          t.regions?.name,
          t.regions?.code,
        ].map((x) => String(x ?? "").toLowerCase()));
      }
      filtered = filtered.filter((v) => {
        const tripHit = (tripMeta.get(v.trip_id) || []).some((x) => x.includes(q));
        if (tripHit) return true;
        return [v.no_polisi, v.vehicle_type, v.golongan, v.kategori]
          .map((x) => String(x ?? "").toLowerCase())
          .some((x) => x.includes(q));
      });
    }

    const vehiclesByTrip = new Map<string, any[]>();
    for (const v of filtered) {
      if (!vehiclesByTrip.has(v.trip_id)) vehiclesByTrip.set(v.trip_id, []);
      vehiclesByTrip.get(v.trip_id)!.push(v);
    }

    let result = (trips ?? []).map((t: any) => {
      const tv = vehiclesByTrip.get(t.id) ?? [];
      // Collect all vehicle photos plus trip proof photo
      const allPhotos = [
        ...tv.map((v: any) => v.foto_path).filter(Boolean),
        t.foto_kosong_path,
      ].filter(Boolean);

      return {
        ...t,
        officer_name: t.officers?.name,
        region_name: t.regions?.name,
        region_code: t.regions?.code,
        vehicles: tv,
        vehicle_count: tv.length,
        trip_revenue: tv.reduce((s: number, v: any) => s + (v.tariff_amount || 0), 0),
        all_photos: allPhotos,
        trip_photo: t.foto_kosong_path,
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

    // Opsi diturunkan dari data kendaraan yang benar-benar dipakai di lapangan,
    // bukan dari master tarif (yang masih memakai Golongan I..V).
    const { data: vehRows, error: vehError } = await db
      .from("vehicles")
      .select("golongan, vehicle_type")
      .not("trip_id", "is", null)
      .limit(5000);
    if (vehError) throw vehError;

    const foundTypes = new Set<string>();
    for (const v of (vehRows ?? []) as any[]) {
      if (v.vehicle_type) foundTypes.add(String(v.vehicle_type));
    }

    const { data: tariffs, error } = await db
      .from("tariffs")
      .select("golongan, vehicle_type")
      .eq("is_active", 1)
      .order("golongan", { ascending: true });
    if (error) throw error;

    const vehicleTypes = foundTypes.size > 0
      ? [...foundTypes].sort()
      : [...new Set((tariffs ?? []).map((t: any) => t.vehicle_type).filter(Boolean))].sort();

    // Selalu kembalikan tiga kategori operasional, urut Internal - Eksternal - Lokal.
    const golongan = OPERATIONAL_CATEGORIES.slice();

    return json({ golongan, vehicleTypes });
  } catch (error) {
    console.error("Filters error:", error);
    return json({ error: "Failed to fetch filter options" }, 500);
  }
}
