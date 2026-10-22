// Officers handlers (port of backend/src/routes/officers.js).
import bcryptjs from "npm:bcryptjs@2.4.3";
import { db, json, auth, requireAdmin } from "../_shared.ts";

/**
 * Extras untuk BANYAK officer sekaligus — 2 query, bukan 2 per officer.
 *
 * Versi lama memanggil `officerExtras` satu per officer di dalam
 * `Promise.all`, jadi 20 officer = 40 query (N+1) pada satu endpoint
 * /officers yang dipanggil dashboard admin. Sekarang relasi diambil
 * sekali dengan filter `.in()` lalu dikelompokkan di memori.
 */
async function officerExtrasBulk(officerIds: string[]) {
  if (officerIds.length === 0) return {} as Record<string, { regions: any[]; dermagas: any[] }>;

  const [{ data: regionRows }, { data: dermagaRows }] = await Promise.all([
    db
      .from("officer_regions")
      .select("officer_id, regions(id, name, code)")
      .in("officer_id", officerIds),
    db
      .from("officer_dermagas")
      .select("officer_id, dermagas(id, name, code, region_id)")
      .in("officer_id", officerIds),
  ]);

  const map: Record<string, { regions: any[]; dermagas: any[] }> = {};
  for (const id of officerIds) map[id] = { regions: [], dermagas: [] };

  for (const row of (regionRows ?? []) as any[]) {
    const bucket = map[String(row.officer_id)];
    if (bucket && row.regions) bucket.regions.push(row.regions);
  }
  for (const row of (dermagaRows ?? []) as any[]) {
    const bucket = map[String(row.officer_id)];
    if (bucket && row.dermagas) bucket.dermagas.push(row.dermagas);
  }
  return map;
}

function shapeOfficer(o: any, extras: { regions: any[]; dermagas: any[] }) {
  return {
    ...o,
    pin_hash: o.pin ?? null,
    pin: undefined,
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

    const officers_ = officers ?? [];
    const extrasMap = await officerExtrasBulk(officers_.map(o => String(o.id)));
    const result: any[] = [];
    for (const o of officers_) {
      result.push(shapeOfficer(o, extrasMap[String(o.id)] ?? { regions: [], dermagas: [] }));
    }
    return json(result);
  } catch (error) {
    console.error("Fetch officers error:", error);
    return json({ error: "Failed to fetch officers" }, 500);
  }
}

// GET /officers/:id/dermaga-access — daftar dermaga akses petugas.
// Petugas hanya boleh melihat akses dirinya sendiri; admin boleh siapa pun.
export async function officerDermagaAccess(req: Request, officerId: string): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Not authenticated" }, 401);
    const isAdmin = String(ctx.role ?? "") === "admin";
    if (!isAdmin && String(ctx.officerId ?? "") !== String(officerId)) {
      return json({ error: "Forbidden" }, 403);
    }

    const { data, error } = await db
      .from("officer_dermagas")
      .select("dermagas(id, name, code, region_id)")
      .eq("officer_id", officerId);
    if (error) throw error;

    return json((data ?? []).map((od: any) => od.dermagas).filter(Boolean));
  } catch (error) {
    console.error("Fetch officer dermaga-access error:", error);
    return json({ error: "Failed to fetch dermaga access" }, 500);
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

    // Extras (regions + dermaga) diambil sekaligus untuk semua officer —
    // 2 query total, bukan 2 per petugas. Endpoint ini dipanggil aplikasi
    // mobile saat buka roster, jadi N+1 di sini terasa sekali everyone's slow.
    const officers_ = officers ?? [];
    const extrasMap = await officerExtrasBulk(officers_.map(o => String(o.id)));
    const result: any[] = [];
    for (const o of officers_) {
      const extras = extrasMap[String(o.id)] ?? { regions: [], dermagas: [] };
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
