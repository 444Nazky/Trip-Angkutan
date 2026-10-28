// Resolusi tarif terpusat — SATU-SATUNYA sumber harga di backend.
//
// Dipakai oleh:
//   - /trips/complete (saat insert kendaraan) -> vehicles.tariff_amount
//   - /reports/trips   (saat baca laporan)   -> tarif_efektif per kendaraan
//
// Urutan prioritas harga (kebijakan disetujui owner):
//   1. Kategori Internal            -> Rp 0 (kendaraan internal selalu gratis)
//   2. Baris tarif region per jenis -> region_tariff_rows (region + jenis kendaraan)
//                                      Eksternal: hasLoad -> muatan_tariff,
//                                      kosong -> kosong_tariff. Lokal: lokal_tariff.
//   3. Tarif terpusat per region    -> region_tariffs (lokal / eksternal)
//   4. Nol                          -> tidak ada sumber harga (ditandai "tanpa-tarif")
//
// Setiap region punya barisnya sendiri (termasuk BADAU); tidak ada fallback
// ke master. Region tanpa baris = tarif 0, dan admin mengisinya di tabel REGION.
//
// Catatan normalisasi: penulisan jenis kendaraan di admin bisa "Truck Besar"
// sedangkan label UI mobile "Truk Besar". both dinormalisasi ke kunci yang sama
// supaya lookup tidak meleset -> penyebab utama laporan "Rp 0" sebelumnya.

import { db } from "../_shared.ts";

export interface MasterTariffRow {
  id?: string;
  golongan: string;
  vehicle_type: string;
  loaded_tariff: number;
  empty_tariff: number;
  description?: string | null;
  is_active?: number;
}

export interface FlatRegionTariff {
  region_id: string;
  tariff_type: "lokal" | "eksternal";
  nominal_tariff: number;
  is_active: number;
}

export type TariffSource =
  | "internal"
  | "region-row"
  | "region"
  | "tanpa-tarif";

export interface TariffResult {
  amount: number;
  source: TariffSource;
  loaded: number;
  empty: number;
}

// ── Cache master tarif & tarif region (per instance edge function) ────────────

let masterCache: { at: number; rows: MasterTariffRow[] } | null = null;
let regionCache: { at: number; rows: FlatRegionTariff[] } | null = null;
let overrideCache: { at: number; rows: OverrideTariffRow[] } | null = null;

const MASTER_TTL_MS = 60_000;
const REGION_TTL_MS = 60_000;

/** Buang cache tarif (dipanggil setelah admin mengubah master tarif). */
export function invalidateTariffCache(): void {
  masterCache = null;
  regionCache = null;
  overrideCache = null;
}

/** Master tarif untuk mobile = baris tarif BADAU (sumber tunggal setelah golongan dihapus). */
export async function getMasterTariffs(force = false): Promise<MasterTariffRow[]> {
  if (!force && masterCache && Date.now() - masterCache.at < MASTER_TTL_MS) {
    return masterCache.rows;
  }
  const { data: region } = await db
    .from("regions")
    .select("id")
    .eq("code", "BADAU")
    .limit(1);
  const regionId = (region as any[] | null)?.[0]?.id;
  if (!regionId) return masterCache?.rows ?? [];
  const { data, error } = await db
    .from("region_tariff_rows")
    .select("id, vehicle_type, muatan_tariff, kosong_tariff, is_active")
    .eq("region_id", regionId)
    .eq("is_active", 1);
  if (error || !data) return masterCache?.rows ?? [];
  const rows = (data as any[]).map((t) => ({
    id: t.id,
    golongan: "",
    vehicle_type: String(t.vehicle_type ?? ""),
    loaded_tariff: Number(t.muatan_tariff ?? 0) || 0,
    empty_tariff: Number(t.kosong_tariff ?? 0) || 0,
    description: null,
    is_active: t.is_active ?? 1,
  }));
  masterCache = { at: Date.now(), rows };
  return rows;
}

export async function getRegionTariffs(force = false): Promise<FlatRegionTariff[]> {
  if (!force && regionCache && Date.now() - regionCache.at < REGION_TTL_MS) {
    return regionCache.rows;
  }
  const { data, error } = await db
    .from("region_tariffs")
    .select("region_id, tariff_type, nominal_tariff, is_active");
  if (error || !data) return regionCache?.rows ?? [];
  const rows = (data as any[]).map((r) => ({
    region_id: String(r.region_id ?? ""),
    tariff_type: (String(r.tariff_type ?? "").toLowerCase() === "eksternal"
      ? "eksternal"
      : "lokal") as "lokal" | "eksternal",
    nominal_tariff: Number(r.nominal_tariff ?? 0) || 0,
    is_active: Number(r.is_active ?? 0) || 0,
  }));
  regionCache = { at: Date.now(), rows };
  return rows;
}

// ── Baris override tarif region (region_tariff_rows) ─────────────────────────

export interface OverrideTariffRow {
  region_id: string;
  vehicle_type: string;
  lokal_tariff: number;
  muatan_tariff: number;
  kosong_tariff: number;
  is_active: number;
}

