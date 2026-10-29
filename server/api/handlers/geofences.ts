import { db, json, auth, requireAdmin, dbDetail, type OfficerClaims } from "../_shared.ts";



export function numericCoordinate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}



function validLatLng(lat: number | null, lng: number | null): boolean {
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}



export function clampRadius(value: unknown): number {
  const n = numericCoordinate(value);
  if (n === null || n < 1 || n > 10000) return 100;
  return n;
}



function parseCoordsFromText(text: string): { latitude: number; longitude: number } | null {
  if (!text) return null;
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|destination|daddr|ll|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /"(-?\d+\.\d{4,})",\s*(-?\d+\.\d{4,})"/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { latitude: lat, longitude: lng };
      }
    }
  }
  return null;
}

// ponytail: mobil masih kirim id kode ("BADAU-D1"), DB pakai UUID — resolve sekali di sini agar semua client yang pakai kode ikut jalan.
export async function resolveDermagaId(raw: unknown): Promise<string> {
  const value = String(raw ?? "").trim();
  if (!value || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  const m = value.match(/^([A-Za-z0-9]+)-D(\d+)$/i);
  if (!m) return value;
  const { data } = await db
    .from("dermagas")
    .select("id, code, regions!inner(code)")
    .eq("code", `D${m[2]}`)
    .eq("regions.code", m[1].toUpperCase())
    .limit(1)
    .maybeSingle();
  return data?.id ?? value;
}



export function shape(rows: any[] | null): unknown[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name || r.location_name,
    locationName: r.location_name || r.name,
    dermagaId: r.dermaga_id ?? null,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    radiusMeters: clampRadius(r.radius_meters),
    allowedRouteCodes: String(r.allowed_route_codes ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    allowedDirections: String(r.allowed_directions ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    description: r.description ?? "",
    enabled: r.enabled === undefined || r.enabled === null ? true : Number(r.enabled) !== 0,
  }));
}



export async function getGeofences(req: Request, url: URL): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);

    const dermagaId = await resolveDermagaId(url.searchParams.get("dermagaId"));
    const scopeAll = String(url.searchParams.get("scope") ?? "").toLowerCase() === "all";

    if (!dermagaId || scopeAll) {
      const { data, error } = await db
        .from("geofences")
        .select("*")
        .order("location_name", { ascending: true, nullsFirst: true });
      if (error) throw error;
      return json(shape(data));
    }

    const { data, error } = await db
      .from("geofences")
      .select("*")
      .or(`dermaga_id.eq.${dermagaId},dermaga_id.is.null`)
      .order("location_name", { ascending: true, nullsFirst: true });
    if (error) throw error;
    return json(shape(data));
  } catch (error) {
    console.error("Get geofences error:", error);
    return json({ error: "Failed to fetch geofences" }, 500);
  }
}



export async function resolveLink(req: Request, url: URL): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);

    const raw = String(url.searchParams.get("url") ?? "").trim();
    if (!/^https?:\/\//i.test(raw)) return json({ error: "url wajib berupa http(s) URL" }, 400);
    let host = "";
    try { host = new URL(raw).hostname.toLowerCase(); } catch { return json({ error: "url tidak valid" }, 400); }
    if (!/(^|\.)(goo\.gl|g\.co|google\.com|maps\.app\.goo\.gl)$/i.test(host)) {
      return json({ error: "Hanya link Google Maps (goo.gl / maps.app.goo.gl / google.com) yang didukung" }, 400);
    }
    const response = await fetch(raw, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
      },
    });
    const finalUrl = response.url || raw;
    const fromUrl = parseCoordsFromText(finalUrl);
    if (fromUrl) return json({ url: finalUrl, ...fromUrl });
    const html = await response.text();
    const fromHtml = parseCoordsFromText(html.slice(0, 262144));
    if (fromHtml) return json({ url: finalUrl, ...fromHtml });
    return json({ url: finalUrl });
  } catch (error) {
    console.error("Resolve maps link error:", error);
    return json({ error: "Gagal membuka link" }, 502);
  }
}



