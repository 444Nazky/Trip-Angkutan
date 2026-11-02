// Pengaturan aplikasi yang bisa diubah admin dari dashboard.
//
// Values live in table `app_settings` (key-value), so a setting changed by
// the owner takes effect without a new build of the mobile app.
//
// Keys:
//
//   draft_ttl_minutes : how long a trip draft stays editable, in minutes.
//                       The value is cached on the device; when the server is
//                       unreachable the device keeps using the last known
//                       value (fallback: 15 minutes).
import { db, json, requireAdmin, auth } from "../_shared.ts";

/** Key pengaturan batas umur draft (menit). */
export const DRAFT_TTL_KEY = "draft_ttl_minutes";

/** Nilai bawaan kalau server tidak bisa dihubungi / key belum ada. */
export const DEFAULT_DRAFT_TTL_MINUTES = 15;

/** Batas aman: terlalu kecil = draft mati sebelum sempat diisi. */
export const MIN_DRAFT_TTL_MINUTES = 1;

/** Batas atas: lebih dari ini tidak masuk akal untuk draft lapangan. */
export const MAX_DRAFT_TTL_MINUTES = 240;

/**
 * Validate the draft TTL value coming from the admin form.
 *
 * Returns the clamped value in minutes, or null when the input is not a
 * number at all (so the caller can answer 400 instead of silently writing
 * garbage into the settings table).
 */
export function normalizeDraftTtlMinutes(raw: unknown): number | null {
  // null / undefined / string kosong berarti "tidak diisi" - bukan 0 menit.
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return null;
  if (n < MIN_DRAFT_TTL_MINUTES) return MIN_DRAFT_TTL_MINUTES;
  if (n > MAX_DRAFT_TTL_MINUTES) return MAX_DRAFT_TTL_MINUTES;
  return n;
}

/** Read all settings as a plain object (string values). */
async function readAll(): Promise<Record<string, string>> {
  const { data, error } = await db.from("app_settings").select("key, value");
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as any[]) {
    out[String(row.key)] = String(row.value ?? "");
  }
  return out;
}

/**
 * GET /api/settings
 *
 * Read-only for any authenticated user (mobile app needs it), write is
 * admin-only (see putSettings).
 */
export async function getSettings(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);

    const all = await readAll();
    const minutes = normalizeDraftTtlMinutes(all[DRAFT_TTL_KEY] ?? DEFAULT_DRAFT_TTL_MINUTES);
    return json({
      draftTtlMinutes: minutes ?? DEFAULT_DRAFT_TTL_MINUTES,
      updatedAt: all.__updatedAt ?? null,
    });
  } catch (error) {
    console.error("Get settings error:", error);
    return json({ error: "Gagal membaca pengaturan" }, 500);
  }
}

/**
 * PUT /api/settings  (admin)
 *
 * Body: { draftTtlMinutes: 10 }
 */
export async function putSettings(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const body = await req.json().catch(() => ({})) as any;
    const minutes = normalizeDraftTtlMinutes(body?.draftTtlMinutes);
    if (minutes === null) {
      return json({ error: "Nilai batas draft harus berupa angka (menit)" }, 400);
    }

    const { error } = await db
      .from("app_settings")
      .upsert(
        { key: DRAFT_TTL_KEY, value: String(minutes), updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) throw error;

    return json({ success: true, draftTtlMinutes: minutes });
  } catch (error) {
    console.error("Put settings error:", error);
    return json({ error: "Gagal menyimpan pengaturan" }, 500);
  }
}
