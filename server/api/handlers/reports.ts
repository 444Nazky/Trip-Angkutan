// Reports handlers (port of backend/src/routes/reports.js) — admin only.
import { db, json, requireAdmin } from "../_shared.ts";
import {
  resolveTariff,
  hasColumn,
  normalizeCategory,
  type TariffSource,
} from "./tariffRules.ts";

function dateRange(url: URL): { start?: string; end?: string } {
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  if (!startDate || !endDate) return {};
  return { start: `${startDate}T00:00:00`, end: `${endDate}T23:59:59` };
}

// Kategori operasional kendaraan (bukan Golongan master tarif I..V).
const OPERATIONAL_CATEGORIES = ["Internal", "Eksternal", "Lokal"];

// Normalisasi nilai golongan pada tabel vehicles menjadi kategori operasional.
// (Data lawas: kolom `golongan` sempat berisi kategori, bukan gol master I..V.)
function normalizeLegacyCategory(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("internal")) return "Internal";
  if (s.startsWith("eksternal")) return "Eksternal";
  if (s.startsWith("lokal")) return "Lokal";
  return null;
}

// Id dermaga/rute bertipe uuid di database — divalidasi sebelum dipakai query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const norm = normalizeLegacyCategory(raw);
  if (norm) return norm.toLowerCase() === t;
  return String(raw ?? "").trim().toLowerCase() === t;
}

// ── Perhitungan tarif laporan ────────────────────────────────────────────────
//
// ATURAN HARGA LAPORAN: harga yang ditampilkan untuk sebuah trip ADALAH harga
// yang tercatat ketika trip itu dikirim (snapshot di vehicles.tariff_amount).
//
// Admin boleh mengubah tarif kapan saja, tetapi perubahan itu hanya berlaku
// untuk trip SELANJUTNYA. Trip yang sudah terkirim tetap memakai harga
// lamanya.
//
// Contoh: tarif 50.000 berlaku sampai 31 Desember. 2 Januari admin mengubahnya
// jadi 75.000. Trip yang dikirim 1 Januari tetap tercatat Rp 50.000; trip yang
// dikirim 2 Januari tercatat Rp 75.000.
//
// Karena itu laporan TIDAK lagi menghitung ulang tarif memakai master/region
// yang berlaku SEKARANG. Tarif terkini hanya dipakai:
//   - saat INSERT trip (menentukan harga snapshot), dan
//   - untuk baris lawas yang sama sekali tidak punya harga tersimpan
//     (fallback supaya laporan tidak ikut jadi Rp 0).

interface EffectiveTariff {
  amount: number;
  source: TariffSource;
}

/**
 * Ambil harga snapshot yang tersimpan pada baris kendaraan.
 *
 * Mengembalikan null HANYA kalau baris itu benar-benar tidak punya informasi
 * harga (data lawas sebelum tarif_amount terisi) — pemanggil lalu memakai
 * tarif yang berlaku sekarang sebagai gantinya.
 */
export function snapshotTariff(vehicle: any): EffectiveTariff | null {
  const stored = Number(vehicle?.tariff_amount ?? 0) || 0;
  const raw = String(vehicle?.tarif_source ?? "").trim();
  const source = raw as TariffSource;

  // Harga tersimpan > 0 -> inilah harga saat trip dikirim. Dipakai apa adanya,
  // berapa pun harga master/region yang berlaku sekarang.
  if (stored > 0) {
    // "tanpa-tarif" + nominal > 0 berarti nominalnya datang dari perangkat
    // petugas (server tidak punya sumber harga) -> tetap harga saat dikirim.
    return {
      amount: stored,
      source: source && source !== "tanpa-tarif" ? source : "snapshot",
    };
  }
  // Harga 0 yang sudah berlabel (mis. "internal") -> memang gratis / tanpa
  // tarif ketika trip dikirim. Jangan diisi ulang dengan tarif yang lebih baru.
  if (source) return { amount: 0, source };
  return null;
}

/**
 * Hitung tarif efektif untuk satu baris kendaraan.
 * Mengembalikan null bila tidak ada sumber harga (pemanggil pakai nilai lama).
 */
