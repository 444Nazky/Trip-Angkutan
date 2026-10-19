// Officers handlers (port of backend/src/routes/officers.js).
import * as bcryptjs from "https://esm.sh/bcryptjs@2.4.3";
import { db, json, auth, requireAdmin } from "../_shared.ts";

async function officerExtras(officerId: string) {
  const [{ data: officerRegions }, { data: officerDermagas }] = await Promise.all([
    db.from("officer_regions").select("regions(id, name, code)").eq("officer_id", officerId),
    db.from("officer_dermagas").select("dermagas(id, name, code, region_id)").eq("officer_id", officerId),
  ]);
  return {
    regions: (officerRegions ?? []).map((or: any) => or.regions).filter(Boolean),
    dermagas: (officerDermagas ?? []).map((od: any) => od.dermagas).filter(Boolean),
  };
}

function shapeOfficer(o: any, extras: { regions: any[]; dermagas: any[] }) {
  return {
    ...o,
    region_name: o.regions?.name,
    region_code: o.regions?.code,
    ...extras,
  };
}

// GET /officers
export async function getOfficers(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { data: officers, error } = await db
      .from("officers")
      .select("id, name, username, region_id, is_active, regions!officers_region_id_fkey(name, code)")
      .order("name", { ascending: true });
    if (error) throw error;

    const result: any[] = [];
    for (const o of officers ?? []) {
      result.push(shapeOfficer(o, await officerExtras(o.id)));
    }
    return json(result);
  } catch (error) {
    console.error("Fetch officers error:", error);
    return json({ error: "Failed to fetch officers" }, 500);
  }
}

// GET /officers/my-region
export async function myRegionOfficers(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Not authenticated" }, 401);
    const meId = String(ctx.officerId ?? "");
    if (!meId) return json({ error: "Not authenticated" }, 401);

    const { data: myOfficerRegions } = await db.from("officer_regions").select("region_id").eq("officer_id", meId);
    const myRegionIds = new Set((myOfficerRegions ?? []).map((r: any) => r.region_id));

    const { data: officers } = await db
      .from("officers")
      .select("*, regions!officers_region_id_fkey(name, code)")
      .order("name", { ascending: true });

    const result: any[] = [];
    for (const o of officers ?? []) {
      const extras = await officerExtras(o.id);
      const sharesRegion =
        extras.regions.some((r: any) => myRegionIds.has(r.id)) || myRegionIds.has(o.region_id);
      if (sharesRegion || String(o.id) === meId) {
        result.push(shapeOfficer(o, extras));
      }
    }
    return json(result);
  } catch (error) {
    console.error("Fetch my-region officers error:", error);
    return json({ error: "Failed to fetch officers" }, 500);
  }
}

// POST /officers
export async function createOfficer(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { name, username, pin, regionId, regionIds, dermagaIds } = await req.json().catch(() => ({})) as any;
    const cleanName = String(name ?? "").trim();
    if (!cleanName) return json({ error: "Nama wajib diisi" }, 400);
    if (!pin || String(pin).length < 4) return json({ error: "PIN minimal 4 digit" }, 400);

    const base =
      String(username ?? "").trim().toLowerCase().replace(/\s+/g, "") ||
      cleanName.toLowerCase().replace(/\s+/g, "");

    let candidate = base;
    let n = 2;
    for (;;) {
      const { data: existing } = await db.from("officers").select("id").ilike("username", candidate).limit(1);
      if (!existing?.length) break;
      candidate = `${base}-${n++}`;
    }

    const hashedPin = bcryptjs.hashSync(String(pin), 10);
    const id = crypto.randomUUID();
    const primaryRegionId = Array.isArray(regionIds) && regionIds.length > 0 ? regionIds[0] : regionId;

    const { error: insertError } = await db.from("officers").insert({
      id,
      name: cleanName,
      username: candidate,
      pin: hashedPin,
      region_id: primaryRegionId,
    });
    if (insertError) throw insertError;

    const ids = Array.isArray(regionIds) && regionIds.length > 0 ? regionIds : [primaryRegionId];
    if (ids.length) {
      await db.from("officer_regions").upsert(ids.map((rid: string) => ({ officer_id: id, region_id: rid })));
    }
    if (Array.isArray(dermagaIds) && dermagaIds.length > 0) {
      await db
        .from("officer_dermagas")
        .upsert(dermagaIds.filter(Boolean).map((dmId: string) => ({ officer_id: id, dermaga_id: dmId })));
    }

    return json({ id, name: cleanName, username: candidate, regionIds: ids }, 201);
  } catch (error) {
    console.error("Create officer error:", error);
    return json({ error: "Failed to create officer" }, 500);
  }
}

