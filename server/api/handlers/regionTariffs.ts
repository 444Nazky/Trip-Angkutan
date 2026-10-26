// Region tariffs (admin). Port of backend/src/routes/region-tariffs.js.
import { db, json, requireAdmin } from "../_shared.ts";

export async function getRegionTariffs(_req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(_req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { data: regions, error } = await db.from("regions").select("id, name, code").order("name", { ascending: true });
    if (error) throw error;

    const regionIds = (regions ?? []).map((r: any) => String(r.id));
    if (!regionIds.length) return json([]);

    const { data: tariffs } = await db.from("region_tariffs").select("*").in("region_id", regionIds);

    const tariffsByRegion: Record<string, Record<string, any>> = {};
    for (const t of tariffs ?? []) {
      (tariffsByRegion[String(t.region_id)] ||= {})[t.tariff_type] = t;
    }

    return json(
      (regions ?? []).map((r: any) => ({
        id: String(r.id),
        name: r.name,
        code: r.code,
        lokal_tariff: tariffsByRegion[String(r.id)]?.lokal?.nominal_tariff ?? 0,
        lokal_active: tariffsByRegion[String(r.id)]?.lokal?.is_active ?? 0,
        eksternal_tariff: tariffsByRegion[String(r.id)]?.eksternal?.nominal_tariff ?? 0,
        eksternal_active: tariffsByRegion[String(r.id)]?.eksternal?.is_active ?? 0,
      })),
    );
  } catch (error) {
    console.error("Get region tariffs error:", error);
    return json({ error: "Failed to fetch region tariffs" }, 500);
  }
}

export async function updateRegionTariff(req: Request, regionId: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { tariffType, nominalTariff, isActive } = await req.json().catch(() => ({})) as any;
    if (!["lokal", "eksternal"].includes(tariffType)) {
      return json({ error: "tariffType harus 'lokal' atau 'eksternal'" }, 400);
    }

    const { data: region } = await db.from("regions").select("id").eq("id", regionId).limit(1);
    if (!region || !region?.length) return json({ error: "Region not found" }, 404);

    const { data: existing } = await db
      .from("region_tariffs")
      .select("id")
      .eq("region_id", regionId)
      .eq("tariff_type", tariffType)
      .limit(1)
      .maybeSingle();

    const nominal = Number.isFinite(Number(nominalTariff)) ? Number(nominalTariff) : 0;
    const active = isActive === undefined ? 1 : (isActive ? 1 : 0);

    if (existing) {
      const { error: err } = await db.from("region_tariffs").update({ nominal_tariff: nominal, is_active: active }).eq("id", existing.id);
      if (err) throw err;
      return json({ success: true, regionId, tariffType, nominalTariff: nominal, isActive: active });
    }

    const { error: err2 } = await db.from("region_tariffs").insert({
      id: `${regionId}:${tariffType}`,
      region_id: regionId,
      tariff_type: tariffType,
      nominal_tariff: nominal,
      is_active: active,
    });
    if (err2) throw err2;

    return json({ success: true, regionId, tariffType, nominalTariff: nominal, isActive: active });
  } catch (error) {
    console.error("Update region tariff error:", error);
    return json({ error: "Failed to update region tariff" }, 500);
  }
}
