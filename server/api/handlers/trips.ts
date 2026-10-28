// Trips handlers (port of backend/src/routes/trips.js), photos on Storage.
import { db, json, auth, generateTripNo, type OfficerClaims } from "../_shared.ts";
import { resolveTariff, hasColumn, normalizeCategory, normalizeGolongan } from "./tariffRules.ts";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// Status muatan memakai daftar putih — bukan string bebas.
const VALID_STATUS_MUATAN = new Set(["muatan", "kosong"]);

// Batas panjang teks bebas (nomor plat, keterangan, rute).
const MAX_SHORT_TEXT = 60;
const MAX_LONG_TEXT = 240;

function shortText(value: unknown): string {
  return String(value ?? "").trim().slice(0, MAX_SHORT_TEXT);
}

function longText(value: unknown): string {
  return String(value ?? "").trim().slice(0, MAX_LONG_TEXT);
}

// ── Validasi UUID ─────────────────────────────────────────────────────────────
//
// Semua kolom FK di tabel trips/vehicles/dermagas bertipe uuid. Kalau satu
// nilai bukan UUID (mis. ID dermaga lawas "BADAU-D1", atau region kosong ""),
// PostgreSQL menolak insert dengan "invalid input syntax for type uuid"
// (kode 22P02). Handler lama melempar galat itu apa adanya -> PostgREST 400
// -> router jadi HTTP 500 tanpa penjelasan, dan petugas hanya melihat
// "gagal mengunggah".
//
// Jadi: TIGA hal dilakukan di sini.
//   1. Nilai yang TIDAK berbentuk uuid TIDAK PERNAH masuk ke query.
//   2. Nilai yang wajib (officer) tidak valid -> 401/400 dengan pesan jelas.
//   3. Nilai opsional (region/dermaga) tidak valid -> null, bukan error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Nilai UUID yang valid, atau null. String kosong -> null (bukan error). */
export function asUuidOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return UUID_RE.test(s) ? s : null;
}
/**
 * Apakah payload ini instance yang sama dengan trip yang sudah tersimpan?
 *
 * Kunci idempoten: `completed_at`. Retry dari perangkat yang sama mengirim
 * payload yang sama persis, jadi nilainya cocok. Trip yang berbeda pasti
 * punya waktu selesai yang berbeda.
 */
function isSameTripInstance(existing: any, payload: any): boolean {
  const a = String(existing?.completed_at ?? "");
  const b = String(payload?.completedAt ?? "");
  if (!a && !b) return true;
  return a === b;
}

// ── Kode galat PostgreSQL ────────────────────────────────────────────────────

const PG_INVALID_UUID = "22P02"; // invalid input syntax for type uuid
const PG_FOREIGN_KEY = "23503"; // foreign key violation
const PG_UNIQUE_VIOLATION = "23505"; // duplicate key

function pgCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

/**
 * Ambil pesan galat dari berbagai bentuk error.
 *
 * PENTING: galat dari PostgREST itu objek biasa ({ message, details, hint,
 * code }), BUKAN instance Error. Kalau dipanggil `String(error)`, hasilnya
 * "[object Object]" — pesan aslinya hilang, jadi galat 22P02/23503 tidak
 * pernah bisa dijelaskan ke petugas.
 *
 * Implementasinya共用 di `_shared.ts` (dipakai juga handler master).
 */
export { errorText } from "../_shared.ts";
import { errorText } from "../_shared.ts";

/**
 * Terjemahkan galat PostgREST menjadi jawaban HTTP yang JELAS.
 *
 * Posisi server intranet: pesan galat PostgreSQL sangat membantu operator
 * (bukan data sensitif), sedangkan "Failed to submit complete trip
 * documentation" tidak memberi informasi apa pun. Petugas di lapangan
 * minimal harus tahu itu masalah data, bukan masalah jaringan.
 *
 * Return null kalau galatnya tidak dikenali (biarkan jalur umum yang menanganinya).
 */
