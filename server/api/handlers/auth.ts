// Auth route handlers (port of backend/src/routes/auth.js).
// db helpers, signToken, auth etc. live in __shared.
import bcryptjs from "npm:bcryptjs@2.4.3";
import {
  db,
  json,
  auth,
  signToken,
  getOfficerDermagas,
  getDermagaRoutes,
  getOfficerRoutesByDermaga,
  type OfficerClaims,
} from "../_shared.ts";
import { clientIp } from "../_ratelimit.ts";

const OFFICER_TOKEN_TTL = 90 * 24 * 60 * 60;

// Pembatas percobaan login.
//
// CATATAN: state ini hidup di memori proses. Server intranet berjalan satu
// proses, jadi bucket ini berlaku untuk semua request, tetapi tetap
// diperlakukan sebagai jaring pengaman pertama (bukan pengganti rate limiter
// di _ratelimit.ts).
//
// Versi lama memakai satu kunci "global": satu instance menahan login untuk
// SEMUA pengguna sekaligus, sehingga(admin yang sah ikut terkunci). Sekarang
// dipisah per IP.
const rateBuckets = new Map<string, number[]>();

function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  let hits = rateBuckets.get(key) ?? [];
  hits = hits.filter((t) => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  rateBuckets.set(key, hits);
  return true;
}
const authRateLimiter = (req: Request) => rateLimit(`auth:ip:${clientIp(req)}`, 20, 60_000);

// ============================================
// ADMIN LOGIN
// ============================================

export async function adminLogin(req: Request): Promise<Response> {
  if (!authRateLimiter(req)) return json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429);
  try {
    const { username, password } = await req.json().catch(() => ({})) as any;
    const adminUser = (Deno.env.get("ADMIN_USERNAME") ?? "admin").trim() || "admin";

    // Dashboard admin pada server intranet TIDAK memakai password.
    //
    // Server ini hanya melayani jaringan lokal kantor, dan dashboard sudah
    // sebelumnya terbuka otomatis dengan kredensial bawaan. Mode ini
    // dipertahankan supaya instalasi baru tidak pernah tersangkut di layar
    // login (mis. karena kredensial admin belum dikonfigurasi).
    //
    // Token tetap diterbitkan supaya klien punya sesi yang konsisten; isinya
    // tidak menambah keamanan apa pun karena server sudah memperlakukan
    // request tanpa token sebagai admin (lihat _shared.ts `auth`).
    if (Deno.env.get("ADMIN_AUTH_DISABLED") === "1") {
      const token = await signToken({ role: "admin", username: adminUser }, 24 * 60 * 60);
      return json({ token, admin: { username: adminUser, role: "admin" } });
    }

    const { data: rows } = await db
      .from("admin_credentials")
      .select("id, username, password")
      .order("id", { ascending: true });

    // Baris pertama yang dipakai. Baris sisanya dibuang supaya pembacaan
    // kredensial selalu tunggal (tabel ini tidak punya batasan unik, dan
    // `single()` akan gagal kalau ada lebih dari satu baris).
    const list = (rows ?? []) as { id?: number; username?: string; password?: string }[];
    const adminRow = list[0];

    let valid = false;
    let effectiveUser = adminUser;

    if (adminRow?.password) {
      // Baris di database adalah sumber kebenaran. Password di situ bisa
      // diubah operator lewat dashboard, jadi environment tidak boleh
      // menimpanya (kalau tidak, password lama tetap berlaku selamanya).
      effectiveUser = adminRow.username || adminUser;
      if (username === effectiveUser) {
        try { valid = bcryptjs.compareSync(password, adminRow.password); } catch { valid = false; }
      }
    } else {
      // Belum ada kredensial tersimpan: pakai ADMIN_PASSWORD dari environment
      // sebagai jalur bootstrap. Nilai environment TIDAK ditulis ke database,
      // jadi password tetap bisa diubah dari .env.local selama operator belum
      // memakai menu Ganti Password di dashboard.
      const envPassword = (Deno.env.get("ADMIN_PASSWORD") ?? "").trim();
      if (!envPassword) {
        return json({
          error: "Kredensial admin belum diatur di server. Isi ADMIN_PASSWORD di server/api/.env.local, lalu jalankan ./restart-all-ubuntu.sh.",
        }, 503);
      }
      valid = username === adminUser && password === envPassword;
    }

    if (!valid) return json({ error: "Username atau password salah" }, 401);

    for (const extra of list.slice(1)) {
      if (extra.id === undefined) continue;
      await db.from("admin_credentials").delete().eq("id", extra.id);
    }

    const token = await signToken({ role: "admin", username: effectiveUser }, 24 * 60 * 60);
    return json({ token, admin: { username: effectiveUser, role: "admin" } });
  } catch (error) {
    console.error("Admin login error:", error);
    return json({ error: "Login admin gagal" }, 500);
  }
}

