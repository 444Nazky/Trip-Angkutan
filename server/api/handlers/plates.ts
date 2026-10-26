// Plates handlers (port of backend/src/routes/plates.js).
import { db, json, auth, requireAdmin } from "../_shared.ts";

function normalizePlate(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Pola ILIKE yang cocok dengan nomor plat berapa pun bentuk spasinya.
 *
 * Plat bisa tersimpan "B1234XY" maupun "B 1234 XY". `ilike("plate", "B1234XY")`
 * hanya cocok yang tanpa spasi, sehingga plat yang diinput admin dengan spasi
 * selalu dianggap "tidak terdaftar" — petugas lalu salah melihat status
 * kendaraan (internal dikira eksternal). Pola ini menyisipkan wildcard di antara
 * kelompok huruf dan angka, jadi semua bentuk spasi ikut cocok; hasil akhir
 * tetap dibandingkan ulang dengan normalisasi di dalam JS.
 */
function plateMatchPattern(norm: string): string {
  const runs = norm.match(/[A-Z]+|[0-9]+/g);
  if (!runs || runs.length === 0) return `%${norm}%`;
  return `%${runs.join("%")}%`;
}

// GET /plates
export async function getPlates(req: Request, url: URL): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    let query = db
      .from("vehicle_plates")
      .select("*, regions:origin_region_id(id, code, name)")
      .order("plate", { ascending: true });

    const plate = url.searchParams.get("plate");
    if (plate) query = query.ilike("plate", `%${normalizePlate(plate)}%`);

    const { data, error } = await query;
    if (error) throw error;

    return json(
      (data ?? []).map((p: any) => ({
        ...p,
        origin_region_code: p.regions?.code,
        origin_region_name: p.regions?.name,
      })),
    );
  } catch (error) {
    console.error("Fetch plates error:", error);
    return json({ error: "Failed to fetch plates" }, 500);
  }
}

// POST /plates
export async function createPlate(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { plate, owner, originRegionId, status } = await req.json().catch(() => ({})) as any;
    const norm = normalizePlate(plate);
    if (!norm) return json({ error: "Nomor plat wajib diisi" }, 400);

    const { data: dupRows } = await db
      .from("vehicle_plates")
      .select("id, plate")
      .ilike("plate", plateMatchPattern(norm))
      .limit(10);
    const existing = (dupRows ?? []).find((p: any) => normalizePlate(p.plate) === norm);
    if (existing) return json({ error: "Plat sudah terdaftar" }, 409);

    const st = ["internal", "lokal", "eksternal"].includes(status) ? status : "internal";
    const { data, error } = await db
      .from("vehicle_plates")
      .insert({
        plate: String(plate).trim().toUpperCase(),
        owner: owner || null,
        origin_region_id: originRegionId || null,
        status: st,
      })
      .select()
      .single();
    if (error) throw error;

    return json({ id: data.id, plate: data.plate, status: data.status }, 201);
  } catch (error) {
    console.error("Create plate error:", error);
    return json({ error: "Failed to create plate" }, 500);
  }
}

// PUT /plates/:id
export async function updatePlate(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { plate, owner, originRegionId, status, isActive } = await req.json().catch(() => ({})) as any;

    const { data: existing } = await db.from("vehicle_plates").select("*").eq("id", id).limit(1).single();
    if (!existing) return json({ error: "Plate not found" }, 404);

    const norm = plate != null ? normalizePlate(plate) : null;
    if (plate != null && !norm) return json({ error: "Nomor plat wajib diisi" }, 400);

    if (norm) {
      const { data: dupRows } = await db
        .from("vehicle_plates")
        .select("id, plate")
        .ilike("plate", plateMatchPattern(norm))
        .neq("id", id)
        .limit(10);
      const dup = (dupRows ?? []).find((p: any) => normalizePlate(p.plate) === norm);
      if (dup) return json({ error: "Plat sudah terdaftar" }, 409);
    }

    const updateData: Record<string, unknown> = {};
    if (plate !== undefined) updateData.plate = String(plate).trim().toUpperCase();
    if (owner !== undefined) updateData.owner = owner || null;
    if (originRegionId !== undefined) updateData.origin_region_id = originRegionId || null;
    if (status !== undefined) {
      updateData.status = ["internal", "lokal", "eksternal"].includes(status) ? status : existing.status;
    }
    if (isActive !== undefined) updateData.is_active = isActive ? 1 : 0;

    const { error } = await db.from("vehicle_plates").update(updateData).eq("id", id);
    if (error) throw error;
    return json({ success: true });
  } catch (error) {
    console.error("Update plate error:", error);
    return json({ error: "Failed to update plate" }, 500);
  }
}