export function explainDbError(error: unknown): { status: number; message: string } | null {
  const code = pgCode(error);
  const raw = errorText(error);
  if (code === PG_INVALID_UUID) {
    return {
      status: 400,
      message: "ID pada data trip tidak valid (harus UUID). Petugas harus logout lalu login ulang.",
    };
  }
  if (code === PG_FOREIGN_KEY) {
    return {
      status: 409,
      message: `Database menolak data trip (${code}): ${raw.slice(0, 240)}`,
    };
  }
  if (code === PG_UNIQUE_VIOLATION) {
    return {
      status: 409,
      message: `Data trip bentrok di database (${code}): ${raw.slice(0, 240)}`,
    };
  }
  return null;
}

/**
 * Validasi satu kendaraan pada payload trip.
 * Mengembalikan pesan error (bahasa Indonesia) atau null bila valid.
 */
function validateVehiclePayload(vehicle: any, index: number): string | null {
  const label = `kendaraan ke-${index + 1}`;
  if (!vehicle || typeof vehicle !== "object") return `${label} tidak valid`;

  const noPolisi = String(vehicle.noPolisi ?? "").trim();
  if (!noPolisi) return `Nomor plat ${label} wajib diisi`;
  if (noPolisi.length > MAX_SHORT_TEXT) return `Nomor plat ${label} terlalu panjang`;

  const vehicleType = String(vehicle.vehicleType ?? "").trim();
  if (!vehicleType) return `Jenis kendaraan ${label} wajib diisi`;
  if (vehicleType.length > MAX_SHORT_TEXT) return `Jenis kendaraan ${label} terlalu panjang`;

  if (typeof vehicle.hasLoad !== "boolean") {
    return `Status muatan ${label} harus true (muatan) atau false (kosong)`;
  }

  // Kategori operasional: boleh kosong (data lawas), tapi kalau diisi harus
  // salah satu dari tiga kategori yang dikenal — supaya backend dan laporan
  // tidak pernah memakai kategori yang tidak dikenali.
  const kategoriRaw = vehicle.kategori ?? vehicle.category;
  const kategoriText = String(kategoriRaw ?? "").trim();
  if (kategoriText && !normalizeCategory(kategoriText)) {
    return `Kategori ${label} harus salah satu dari: Internal, Eksternal, Lokal`;
  }

  return null;
}

function numericCoordinate(value: unknown): number | null {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function validPhotoIndex(value: unknown, count: number): number | null | undefined {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (Number.isInteger(num) && num >= 0 && num < count) return num;
  return undefined;
}

// ── Ketersediaan kolom baru (aman dipakai sebelum/sesudah migrasi) ──────────

const columnCache = new Map<string, boolean>();

async function supportsColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = columnCache.get(key);
  if (cached !== undefined) return cached;
  const ok = await hasColumn(table, column);
  columnCache.set(key, ok);
  return ok;
}

// ponytail: cache tarif per-request. Resolver tarif (tariffRules.ts) sudah
// punya cache sendiri per-instance (60 detik), jadi handler tidak perlu query
// tariffs per kendaraan.

/**
 * Apakah baris dengan id ini benar-benar ADA di tabelnya?
 *
 * Penjaga FK: kolom `region_id` / `dermaga_id` / `officer_id` punya
 * REFERENCES. Kalau nilainya UUID yangvalid tapi barisnya sudah dihapus
 * admin, PostgreSQL menjawab 23503 (foreign key violation) -> handler lama
 * melemparnya -> HTTP 500. Di sini nilainya dibuang saja (null), supaya trip
 * tetap tercatat albeit tanpa relasi itu.
 */
async function rowExists(table: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data, error } = await db.from(table).select("id").eq("id", id).limit(1);
  if (error) return false;
  return !!data?.[0];
}

/**
 * Tentukan region & dermaga untuk trip.
 *
 * ATURAN: nilai yang bermasalah TIDAK BOLEH menggagalkan permintaan.
 *   - bukan UUID        -> null (bukan error)
 *   - UUID tapi hilang  -> null (bukan error FK)
 * Yang wajib (officer) ditangani terpisah di handler.
 */