// ============================================
// REGION LOGIN
// ============================================

export async function regionLogin(req: Request): Promise<Response> {
  if (!authRateLimiter(req)) return json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429);
  try {
    const { regionCode, password } = await req.json().catch(() => ({})) as any;
    const code = String(regionCode ?? "").trim();
    const pass = String(password ?? "");

    if (!code || !pass) return json({ error: "Kode wilayah dan password wajib diisi" }, 400);

    const { data: region, error } = await db
      .from("regions")
      .select("*")
      .ilike("code", code)
      .limit(1)
      .single();

    if (error || !region?.password) {
      return json({ error: "Kode wilayah atau password salah" }, 401);
    }

    let valid = false;
    try { valid = bcryptjs.compareSync(pass, region.password); } catch { valid = false; }

    if (!valid) return json({ error: "Kode wilayah atau password salah" }, 401);

    const { data: officers } = await db
      .from("officers")
      .select("id, name")
      .eq("region_id", region.id)
      .eq("is_active", 1)
      .order("name", { ascending: true });

    return json({
      region: { id: String(region.id), name: region.name, code: region.code },
      officers: (officers ?? []).map((o: any) => ({ id: String(o.id), name: o.name })),
    });
  } catch (error) {
    console.error("Region login error:", error);
    return json({ error: "Login wilayah gagal" }, 500);
  }
}

// ============================================
// MEMBER LOGIN (Officer by username)
// ============================================

export async function memberLogin(req: Request): Promise<Response> {
  if (!authRateLimiter(req)) return json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429);
  try {
    const { username, password } = await req.json().catch(() => ({})) as any;
    const normalizedUsername = String(username ?? "").trim().toLowerCase();
    const pin = String(password ?? "");

    if (!normalizedUsername || !pin) return json({ error: "Username dan PIN wajib diisi" }, 400);

    const { data: officerRows, error } = await db
      .from("officers")
      .select("*, regions!officers_region_id_fkey(name, code)")
      .ilike("username", normalizedUsername)
      .eq("is_active", 1);

    if (error || !officerRows?.length) return json({ error: "Username tidak terdaftar" }, 401);

    let officer: any = null;
    for (const r of officerRows) {
      if (!r.pin) continue;
      try {
        if (bcryptjs.compareSync(pin, r.pin)) { officer = r; break; }
      } catch { /* hash damaged */ }
    }

    if (!officer) return json({ error: "PIN salah" }, 401);

    const dermagas = await getOfficerDermagas(officer.id);
    // Satu query untuk semua rute (bukan satu query per dermaga).
    const routesMap = await getOfficerRoutesByDermaga(officer.id);

    const isDualAccess = dermagas.length > 1;
    const token = await signToken(
      { officerId: officer.id, regionId: officer.region_id, role: "officer" },
      OFFICER_TOKEN_TTL,
    );

    return json({
      token,
      officer: {
        id: String(officer.id),
        name: officer.name,
        username: officer.username || normalizedUsername,
        regionId: officer.region_id,
        regionName: officer.regions?.name,
        regionCode: officer.regions?.code,
        dermagaAccess: dermagas.map((d: any) => ({ id: d.id, name: d.name, code: d.code })),
      },
      dermagas,
      routes: routesMap,
      isDualAccess,
    });
  } catch (error) {
    console.error("Member login error:", error);
    return json({ error: "Login failed" }, 500);
  }
}

