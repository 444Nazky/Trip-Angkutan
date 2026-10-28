// Master data handlers: regions, dermagas, tariffs.
import { db, json, auth, requireAdmin, dbDetail } from "../_shared.ts";
import { invalidateTariffCache, getMasterTariffs as getBadauMasterTariffs } from "./tariffRules.ts";

/** Id region/dermaga bertipe uuid di database. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- REGIONS ----------

export async function getRegions(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);
    const { data, error } = await db
      .from("regions")
      .select("id, name, code")
      .order("name", { ascending: true });
    if (error) throw error;
    return json(data);
  } catch (error) {
    console.error("Get regions error:", error);
    return json({ error: "Failed to fetch regions" }, 500);
  }
}

export async function createRegion(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { name, code } = await req.json().catch(() => ({})) as any;
    const cleanName = String(name ?? "").trim();
    const cleanCode = String(code ?? "").trim();
    if (!cleanName) return json({ error: "Nama wilayah wajib diisi" }, 400);
    if (!cleanCode) return json({ error: "Kode wilayah wajib diisi" }, 400);
    const { data, error } = await db
      .from("regions")
      .insert({ name: cleanName, code: cleanCode })
      .select()
      .single();
    if (error) {
      console.error("Create region error:", error);
      return json({ error: "Gagal membuat wilayah" }, 500);
    }
    invalidateTariffCache();
    return json(data, 201);
  } catch (error) {
    console.error("Create region error:", error);
    return json({ error: "Failed to create region" }, 500);
  }
}

export async function updateRegion(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const b = await req.json().catch(() => ({})) as any;
    const updateData: Record<string, unknown> = {};
    if (b.name !== undefined) updateData.name = b.name;
    if (b.code !== undefined) updateData.code = b.code;
    if (b.password !== undefined) updateData.password = b.password;
    const { error } = await db.from("regions").update(updateData).eq("id", id);
    if (error) throw error;
    invalidateTariffCache();
    return json({ success: true });
  } catch (error) {
    console.error("Update region error:", error);
    return json({ error: "Failed to update region" }, 500);
  }
}

export async function deleteRegion(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    // Wilayah yang masih dipakai tidak dihapus. Tanpa cek ini, `dermagas`
    // akan jadi yatim (region_id NULL) dan petugas kehilangan wilayah.
    const [dermagas, officers, officerRegions] = await Promise.all([
      db.from("dermagas").select("id", { count: "exact", head: true }).eq("region_id", id),
      db.from("officers").select("id", { count: "exact", head: true }).eq("region_id", id),
      db.from("officer_regions").select("officer_id", { count: "exact", head: true }).eq("region_id", id),
    ]);
    if (dermagas.error || officers.error || officerRegions.error) throw dermagas.error ?? officers.error ?? officerRegions.error;
    if ((dermagas.count ?? 0) > 0) {
      return json({ error: "Wilayah masih punya dermaga. Hapus dermaganya dulu." }, 409);
    }
    if ((officers.count ?? 0) > 0 || (officerRegions.count ?? 0) > 0) {
      return json({ error: "Wilayah masih dipakai petugas. Pindahkan petugasnya dulu." }, 409);
    }
    const { error } = await db.from("regions").delete().eq("id", id);
    if (error) throw error;
    return json({ success: true });
  } catch (error) {
    console.error("Delete region error:", error);
    return json({ error: "Failed to delete region" }, 500);
  }
}

// ---------- DERMAGAS ----------

export async function getDermagas(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { data, error } = await db
      .from("dermagas")
      .select("*, regions(name, code)")
      .order("name", { ascending: true });
    if (error) throw error;
    return json(
      (data ?? []).map((d: any) => ({
        ...d,
        region_name: d.regions?.name,
        region_code: d.regions?.code,
      })),
    );
  } catch (error) {
    console.error("Get dermagas error:", error);
    return json({ error: "Failed to fetch dermagas" }, 500);
  }
}

export async function createDermaga(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { region_id, name, code } = await req.json().catch(() => ({})) as any;
    const cleanName = String(name ?? "").trim();
    const cleanCode = String(code ?? "").trim();
    if (!cleanName) return json({ error: "Nama dermaga wajib diisi" }, 400);
    if (!cleanCode) return json({ error: "Kode dermaga wajib diisi" }, 400);
    // region_id bertipe uuid dan rekannya ke regions(id). Nilai kosong ->
    // NULL (dermaga tanpa wilayah, sah); nilai bukan uuid -> tolong dengan
    // 400, jangan dibiarkan jadi galat database yang tidak jelas.
    const regionUuid = UUID_RE.test(String(region_id ?? "")) ? String(region_id) : null;
    if (region_id && !regionUuid) {
      return json({ error: "Wilayah tidak valid" }, 400);
    }
    const { data, error } = await db
      .from("dermagas")
      .insert({ region_id: regionUuid, name: cleanName, code: cleanCode })
      .select()
      .single();
    if (error) {
      console.error("Create dermaga error:", error);
      return json({ error: "Gagal membuat dermaga" }, 500);
    }
    return json(data, 201);
  } catch (error) {
    console.error("Create dermaga error:", error);
    return json({ error: "Failed to create dermaga" }, 500);
  }
}

export async function updateDermaga(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { name, code, region_id } = await req.json().catch(() => ({})) as any;
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (code !== undefined) updateData.code = String(code).trim();
    //(region bisa dipindah - tadinya tidak bisa sama sekali)
    if (region_id !== undefined) {
      const regionUuid = UUID_RE.test(String(region_id ?? "")) ? String(region_id) : null;
      if (region_id && !regionUuid) return json({ error: "Wilayah tidak valid" }, 400);
      updateData.region_id = regionUuid;
    }
    const { error } = await db.from("dermagas").update(updateData).eq("id", id);
    if (error) {
      console.error("Update dermaga error:", error);
      return json({ error: "Gagal memperbarui dermaga" }, 500);
    }
    return json({ success: true });
  } catch (error) {
    console.error("Update dermaga error:", error);
    return json({ error: "Failed to update dermaga" }, 500);
  }
}

export async function deleteDermaga(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    // Dermaga yang masih dipakai tidak dihapus. Dulu rute & akses petugas
    // ikut terhapus diam-diam lewat cascade; itu kehilangan data.
    const [routes, access] = await Promise.all([
      db.from("routes").select("id, name", { count: "exact" }).eq("dermaga_id", id),
      db.from("officer_dermagas").select("officer_id", { count: "exact" }).eq("dermaga_id", id),
    ]);
    if (routes.error || access.error) throw routes.error ?? access.error;
    if ((routes.count ?? 0) > 0) {
      // Sebut jumlahnya supaya operator tahu persis apa yang harus dibersihkan.
      const names = (routes.data ?? []).map((r: any) => r.name).filter(Boolean);
      const detail = names.length > 0 ? `: ${names.join(", ")}` : "";
      return json({ error: `Dermaga gagal dihapus karena masih punya ${routes.count} rute${detail}` }, 409);
    }
    if ((access.count ?? 0) > 0) {
      return json({ error: `Dermaga gagal dihapus karena masih dipakai ${access.count} petugas` }, 409);
    }
    const { error } = await db.from("dermagas").delete().eq("id", id);
    if (error) {
      console.error("Delete dermaga error:", error);
      return json({ error: `Dermaga gagal dihapus karena database menolak: ${dbDetail(error)}` }, 500);
    }
    return json({ success: true });
  } catch (error) {
    console.error("Delete dermaga error:", error);
    return json({ error: `Dermaga gagal dihapus karena galat server: ${dbDetail(error)}` }, 500);
  }
}

// ---------- TARIFFS ----------

// admin-only list.
export async function getAdminTariffs(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { data, error } = await db
      .from("tariffs")
      .select("*")
      .eq("is_active", 1)
      .order("golongan", { ascending: true })
      .order("vehicle_type", { ascending: true });
    if (error) throw error;
    return json(data);
  } catch (error) {
    console.error("Get tariffs error:", error);
    return json({ error: "Failed to fetch tariffs" }, 500);
  }
}

export async function createTariff(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { golongan, vehicleType, loadedTariff, emptyTariff, description } =
      await req.json().catch(() => ({})) as any;
    if (!golongan || !vehicleType) {
      return json({ error: "Golongan dan jenis kendaraan wajib diisi" }, 400);
    }
    // Nominal 0 = semua trip bertipe itu ditagih Rp 0 di laporan.
    const loaded = Number(loadedTariff);
    const empty = Number(emptyTariff);
    if (!Number.isFinite(loaded) || loaded <= 0) {
      return json({ error: "Nominal muatan harus lebih dari 0" }, 400);
    }
    if (!Number.isFinite(empty) || empty < 0) {
      return json({ error: "Nominal kosong tidak boleh negatif" }, 400);
    }
    const { data, error } = await db
      .from("tariffs")
      .insert({
        golongan,
        vehicle_type: vehicleType,
        loaded_tariff: loaded,
        empty_tariff: empty,
        description: description || "",
      })
      .select()
      .single();
    if (error) throw error;
    invalidateTariffCache();
    return json(data, 201);
  } catch (error) {
    console.error("Create tariff error:", error);
    return json({ error: "Failed to create tariff" }, 500);
  }
}

export async function updateTariff(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { data: existing } = await db.from("tariffs").select("id").eq("id", id).limit(1);
    if (!existing?.length) return json({ error: "Tariff not found" }, 404);

    const b = await req.json().catch(() => ({})) as any;
    const updateData: Record<string, unknown> = {};
    if (b.golongan !== undefined) updateData.golongan = b.golongan;
    if (b.vehicleType !== undefined) updateData.vehicle_type = b.vehicleType;
    if (b.loadedTariff !== undefined) {
      const v = Number(b.loadedTariff);
      if (!Number.isFinite(v) || v <= 0) {
        return json({ error: "Nominal muatan harus lebih dari 0" }, 400);
      }
      updateData.loaded_tariff = v;
    }
    if (b.emptyTariff !== undefined) {
      const v = Number(b.emptyTariff);
      if (!Number.isFinite(v) || v < 0) {
        return json({ error: "Nominal kosong tidak boleh negatif" }, 400);
      }
      updateData.empty_tariff = v;
    }
    if (b.description !== undefined) updateData.description = b.description;
    if (b.isActive !== undefined) updateData.is_active = b.isActive ? 1 : 0;
    const { error } = await db.from("tariffs").update(updateData).eq("id", id);
    if (error) throw error;
    invalidateTariffCache();
    return json({ success: true });
  } catch (error) {
    console.error("Update tariff error:", error);
    return json({ error: "Failed to update tariff" }, 500);
  }
}

export async function deleteTariff(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { error } = await db.from("tariffs").delete().eq("id", id);
    if (error) throw error;
    invalidateTariffCache();
    return json({ success: true });
  } catch (error) {
    console.error("Delete tariff error:", error);
    return json({ error: "Failed to delete tariff" }, 500);
  }
}

// ---------- OFFLINE MASTER PACK ----------

/**
 * Paket master data untuk mode offline (petugas HP).
 *
 * Seamula tidak ada endpoint yang bisa dipakai petugas untuk menarik
 * master plat & region ke perangkat: `GET /plates` requireAdmin, dan
 * `GET /region-tariffs` juga admin. Akibatnya cek status plat (`/plates/check`)
 * HANYA bisa jalan online — petugas di lapangan tanpa sinyal tidak tahu
 * apakah kendaraan itu internal (Rp 0) atau eksternal, dan tarif region
 * tidak pernah ada di HP.
 *
 * Isi paket (satu request, jangan dipecah jadi beberapa supaya kuota
 * Edge Function tidak naik):
 * - regions        : id/code/nama (dipakai label region & pencocokan)
 * - plates         : plat + status + region asal — TANPA nama pemilik,
 *                    supaya data pribadi tidak ikut ter-cache di HP.
 * - regionTariffs  : tarif per region (lokal/eksternal) untuk hitung nominal
 *
 * Hanya status & region yang dibutuhkan untuk menentukan apakah kendaraan
 * ditagih; `owner` sengaja tidak ikut agar perangkat petugas tidak menyimpan
 * data pemilik kendaraan.
 */
