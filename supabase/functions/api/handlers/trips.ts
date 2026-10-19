// Trips handlers (port of backend/src/routes/trips.js), photos on Storage.
import { db, json, auth, generateTripNo, type OfficerClaims } from "../_shared.ts";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function numericCoordinate(value: unknown): number | null {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function validPhotoIndex(value: unknown, count: number): number | null | undefined {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (Number.isInteger(num) && num >= 0 && num < count) return num;
  return undefined;
}

async function getTariff(vehicleType: string) {
  const { data, error } = await db
    .from("tariffs")
    .select("id, loaded_tariff, empty_tariff")
    .eq("is_active", 1)
    .eq("vehicle_type", vehicleType)
    .limit(1);
  if (error && (error as any).code !== "PGRST116") return null;
  return data?.[0] ?? null;
}

async function resolveOfficerDermaga(officerId: string, regionId: string, bodyDermagaId: unknown): Promise<string | undefined> {
  if (bodyDermagaId) return String(bodyDermagaId);
  const { data: od } = await db.from("officer_dermagas").select("dermaga_id").eq("officer_id", officerId).limit(1);
  if (od?.[0]) return od[0].dermaga_id;
  const { data: d } = await db.from("dermagas").select("id").eq("region_id", regionId).limit(1);
  return d?.[0]?.id;
}

async function publicUrl(bucket: string, path: string): Promise<string> {
  const { data } = db.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function storePhoto(file: File): Promise<string> {
  const ext = EXT_BY_TYPE[file.type] || ".jpg";
  const path = `${crypto.randomUUID()}${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await db.storage.from("trip-photos").upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return await publicUrl("trip-photos", path);
}

async function insertVehicle(tripId: string, vehicle: any, photoPath: string): Promise<void> {
  const vehicleId = crypto.randomUUID();
  const tariff = await getTariff(vehicle.vehicleType);
  const amount =
    typeof vehicle.tariffAmount === "number" && vehicle.tariffAmount > 0
      ? vehicle.tariffAmount
      : tariff ? (vehicle.hasLoad ? tariff.loaded_tariff : tariff.empty_tariff) : 0;

  const { data: newVehicle, error } = await db
    .from("vehicles")
    .insert({
      id: vehicleId,
      no_polisi: vehicle.noPolisi,
      vehicle_type: vehicle.vehicleType,
      golongan: vehicle.golongan,
      trip_id: tripId,
      has_load: vehicle.hasLoad ? 1 : 0,
      tariff_id: tariff?.id || null,
      tariff_amount: amount,
      foto_path: photoPath,
      foto_captured_at: vehicle.photoCapturedAt || null,
      latitude: numericCoordinate(vehicle.latitude),
      longitude: numericCoordinate(vehicle.longitude),
    })
    .select("id")
    .single();
  if (error) throw error;

  await db.from("trip_vehicles").insert({ id: crypto.randomUUID(), trip_id: tripId, vehicle_id: vehicleId });
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

    if (!files.length) return json({ error: 'Missing "photos" files' }, 400);
    if (files.some((f) => !PHOTO_TYPES.has(f.type))) return json({ error: "File yang diizinkan: JPG, PNG, WEBP" }, 400);
    if (files.some((f) => f.size > 5 * 1024 * 1024)) return json({ error: "File terlalu besar (max 5MB)" }, 400);

    if (!payload.statusMuatan) return json({ error: "statusMuatan wajib diisi" }, 400);

    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);
    const officerId = ctx.officerId ?? "";
    const regionId = String(ctx.regionId ?? "");

    console.log("[trips/complete] officer", officerId, "trip", payload.clientTripId ?? "(new)");

    const clientTripId = typeof payload.clientTripId === "string" ? payload.clientTripId.trim() : "";

    let existingTrip: any = null;
    if (clientTripId) {
      const { data } = await db
        .from("trips")
        .select("id, no_trip")
        .eq("client_trip_id", clientTripId)
        .eq("officer_id", officerId)
        .limit(1);
      existingTrip = data?.[0] ?? null;
    }

    const tripPhotoIndex = validPhotoIndex(payload.tripPhotoIndex, files.length);
    const vehiclePhotoIndexes = vehicles.map((v: any) => validPhotoIndex(v.photoIndex, files.length));

    if (
      tripPhotoIndex === null || tripPhotoIndex === undefined ||
      vehiclePhotoIndexes.some((i: number | null | undefined) => i === null || i === undefined)
    ) {
      return json({ error: "Semua foto dokumentasi wajib disertakan" }, 400);
    }

    const usedIndexes = [tripPhotoIndex, ...vehiclePhotoIndexes];
    if (new Set(usedIndexes).size !== files.length) {
      return json({ error: "Payload harus menyertakan seluruh foto dokumentasi tepat satu kali" }, 400);
    }

    const dermagaId = await resolveOfficerDermaga(officerId, regionId, form.get("dermagaId"));

    // Upload photos BEFORE database inserts (so failure doesn't orphan rows)
    const photoPaths: string[] = [];
    for (const f of files) photoPaths.push(await storePhoto(f));

    const tripId = existingTrip ? existingTrip.id : crypto.randomUUID();
    const noTrip = existingTrip ? existingTrip.no_trip : generateTripNo();

    const tripDoc = {
      status_muatan: payload.statusMuatan,
      route_from: payload.routeFrom || null,
      route_to: payload.routeTo || null,
      keterangan: payload.keterangan || null,
      foto_kosong_path: photoPaths[tripPhotoIndex!],
      foto_captured_at: payload.tripPhotoCapturedAt || null,
      foto_latitude: numericCoordinate(payload.tripPhotoLatitude),
      foto_longitude: numericCoordinate(payload.tripPhotoLongitude),
      started_at: payload.startedAt || null,
      completed_at: payload.completedAt || null,
    };

    if (existingTrip) {
      const { error: upErr } = await db.from("trips").update(tripDoc).eq("id", tripId);
      if (upErr) throw upErr;

      const { data: oldVehicles } = await db.from("trip_vehicles").select("vehicle_id").eq("trip_id", tripId);
      if (oldVehicles?.length) {
        await db.from("trip_vehicles").delete().eq("trip_id", tripId);
        for (const row of oldVehicles) await db.from("vehicles").delete().eq("id", row.vehicle_id);
      }

      for (let i = 0; i < vehicles.length; i++) {
        await insertVehicle(tripId, vehicles[i], photoPaths[vehiclePhotoIndexes[i]!]);
      }
      return json({ id: tripId, noTrip, updated: true }, 200);
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

    for (let i = 0; i < vehicles.length; i++) {
      await insertVehicle(tripId, vehicles[i], photoPaths[vehiclePhotoIndexes[i]!]);
    }

    return json({ id: tripId, noTrip }, 201);
  } catch (error) {
    console.error("Complete trip submission error:", error);
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
    const officerId = ctx.officerId ?? "";
    const regionId = String(ctx.regionId ?? "");

    if (!statusMuatan) return json({ error: "statusMuatan wajib diisi" }, 400);

    const tripId = crypto.randomUUID();
    const noTrip = generateTripNo();

    const dermagaId = await resolveOfficerDermaga(officerId, regionId, undefined);

    await db.from("trips").insert({
      id: tripId,
      no_trip: noTrip,
      officer_id: officerId,
      region_id: regionId,
      dermaga_id: dermagaId || null,
      status_muatan: statusMuatan,
      route_from: routeFrom,
      route_to: routeTo,
      keterangan: keterangan,
      foto_kosong_path: fotoKosongPath,
    });

    return json({ id: tripId, noTrip }, 201);
  } catch (error) {
    console.error("Create trip error:", error);
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
