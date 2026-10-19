// App update/OTA handlers — Supabase-native: release metadata in `app_versions`
// table, OTA manifests in `ota_bundles`, file bytes in public buckets `apks` and `ota`.
import { corsHeaders, db, json, requireAdmin } from "../_shared.ts";

const APK_BUCKET = "apks";
const OTA_BUCKET = "ota";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function storagePublicUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

function parse(v: string): [number, number, number, number] {
  const [core = "", stamp = "0"] = String(v ?? "").split("+");
  const [a = 0, b = 0, c = 0] = String(core).split(".").map((n) => Number(n) || 0);
  return [a, b, c, Number(stamp) || 0];
}

function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return String(a).localeCompare(String(b));
}

function compareVersionFilter(current: string, latest: string): number {
  // update available when latest > current
  return compareVersions(latest, current) > 0 ? 1 : 0;
}
function compareVersionsNoStamp(v: string): string {
  return String(v ?? "").split("+")[0];
}

function isForce(row: any): boolean {
  return Boolean(row?.is_force_update);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// GET /app-version?current=1.0.0
export async function getAppVersion(req: Request, url: URL): Promise<Response> {
  try {
    const current = String(url.searchParams.get("current") ?? "0.0.0").trim() || "0.0.0";
    const { data, error } = await db
      .from("app_versions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    const releases = (data ?? []).sort((x: any, y: any) => compareVersions(x.version, y.version));
    const latest = releases[releases.length - 1];
    if (!latest) {
      return json({ latestVersion: current, updateAvailable: false, downloadUrl: null, releaseNotes: null });
    }

    const updateAvailable = compareVersionFilter(compareVersionsNoStamp(current), latest.version) === 1;
    const releaseNotes = latest.release_notes || "Update tersedia";

    return json({
      latestVersion: latest.version,
      updateAvailable,
      isForceUpdate: isForce(latest),
      downloadUrl: latest.download_url || storagePublicUrl(APK_BUCKET, `app-${latest.version}.apk`),
      releaseNotes,
      apkSize: latest.apk_size ?? null,
      apkHash: latest.apk_hash ?? null,
      minVersion: latest.min_version || null,
      releaseDate: latest.release_date || null,
      apkAvailable: true,
    });
  } catch (error) {
    console.error("App version check error:", error);
    return json({ error: "VERSION_CHECK_FAILED", message: "Gagal memeriksa versi" }, 500);
  }
}

// GET /release-notes/:version
export async function releaseNotes(_req: Request, version: string): Promise<Response> {
  try {
    const { data } = await db.from("app_versions").select("*").eq("version", version).limit(1).single();
    if (!data) {
      return json({ error: "RELEASE_NOT_FOUND", message: `Catatan rilis ${version} tidak ditemukan` }, 404);
    }
    return json({
      version,
      releaseDate: data.release_date || null,
      notes: (data.release_notes || "")
        .split(/[\n;]+/)
        .map((line: string) => line.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean)
        .map((line: string) => ({
          type: /fix|perbaikan|bug/i.test(line) ? "bugfix" : /security|keamanan/i.test(line) ? "security" : /improve|peningkat|optim/i.test(line) ? "improvement" : "feature",
          title: line,
          description: "",
        })),
    });
  } catch {
    return json({ error: "RELEASE_NOTES_FAILED", message: "Gagal membaca catatan rilis" }, 500);
  }
}

// GET /apk-list
export async function apkList(_req: Request): Promise<Response> {
  try {
    const { data, error } = await db.from("app_versions").select("version").order("created_at", { ascending: true });
    if (error) throw error;
    const versions = (data ?? [])
      .map((r: any) => ({ version: r.version, filename: `app-${r.version}.apk` }))
      .sort((a: any, b: any) => compareVersions(a.version, b.version));
    return json({ count: versions.length, apks: versions });
  } catch {
    return json({ count: 0, apks: [] });
  }
}

// POST /publish-version  (x-publish-secret)
export async function publishVersion(req: Request): Promise<Response> {
  const secret = req.headers.get("x-publish-secret");
  const expected = Deno.env.get("PUBLISH_SECRET") || "trip-angkut-secret";
  if (secret !== expected) return json({ error: "UNAUTHORIZED", message: "Unauthorized" }, 401);

  const { version, downloadUrl, apkBase64, releaseNotes, isForceUpdate, minVersion, apkVersionName, apkVersionCode } = await req.json().catch(() => ({})) as any;
  if (!version) return json({ error: "MISSING_VERSION", message: "Versi harus diisi" }, 400);
  if (!/^\d+\.\d+\.\d+$/.test(version)) return json({ error: "INVALID_VERSION", message: "Format versi tidak valid" }, 400);
  if (!downloadUrl && !apkBase64) return json({ error: "MISSING_SOURCE", message: "Harus ada downloadUrl atau apkBase64" }, 400);
  if (downloadUrl && !/^https?:\/\//i.test(downloadUrl)) {
    return json({ error: "INVALID_DOWNLOAD_URL", message: "downloadUrl harus absolut (http/https). Untuk berkas lokal, pakai apkBase64." }, 400);
  }

  let apkBytes: Uint8Array | null = null;
  if (apkBase64 && !downloadUrl) {
    apkBytes = Uint8Array.from(atob(apkBase64), (c) => c.charCodeAt(0));
    if (apkBytes.length < 1_000_000) {
      return json({ error: "APK_TOO_SMALL", message: `Data APK terlalu kecil (${apkBytes.length} byte)` }, 400);
    }
  }

  let apkSize: number | null = null;
  let apkHash: string | null = null;
  if (apkBytes) {
    try {
      apkSize = apkBytes.length;
      apkHash = await sha256Hex(apkBytes);
      // ponytail: capak default path app-<versi>.apk; migrasi ke multipart storage kalau body limit kena
      const { error } = await db.storage.from(APK_BUCKET).upload(`app-${version}.apk`, apkBytes.buffer as ArrayBuffer, {
        contentType: "application/vnd.android.package-archive",
        upsert: true,
      });
      if (error) throw error;
    } catch (err) {
      console.error("APK upload error:", err);
      return json({ error: "APK_SAVE_FAILED", message: "Gagal menyimpan APK" }, 500);
    }
  }

  const download_url = downloadUrl || storagePublicUrl(APK_BUCKET, `app-${version}.apk`);
  const { error: insertErr } = await db
    .from("app_versions")
    .insert({
      version,
      download_url,
      release_date: new Date().toISOString(),
      release_notes: releaseNotes || "",
      is_force_update: Boolean(isForceUpdate),
      min_version: minVersion || null,
      apk_size: apkSize,
      apk_hash: apkHash,
      apk_version_name: apkVersionName ? String(apkVersionName).trim() : null,
      apk_version_code: Number.isFinite(Number(apkVersionCode)) ? Number(apkVersionCode) : null,
    });
  if (insertErr) throw insertErr;

  return json({
    success: true,
    version,
    apkAvailable: true,
    apkHash,
    apkSize,
    message: `Versi ${version} dipublish`,
  });
}

// GET /app-download/:version → redirect ke storage publik
export async function appDownload(_req: Request, version: string): Promise<Response> {
  try {
    const { data } = await db.from("app_versions").select("download_url").eq("version", version).limit(1).single();
    const url = data?.download_url || storagePublicUrl(APK_BUCKET, `app-${version}.apk`);
    if (!/^https?:\/\//i.test(url)) return json({ error: "APK_NOT_FOUND" }, 404);
    return new Response(null, { status: 302, headers: { Location: url } });
  } catch {
    return json({ error: "APK_NOT_FOUND" }, 404);
  }
}

// GET /ota-manifest
export async function otaManifest(_req: Request): Promise<Response> {
  try {
    const { data, error } = await db.from("ota_bundles").select("manifest, published_at");
    if (error || !data?.length) {
      return json({ error: "OTA_NOT_PUBLISHED", message: "Belum ada bundel modul yang dipublikasikan" }, 404);
    }
    // ponytail: pick active (highest version) client-side; cukup karena manifest kecil
    const active = (data as any[]).sort((a, b) => compareVersions(b.manifest.version, a.manifest.version))[0];
    const m = active.manifest;
    return new Response(JSON.stringify({
      version: m.version,
      assets: m.assets,
      integrity: m.integrity || {},
      minVersion: m.minVersion || null,
      isForceUpdate: Boolean(m.isForceUpdate),
      releaseNotes: m.releaseNotes || "",
      publishedAt: m.publishedAt || active.published_at || null,
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("OTA manifest error:", error);
    return json({ error: "OTA_MANIFEST_FAILED", message: "Gagal membaca manifest modul" }, 500);
  }
}

// GET /ota-versions
export async function otaVersions(_req: Request): Promise<Response> {
  try {
    const { data } = await db.from("ota_bundles").select("manifest, published_at");
    const rows = (data ?? []) as any[];
    const versions = rows.map((r) => r.manifest.version).sort(compareVersions).reverse();
    const active = versions[0] || null;
    return json({ activeVersion: active, versions });
  } catch {
    return json({ activeVersion: null, versions: [] });
  }
}

// POST /publish-ota  (x-publish-secret) — files: { assetPath: base64 }
export async function publishOta(req: Request): Promise<Response> {
  const secret = req.headers.get("x-publish-secret");
  const expected = Deno.env.get("PUBLISH_SECRET") || "trip-angkut-secret";
  if (secret !== expected) return json({ error: "UNAUTHORIZED", message: "Unauthorized" }, 401);

  const { version, files, releaseNotes, minVersion, isForceUpdate } = await req.json().catch(() => ({})) as any;
  if (!version || !/^\d+\.\d+\.\d+(?:\+\d+)?$/.test(String(version))) {
    return json({ error: "INVALID_VERSION", message: "Versi modul tidak valid (contoh: 1.0.26+1792118276850)" }, 400);
  }
  if (!files || typeof files !== "object") {
    return json({ error: "MISSING_FILES", message: "Payload files (base64 per berkas) wajib diisi" }, 400);
  }

  const entries = Object.entries(files);
  if (!entries.length || entries.length > 120) {
    return json({ error: "INVALID_FILES", message: "Jumlah berkas harus 1..120" }, 400);
  }

  const cleaned: { assetPath: string; bytes: Uint8Array; sha256: string }[] = [];
  for (const [rawPath, rawBase64] of entries) {
    const assetPath = String(rawPath ?? "").replace(/\\/g, "/").trim();
    if (!assetPath || assetPath.startsWith("/") || assetPath.includes("..")) {
      return json({ error: "INVALID_ASSET_PATH", message: `Nama berkas tidak sah: ${rawPath}` }, 400);
    }
    const bytes = Uint8Array.from(atob(String(rawBase64 ?? "")), (c) => c.charCodeAt(0));
    if (!bytes.length) return json({ error: "EMPTY_ASSET", message: `Berkas kosong: ${assetPath}` }, 400);
    if (bytes.length > 8 * 1024 * 1024) {
      return json({ error: "ASSET_TOO_LARGE", message: `Berkas terlalu besar: ${assetPath}` }, 400);
    }
    cleaned.push({ assetPath, bytes, sha256: await sha256Hex(bytes) });
  }

  if (!cleaned.some((item) => item.assetPath === "index.html")) {
    return json({ error: "MISSING_ENTRY", message: "Bundel harus memuat index.html" }, 400);
  }

  const integrity: Record<string, string> = {};
  for (const item of cleaned) integrity[item.assetPath] = item.sha256;

  // Upload ke storage bucket dulu, supaya tanda "publish" aman kalau upload gagal
  for (const item of cleaned) {
    const { error } = await db.storage
      .from(OTA_BUCKET)
      .upload(`${String(version)}/${item.assetPath}`, item.bytes.buffer as ArrayBuffer, { upsert: true });
    if (error) {
      console.error(`OTA upload error (${item.assetPath}):`, error);
      return json({ error: "OTA_PUBLISH_FAILED", message: `Gagal upload bundel modul (${item.assetPath})` }, 500);
    }
  }

  const manifest = {
    version: String(version),
    assets: cleaned.map((i) => i.assetPath),
    integrity,
    minVersion: minVersion || null,
    isForceUpdate: Boolean(isForceUpdate),
    releaseNotes: releaseNotes || "",
    publishedAt: new Date().toISOString(),
  };

  const { error: insertErr } = await db
    .from("ota_bundles")
    .insert({ version: String(version), manifest, published_at: manifest.publishedAt });
  if (insertErr) {
    console.error("OTA insert error:", insertErr);
    return json({ error: "OTA_PUBLISH_FAILED", message: "Gagal publikasi manifest" }, 500);
  }

  return json({
    success: true,
    version: manifest.version,
    files: manifest.assets.length,
    pruned: [],
    message: `Modul ${manifest.version} dipublikasikan`,
  });
}

// POST /report-version (upsert device)
export async function reportDeviceVersion(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({})) as any;
    const deviceId = String(body.deviceId ?? "").trim();
    const version = String(body.version ?? "").trim();
    const platform = String(body.platform ?? "").trim() || "unknown";

    if (!deviceId || !version) {
      return json({ error: "INVALID_PAYLOAD", message: "deviceId & version wajib diisi" }, 400);
    }
    if (deviceId.length > 128 || version.length > 32 || platform.length > 32) {
      return json({ error: "INVALID_PAYLOAD", message: "deviceId/version/platform terlalu panjang" }, 400);
    }

    await db
      .from("device_versions")
      .upsert({ device_id: deviceId, version, platform, last_seen: new Date().toISOString() }, { onConflict: "device_id" });

    return json({ success: true, version, platform });
  } catch (error) {
    console.error("Report version error:", error);
    return json({ error: "REPORT_VERSION_FAILED", message: "Gagal menyimpan versi perangkat" }, 500);
  }
}

// GET /device-versions (admin)
export async function deviceVersions(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);
    const { data, error } = await db.from("device_versions").select("version, platform");
    if (error) throw error;
    const groups: Record<string, { version: string; platform: string; devices: number }> = {};
    for (const dv of (data ?? []) as any[]) {
      const key = `${dv.version}|${dv.platform}`;
      if (!groups[key]) groups[key] = { version: dv.version, platform: dv.platform, devices: 0 };
      groups[key].devices++;
    }
    return json({ totalDevices: (data ?? []).length, versions: Object.values(groups).sort((a, b) => b.version.localeCompare(a.version)) });
  } catch (error) {
    console.error("Device versions error:", error);
    return json({ error: "DEVICE_VERSIONS_FAILED" }, 500);
  }
}