export async function getRegionTariffOverrides(force = false): Promise<OverrideTariffRow[]> {
  if (!force && overrideCache && Date.now() - overrideCache.at < REGION_TTL_MS) {
    return overrideCache.rows;
  }
  const { data, error } = await db
    .from("region_tariff_rows")
    .select("region_id, vehicle_type, lokal_tariff, muatan_tariff, kosong_tariff, is_active");
  if (error || !data) return overrideCache?.rows ?? [];
  const rows = (data as any[]).map((r) => ({
    region_id: String(r.region_id ?? ""),
    vehicle_type: String(r.vehicle_type ?? ""),
    lokal_tariff: Number(r.lokal_tariff ?? 0) || 0,
    muatan_tariff: Number(r.muatan_tariff ?? 0) || 0,
    kosong_tariff: Number(r.kosong_tariff ?? 0) || 0,
    is_active: Number(r.is_active ?? 0) || 0,
  }));
  overrideCache = { at: Date.now(), rows };
  return rows;
}

// ── Normalisasi kategori operasional ──────────────────────────────────────────

export const OPERATIONAL_CATEGORIES = ["Internal", "Eksternal", "Lokal"] as const;

export type OperationalCategory = (typeof OPERATIONAL_CATEGORIES)[number];

/** Kategori dari plat/plat scan memakai huruf kecil (internal/lokal/eksternal). */
export function normalizeCategory(raw: unknown): OperationalCategory | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("internal")) return "Internal";
  if (s.startsWith("eksternal")) return "Eksternal";
  if (s.startsWith("lokal")) return "Lokal";
  return null;
}

/** Kunci perbandingan jenis kendaraan.
 * "Truck Besar" / "TruckBesar" / "Truk Besar" -> "trukbesar"
 */
export function normalizeVehicleType(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/truck/g, "truk")
    .replace(/[^a-z0-9]/g, "");
}

/** Samakan golongan (I/ii/ "3 ") agar lookup tidak miss karena format. */
export function normalizeGolongan(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  const roman: Record<string, string> = { i: "i", ii: "ii", iii: "iii", iv: "iv", v: "v" };
  if (roman[s]) return roman[s];
  const n = Number(s);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return ["i", "ii", "iii", "iv", "v"][n - 1];
  return s;
}

// ── Resolver tarif ────────────────────────────────────────────────────────────

export interface ResolveTariffInput {
  vehicleType: string;
  hasLoad: boolean;
  /** @deprecated golongan sudah tidak dipakai; dipertahankan agar pemanggil lama tetap kompatibel. */
  golongan?: string | null;
  /** Kategori operasional kendaraan (Internal / Eksternal / Lokal). */
  kategori?: string | null;
  /** Region tempat trip dicatat — dipakai untuk tarif terpusat per region. */
  regionId?: string | null;
}

export interface ResolvedTariff extends TariffResult {
  /** Kategori final yang dipakai (Internal -> 0). */
  category: OperationalCategory | null;
}

export async function resolveTariff(input: ResolveTariffInput): Promise<ResolvedTariff> {
  const category = normalizeCategory(input.kategori);
  const vehicleType = String(input.vehicleType ?? "").trim();
  const hasLoad = !!input.hasLoad;
  const wantType = normalizeVehicleType(vehicleType);

  // 1. Internal selalu gratis.
  if (category === "Internal") {
    return { amount: 0, source: "internal", loaded: 0, empty: 0, category };
  }

  // 2. Baris tarif region untuk jenis kendaraan ini (satu baris per region+jenis).
  if (input.regionId) {
    const overrides = await getRegionTariffOverrides();
    const hit = overrides.find(
      (o) =>
        o.region_id === String(input.regionId) &&
        o.is_active === 1 &&
        (wantType ? normalizeVehicleType(o.vehicle_type) === wantType : true),
    );
    if (hit && category === "Lokal") {
      // Tarif lokal per jenis. 0 = belum diisi -> pakai nilai flat di langkah 3.
      const lokal = Number(hit.lokal_tariff ?? 0) || 0;
      if (lokal > 0) {
        return { amount: lokal, source: "region-row", loaded: lokal, empty: lokal, category };
      }
    } else if (hit) {
      const loaded = Number(hit.muatan_tariff ?? 0) || 0;
      const empty = Number(hit.kosong_tariff ?? 0) || 0;
      return {
        amount: hasLoad ? loaded : empty,
        source: "region-row",
        loaded,
        empty,
        category,
      };
    }
  }

  // 3. Tarif terpusat per region (kategori lokal / eksternal, region aktif).
  if (category && input.regionId) {
    const regions = await getRegionTariffs();
    const wanted = category === "Lokal" ? "lokal" : "eksternal";
    const hit = regions.find(
      (r) => r.region_id === String(input.regionId) && r.tariff_type === wanted && r.is_active === 1,
    );
    if (hit) {
      const nominal = Number(hit.nominal_tariff ?? 0) || 0;
      if (nominal > 0) {
        return { amount: nominal, source: "region", loaded: nominal, empty: nominal, category };
      }
    }
  }

  // 4. Tidak ada sumber harga.
  return { amount: 0, source: "tanpa-tarif", loaded: 0, empty: 0, category };
}

// ── Deteksi ketersediaan kolom (deploy aman sebelum migrasi) ─────────────────

const columnSupport = new Map<string, boolean>();

/**
 * Cek apakah sebuah kolom ada di tabel tertentu. Dipakai supaya backend bisa
 * jalan baik sebelum maupun sesudah migrasi kolom baru (kategori, selfie_path)
 * diterapkan — tidak sampai insert gagal total.
 */
export async function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = columnSupport.get(key);
  if (cached !== undefined) return cached;
  const { error } = await db.from(table).select(`id, ${column}`).limit(1);
  const ok = !error;
  columnSupport.set(key, ok);
  return ok;
}
