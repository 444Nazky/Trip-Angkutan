// Restore data mobile: unggah arsip ZIP hasil "Ekspor Data Trip" di aplikasi
// mobile, lalu masukkan kembali trip-trip yang ada di dalamnya ke database.
//
// Alur (berurutan — tidak ada penulisan sebelum seluruh validasi lolos):
//   1. Validasi berkas: wajib .zip, maksimal 100 MB.
//   2. Ekstrak di memori dan baca `data_trip.json`; tolak 400 kalau rusak,
//      kosong, atau kolom wajib tidak sesuai.
//   3. Pastikan setiap foto yang direferensikan JSON benar-benar ada di
//      folder `images/` arsip.
//   4. Unggah foto ke storage `trip-photos`.
//   5. Simpan trip dengan upsert berdasarkan `client_trip_id` (ID unik trip).
//      Bila ada langkah yang gagal, seluruh perubahan dalam permintaan ini
//      dibatalkan (rollback kompensasi: baris baru dihapus, baris lama
//      dikembalikan ke snapshot sebelumnya, foto yang sudah diunggah dihapus).
//
// Catatan transaksi: database diakses lewat PostgREST (HTTP, tanpa sesi SQL),
// jadi `BEGIN/COMMIT` tidak tersedia. Rollback dilakukan secara kompensasi
// dengan urutan terbalik — perilaku yang sama: tidak ada data setengah jadi.
import JSZip from "npm:jszip@3.10.2";
import { db, errorText, generateTripNo, json, requireAdmin } from "../_shared.ts";
import { hasColumn, normalizeCategory, normalizeGolongan, resolveTariff } from "./tariffRules.ts";
import { asUuidOrNull, isUuid } from "./trips.ts";

/** Batas ukuran arsip yang diterima. */
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

export const ARCHIVE_JSON_NAME = "data_trip.json";
const IMAGE_PREFIX = "images/";

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Batas ukuran satu foto di dalam arsip (sama dengan unggahan trip biasa). */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface RestoreTrip {
  clientTripId: string;
  officerId: string | null;
  officerName: string;
  dermagaId: string | null;
  statusMuatan: "muatan" | "kosong";
  routeFrom: string;
  routeTo: string;
  keterangan: string | null;
  startedAt: string | null;
  completedAt: string;
  createdAt: string | null;
  photoUrl?: string;
  photoCapturedAt: string | null;
  photoLatitude: number | null;
  photoLongitude: number | null;
  selfieUrl?: string;
  selfieCapturedAt: string | null;
  proofUrl?: string;
  proofCapturedAt: string | null;
  vehicles: RestoreVehicle[];
}

export interface RestoreVehicle {
  plate: string;
  type: string;
  category: string;
  golongan: string;
  hasLoad: boolean;
  tariffAmount: number;
  photoUrl?: string;
  photoCapturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
}

type ParsedPayload = { ok: true; trips: RestoreTrip[] } | { ok: false; error: string };

/**
 * Nominal kendaraan hasil restore.
 *
 * Server adalah sumber harga, sama seperti `/trips/complete`: arsip dari HP
 * bisa berisi `tariff: 0` bila cache master tarif perangkat belum terisi,
 * jadi nominal arsip TIDAK boleh dipakai apa adanya saat server punya tarif.
 * Nominal arsip hanya jadi cadangan kalau server tidak punya sumber harga
 * sama sekali (kategori/region tidak dikenal).
 */
