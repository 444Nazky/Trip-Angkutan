// Routes handlers (port of backend/src/routes/routes.js).
import { db, json, auth, requireAdmin, type OfficerClaims } from "../_shared.ts";

/** Id dermaga bertipe uuid di database. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getOfficerRoutes(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);
    const officerId = ctx.officerId;
    if (!officerId) return json({ error: "Officer access required" }, 403);

    const { data, error } = await db
      .from("officer_dermagas")
      .select(`dermagas(id, name, code, routes(id, name, route_from, route_to, distance, duration))`)
      .eq("officer_id", officerId);
    if (error) throw error;

    const result: unknown[] = [];
    for (const od of data ?? []) {
      const dm: any = od.dermagas;
      for (const r of dm?.routes ?? []) {
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
    return json(result);
  } catch (error) {
    console.error("Get officer routes error:", error);
    return json({ error: "Failed to fetch officer routes" }, 500);
  }
}

export async function getAllRoutes(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { data, error } = await db
      .from("routes")
      .select("*, dermagas(name, code)")
      .order("name", { ascending: true });
    if (error) throw error;
    return json(
      (data ?? []).map((r: any) => ({
        ...r,
        dermaga_name: r.dermagas?.name,
        dermaga_code: r.dermagas?.code,
      })),
    );
  } catch (error) {
    console.error("Get routes error:", error);
    return json({ error: "Failed to fetch routes" }, 500);
  }
}

export async function createRoute(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { dermaga_id, name, route_from, route_to, distance, duration } =
      await req.json().catch(() => ({})) as any;

    const cleanName = String(name ?? "").trim();
    const cleanFrom = String(route_from ?? "").trim().toUpperCase();
    const cleanTo = String(route_to ?? "").trim().toUpperCase();
    if (!cleanName) return json({ error: "Nama rute wajib diisi" }, 400);
    if (!cleanFrom) return json({ error: "Rute asal wajib diisi" }, 400);
    if (!cleanTo) return json({ error: "Rute tujuan wajib diisi" }, 400);

    // Dermaga WAJIB diisi dan harus uuid. Rute tanpa dermaga tersimpan dengan
    // dermaga_id NULL - administrasi melihatnya di dashboard, tapi petugas
    // TIDAK PERNAH melihatnya (rute ditarik lewat
    // officer_dermagas -> dermagas -> routes). Dulu tidak ada validasi,
    // jadi route bisa "berhasil ditambahkan" tapi tidak muncul di aplikasi.
    if (!dermaga_id) return json({ error: "Dermaga wajib dipilih" }, 400);
    if (!UUID_RE.test(String(dermaga_id))) return json({ error: "Dermaga tidak valid" }, 400);

    const { data, error } = await db
      .from("routes")
      .insert({
        dermaga_id: String(dermaga_id),
        name: cleanName,
        route_from: cleanFrom,
        route_to: cleanTo,
        distance: distance || null,
        duration: duration || null,
      })
      .select()
      .single();
    if (error) {
      console.error("Create route error:", error);
      return json({ error: "Gagal membuat rute" }, 500);
    }
    return json(data, 201);
  } catch (error) {
    console.error("Create route error:", error);
    return json({ error: "Failed to create route" }, 500);
  }
}

export async function updateRoute(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { name, route_from, route_to, distance, duration } = await req.json().catch(() => ({})) as any;
    const { error } = await db
      .from("routes")
      .update({ name, route_from, route_to, distance: distance || null, duration: duration || null })
      .eq("id", id);
    if (error) throw error;
    return json({ success: true });
  } catch (error) {
    console.error("Update route error:", error);
    return json({ error: "Failed to update route" }, 500);
  }
}

export async function deleteRoute(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { error } = await db.from("routes").delete().eq("id", id);
    if (error) throw error;
    return json({ success: true });
  } catch (error) {
    console.error("Delete route error:", error);
    return json({ error: "Failed to delete route" }, 500);
  }
}