async function effectiveTariff(
  vehicle: any,
  regionId: string | null,
  kategori: string | null,
): Promise<EffectiveTariff | null> {
  const resolved = await resolveTariff({
    vehicleType: vehicle.vehicle_type,
    hasLoad: Number(vehicle.has_load) > 0,
    golongan: vehicle.golongan,
    kategori,
    regionId,
  });
  if (resolved.source === "tanpa-tarif") return null;
  return { amount: resolved.amount, source: resolved.source };
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
    const dermagaId = url.searchParams.get("dermagaId");
    const routeId = url.searchParams.get("routeId");
    const status = url.searchParams.get("status");
    const golongan = url.searchParams.get("golongan");
    const vehicleType = url.searchParams.get("vehicleType");
    const route = url.searchParams.get("route");
    const muatan = url.searchParams.get("muatan"); // ada | tanpa (status muatan kendaraan)
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();

    if (dermagaId && !UUID_RE.test(dermagaId)) return json({ error: "dermagaId tidak valid" }, 400);
    if (routeId && !UUID_RE.test(routeId)) return json({ error: "routeId tidak valid" }, 400);

    let query = db
      .from("trips")
      .select("*, officers(name), regions(name, code), dermagas(name, code), routes(name, route_from, route_to)")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (range.start && range.end) query = query.gte("created_at", range.start).lte("created_at", range.end);
    if (regionId) query = query.eq("region_id", regionId);
    if (dermagaId) query = query.eq("dermaga_id", dermagaId);
    if (status) query = query.eq("status_muatan", status);

    const { data: fetchedTrips, error } = await query;
    if (error) throw error;
    let trips = fetchedTrips ?? [];

    // Filter Rute: trip lawas tidak punya route_id (kolom selalu NULL), jadi
    // selain cocok lewat route_id, trip juga cocok lewat identitas rute yang
    // benar-benar tersimpan: route_from + route_to + dermaga_id.
    if (routeId) {
      const { data: routeRows, error: routeError } = await db
        .from("routes")
        .select("id, route_from, route_to, dermaga_id")
        .eq("id", routeId)
        .limit(1);
      if (routeError) throw routeError;
      const route = (routeRows ?? [])[0];
      if (!route) return json([]); // Rute tidak ada -> bukan error, memang tidak ada trip.
      const from = String(route.route_from ?? "").trim().toUpperCase();
      const to = String(route.route_to ?? "").trim().toUpperCase();
      const dock = String(route.dermaga_id ?? "");
      trips = trips.filter((t: any) => {
        if (t.route_id) return String(t.route_id) === routeId;
        return String(t.route_from ?? "").trim().toUpperCase() === from
            && String(t.route_to ?? "").trim().toUpperCase() === to
            && String(t.dermaga_id ?? "") === dock;
      });
    }

    const tripIds = trips.map((t: any) => t.id);
    let vehicles: any[] = [];

    if (tripIds.length) {
      const { data: tvData } = await db
        .from("trip_vehicles")
        .select("trip_id, vehicles(*)")
        .in("trip_id", tripIds);
      vehicles = (tvData ?? []).map((tv: any) => ({ ...tv.vehicles, trip_id: tv.trip_id }));
    }

    // Kategori operasional kendaraan (Internal / Eksternal / Lokal).
    // Urutan sumber:
    //   1. kolom vehicles.kategori  -> yang dipilih petugas di aplikasi
    //   2. pindaian plat terbaru    -> workaround untuk trip lama
    //   3. kolom vehicles.golongan  -> data lawas
    const hasKategoriCol = await hasColumn("vehicles", "kategori");
    const plateCategories = hasKategoriCol
      ? new Map<string, string>()
      : await fetchPlateCategories(vehicles.map((v: any) => v.no_polisi));

    vehicles = vehicles.map((v) => {
      const fromColumn = hasKategoriCol ? normalizeCategory(v.kategori) : null;
      const fromScan = plateCategories.get(plateKey(v.no_polisi)) ?? null;
      const stored = normalizeLegacyCategory(v.golongan);
      return { ...v, kategori: fromColumn ?? fromScan ?? stored };
    });

    // Harga yang ditampilkan = harga yang tercatat saat trip dikirim.
    // Master/region yang berlaku SEKARANG tidak boleh menimpa harga trip
    // lama; perubahan tarif hanya berlaku untuk trip selanjutnya.
    // Row lawas tanpa harga tersimpan -> pakai tarif terkini (fallback).
    const regionByTrip = new Map<string, string>(
      trips.map((t: any) => [t.id, String(t.region_id ?? "")]),
    );

    vehicles = await Promise.all(vehicles.map(async (v) => {
      const snap = snapshotTariff(v);
      if (snap) {
        return {
          ...v,
          tariff_amount: snap.amount,
          tarif_source: snap.source,
          // Nilai master saat trip dicatat (audit trail).
          tariff_amount_saved: v.tariff_amount ?? null,
        };
      }
      // Tidak ada sumber harga -> pertahankan nominal lama (bukan 0).
      const calc = await effectiveTariff(v, regionByTrip.get(v.trip_id) ?? null, v.kategori);
      if (!calc) {
        return { ...v, tarif_source: "tanpa-tarif" };
      }
      return {
        ...v,
        tariff_amount: calc.amount,
        tarif_source: calc.source,
        // Nilai master saat trip dicatat (audit trail).
        tariff_amount_saved: v.tariff_amount ?? null,
      };
    }));


    let filtered = vehicles;
    if (golongan) filtered = filtered.filter((v) => matchesGolongan(v.kategori, golongan));
    if (vehicleType) filtered = filtered.filter((v) => v.vehicle_type === vehicleType);
    if (muatan === "ada") filtered = filtered.filter((v) => Number(v.has_load) > 0);
    if (muatan === "tanpa") filtered = filtered.filter((v) => !Number(v.has_load));

    // Pencarian bebas: cocok di tingkat trip (no trip, petugas, rute, wilayah)
    // atau di tingkat kendaraan (plat, jenis, kategori).
    if (q) {
      const tripMeta = new Map<string, string[]>();
      for (const t of trips as any[]) {
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

    let result = trips.map((t: any) => {
      const tv = vehiclesByTrip.get(t.id) ?? [];
      // Semua foto: bukti trip + swafoto petugas + foto tiap kendaraan
      const allPhotos = [
        ...tv.map((v: any) => v.foto_path).filter(Boolean),
        t.foto_kosong_path,
        t.selfie_path,
      ].filter(Boolean);

      return {
        ...t,
        officer_name: t.officers?.name,
        region_name: t.regions?.name,
        region_code: t.regions?.code,
        dermaga_name: t.dermagas?.name ?? null,
        dermaga_code: t.dermagas?.code ?? null,
        route_name: t.routes?.name ?? null,
        vehicles: tv,
        vehicle_count: tv.length,
        trip_revenue: tv.reduce((s: number, v: any) => s + (v.tariff_amount || 0), 0),
        all_photos: allPhotos,
        trip_photo: t.foto_kosong_path,
        selfie_photo: t.selfie_path ?? null,
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

    // Opsi filter diambil dari MASTER data, bukan dari trip yang sudah
    // terkirim: menu harus menampilkan semua pilihan yang sah meskipun belum
    // ada satu pun trip dengan kategori itu (mis. jenis kendaraan yang belum
    // pernah dipakai). Tidak ada opsi karangan — semua baris benar-benar ada
    // di database.
    const { data: typeRows, error: typeError } = await db
      .from("vehicle_types")
      .select("name")
      .eq("is_active", 1)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (typeError) throw typeError;
    const vehicleTypes = [...new Set((typeRows ?? [])
      .map((t: any) => String(t.name ?? "").trim())
      .filter(Boolean))];

    const { data: dermagaRows, error: dermagaError } = await db
      .from("dermagas")
      .select("id, name, code, regions(name, code)")
      .order("name", { ascending: true });
    if (dermagaError) throw dermagaError;
    const dermagas = (dermagaRows ?? []).map((d: any) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      region_name: d.regions?.name ?? null,
      region_code: d.regions?.code ?? null,
    }));

    const { data: routeRows, error: routeError } = await db
      .from("routes")
      .select("id, name, route_from, route_to, dermaga_id, dermagas(name, code)")
      .order("route_from", { ascending: true })
      .order("route_to", { ascending: true });
    if (routeError) throw routeError;
    const routes = (routeRows ?? [])
      .map((r: any) => ({
        id: r.id,
        name: r.name,
        route_from: r.route_from,
        route_to: r.route_to,
        dermaga_id: r.dermaga_id,
        dermaga_name: r.dermagas?.name ?? null,
        dermaga_code: r.dermagas?.code ?? null,
      }))
      .sort((a: any, b: any) =>
        String(a.dermaga_name ?? "").localeCompare(String(b.dermaga_name ?? ""))
        || String(a.route_from ?? "").localeCompare(String(b.route_from ?? ""))
        || String(a.route_to ?? "").localeCompare(String(b.route_to ?? "")));

    // Selalu kembalikan tiga kategori operasional, urut Internal - Eksternal - Lokal.
    const golongan = OPERATIONAL_CATEGORIES.slice();

    return json({ golongan, vehicleTypes, dermagas, routes });
  } catch (error) {
    console.error("Filters error:", error);
    return json({ error: "Failed to fetch filter options" }, 500);
  }
}