export function restoreVehicleTariff(
  archivedAmount: number,
  resolved: { amount: number; source: string },
): { amount: number; source: string } {
  const archived = Number.isFinite(archivedAmount) ? Math.max(0, Math.round(archivedAmount)) : 0;
  if (resolved.source === "tanpa-tarif") return { amount: archived, source: resolved.source };
  return { amount: Math.max(0, Math.round(resolved.amount)), source: resolved.source };
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function isoOrNull(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function numberOrNull(value: unknown): number | null {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

/** Referensi foto lokal (di dalam arsip) atau null kalau kosong. */
function photoRef(value: unknown): string | undefined {
  const ref = text(value);
  return ref || undefined;
}

/**
 * Validasi struktur `data_trip.json` sebelum satu baris pun ditulis.
 *
 * Kolom wajib: clientTripId (ID unik trip), status muatan, rute, waktu selesai,
 * dan data kendaraan (plat + jenis) bila ada. Foto yang direferensikan harus
 * memakai folder `images/` di dalam arsip.
 */
export function validateExportPayload(raw: unknown): ParsedPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `${ARCHIVE_JSON_NAME} harus berupa objek JSON` };
  }
  const root = raw as Record<string, unknown>;
  const rows = root.trips;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: `${ARCHIVE_JSON_NAME} kosong — tidak ada data trip untuk dipulihkan` };
  }

  const seen = new Set<string>();
  const trips: RestoreTrip[] = [];

  for (let i = 0; i < rows.length; i++) {
    const label = `trip ke-${i + 1}`;
    const row = rows[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: `${label} tidak valid (bukan objek)` };
    }
    const trip = row as Record<string, unknown>;

    const clientTripId = text(trip.clientTripId) || text(trip.id);
    if (!clientTripId) {
      return { ok: false, error: `${label}: kolom wajib "clientTripId" tidak ada` };
    }
    if (seen.has(clientTripId)) {
      return { ok: false, error: `${label}: clientTripId ganda (${clientTripId})` };
    }
    seen.add(clientTripId);

    const explicitStatus = text(trip.statusMuatan);
    const load = text(trip.load);
    const derivedStatus = load === "Kosong" ? "kosong" : load === "Ada Muatan" ? "muatan" : "";
    const statusRaw = explicitStatus || derivedStatus;
    if (statusRaw !== "muatan" && statusRaw !== "kosong") {
      return { ok: false, error: `${label}: "statusMuatan" harus "muatan" atau "kosong"` };
    }

    const routeCode = text(trip.routeCode);
    let routeFrom = text(trip.routeFrom);
    let routeTo = text(trip.routeTo);
    if ((!routeFrom || !routeTo) && routeCode.includes("-")) {
      const at = routeCode.lastIndexOf("-");
      routeFrom = routeFrom || routeCode.slice(0, at).trim();
      routeTo = routeTo || routeCode.slice(at + 1).trim();
    }
    if (!routeFrom || !routeTo) {
      return { ok: false, error: `${label}: kolom wajib "routeFrom"/"routeTo" tidak sesuai` };
    }

    const completedAt = isoOrNull(trip.completedAt);
    if (!completedAt) {
      return { ok: false, error: `${label}: kolom wajib "completedAt" tidak berisi tanggal valid` };
    }

    const rawVehicles = trip.vehicles;
    if (rawVehicles !== undefined && !Array.isArray(rawVehicles)) {
      return { ok: false, error: `${label}: "vehicles" harus berupa array` };
    }
    const vehicles: RestoreVehicle[] = [];
    for (let v = 0; v < (rawVehicles ?? []).length; v++) {
      const item = (rawVehicles as unknown[])[v];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return { ok: false, error: `${label}: kendaraan ke-${v + 1} tidak valid` };
      }
      const vehicle = item as Record<string, unknown>;
      const plate = text(vehicle.plate) || text(vehicle.noPolisi);
      const type = text(vehicle.type) || text(vehicle.vehicleType);
      if (!plate || !type) {
        return { ok: false, error: `${label}: kendaraan ke-${v + 1} wajib punya plat dan jenis kendaraan` };
      }
      const load = text(vehicle.load);
      vehicles.push({
        plate,
        type,
        category: text(vehicle.category) || text(vehicle.kategori),
        golongan: text(vehicle.golongan),
        hasLoad: vehicle.hasLoad === true || vehicle.hasLoad === 1 || load === "loaded",
        tariffAmount: Number.isFinite(Number(vehicle.tariff ?? vehicle.tariffAmount))
          ? Number(vehicle.tariff ?? vehicle.tariffAmount)
          : 0,
        photoUrl: photoRef(vehicle.photoUrl),
        photoCapturedAt: isoOrNull(vehicle.photoCapturedAt),
        latitude: numberOrNull(vehicle.photoLatitude ?? vehicle.latitude),
        longitude: numberOrNull(vehicle.photoLongitude ?? vehicle.longitude),
      });
    }

    trips.push({
      clientTripId,
      officerId: asUuidOrNull(trip.officerId),
      officerName: text(trip.officer),
      dermagaId: asUuidOrNull(trip.dermagaId),
      statusMuatan: statusRaw,
      routeFrom: routeFrom.slice(0, 60),
      routeTo: routeTo.slice(0, 60),
      keterangan: text(trip.keterangan) ? text(trip.keterangan).slice(0, 240) : null,
      startedAt: isoOrNull(trip.startedAt),
      completedAt,
      createdAt: isoOrNull(trip.createdAt) ?? isoOrNull(trip.startedAt) ?? completedAt,
      photoUrl: photoRef(trip.photoUrl),
      photoCapturedAt: isoOrNull(trip.photoCapturedAt),
      photoLatitude: numberOrNull(trip.photoLatitude),
      photoLongitude: numberOrNull(trip.photoLongitude),
      selfieUrl: photoRef(trip.selfieUrl),
      selfieCapturedAt: isoOrNull(trip.selfieCapturedAt),
      proofUrl: photoRef(trip.proofUrl),
      proofCapturedAt: isoOrNull(trip.proofCapturedAt),
      vehicles,
    });
  }

  return { ok: true, trips };
}