// DELETE /plates/:id
export async function deletePlate(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { error } = await db.from("vehicle_plates").delete().eq("id", id);
    if (error) throw error;
    return json({ success: true });
  } catch (error) {
    console.error("Delete plate error:", error);
    return json({ error: "Failed to delete plate" }, 500);
  }
}

// POST /plates/check
export async function checkPlate(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);

    const { plate, originRegionId } = await req.json().catch(() => ({})) as any;
    const norm = normalizePlate(plate);
    if (!norm) return json({ error: "Nomor plat wajib diisi" }, 400);

    const checkpointRegionId = ctx.regionId ? String(ctx.regionId) : null;

    // Find registered plate (spasi di nomor plat diabaikan).
    const { data: candidateRows } = await db
      .from("vehicle_plates")
      .select("*")
      .eq("is_active", 1)
      .ilike("plate", plateMatchPattern(norm))
      .limit(10);
    const registered =
      (candidateRows ?? []).find((p: any) => normalizePlate(p.plate) === norm) ?? null;

    let status: string;
    let origin: string | null;
    if (registered?.status === "internal") {
      status = "internal";
      origin = registered.origin_region_id || checkpointRegionId;
    } else if (registered?.status) {
      status = registered.status;
      origin = registered.origin_region_id || originRegionId || checkpointRegionId;
      if (status === "lokal" && origin && checkpointRegionId && origin !== checkpointRegionId) {
        status = "eksternal";
      }
    } else {
      origin = originRegionId || checkpointRegionId;
      status = origin && checkpointRegionId && origin !== checkpointRegionId ? "eksternal" : "lokal";
    }

    const jenisTarif = status === "internal" ? null : status;
    let tariffAmount = 0;
    if (jenisTarif && checkpointRegionId) {
      const { data: regionTariff } = await db
        .from("region_tariffs")
        .select("nominal_tariff")
        .eq("region_id", checkpointRegionId)
        .eq("tariff_type", jenisTarif)
        .eq("is_active", 1)
        .limit(1)
        .single();
      tariffAmount = regionTariff?.nominal_tariff || 0;
    }

    try {
      await db.from("plate_scans").insert({
        plate: norm,
        status,
        origin_region_id: origin,
        checkpoint_region_id: checkpointRegionId,
        tariff_amount: tariffAmount,
        officer_id: ctx.officerId || null,
      });
    } catch (_) {}

    let originRegionCode: string | null = null;
    let checkpointRegionCode: string | null = null;
    if (origin) {
      const { data: originRow } = await db.from("regions").select("code").eq("id", origin).limit(1).single();
      originRegionCode = originRow?.code ?? null;
    }
    if (checkpointRegionId) {
      const { data: cpRow } = await db.from("regions").select("code").eq("id", checkpointRegionId).limit(1).single();
      checkpointRegionCode = cpRow?.code ?? null;
    }

    return json({
      found: !!registered,
      plate: registered?.plate || norm,
      owner: registered?.owner || null,
      status,
      jenisTarif,
      originRegionId: origin,
      originRegionCode,
      checkpointRegionId,
      checkpointRegionCode,
      tariffAmount,
    });
  } catch (error) {
    console.error("Check plate error:", error);
    return json({ error: "Failed to check plate" }, 500);
  }
}
