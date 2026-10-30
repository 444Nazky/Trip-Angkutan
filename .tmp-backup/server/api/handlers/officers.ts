// Officers handlers (port of backend/src/routes/officers.js).
import bcryptjs from "npm:bcryptjs@2.4.3";
import { db, json, auth, requireAdmin, dbDetail } from "../_shared.ts";
import { groupOfficerExtras } from "../_officerExtras.ts";

/** Id region/dermaga bertipe uuid di database. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  return groupOfficerExtras(officerIds, regionRows, dermagaRows);
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
    const extrasMap = await officerExtrasBulk(officers_.map((o: any) => String(o.id)));
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
    const extrasMap = await officerExtrasBulk(officers_.map((o: any) => String(o.id)));
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
    // Id region/dermaga harus uuid; nilai lain akan membuat INSERT gagal
    // dengan "invalid input syntax for type uuid".
    const primaryRegionId = Array.isArray(regionIds) && regionIds.length > 0 ? regionIds[0] : regionId;
    const regionUuid = UUID_RE.test(String(primaryRegionId ?? "")) ? String(primaryRegionId) : null;
    const regionUuids = [...new Set((Array.isArray(regionIds) ? regionIds : [])
      .map((v: unknown) => String(v ?? "").trim())
      .filter((v: string) => UUID_RE.test(v)))];
    const dermagaUuids = [...new Set((Array.isArray(dermagaIds) ? dermagaIds : [])
      .map((v: unknown) => String(v ?? "").trim())
      .filter((v: string) => UUID_RE.test(v)))];

    const { error: insertError } = await db.from("officers").insert({
      id,
      name: cleanName,
      username: candidate,
      pin: hashedPin,
      region_id: regionUuid,
    });
    if (insertError) throw insertError;

    const ids = regionUuids.length > 0 ? regionUuids : (regionUuid ? [regionUuid] : []);
    if (ids.length) {
      const { error } = await db
        .from("officer_regions")
        .upsert(ids.map((rid: string) => ({ officer_id: id, region_id: rid })));
      if (error) {
        console.error("Create officer (regions) error:", error);
        return json({ error: "Petugas dibuat, tetapi wilayah gagal disimpan" }, 500);
      }
    }
    if (dermagaUuids.length > 0) {
      const { error } = await db
        .from("officer_dermagas")
        .upsert(dermagaUuids.map((dmId: string) => ({ officer_id: id, dermaga_id: dmId })));
      if (error) {
        console.error("Create officer (dermagas) error:", error);
        return json({ error: "Petugas dibuat, tetapi akses dermaga gagal disimpan" }, 500);
      }
    }

    return json({ id, name: cleanName, username: candidate, regionIds: ids }, 201);
  } catch (error) {
    console.error("Create officer error:", error);
    return json({ error: `Petugas gagal ditambahkan karena galat server: ${dbDetail(error)}` }, 500);
  }
}

// PUT /officers/:id/dermagas
export async function updateOfficerDermagas(req: Request, officerId: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { dermagaIds } = await req.json().catch(() => ({})) as any;
    if (!Array.isArray(dermagaIds)) return json({ error: "dermagaIds harus berupa array" }, 400);

    // Id dermaga HARUS uuid - kolomnya bertipe uuid dan rekannya ke
    // dermagas(id). Nilai bukan uuid (mis. id lawas "BADAU-D1") akan membuat
    // INSERT gagal; kalau galatnya diabaikan, petugas kehilangan akses ke
    // SEMUA dermaga tanpa ada pesan error.
    const ids = [...new Set(dermagaIds
      .map((v: unknown) => String(v ?? "").trim())
      .filter((v: string) => UUID_RE.test(v)))];

    // Urutan: TAMBAHKAN dulu, baru HAPUS yang tidak lagi dipilih. Kalau
    // urutan dibalik (hapus dulu, lalu tambah) dan penambahan gagal, akses
    // petugas hilang seluruhnya.
    if (ids.length) {
      const { error } = await db
        .from("officer_dermagas")
        .upsert(ids.map((dmId: string) => ({ officer_id: officerId, dermaga_id: dmId })));
      if (error) {
        console.error("Update officer dermagas (upsert) error:", error);
        return json({ error: "Gagal menyimpan akses dermaga" }, 500);
      }
    }

    const { data: current } = await db
      .from("officer_dermagas")
      .select("dermaga_id")
      .eq("officer_id", officerId);
    const stale = (current ?? [])
      .map((r: any) => String(r.dermaga_id))
      .filter((dmId: string) => !ids.includes(dmId));
    for (const dmId of stale) {
      const { error } = await db
        .from("officer_dermagas")
        .delete()
        .eq("officer_id", officerId)
        .eq("dermaga_id", dmId);
      if (error) {
        console.error("Update officer dermagas (delete) error:", error);
        return json({ error: "Gagal menyimpan akses dermaga" }, 500);
      }
    }

    return json({ success: true, dermagaIds: ids });
  } catch (error) {
    console.error("Update officer dermagas error:", error);
    return json({ error: `Akses dermaga gagal disimpan karena galat server: ${dbDetail(error)}` }, 500);
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
    const ids = [...new Set(regionIds
      .map((v: unknown) => String(v ?? "").trim())
      .filter((v: string) => UUID_RE.test(v)))];
    if (ids.length === 0) return json({ error: "Tidak ada region valid yang dipilih" }, 400);

    // Tambah dulu, baru hapus yang lama (lihat updateOfficerDermagas).
    const { error: upsertError } = await db
      .from("officer_regions")
      .upsert(ids.map((rid: string) => ({ officer_id: officerId, region_id: rid })));
    if (upsertError) {
      console.error("Update officer regions (upsert) error:", upsertError);
      return json({ error: "Gagal menyimpan akses region" }, 500);
    }

    const { data: current } = await db
      .from("officer_regions")
      .select("region_id")
      .eq("officer_id", officerId);
    const stale = (current ?? [])
      .map((r: any) => String(r.region_id))
      .filter((rid: string) => !ids.includes(rid));
    for (const rid of stale) {
      const { error } = await db
        .from("officer_regions")
        .delete()
        .eq("officer_id", officerId)
        .eq("region_id", rid);
      if (error) {
        console.error("Update officer regions (delete) error:", error);
        return json({ error: "Gagal menyimpan akses region" }, 500);
      }
    }

    const { error: primaryError } = await db
      .from("officers")
      .update({ region_id: ids[0] })
      .eq("id", officerId);
    if (primaryError) {
      console.error("Update officer regions (primary) error:", primaryError);
      return json({ error: "Gagal menyimpan wilayah utama petugas" }, 500);
    }

    return json({ success: true, regionIds: ids });
  } catch (error) {
    console.error("Update officer regions error:", error);
    return json({ error: `Wilayah petugas gagal disimpan karena galat server: ${dbDetail(error)}` }, 500);
  }
}

// PUT /officers/:id  (profil dasar: nama + username)
//
// DULU dashboard admin punya kolom "Nama" yang bisa diedit, tapi tidak ada
// endpoint yang mengubahnya - formnya hanya mengirim wilayah/dermaga/PIN.
// Akibatnya UI menampilkan "Petugas diupdate" padahal nama di database
// tetap nama lama (dan kembali lagi setelah reload). Endpoint ini menutup
// celah itu: apa yang diedit admin = apa yang tersimpan di database.
export async function updateOfficerProfile(req: Request, officerId: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const body = await req.json().catch(() => ({})) as any;
    const patch: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const cleanName = String(body.name ?? "").trim();
      if (!cleanName) return json({ error: "Nama wajib diisi" }, 400);
      patch.name = cleanName;
    }

    if (body?.username !== undefined) {
      const cleanUsername = String(body.username ?? "").trim().toLowerCase().replace(/\s+/g, "");
      if (!cleanUsername) return json({ error: "Username wajib diisi" }, 400);
      // Username harus unik - kalau dipakai petugas lain, tolak (jangan
      // diam-diam memakai username yang bentrok).
      const { data: clash } = await db
        .from("officers")
        .select("id")
        .ilike("username", cleanUsername)
        .neq("id", officerId)
        .limit(1);
      if (clash?.length) return json({ error: "Username sudah dipakai petugas lain" }, 409);
      patch.username = cleanUsername;
    }

    if (Object.keys(patch).length === 0) return json({ error: "Tidak ada data yang diubah" }, 400);

    const { error } = await db.from("officers").update(patch).eq("id", officerId);
    if (error) throw error;
    return json({ success: true, ...patch });
  } catch (error) {
    console.error("Update officer profile error:", error);
    return json({ error: `Data petugas gagal disimpan karena galat server: ${dbDetail(error)}` }, 500);
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
    return json({ error: `PIN gagal disimpan karena galat server: ${dbDetail(error)}` }, 500);
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
    return json({ error: `Status petugas gagal diubah karena galat server: ${dbDetail(error)}` }, 500);
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
    return json({ error: `Petugas gagal dihapus karena galat server: ${dbDetail(error)}` }, 500);
  }
}