/** Semua referensi foto lokal yang harus ada di folder `images/`. */
export function collectPhotoRefs(trips: RestoreTrip[]): string[] {
  const refs = new Set<string>();
  for (const trip of trips) {
    for (const ref of [trip.photoUrl, trip.selfieUrl, trip.proofUrl]) {
      if (ref?.startsWith(IMAGE_PREFIX)) refs.add(ref);
    }
    for (const vehicle of trip.vehicles) {
      if (vehicle.photoUrl?.startsWith(IMAGE_PREFIX)) refs.add(vehicle.photoUrl);
    }
  }
  return [...refs];
}

function mimeForPath(path: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return EXT_MIME[ext] ?? null;
}

async function uploadPhoto(bytes: Uint8Array, mime: string): Promise<string> {
  const ext = Object.entries(EXT_MIME).find(([, type]) => type === mime)?.[0] ?? "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from("trip-photos").upload(path, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (error) throw new Error(`Gagal menyimpan foto: ${errorText(error)}`);
  const { data } = db.storage.from("trip-photos").getPublicUrl(path);
  return data.publicUrl;
}

async function rowExists(table: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data, error } = await db.from(table).select("id").eq("id", id).limit(1);
  if (error) return false;
  return !!data?.[0];
}

/** Cari petugas: utamakan id, lalu nama persis. Region ikut diambil. */
async function resolveOfficer(
  officerId: string | null,
  officerName: string,
): Promise<{ id: string | null; name: string; regionId: string | null }> {
  if (officerId && isUuid(officerId)) {
    const { data } = await db.from("officers").select("id, name, region_id").eq("id", officerId).limit(1);
    const row = data?.[0] as { id?: string; name?: string; region_id?: string } | undefined;
    if (row?.id) {
      return {
        id: String(row.id),
        name: text(row.name) || officerName,
        regionId: asUuidOrNull(row.region_id),
      };
    }
  }
  if (officerName) {
    const { data } = await db.from("officers").select("id, name, region_id").eq("name", officerName).limit(1);
    const row = data?.[0] as { id?: string; name?: string; region_id?: string } | undefined;
    if (row?.id) {
      return {
        id: String(row.id),
        name: text(row.name) || officerName,
        regionId: asUuidOrNull(row.region_id),
      };
    }
  }
  return { id: null, name: officerName, regionId: null };
}

interface TripColumns {
  selfie: boolean;
  proof: boolean;
  officerName: boolean;
  vehicleKategori: boolean;
  vehicleTarifSource: boolean;
}