// ============================================
// LOGIN (Officer by ID + PIN)
// ============================================

export async function login(req: Request): Promise<Response> {
  if (!authRateLimiter(req)) return json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429);
  try {
    const { officerId, pin } = await req.json().catch(() => ({})) as any;

    if (!officerId || !pin) return json({ error: "Officer ID and PIN required" }, 400);

    const { data: officer, error } = await db
      .from("officers")
      .select("*, regions!officers_region_id_fkey(name, code)")
      .eq("id", officerId)
      .eq("is_active", 1)
      .limit(1)
      .single();

    if (error || !officer) return json({ error: "Invalid credentials" }, 401);

    let validPin = false;
    try { validPin = bcryptjs.compareSync(String(pin), officer.pin); } catch { validPin = false; }
    if (!validPin) return json({ error: "Invalid credentials" }, 401);

    const dermagas = await getOfficerDermagas(officerId);
    // Satu query untuk semua rute (bukan satu query per dermaga).
    const routesMap = await getOfficerRoutesByDermaga(officerId);

    const isDualAccess = dermagas.length > 1;
    const token = await signToken(
      { officerId: officer.id, regionId: officer.region_id, role: "officer", isDualAccess },
      OFFICER_TOKEN_TTL,
    );

    return json({
      token,
      officer: {
        id: String(officer.id),
        name: officer.name,
        username: officer.username,
        regionId: officer.region_id,
        regionName: officer.regions?.name,
        regionCode: officer.regions?.code,
      },
      dermagas,
      routes: routesMap,
      isDualAccess,
    });
  } catch (error) {
    console.error("Login error:", error);
    return json({ error: "Login failed" }, 500);
  }
}

// ============================================
// SELECT DERMAGA
// ============================================

export async function selectDermaga(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);

    const { dermagaId } = await req.json().catch(() => ({})) as any;
    if (!dermagaId) return json({ error: "Dermaga ID required" }, 400);

    const { data: access } = await db
      .from("officer_dermagas")
      .select("1")
      .eq("officer_id", ctx.officerId)
      .eq("dermaga_id", dermagaId)
      .limit(1);

    if (!access?.length) return json({ error: "Access denied to this dermaga" }, 403);

    const { data: dermaga, error: dermagaError } = await db
      .from("dermagas")
      .select("id, name, code, regions(name, code)")
      .eq("id", dermagaId)
      .limit(1)
      .single();

    if (dermagaError || !dermaga) return json({ error: "Dermaga not found" }, 404);

    const routes = await getDermagaRoutes(dermagaId);

    return json({
      dermaga: {
        id: String(dermaga.id),
        name: dermaga.name,
        code: dermaga.code,
        region_name: (dermaga as any).regions?.name,
        region_code: (dermaga as any).regions?.code,
      },
      routes,
    });
  } catch (error) {
    console.error("Select dermaga error:", error);
    return json({ error: "Failed to select dermaga" }, 500);
  }
}

// ============================================
// REFRESH TOKEN
// ============================================

export async function refreshToken(req: Request): Promise<Response> {
  try {
    const ctx = await auth(req);
    if (!ctx) return json({ error: "Invalid token" }, 401);

    const { data: officer, error } = await db
      .from("officers")
      .select("id, name, region_id, regions!officers_region_id_fkey(name, code)")
      .eq("id", ctx.officerId)
      .eq("is_active", 1)
      .limit(1)
      .single();

    if (error || !officer) return json({ error: "Officer not found or inactive" }, 401);

    const token = await signToken(
      { officerId: officer.id, regionId: officer.region_id, role: "officer" },
      OFFICER_TOKEN_TTL,
    );

    return json({
      token,
      officer: {
        id: String(officer.id),
        name: officer.name,
        regionId: officer.region_id,
        regionName: (officer as any).regions?.name,
        regionCode: (officer as any).regions?.code,
      },
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    return json({ error: "Token refresh failed" }, 500);
  }
}

export type { OfficerClaims };