// PUT /officers/:id/dermagas
export async function updateOfficerDermagas(req: Request, officerId: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { dermagaIds } = await req.json().catch(() => ({})) as any;
    if (!Array.isArray(dermagaIds)) return json({ error: "dermagaIds harus berupa array" }, 400);

    await db.from("officer_dermagas").delete().eq("officer_id", officerId);
    const links = dermagaIds.filter(Boolean).map((dmId: string) => ({
      officer_id: officerId,
      dermaga_id: String(dmId),
    }));
    if (links.length) await db.from("officer_dermagas").upsert(links);

    return json({ success: true, dermagaIds: dermagaIds.filter(Boolean).map(String) });
  } catch (error) {
    console.error("Update officer dermagas error:", error);
    return json({ error: "Failed to update officer dermagas" }, 500);
  }
}

// PUT /officers/:id/regions
export async function updateOfficerRegions(req: Request, officerId: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { regionIds } = await req.json().catch(() => ({})) as any;
    if (!Array.isArray(regionIds) || regionIds.length === 0) {
      return json({ error: "regionIds harus berupa array dan tidak kosong" }, 400);
    }

    await db.from("officer_regions").delete().eq("officer_id", officerId);
    await db
      .from("officer_regions")
      .upsert(regionIds.map((rid: string) => ({ officer_id: officerId, region_id: String(rid) })));
    await db.from("officers").update({ region_id: String(regionIds[0]) }).eq("id", officerId);

    return json({ success: true, regionIds: regionIds.map(String) });
  } catch (error) {
    console.error("Update officer regions error:", error);
    return json({ error: "Failed to update officer regions" }, 500);
  }
}

// PUT /officers/:id/pin
export async function updateOfficerPin(req: Request, officerId: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { pin } = await req.json().catch(() => ({})) as any;
    const { error } = await db
      .from("officers")
      .update({ pin: bcryptjs.hashSync(String(pin), 10) })
      .eq("id", officerId);
    if (error) throw error;
    return json({ success: true });
  } catch (error) {
    console.error("Update officer PIN error:", error);
    return json({ error: "Failed to update PIN" }, 500);
  }
}

// PUT /officers/:id/status
export async function updateOfficerStatus(req: Request, officerId: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { isActive } = await req.json().catch(() => ({})) as any;
    const { error } = await db.from("officers").update({ is_active: isActive ? 1 : 0 }).eq("id", officerId);
    if (error) throw error;
    return json({ success: true });
  } catch (error) {
    console.error("Update officer status error:", error);
    return json({ error: "Failed to update status" }, 500);
  }
}

// DELETE /officers/:id
export async function deleteOfficer(req: Request, officerId: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    await db.from("officer_regions").delete().eq("officer_id", officerId);
    await db.from("officer_dermagas").delete().eq("officer_id", officerId);
    const { error } = await db.from("officers").delete().eq("id", officerId);
    if (error) throw error;
    return json({ success: true });
  } catch (error) {
    console.error("Delete officer error:", error);
    return json({ error: "Failed to delete officer" }, 500);
  }
}