async function resolveTripReferences(
  officerId: string,
  regionIdRaw: unknown,
  bodyDermagaId: unknown,
): Promise<{ regionId: string | null; dermagaId: string | null }> {
  const regionCandidate = asUuidOrNull(regionIdRaw);
  const bodyDermaga = asUuidOrNull(bodyDermagaId);

  // Prioritas 1: dermaga yang dipilih petugas (dikirim di form).
  let dermagaId: string | null = null;
  if (bodyDermaga && (await rowExists("dermagas", bodyDermaga))) dermagaId = bodyDermaga;

  // Prioritas 2: dermaga yang ditugaskan ke petugas.
  if (!dermagaId) {
    const { data: od } = await db.from("officer_dermagas")
      .select("dermaga_id").eq("officer_id", officerId).limit(1);
    const candidate = asUuidOrNull(od?.[0]?.dermaga_id);
    if (candidate && (await rowExists("dermagas", candidate))) dermagaId = candidate;
  }

  // Prioritas 3: dermaga pertama di region petugas.
  if (!dermagaId && regionCandidate) {
    const { data: d } = await db.from("dermagas")
      .select("id").eq("region_id", regionCandidate).limit(1);
    const candidate = asUuidOrNull(d?.[0]?.id);
    if (candidate) dermagaId = candidate;
  }

  const regionId = regionCandidate && (await rowExists("regions", regionCandidate))
    ? regionCandidate
    : null;

  return { regionId, dermagaId };
}

