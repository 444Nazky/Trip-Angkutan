// Routes handlers (port of backend/src/routes/routes.js).
import { db, json, auth, requireAdmin, dbDetail, type OfficerClaims } from "../_shared.ts";

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
      .select(`dermagas(id, name, code, routes(id, name, route_from, route_to, distance, duration, sort_order))`)
      .eq("officer_id", officerId);
    if (error) throw error;

    const result: unknown[] = [];
    for (const od of data ?? []) {
      const dm: any = od.dermagas;
      // Urutan mengikuti susunan admin di dashboard. Fallback nama untuk
      // database lama yang belum punya sort_order.
      const routes = [...(dm?.routes ?? [])].sort((a: any, b: any) =>
        (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      );
      for (const r of routes) {
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
      .order("sort_order", { ascending: true })
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

    // Rute baru diletakkan paling bawah di dermaganya. Tanpa ini semua rute
    // baru mendapat sort_order 0 dan urutan drag di dashboard jadi acak.
    const { data: lastRoute } = await db
      .from("routes")
      .select("sort_order")
      .eq("dermaga_id", String(dermaga_id))
      .order("sort_order", { ascending: false })
      .limit(1);
    const sortOrder = Number((lastRoute as any[] | null)?.[0]?.sort_order ?? 0) + 1;

    const { data, error } = await db
      .from("routes")
      .insert({
        dermaga_id: String(dermaga_id),
        name: cleanName,
        route_from: cleanFrom,
        route_to: cleanTo,
        distance: distance || null,
        duration: duration || null,
        sort_order: sortOrder,
      })
      .select()
      .single();
    if (error) {
      console.error("Create route error:", error);
      return json({ error: `Rute gagal ditambahkan karena database menolak: ${dbDetail(error)}` }, 500);
    }
    return json(data, 201);
  } catch (error) {
    console.error("Create route error:", error);
    return json({ error: `Rute gagal ditambahkan karena galat server: ${dbDetail(error)}` }, 500);
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
    return json({ error: `Rute gagal diperbarui karena galat server: ${dbDetail(error)}` }, 500);
  }
}

/**
 * PUT /routes/reorder
 *
 * Menyimpan urutan rute hasil drag-and-drop di dashboard. Urutan hanya
 * berlaku di dalam satu dermaga (`sort_order` 1..n), karena rute milik
 * dermaga lain tidak ikut diubah.
 */
export async function reorderRoutes(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { dermagaId, routeIds } = await req.json().catch(() => ({})) as any;
    const dermaga = String(dermagaId ?? "").trim();
    if (!UUID_RE.test(dermaga)) return json({ error: "Dermaga tidak valid" }, 400);
    if (!Array.isArray(routeIds)) return json({ error: "routeIds harus berupa array" }, 400);

    const ids = [...new Set(routeIds
      .map((v: unknown) => String(v ?? "").trim())
      .filter((v: string) => UUID_RE.test(v)))];
    if (ids.length === 0) return json({ error: "Tidak ada rute valid yang dipilih" }, 400);

    // Pastikan semua rute memang milik dermaga ini. Tanpa pemeriksaan ini,
    // request yang salah bisa mengubah urutan rute dermaga lain.
    const { data: owned, error: readError } = await db
      .from("routes")
      .select("id")
      .eq("dermaga_id", dermaga);
    if (readError) throw readError;
    const ownedIds = new Set((owned ?? []).map((r: any) => String(r.id)));
    if (ids.some((id) => !ownedIds.has(id))) {
      return json({ error: "Ada rute yang bukan milik dermaga ini" }, 400);
    }

    // Simpan berurutan supaya tidak ada dua rute dengan sort_order sama.
    for (let i = 0; i < ids.length; i++) {
      const { error } = await db
        .from("routes")
        .update({ sort_order: i + 1 })
        .eq("id", ids[i]);
      if (error) throw error;
    }

    return json({ success: true, routeIds: ids });
  } catch (error) {
    console.error("Reorder routes error:", error);
    return json({ error: `Urutan rute gagal disimpan karena galat server: ${dbDetail(error)}` }, 500);
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
    return json({ error: `Rute gagal dihapus karena galat server: ${dbDetail(error)}` }, 500);
  }
}
