// Master jenis kendaraan.
//
// SEBELUM ada handler ini, daftar jenis kendaraan hidup di tiga tempat:
//   - hardcode di dashboard admin ("motor, mobil, truk kecil, ...")
//   - hardcode di aplikasi petugas ("Motor, Mobil, Truck Kecil, ...")
//   - baris tarif per region (tiap region boleh punya ejaan sendiri)
// Akibatnya pilihan di admin dan di HP tidak sinkron, dan satu jenis bisa
// muncul sebagai dua baris di region yang sama.
//
// Sekarang `vehicle_types` jadi sumber tunggal: dashboard admin, aplikasi
// petugas, dan resolver tarif semuanya membaca daftar yang sama dari
// database. Menambah/menghapus jenis di admin LANGSUNG menulis ke tabel ini
// (tidak ada daftar lokal di frontend), jadi tidak ada data palsu.
//
// Kunci pencocokan (`key`) = bentuk normalisasi: lowercase, "truck" -> "truk",
// tanpa spasi. Jadi "Truk Kecil", "truk kecil", dan "Truck Kecil" adalah jenis
// yang sama - ini aturan yang sama dengan `normalizeVehicleType` di
// tariffRules.ts.
import { db, json, auth, requireAdmin, dbDetail } from "../_shared.ts";

/** Kunci perbandingan jenis kendaraan (harus sama dengan tariffRules). */
export const vehicleTypeKey = (raw: unknown): string =>
  String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/truck/g, "truk")
    .replace(/[^a-z0-9]/g, "");

export interface VehicleTypeRow {
  id: string;
  name: string;
  key: string;
  sortOrder: number;
  isActive: boolean;
}

type RawRow = {
  id?: unknown;
  name?: unknown;
  key?: unknown;
  sort_order?: unknown;
  is_active?: unknown;
};

function toRow(r: RawRow): VehicleTypeRow {
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    key: String(r.key ?? vehicleTypeKey(r.name)),
    sortOrder: Number(r.sort_order ?? 0) || 0,
    isActive: Number(r.is_active ?? 1) === 1,
  };
}

/**
 * Daftar jenis kendaraan.
 *
 * Auth wajib (petugas butuh daftar ini untuk form kendaraan). Admin boleh
 * meminta jenis nonaktif juga (`?includeInactive=1`) supaya bisa melihat dan
 * mengaktifkan kembali jenis lama.
 */
export async function getVehicleTypes(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);

    const url = new URL(req.url);
    const wantInactive = url.searchParams.get("includeInactive") === "1";
    // Hanya admin yang boleh melihat jenis nonaktif.
    const includeInactive = wantInactive && ctx.role === "admin";

    const { data, error } = await db
      .from("vehicle_types")
      .select("id, name, key, sort_order, is_active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw error;

    const rows = ((data ?? []) as RawRow[])
      .map(toRow)
      .filter((r) => r.name && r.key)
      .filter((r) => includeInactive || r.isActive);

    return json(rows);
  } catch (error) {
    console.error("Get vehicle types error:", error);
    return json({ error: "Gagal memuat daftar jenis kendaraan" }, 500);
  }
}

/** Tambah jenis kendaraan baru ke master. */
export async function createVehicleType(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const body = await req.json().catch(() => ({} as any));
    const name = String(body.name ?? body.vehicleType ?? "").trim();
    if (!name) return json({ error: "Nama jenis kendaraan wajib diisi" }, 400);
    const key = vehicleTypeKey(name);
    if (!key) return json({ error: "Nama jenis kendaraan tidak valid" }, 400);

    const { data: existing } = await db.from("vehicle_types").select("id, name").eq("key", key).limit(1);
    if (existing && existing.length) {
      return json(
        { error: `Jenis kendaraan "${existing[0].name}" sudah ada (huruf besar/kecil tidak dibedakan)` },
        409,
      );
    }

    // Urutan default: paling akhir dari jenis yang ada.
    let sortOrder = Number(body.sortOrder);
    if (!Number.isFinite(sortOrder)) {
      const { data: last } = await db
        .from("vehicle_types")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1);
      sortOrder = Number((last as any[] | null)?.[0]?.sort_order ?? 0) + 1;
    }

    const { data, error } = await db
      .from("vehicle_types")
      .insert({ name, key, sort_order: Math.floor(sortOrder), is_active: 1 })
      .select()
      .single();
    if (error) throw error;
    return json(toRow(data as RawRow), 201);
  } catch (error) {
    console.error("Create vehicle type error:", error);
    return json({ error: `Jenis kendaraan gagal ditambahkan karena galat server: ${dbDetail(error)}` }, 500);
  }
}

/**
 * Ubah jenis kendaraan (nama / urutan / status aktif).
 *
 * Kalau nama berubah, baris tarif yang memakai ejaan lama ikut ditulis
 * memakai ejaan baru. Tanpa ini, "Truk Kecil" yang diubah jadi "Truk Ringan"
 * akan meninggalkan baris tarif yatim pada ejaan lama.
 */
