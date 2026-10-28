// Region tariffs (admin). Port of backend/src/routes/region-tariffs.js.
//
// Dua lapis tarif per region:
//   - flat  : region_tariffs (lokal/eksternal nominal datar) — turtle lama utk
//             resolver cadangan & mode offline.
//   - rows  : region_tariff_rows (muatan/kosong per jenis kendaraan) — tarif
//             tiap wilayah; region tanpa baris = Rp 0.
import { db, json, requireAdmin } from "../_shared.ts";
import { invalidateTariffCache } from "./tariffRules.ts";

const isUuid = (s: string) =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);

const asInt = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

export async function getRegionTariffs(_req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(_req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { data: regions, error } = await db.from("regions").select("id, name, code").order("name", { ascending: true });
    if (error) throw error;

    const regionIds = (regions ?? []).map((r: any) => String(r.id));
    if (!regionIds.length) return json([]);

    const [tariffs, rows] = await Promise.all([
      db.from("region_tariffs").select("*").in("region_id", regionIds),
      db
        .from("region_tariff_rows")
        .select("region_id, vehicle_type, muatan_tariff, kosong_tariff, is_active")
        .in("region_id", regionIds)
        .order("vehicle_type", { ascending: true }),
    ]);

    const tariffsByRegion: Record<string, Record<string, any>> = {};
    for (const t of tariffs.data ?? []) {
      (tariffsByRegion[String(t.region_id)] ||= {})[t.tariff_type] = t;
    }
    const rowsByRegion: Record<string, any[]> = {};
    for (const r of rows.data ?? []) (rowsByRegion[String(r.region_id)] ||= []).push(r);

    return json(
      (regions ?? []).map((r: any) => ({
        id: String(r.id),
        name: r.name,
        code: r.code,
        lokal_tariff: tariffsByRegion[String(r.id)]?.lokal?.nominal_tariff ?? 0,
        lokal_active: tariffsByRegion[String(r.id)]?.lokal?.is_active ?? 0,
        eksternal_tariff: tariffsByRegion[String(r.id)]?.eksternal?.nominal_tariff ?? 0,
        eksternal_active: tariffsByRegion[String(r.id)]?.eksternal?.is_active ?? 0,
        rows: (rowsByRegion[String(r.id)] ?? []).map((x) => ({
          vehicleType: x.vehicle_type,
          muatanTariff: x.muatan_tariff,
          kosongTariff: x.kosong_tariff,
          isActive: x.is_active,
        })),
      })),
    );
  } catch (error) {
    console.error("Get region tariffs error:", error);
    return json({ error: "Failed to fetch region tariffs" }, 500);
  }
}

/** Upsert satu baris tarif per jenis kendaraan per region. */
async function updateRegionRow(body: any, regionId: string): Promise<Response> {
  const vehicleType = String(body.vehicleType ?? body.vehicle_type ?? "").trim();
  if (!vehicleType) return json({ error: "vehicleType wajib diisi" }, 400);

  const muatan = asInt(body.muatanTariff);
  const kosong = asInt(body.kosongTariff ?? body.kosong);
  const active = body.isActive === undefined ? 1 : body.isActive ? 1 : 0;

  const { error: upErr } = await db
    .from("region_tariff_rows")
    .upsert(
      { region_id: regionId, vehicle_type: vehicleType, muatan_tariff: muatan, kosong_tariff: kosong, is_active: active, updated_at: new Date().toISOString() },
      { onConflict: "region_id,vehicle_type" },
    );
  if (upErr) {
    console.error("Upsert region tariff row failed:", upErr);
    return json({ error: "Gagal menyimpan baris tarif region" }, 500);
  }
  invalidateTariffCache();
  return json({ success: true, regionId, vehicleType, muatanTariff: muatan, kosongTariff: kosong });
}

/** Upsert tarif flat (lokal/eksternal) per region. */
async function updateRegionFlat(body: any, regionId: string): Promise<Response> {
  // Dua bentuk payload yang diterima:
  //   legacy : { tariffType: 'lokal'|'eksternal', nominalTariff, isActive }
  //   UI     : { lokal_tariff, lokal_active } | { eksternal_tariff, eksternal_active }
  let type: string | undefined = body.tariffType;  let nominal = body.nominalTariff;
  let active = body.isActive;
  if (type === undefined) {
    if (body.lokal_tariff !== undefined || body.lokal_active !== undefined) {
      type = "lokal";
      nominal = body.lokal_tariff;
      active = body.lokal_active;
    } else if (body.eksternal_tariff !== undefined || body.eksternal_active !== undefined) {
      type = "eksternal";
      nominal = body.eksternal_tariff;
      active = body.eksternal_active;
    }
  }
  if (type !== "lokal" && type !== "eksternal") {
    return json({ error: "tariffType harus 'lokal' atau 'eksternal'" }, 400);
  }

  const nominalValue = asInt(nominal);
  const activeValue = active === undefined ? 1 : active ? 1 : 0;

  const { error } = await db
    .from("region_tariffs")
    .upsert(
      { region_id: regionId, tariff_type: type, nominal_tariff: nominalValue, is_active: activeValue },
      { onConflict: "region_id,tariff_type" },
    );
  if (error) return json({ error: "Region tariff creation failed" }, 500);

  invalidateTariffCache();
  return json({
    success: true,
    regionId,
    tariffType: type,
    nominalTariff: nominalValue,
    isActive: activeValue,
  });
}

export async function updateRegionTariff(req: Request, regionId: string, _url?: URL): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    if (!isUuid(regionId)) return json({ error: "Region id tidak valid" }, 400);

    const { data: region, error: regionErr } = await db.from("regions").select("id").eq("id", regionId).limit(1);
    if (regionErr) throw regionErr;
    if (!region || !region.length) return json({ error: "Region not found" }, 404);

    // Bentuk payload menentukan target: baris per jenis atau flat.
    const body = await req.json().catch(() => ({} as any));
    const isRowPayload = body?.vehicleType !== undefined || body?.vehicle_type !== undefined;
    if (isRowPayload) return await updateRegionRow(body, regionId);
    return await updateRegionFlat(body, regionId);
  } catch (error) {
    console.error("Update region tariff error:", error);
    return json({ error: "Failed to update region tariff" }, 500);
  }
}