export async function getOfflineMasterPack(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);

    const [regionsRes, platesRes, tariffsRes] = await Promise.all([
      db.from("regions").select("id, name, code"),
      db.from("vehicle_plates").select("plate, status, origin_region_id").eq("is_active", 1),
      db.from("region_tariffs").select("region_id, tariff_type, nominal_tariff, is_active"),
    ]);
    if (regionsRes.error) throw regionsRes.error;
    if (platesRes.error) throw platesRes.error;
    if (tariffsRes.error) throw tariffsRes.error;

    const regions = (regionsRes.data ?? []) as any[];
    const codeById = new Map<string, string>();
    for (const r of regions) codeById.set(String(r.id), String(r.code ?? ""));

    const plates = ((platesRes.data ?? []) as any[])
      .map((p) => ({
        plate: String(p.plate ?? "").trim().toUpperCase(),
        status: String(p.status ?? ""),
        originRegionId: p.origin_region_id ? String(p.origin_region_id) : null,
        originRegionCode: p.origin_region_id
          ? codeById.get(String(p.origin_region_id)) ?? null
          : null,
      }))
      .filter((p) => p.plate && p.status);

    const regionTariffs = ((tariffsRes.data ?? []) as any[])
      .map((t) => ({
        regionId: String(t.region_id ?? ""),
        regionCode: codeById.get(String(t.region_id ?? "")) ?? null,
        tariffType: String(t.tariff_type ?? ""),
        nominalTariff: Number(t.nominal_tariff ?? 0) || 0,
        isActive: t.is_active === 1 || t.is_active === true,
      }))
      .filter((t) => t.regionId && t.tariffType);

    return json({
      pulledAt: Date.now(),
      regions: regions.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? ""),
        code: String(r.code ?? ""),
      })),
      plates,
      regionTariffs,
    });
  } catch (error) {
    console.error("Get offline master pack error:", error);
    return json({ error: "Failed to fetch offline master pack" }, 500);
  }
}

// Master tariffs for officers (athlete field: petugas HP caching).
// Sumber: baris tarif BADAU (tarif tiap region dikelola di /region-tariffs).
export async function getMasterTariffs(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);
    return json(await getBadauMasterTariffs());
  } catch (error) {
    console.error("Get master tariffs error:", error);
    return json({ error: "Failed to fetch tariffs" }, 500);
  }
}