export async function updateVehicleType(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { data: found } = await db.from("vehicle_types").select("id, name, key").eq("id", id).limit(1);
    const current = (found ?? [])[0] as RawRow | undefined;
    if (!current) return json({ error: "Jenis kendaraan tidak ditemukan" }, 404);

    const body = await req.json().catch(() => ({} as any));
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    let renamed: { from: string; to: string } | null = null;
    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) return json({ error: "Nama jenis kendaraan wajib diisi" }, 400);
      const key = vehicleTypeKey(name);
      if (!key) return json({ error: "Nama jenis kendaraan tidak valid" }, 400);
      if (key !== String(current.key ?? "")) {
        const { data: clash } = await db.from("vehicle_types").select("id, name").eq("key", key).limit(1);
        if (clash && clash.length) {
          return json({ error: `Jenis kendaraan "${clash[0].name}" sudah ada` }, 409);
        }
        update.name = name;
        update.key = key;
        renamed = { from: String(current.name ?? ""), to: name };
      }
    }
    if (body.sortOrder !== undefined) {
      const n = Number(body.sortOrder);
      if (!Number.isFinite(n)) return json({ error: "Urutan tidak valid" }, 400);
      update.sort_order = Math.floor(n);
    }
    if (body.isActive !== undefined) update.is_active = body.isActive ? 1 : 0;

    const { error } = await db.from("vehicle_types").update(update).eq("id", id);
    if (error) throw error;

    // Tulis ulang baris tarif yang memakai ejaan lama.
    let renamedRows = 0;
    if (renamed) {
      const oldKey = vehicleTypeKey(renamed.from);
      const newKey = vehicleTypeKey(renamed.to);
      if (oldKey !== newKey) {
        const { data: rows } = await db
          .from("region_tariff_rows")
          .select("id, region_id, vehicle_type")
          .eq("vehicle_type", renamed.from);
        const affected = ((rows ?? []) as any[]).filter((r) => vehicleTypeKey(r.vehicle_type) === oldKey);
        for (const row of affected) {
          const { error: upErr } = await db
            .from("region_tariff_rows")
            .update({ vehicle_type: renamed.to, updated_at: new Date().toISOString() })
            .eq("id", String(row.id));
          if (!upErr) renamedRows++;
        }
        await db
          .from("tariffs")
          .update({ vehicle_type: renamed.to })
          .eq("vehicle_type", renamed.from);
      }
    }

    return json({ success: true, id, renamed: renamedRows, name: update.name ?? current.name });
  } catch (error) {
    console.error("Update vehicle type error:", error);
    return json({ error: `Jenis kendaraan gagal diperbarui karena galat server: ${dbDetail(error)}` }, 500);
  }
}

/**
 * Hapus jenis kendaraan dari master.
 *
 * Baris tarif milik jenis ini ikut dihapus (baris itu tidak berguna lagi
 * kalau jenisnya sudah tidak ada). Riwayat trip lama TIDAK disentuh: kolom
 * `vehicles.vehicle_type` berisi teks, jadi history tetap terbaca apa adanya.
 */
export async function deleteVehicleType(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const { data: found } = await db.from("vehicle_types").select("id, name, key").eq("id", id).limit(1);
    const current = (found ?? [])[0] as RawRow | undefined;
    if (!current) return json({ error: "Jenis kendaraan tidak ditemukan" }, 404);

    const name = String(current.name ?? "");
    const key = String(current.key ?? vehicleTypeKey(name));

    // Baris tarif dengan ejaan berbeda ("truk kecil") ikut dihitung.
    const { data: rows } = await db.from("region_tariff_rows").select("id, vehicle_type");
    const affected = ((rows ?? []) as any[]).filter((r) => vehicleTypeKey(r.vehicle_type) === key);
    let deletedRows = 0;
    for (const row of affected) {
      const { error } = await db.from("region_tariff_rows").delete().eq("id", String(row.id));
      if (!error) deletedRows++;
    }

    const { data: masterRows } = await db.from("tariffs").select("id, vehicle_type");
    const affectedMaster = ((masterRows ?? []) as any[]).filter((r) => vehicleTypeKey(r.vehicle_type) === key);
    let deletedMaster = 0;
    for (const row of affectedMaster) {
      const { error } = await db.from("tariffs").delete().eq("id", String(row.id));
      if (!error) deletedMaster++;
    }

    const { error } = await db.from("vehicle_types").delete().eq("id", id);
    if (error) throw error;

    return json({ success: true, id, name, deletedRows, deletedMaster });
  } catch (error) {
    console.error("Delete vehicle type error:", error);
    return json({ error: `Jenis kendaraan gagal dihapus karena galat server: ${dbDetail(error)}` }, 500);
  }
}