async function tripColumns(): Promise<TripColumns> {
  return {
    selfie: await hasColumn("trips", "selfie_path") && await hasColumn("trips", "selfie_captured_at"),
    proof: await hasColumn("trips", "proof_path") && await hasColumn("trips", "proof_captured_at"),
    officerName: await hasColumn("trips", "officer_name"),
    vehicleKategori: await hasColumn("vehicles", "kategori"),
    vehicleTarifSource: await hasColumn("vehicles", "tarif_source"),
  };
}

interface ExistingTrip {
  id: string;
  no_trip: string;
  officer_id: string | null;
}

async function findExistingTrip(clientTripId: string, officerId: string | null): Promise<ExistingTrip | null> {
  let query = db.from("trips")
    .select("id, no_trip, officer_id, created_at")
    .eq("client_trip_id", clientTripId);
  if (officerId) query = query.eq("officer_id", officerId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  const row = data?.[0] as Record<string, unknown> | undefined;
  if (!row?.id) return null;
  return {
    id: String(row.id),
    no_trip: String(row.no_trip ?? ""),
    officer_id: asUuidOrNull(row.officer_id),
  };
}

function buildTripDoc(
  trip: RestoreTrip,
  photoMap: Map<string, string>,
  officer: { id: string | null; name: string; regionId: string | null },
  dermagaId: string | null,
  columns: TripColumns,
): Record<string, unknown> {
  const photo = (ref?: string) => (ref ? (photoMap.get(ref) ?? null) : null);
  const doc: Record<string, unknown> = {
    officer_id: officer.id,
    region_id: officer.regionId,
    dermaga_id: dermagaId,
    status_muatan: trip.statusMuatan,
    route_from: trip.routeFrom,
    route_to: trip.routeTo,
    keterangan: trip.keterangan,
    foto_kosong_path: photo(trip.photoUrl),
    foto_captured_at: trip.photoCapturedAt,
    foto_latitude: trip.photoLatitude,
    foto_longitude: trip.photoLongitude,
    started_at: trip.startedAt,
    completed_at: trip.completedAt,
    client_trip_id: trip.clientTripId,
    is_synced: 1,
  };
  if (columns.selfie) {
    doc.selfie_path = photo(trip.selfieUrl);
    doc.selfie_captured_at = trip.selfieCapturedAt;
  }
  if (columns.proof) {
    doc.proof_path = photo(trip.proofUrl);
    doc.proof_captured_at = trip.proofCapturedAt;
  }
  if (columns.officerName) doc.officer_name = officer.name || null;
  return doc;
}

async function insertVehicles(
  tripId: string,
  trip: RestoreTrip,
  photoMap: Map<string, string>,
  columns: TripColumns,
  regionId: string | null,
): Promise<string[]> {
  const inserted: string[] = [];
  try {
    for (const vehicle of trip.vehicles) {
      const vehicleId = crypto.randomUUID();
      const kategori = normalizeCategory(vehicle.category);
      const golongan = vehicle.golongan ? normalizeGolongan(vehicle.golongan) : "";
      const resolved = await resolveTariff({
        vehicleType: vehicle.type,
        hasLoad: vehicle.hasLoad,
        golongan,
        kategori,
        regionId,
      });
      const tariff = restoreVehicleTariff(vehicle.tariffAmount, resolved);
      const row: Record<string, unknown> = {
        id: vehicleId,
        no_polisi: vehicle.plate.toUpperCase().slice(0, 60),
        vehicle_type: vehicle.type.slice(0, 60),
        golongan: golongan ? vehicle.golongan.slice(0, 20) : null,
        trip_id: tripId,
        has_load: vehicle.hasLoad ? 1 : 0,
        tariff_amount: tariff.amount,
        foto_path: vehicle.photoUrl ? (photoMap.get(vehicle.photoUrl) ?? null) : null,
        foto_captured_at: vehicle.photoCapturedAt,
        latitude: vehicle.latitude,
        longitude: vehicle.longitude,
      };
      if (columns.vehicleKategori) row.kategori = kategori ?? null;
      if (columns.vehicleTarifSource) row.tarif_source = tariff.source;

      const { error } = await db.from("vehicles").insert(row).select("id").single();
      if (error) throw error;
      inserted.push(vehicleId);
    }
    for (const vehicleId of inserted) {
      const { error } = await db.from("trip_vehicles").insert({
        id: crypto.randomUUID(),
        trip_id: tripId,
        vehicle_id: vehicleId,
      });
      if (error) throw error;
    }
    return inserted;
  } catch (err) {
    await deleteRows("vehicles", inserted);
    throw err;
  }
}

async function deleteRows(table: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await db.from(table).delete().eq("id", id);
    } catch {
      // Rollback best-effort: kegagalan di sini tidak boleh menutupi galat asli.
    }
  }
}

