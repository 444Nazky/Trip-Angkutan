// Master data handlers: regions, dermagas, tariffs.
import { db, json, auth, requireAdmin } from "../_shared.ts";
import { invalidateTariffCache } from "./tariffRules.ts";

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
    const { data, error } = await db.from("regions").insert({ name, code }).select().single();
    if (error) throw error;
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
    const { data, error } = await db.from("dermagas").insert({ region_id, name, code }).select().single();
    if (error) throw error;
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
    const { name, code } = await req.json().catch(() => ({})) as any;
    const { error } = await db.from("dermagas").update({ name, code }).eq("id", id);
    if (error) throw error;
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
    await db.from("routes").delete().eq("dermaga_id", id);
    await db.from("officer_dermagas").delete().eq("dermaga_id", id);
    await db.from("dermagas").delete().eq("id", id);
    return json({ success: true });
  } catch (error) {
    console.error("Delete dermaga error:", error);
    return json({ error: "Failed to delete dermaga" }, 500);
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

// Master tariffs for officers (athlete field: petugas HP caching).
export async function getMasterTariffs(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);
    const { data, error } = await db
      .from("tariffs")
      .select("id, golongan, vehicle_type, loaded_tariff, empty_tariff, description")
      .eq("is_active", 1)
      .order("golongan", { ascending: true })
      .order("vehicle_type", { ascending: true });
    if (error) throw error;
    return json(data);
  } catch (error) {
    console.error("Get master tariffs error:", error);
    return json({ error: "Failed to fetch tariffs" }, 500);
  }
}