export async function createGeofence(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const body = await req.json().catch(() => ({})) as any;
    const lat = numericCoordinate(body.latitude);
    const lng = numericCoordinate(body.longitude);

    if (!body.locationName || String(body.locationName).trim() === "") {
      return json({ error: "locationName wajib diisi" }, 400);
    }
    if (!validLatLng(lat, lng)) {
      return json({ error: "latitude & longitude wajib angka valid (bukan kosong/placeholder) — lat ±90, lng ±180" }, 400);
    }

    const id = crypto.randomUUID();
    const { data, error } = await db
      .from("geofences")
      .insert({
        id,
        name: String(body.locationName).trim(),
        location_name: String(body.locationName).trim(),
        dermaga_id: body.dermagaId ? String(body.dermagaId) : null,
        latitude: lat,
        longitude: lng,
        radius_meters: clampRadius(body.radiusMeters),
        allowed_route_codes: Array.isArray(body.allowedRouteCodes) ? body.allowedRouteCodes.join(",") : String(body.allowedRouteCodes ?? ""),
        allowed_directions: Array.isArray(body.allowedDirections) ? body.allowedDirections.join(",") : String(body.allowedDirections ?? ""),
        description: body.description ? String(body.description) : "",
        enabled: body.enabled === undefined || body.enabled === null ? 1 : (body.enabled ? 1 : 0),
      })
      .select("id")
      .single();

    if (error) throw error;
    return json({ id: data.id }, 201);
  } catch (error) {
    console.error("Create geofence error:", error);
    return json({ error: `Titik geofence gagal ditambahkan karena galat server: ${dbDetail(error)}` }, 500);
  }
}



export async function updateGeofence(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const b = await req.json().catch(() => ({})) as any;

    const { data: existing } = await db.from("geofences").select("id").eq("id", id).limit(1);
    if (!existing?.length) return json({ error: "Geofence not found" }, 404);

    const updateData: Record<string, unknown> = {};
    const lat = b.latitude !== undefined ? numericCoordinate(b.latitude) : undefined;
    const lng = b.longitude !== undefined ? numericCoordinate(b.longitude) : undefined;

    if ((b.latitude !== undefined && lat === null) || (b.longitude !== undefined && lng === null)) {
      return json({ error: "latitude & longitude wajib angka valid" }, 400);
    }
    if (lat !== undefined && lng !== undefined && !validLatLng(lat, lng)) {
      return json({ error: "Koordinat di luar rentang valid — lat ±90, lng ±180" }, 400);
    }

    if (b.locationName !== undefined) {
      const n = String(b.locationName).trim();
      updateData.location_name = n;
      updateData.name = n;
    }
    if (lat !== undefined) updateData.latitude = lat;
    if (lng !== undefined) updateData.longitude = lng;
    if (b.radiusMeters !== undefined) updateData.radius_meters = clampRadius(b.radiusMeters);
    if (b.allowedRouteCodes !== undefined) {
      updateData.allowed_route_codes = Array.isArray(b.allowedRouteCodes) ? b.allowedRouteCodes.join(",") : String(b.allowedRouteCodes);
    }
    if (b.allowedDirections !== undefined) {
      updateData.allowed_directions = Array.isArray(b.allowedDirections) ? b.allowedDirections.join(",") : String(b.allowedDirections);
    }
    if (b.description !== undefined) updateData.description = String(b.description ?? "");
    if (b.dermagaId !== undefined) updateData.dermaga_id = b.dermagaId ? String(b.dermagaId) : null;
    if (b.enabled !== undefined) updateData.enabled = b.enabled ? 1 : 0;

    if (Object.keys(updateData).length) {
      const { error } = await db.from("geofences").update(updateData).eq("id", id);
      if (error) throw error;
    }
    return json({ success: true });
  } catch (error) {
    console.error("Update geofence error:", error);
    return json({ error: `Titik geofence gagal diperbarui karena galat server: ${dbDetail(error)}` }, 500);
  }
}



export async function deleteGeofence(req: Request, id: string): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { error } = await db.from("geofences").delete().eq("id", id);
    if (error) throw error;
    return json({ success: true });
  } catch (error) {
    console.error("Delete geofence error:", error);
    return json({ error: `Titik geofence gagal dihapus karena galat server: ${dbDetail(error)}` }, 500);
  }
}