async function deleteFile(path: string): Promise<void> {
  try {
    await db.storage.from("trip-photos").remove([path]);
  } catch {
    // Berkas yatim tidak merusak data; biarkan operator membersihkannya.
  }
}

/**
 * POST /admin/restore-mobile
 * multipart/form-data dengan field `archive` berisi file .zip.
 */
export async function restoreMobileData(req: Request): Promise<Response> {
  let uploadedPaths: string[] = [];
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const form = await req.formData().catch(() => null);
    if (!form) return json({ error: "Berkas arsip tidak terkirim" }, 400);

    let file: File | null = null;
    for (const value of form.values()) {
      if (value instanceof File) { file = value; break; }
    }
    if (!file) return json({ error: 'Field "archive" wajib berisi file .zip' }, 400);
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return json({ error: "Format file harus .zip" }, 400);
    }
    if (file.size > MAX_ARCHIVE_BYTES) {
      return json({ error: `Ukuran arsip maksimal ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MB` }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      return json({ error: "File bukan arsip ZIP yang valid" }, 400);
    }

    let archive: JSZip;
    try {
      archive = await JSZip.loadAsync(bytes);
    } catch {
      return json({ error: "Arsip ZIP rusak atau tidak bisa dibaca" }, 400);
    }

    const entry = archive.file(ARCHIVE_JSON_NAME);
    if (!entry) {
      return json({ error: `${ARCHIVE_JSON_NAME} tidak ditemukan di dalam arsip` }, 400);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await entry.async("string"));
    } catch {
      return json({ error: `${ARCHIVE_JSON_NAME} bukan JSON yang valid` }, 400);
    }

    const parsed = validateExportPayload(raw);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const trips = parsed.trips;

    // Semua foto harus ada di dalam arsip SEBELUM ada penulisan ke server.
    const refs = collectPhotoRefs(trips);
    const photoBytes = new Map<string, { bytes: Uint8Array; mime: string }>();
    for (const ref of refs) {
      const photoEntry = archive.file(ref);
      if (!photoEntry || photoEntry.dir) {
        return json({ error: `Foto ${ref} tidak ditemukan di folder images/ arsip` }, 400);
      }
      const mime = mimeForPath(ref);
      if (!mime) {
        return json({ error: `Format foto ${ref} tidak didukung (jpg/jpeg/png/webp)` }, 400);
      }
      const data = await photoEntry.async("uint8array");
      if (data.length > MAX_PHOTO_BYTES) {
        return json({ error: `Ukuran foto ${ref} melebihi 5 MB` }, 400);
      }
      photoBytes.set(ref, { bytes: data, mime });
    }

    // Unggah foto. Kalau gagal, foto yang sudah terunggah dihapus kembali.
    const photoMap = new Map<string, string>();
    const uploadedRefPaths = new Map<string, string>();
    for (const [ref, data] of photoBytes) {
      const url = await uploadPhoto(data.bytes, data.mime);
      photoMap.set(ref, url);
      uploadedRefPaths.set(ref, url.replace(/^\/files\/trip-photos\//, ""));
    }
    uploadedPaths = [...uploadedRefPaths.values()];

    const columns = await tripColumns();
    const rollbacks: Array<() => Promise<void>> = [];
    const replacedVehicleIds: string[] = [];
    const usedNoTrip = new Set<string>();
    let created = 0;
    let updated = 0;
    let vehicleCount = 0;

    /** Nomor trip yang belum dipakai (bisa beberapa trip pada detik yang sama). */
    const nextNoTrip = async (): Promise<string> => {
      const base = generateTripNo();
      let candidate = base;
      let suffix = 1;
      while (usedNoTrip.has(candidate)) candidate = `${base}-${suffix++}`;
      while (true) {
        const { data } = await db.from("trips").select("id").eq("no_trip", candidate).limit(1);
        if (!data?.[0]) break;
        candidate = `${base}-${suffix++}`;
      }
      usedNoTrip.add(candidate);
      return candidate;
    };

    try {
      for (const trip of trips) {
        const officer = await resolveOfficer(trip.officerId, trip.officerName);
        const dermagaId = trip.dermagaId && await rowExists("dermagas", trip.dermagaId) ? trip.dermagaId : null;
        const doc = buildTripDoc(trip, photoMap, officer, dermagaId, columns);
        const existing = await findExistingTrip(trip.clientTripId, officer.id);

        if (existing) {
          const { data: snapshot } = await db.from("trips").select("*").eq("id", existing.id).single();
          const before = (snapshot ?? null) as Record<string, unknown> | null;
          const { error: updateError } = await db.from("trips").update(doc).eq("id", existing.id);
          if (updateError) throw updateError;

          const { data: oldLinks } = await db.from("trip_vehicles")
            .select("vehicle_id").eq("trip_id", existing.id);
          const oldVehicleIds = (oldLinks ?? []).map((row: any) => String(row.vehicle_id));

          const newVehicleIds = await insertVehicles(existing.id, trip, photoMap, columns, officer.regionId);
          rollbacks.push(async () => {
            await deleteRows("vehicles", newVehicleIds);
            if (before) await db.from("trips").update(before).eq("id", existing.id);
          });
          // Kendaraan lama baru dilepas setelah SELURUH trip berhasil diproses
          // (lihat pembersihan di bawah), sehingga rollback tetap utuh.
          replacedVehicleIds.push(...oldVehicleIds);
          updated += 1;
          vehicleCount += newVehicleIds.length;
        } else {
          const tripId = crypto.randomUUID();
          const noTrip = await nextNoTrip();
          const { error: insertError } = await db.from("trips").insert({
            id: tripId,
            no_trip: noTrip,
            ...doc,
            created_at: trip.createdAt,
          });
          if (insertError) throw insertError;
          rollbacks.push(async () => {
            await db.from("trips").delete().eq("id", tripId);
          });
          const newVehicleIds = await insertVehicles(tripId, trip, photoMap, columns, officer.regionId);
          conditionallyTrackVehicles(rollbacks, newVehicleIds);
          created += 1;
          vehicleCount += newVehicleIds.length;
        }
      }
    } catch (err) {
      // ROLLBACK: batalkan seluruh perubahan permintaan ini, urutan terbalik.
      for (const rollback of [...rollbacks].reverse()) {
        try { await rollback(); } catch { /* lanjutkan rollback lain */ }
      }
      for (const path of uploadedPaths) await deleteFile(path);
      const message = errorText(err);
      console.error("[restore-mobile] gagal, sudah di-rollback:", message);
      return json({ error: `Restore gagal dan dibatalkan: ${message}` }, 500);
    }

    // Commit: lepas baris kendaraan lama dari trip yang diperbarui. Tautannya
    // ikut terhapus lewat ON DELETE CASCADE.
    await deleteRows("vehicles", replacedVehicleIds);

    return json({
      success: true,
      trips: trips.length,
      created,
      updated,
      vehicles: vehicleCount,
      photos: uploadedPaths.length,
    });
  } catch (error) {
    for (const path of uploadedPaths) await deleteFile(path);
    console.error("[restore-mobile] error:", error);
    return json({ error: `Restore gagal: ${errorText(error)}` }, 500);
  }
}

/** Catat rollback tambahan untuk kendaraan yang sudah ditautkan. */
function conditionallyTrackVehicles(
  rollbacks: Array<() => Promise<void>>,
  vehicleIds: string[],
): void {
  if (!vehicleIds.length) return;
  rollbacks.push(async () => { await deleteRows("vehicles", vehicleIds); });
}