async function publicUrl(bucket: string, path: string): Promise<string> {
  const { data } = db.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Pesan galat yang bisa ditindaklanjuti saat unggahan berkas gagal.
 *
 * Kegagalan paling sering di kantor adalah direktori penyimpanan tidak
 * bisa ditulis (kepemilikan salah di host). Tanpa penerjemahan ini, petugas
 * hanya melihat "gagal menyimpan" tanpa tahu harus minta apa ke operator.
 *
 * CATATAN: klien database (server/api/_db.ts) mengembalikan objek galat
 * biasa `{ message }`, BUKAN instance `Error`. Versi lama memakai
 * `String(error)` sehingga hasilnya "[object Object]" dan pola
 * "permission denied" TIDAK PERNAH cocok - artinya pesan yang bisa
 * ditindaklanjuti tidak pernah sampai ke petugas.
 */
function storageErrorMessage(error: unknown): string {
  const raw = errorText(error);
  if (/permission denied|EACCES|os error 13/i.test(raw)) {
    return "Server tidak bisa menyimpan berkas. Operator perlu memperbaiki " +
      "kepemilikan folder penyimpanan di PC kantor " +
      "(sudo chown -R 1000:1000 data/storage).";
  }
  return "Server gagal menyimpan berkas: " + (raw || "kesalahan tidak diketahui");
}

async function storePhoto(file: File): Promise<string> {
  const ext = EXT_BY_TYPE[file.type] || ".jpg";
  const path = `${crypto.randomUUID()}${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await db.storage.from("trip-photos").upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(storageErrorMessage(error));
  return await publicUrl("trip-photos", path);
}

async function insertVehicleRow(
  tripId: string,
  vehicle: any,
  photoPath: string,
  regionId: string | null,
): Promise<string> {
  const vehicleId = crypto.randomUUID();

  // Kategori operasional = apa yang dipilih petugas (Internal/Eksternal/Lokal).
  // Golongan = gol master tarif (I..V). Keduanya dibedakan supaya tarif dan
  // laporan bisa memakai sumber yang benar.
  const kategori = normalizeCategory(vehicle.kategori ?? vehicle.category);
  const golonganRaw = String(vehicle.golongan ?? "").trim();
  const golongan = golonganRaw ? normalizeGolongan(golonganRaw) : "";

  const resolved = await resolveTariff({
    vehicleType: vehicle.vehicleType,
    hasLoad: !!vehicle.hasLoad,
    golongan,
    kategori,
    regionId,
  });

  // Master Tarif diutamakan (server-authoritative). Nominal dari client hanya
  // dipakai kalau server benar-benar tidak punya sumber harga.
  const amount = resolved.source === "tanpa-tarif"
    ? (typeof vehicle.tariffAmount === "number" && vehicle.tariffAmount > 0 ? vehicle.tariffAmount : 0)
    : resolved.amount;

  const row: Record<string, unknown> = {
    id: vehicleId,
    no_polisi: shortText(vehicle.noPolisi).toUpperCase(),
    vehicle_type: shortText(vehicle.vehicleType),
    // Golongan disimpan dalam bentuk ternormalisasi supaya lookup master tarif
    // (I..V / 1..5) konsisten antara insert dan laporan.
    golongan: golongan ? golonganRaw : null,
    trip_id: tripId,
    has_load: vehicle.hasLoad ? 1 : 0,
    tariff_amount: amount,
    foto_path: photoPath,
    foto_captured_at: vehicle.photoCapturedAt || null,
    latitude: numericCoordinate(vehicle.latitude),
    longitude: numericCoordinate(vehicle.longitude),
  };

  // Kolom baru hanya diisi kalau migrasi sudah diterapkan.
  if (await supportsColumn("vehicles", "kategori")) {
    row.kategori = kategori ?? null;
  }
  if (await supportsColumn("vehicles", "tarif_source")) {
    row.tarif_source = resolved.source;
  }

  const { error } = await db.from("vehicles").insert(row).select("id").single();
  if (error) throw error;

  return vehicleId;
}

/**
 * Hubungkan satu kendaraan ke trip lewat tabel `trip_vehicles`.
 *
 * Pisah dari insert baris kendaraan supaya alur "ganti" (update) bisa
 * menukar 집ahan tanpa pernah meninggalkan trip dalam keadaan setengah jadi.
 */
async function linkVehicle(tripId: string, vehicleId: string): Promise<void> {
  // ponytail: galat di sini DILEWATI diam-diam (tidak diperiksa) sejak awal.
  // Akibatnya kendaraan tercatat di tabel `vehicles` tapi TIDAK pernah
  // terhubung ke trip -> dashboard admin menampilkan trip dengan 0 kendaraan
  // padahal foto dan platnya sudah ada. Sekarang galatnya dilempar.
  const { error: linkError } = await db.from("trip_vehicles")
    .insert({ id: crypto.randomUUID(), trip_id: tripId, vehicle_id: vehicleId });
  if (linkError) throw linkError;
}

/**
 * Hapus baris kendaraan (dan tautannya) — dipakai untuk rollback.
 *
 * `trip_vehicles.vehicle_id` punya `ON DELETE CASCADE`, jadi menghapus baris
 * `vehicles` otomatis melepas tautannya juga.
 */
async function deleteVehicleRows(vehicleIds: string[]): Promise<void> {
  for (const id of vehicleIds) {
    try {
      await db.from("vehicles").delete().eq("id", id);
    } catch {
      // Rollback best-effort: kegagalan di sini dilaporkan lewat verifikasi akhir.
    }
  }
}

/**
 * Hapus trip beserta seluruh kendaraannya.
 *
 * Dipakai kalau trip BARU gagal menyimpan kendaraan: meninggalkan baris trip
 * setengah jadi akan membuat dashboard menampilkan trip dengan 0 kendaraan
 * (gejala "kendaraan menghilang") walau pets sudah diberi tahu gagal kirim.
 * Lebih baik trip tidak ada sama sekali dan petugas mengirim ulang.
 */
async function rollbackTrip(tripId: string): Promise<void> {
  try {
    await db.from("trips").delete().eq("id", tripId);
  } catch {
    // Best-effort.
  }
}

/**
 * Verifikasi bahwa trip punya TEPAT sejumlah kendaraan yang terhubung.
 *
 * Sumber kebenaran dashboard laporan adalah tabel `trip_vehicles`, bukan
 * tabel `vehicles`. Kalau vehicle row ada tapi tautannya hilang, dashboard
 * menampilkan 0 kendaraan. Karena itu jumlahnya diverifikasi di sini sebelum
 * server bilang "berhasil".
 */
export async function countLinkedVehicles(tripId: string): Promise<number> {
  const { data, error } = await db
    .from("trip_vehicles")
    .select("vehicle_id")
    .eq("trip_id", tripId);
  if (error) return -1;
  return (data ?? []).length;
}

/**
 * Simpan seluruh kendaraan sebuah trip dan pastikan semuanya TERHUBUNG.
 *
 * Mengembalikan id kendaraan yang tersimpan. Kalau ada yang gagal, baris
 * yang sudah terlanjur ditulis DIHAPUS supaya tidak ada kendaraan yatim
 * (kendaraan ada di tabel `vehicles` tapi tidak menempel ke trip).
 */
async function insertAndLinkVehicles(
  tripId: string,
  vehicles: any[],
  photoPaths: string[],
  vehiclePhotoIndexes: number[],
  regionId: string | null,
): Promise<string[]> {
  const inserted: string[] = [];
  try {
    for (let i = 0; i < vehicles.length; i++) {
      const vehicleId = await insertVehicleRow(
        tripId,
        vehicles[i],
        photoPaths[vehiclePhotoIndexes[i]!],
        regionId,
      );
      inserted.push(vehicleId);
    }
    for (const vehicleId of inserted) {
      await linkVehicle(tripId, vehicleId);
    }
  } catch (err) {
    await deleteVehicleRows(inserted);
    throw err;
  }
  return inserted;
}

// POST /trips/complete — multipart form: payload JSON + photos[]
export async function completeTrip(req: Request): Promise<Response> {
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: "Payload file not uploaded" }, 400);

  try {
    const payloadRaw = form.get("payload");
    if (!payloadRaw || typeof payloadRaw !== "string") {
      return json({ error: 'Missing "payload" field' }, 400);
    }
    const payload = JSON.parse(payloadRaw as string) || {};
    const vehicles = Array.isArray(payload.vehicles) ? payload.vehicles : [];
    const files = form.getAll("photos").filter((f): f is File => f instanceof File);

    if (!files.length) return json({ error: 'Field "photos" wajib diisi' }, 400);
    if (files.some((f) => !PHOTO_TYPES.has(f.type))) return json({ error: "Format file harus JPG, PNG, atau WEBP" }, 400);
    if (files.some((f) => f.size > 5 * 1024 * 1024)) return json({ error: "Ukuran file maksimal 5MB" }, 400);

    // Status muatan: daftar putih (muatan | kosong).
    const statusMuatan = String(payload.statusMuatan ?? "").trim().toLowerCase();
    if (!statusMuatan) return json({ error: "Status muatan wajib diisi" }, 400);
    if (!VALID_STATUS_MUATAN.has(statusMuatan)) {
      return json({ error: "Status muatan harus 'muatan' atau 'kosong'" }, 400);
    }

    // Validasi tiap kendaraan sebelum foto diunggah (hemat kuota storage).
    for (let i = 0; i < vehicles.length; i++) {
      const problem = validateVehiclePayload(vehicles[i], i);
      if (problem) return json({ error: problem }, 400);
    }

    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);

    // Id officer WAJIB uuid yang benar-benar ada di tabel officers.
    //
    // Dulu: `officer_id: ctx.officerId ?? ""`. Kalau token tanpa id officer
    // (mis. request tanpa header Authorization saat ADMIN_AUTH_DISABLED=1),
    // atau id-nya bukan uuid, inserttrip gagal dengan 22P02 -> HTTP 500.
    // Sekarang dicegat lebih awal dengan pesan yang bisa ditindaklanjuti.
    const officerId = asUuidOrNull(ctx.officerId);
    if (!officerId) {
      return json(
        { error: "Token tidak memuat id petugas yang valid — logout lalu login ulang" },
        401,
      );
    }
    if (!(await rowExists("officers", officerId))) {
      return json(
        { error: "Petugas tidak terdaftar di server — logout lalu login ulang" },
        401,
      );
    }

    console.log("[trips/complete] officer", officerId, "trip", payload.clientTripId ?? "(new)");

    const clientTripId = typeof payload.clientTripId === "string" ? payload.clientTripId.trim() : "";

    let existingTrip: any = null;
    if (clientTripId) {
      const { data } = await db
        .from("trips")
        .select("id, no_trip, completed_at")
        .eq("client_trip_id", clientTripId)
        .eq("officer_id", officerId)
        .limit(1);
      const found = data?.[0] ?? null;
      // Idempoten HANYA kalau itu benar-benar trip yang sama (waktu selesai
      // sama). Kalau client_trip_id sama tapi isinya berbeda, itu trip BARU
      // yang kebetulan memakai id yang sama - mis. petugas memakai perangkat
      // lain, atau riwayat di perangkat lama dihapus sehingga penomoran mulai
      // dari nol lagi.
      //
      // Versi lama selalu menganggapnya trip yang sama, lalu MENIMPA trip lama:
      // baris trip baru tidak pernah dibuat, created_at tetap tanggal yang
      // lama, dan petugas melihat "terkirim" padahal trip-nya tidak muncul
      // di dashboard sebagai data baru.
      if (found && isSameTripInstance(found, payload)) existingTrip = found;
    }

    const tripPhotoIndex = validPhotoIndex(payload.tripPhotoIndex, files.length);
    const vehiclePhotoIndexes = vehicles.map((v: any) => validPhotoIndex(v.photoIndex, files.length));
    // Swafoto (foto petugas) dikirim sebagai foto tambahan. Opsional di sisi
    // server supaya versi aplikasi lama yang belum punya fitur swafoto tetap
    // bisa sinkron — kewajiban swafoto ditegakkan di aplikasi mobile.
    const selfieIndex = payload.selfieIndex === undefined || payload.selfieIndex === null
      ? null
      : validPhotoIndex(payload.selfieIndex, files.length);

    if (
      tripPhotoIndex === null || tripPhotoIndex === undefined ||
      vehiclePhotoIndexes.some((i: number | null | undefined) => i === null || i === undefined)
    ) {
      return json({ error: "Semua foto dokumentasi wajib disertakan" }, 400);
    }
    if (selfieIndex === undefined) {
      return json({ error: "Index foto swafoto tidak valid" }, 400);
    }

    const usedIndexes = [tripPhotoIndex, ...vehiclePhotoIndexes];
    if (selfieIndex !== null) usedIndexes.push(selfieIndex);
    if (new Set(usedIndexes).size !== files.length) {
      return json({ error: "Payload harus menyertakan seluruh foto dokumentasi tepat satu kali" }, 400);
    }

    // Region & dermaga: nilai bermasalah dibuang (null), TIDAK menggagalkan.
    const { regionId, dermagaId } = await resolveTripReferences(
      officerId,
      ctx.regionId,
      form.get("dermagaId"),
    );

    // Upload photos BEFORE database inserts (so failure doesn't orphan rows).
    // ponytail: upload SEKUENSIAL dulu -> 4 foto = 4 round-trip ke Storage
    // berurutan. Sekarang paralel -> 1 round trip.
    const photoPaths: string[] = await Promise.all(files.map(f => storePhoto(f)));

    const tripId = existingTrip ? existingTrip.id : crypto.randomUUID();
    const noTrip = existingTrip ? existingTrip.no_trip : generateTripNo();

    const tripDoc: Record<string, unknown> = {
      status_muatan: statusMuatan,
      route_from: payload.routeFrom ? shortText(payload.routeFrom) : null,
      route_to: payload.routeTo ? shortText(payload.routeTo) : null,
      keterangan: payload.keterangan ? longText(payload.keterangan) : null,
      foto_kosong_path: photoPaths[tripPhotoIndex!],
      foto_captured_at: payload.tripPhotoCapturedAt || null,
      foto_latitude: numericCoordinate(payload.tripPhotoLatitude),
      foto_longitude: numericCoordinate(payload.tripPhotoLongitude),
      started_at: payload.startedAt || null,
      completed_at: payload.completedAt || null,
    };

    // Swafoto disimpan terpisah di kolom sendiri (kalau migrasi sudah ada).
    const hasSelfieCols = await supportsColumn("trips", "selfie_path") &&
      await supportsColumn("trips", "selfie_captured_at");
    if (hasSelfieCols) {
      tripDoc.selfie_path = selfieIndex === null ? null : photoPaths[selfieIndex];
      tripDoc.selfie_captured_at = selfieIndex === null ? null : (payload.selfieCapturedAt || null);
    }

    if (existingTrip) {
      const { error: upErr } = await db.from("trips").update(tripDoc).eq("id", tripId);
      if (upErr) throw upErr;

      // Kendaraan LAMA dibiarkan dulu sampai semua kendaraan BARU berhasil
      // disimpan. Kalau ada yang gagal, mobil baru dihapus dan mobil lama
      // tetap utuh -> dashboard tidak pernah menampilkan trip setengah jadi.
      const { data: oldLinks } = await db.from("trip_vehicles").select("vehicle_id").eq("trip_id", tripId);
      const oldVehicleIds = (oldLinks ?? []).map((r: any) => String(r.vehicle_id));

      let newVehicleIds: string[] = [];
      try {
        newVehicleIds = await insertAndLinkVehicles(
          tripId,
          vehicles,
          photoPaths,
          vehiclePhotoIndexes,
          regionId,
        );
      } catch (err) {
        // Mobil lama masih terpasang -> trip tetap utuh seperti sebelumnya.
        throw err;
      }

      // Verifikasi semua mobil baru benar-benar TERHUBUNG ke trip.
      const linked = await countLinkedVehicles(tripId);
      const expected = oldVehicleIds.length + newVehicleIds.length;
      if (linked !== expected) {
        await deleteVehicleRows(newVehicleIds);
        console.error(
          `[trips/complete] verifikasi kendaraan gagal untuk trip ${tripId}: terhubung=${linked}, diharapkan=${expected}`,
        );
        return json(
          { error: "Data kendaraan gagal disimpan — trip lama dipertahankan, silakan kirim ulang" },
          500,
        );
      }

      // Sekarang boleh lepas mobil lama (tautannya ikut terhapus by cascade).
      await deleteVehicleRows(oldVehicleIds);

      const finalCount = await countLinkedVehicles(tripId);
      if (finalCount !== vehicles.length) {
        console.error(
          `[trips/complete] jumlah kendaraan akhir tidak sesuai untuk trip ${tripId}: ${finalCount} != ${vehicles.length}`,
        );
        return json(
          { error: "Data kendaraan gagal disimpan — silakan kirim ulang" },
          500,
        );
      }

      return json(
        { id: tripId, noTrip, updated: true, vehicleCount: finalCount, photoCount: files.length },
        200,
      );
    }

    const { error: insErr } = await db.from("trips").insert({
      id: tripId,
      no_trip: noTrip,
      officer_id: officerId,
      region_id: regionId,
      dermaga_id: dermagaId || null,
      ...tripDoc,
      client_trip_id: clientTripId || null,
    });
    if (insErr) throw insErr;

    // Simpan + hubungkan seluruh kendaraan. Kalau gagal, trip yang barusan
    // dibuat DIHAPUS supaya dashboard tidak menampilkan trip dengan 0
    // kendaraan (gejala "kendaraan menghilang" yang bikin petugas mengira
    // datanya sudah tersimpan padahal tidak).
    let insertedVehicleIds: string[] = [];
    try {
      insertedVehicleIds = await insertAndLinkVehicles(
        tripId,
        vehicles,
        photoPaths,
        vehiclePhotoIndexes,
        regionId,
      );
    } catch (err) {
      await rollbackTrip(tripId);
      throw err;
    }

    // Verifikasi: semua kendaraan harus TERHUBUNG ke trip, tidak cukup
    //.barisnya ada di tabel `vehicles`.
    const linkedCount = await countLinkedVehicles(tripId);
    if (linkedCount !== vehicles.length) {
      await deleteVehicleRows(insertedVehicleIds);
      await rollbackTrip(tripId);
      console.error(
        `[trips/complete] verifikasi kendaraan gagal untuk trip ${tripId}: terhubung=${linkedCount}, diharapkan=${vehicles.length}`,
      );
      return json(
        { error: "Data kendaraan gagal disimpan — trip dibatalkan, silakan kirim ulang" },
        500,
      );
    }

    return json(
      { id: tripId, noTrip, vehicleCount: linkedCount, photoCount: files.length },
      201,
    );
  } catch (error) {
    console.error("Complete trip submission error:", error);
    const message = errorText(error);
    // Galat penyimpanan berkas punya penyebab yang jelas dan bisa diperbaiki
    // operator, jadi pesannya diteruskan apa adanya. Galat lain disamarkan
    // supaya detail internal server tidak bocor ke perangkat petugas.
    if (/tidak bisa menyimpan berkas|tidak bisa ditulis/i.test(message)) {
      return json({ error: message }, 500);
    }
    // Galat database yang bisa dikenali (uuid/FK/duplikat) dikembalikan
    // apa-adanya dengan status yang tepat (400/409). Sebelumnya semua ini
    // jadi HTTP 500 generik, jadi petugas tidak pernah tahu penyebabnya.
    const explained = explainDbError(error);
    if (explained) return json({ error: explained.message }, explained.status);
    return json({ error: "Failed to submit complete trip documentation" }, 500);
  }
}

// POST /trips — legacy simple version (no photos)
export async function createTrip(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);
    const { statusMuatan, routeFrom, routeTo, keterangan, fotoKosongPath } =
      await req.json().catch(() => ({})) as any;
    const officerId = asUuidOrNull(ctx.officerId);
    if (!officerId) {
      return json(
        { error: "Token tidak memuat id petugas yang valid — logout lalu login ulang" },
        401,
      );
    }

    if (!statusMuatan) return json({ error: "Status muatan wajib diisi" }, 400);
    if (!VALID_STATUS_MUATAN.has(String(statusMuatan).trim().toLowerCase())) {
      return json({ error: "Status muatan harus 'muatan' atau 'kosong'" }, 400);
    }

    const tripId = crypto.randomUUID();
    const noTrip = generateTripNo();

    const { regionId, dermagaId } = await resolveTripReferences(
      officerId,
      ctx.regionId,
      undefined,
    );

    const { error: insErr } = await db.from("trips").insert({
      id: tripId,
      no_trip: noTrip,
      officer_id: officerId,
      region_id: regionId,
      dermaga_id: dermagaId,
      status_muatan: statusMuatan,
      route_from: routeFrom,
      route_to: routeTo,
      keterangan: keterangan,
      foto_kosong_path: fotoKosongPath,
    });
    if (insErr) throw insErr;

    return json({ id: tripId, noTrip }, 201);
  } catch (error) {
    console.error("Create trip error:", error);
    const explained = explainDbError(error);
    if (explained) return json({ error: explained.message }, explained.status);
    return json({ error: "Failed to create trip" }, 500);
  }
}

// GET /trips
export async function getTrips(req: Request, url: URL): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);

    const date = url.searchParams.get("date");
    const isAdmin = ctx.role === "admin";

    let query = db
      .from("trips")
      .select("*, officers(name), regions(code), trip_vehicles(count)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!isAdmin) query = query.eq("region_id", String(ctx.regionId ?? ""));
    if (date) {
      query = query.gte("created_at", `${date}T00:00:00`).lte("created_at", `${date}T23:59:59`);
    }

    const { data: trips, error } = await query;
    if (error) {
      console.error("Fetch trips error:", error);
      return json({ error: "Failed to fetch trips" }, 500);
    }

    return json(
      (trips ?? []).map((t: any) => ({
        ...t,
        officer_name: t.officers?.name,
        region_code: t.regions?.code,
        photo_url: t.foto_kosong_path,
        vehicle_count: t.trip_vehicles?.[0]?.count ?? 0,
      })),
    );
  } catch (error) {
    console.error("Get trips error:", error);
    return json({ error: "Failed to fetch trips" }, 500);
  }
}
