// Shared Edge Function helpers for the api function.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires, accept, origin, x-requested-with",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export const db: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "trip-angkut-secret-key";
// Token TTL: 90 hari - cukup untuk sesi aktif, tidak terlalu panjang jika browser compromise
const OFFICER_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

export type OfficerClaims = {
  officerId?: string;
  regionId?: string;
  role?: "admin" | "officer";
  username?: string;
  isDualAccess?: boolean;
  [k: string]: unknown;
};

function b64urlDecode(s: string): string {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  try {
    return decodeURIComponent(
      bin.split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""),
    );
  } catch {
    return bin;
  }
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+/, "");
}

async function hmac(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+/, "");
}

export async function signToken(claims: OfficerClaims, ttlSeconds = OFFICER_TOKEN_TTL_SECONDS): Promise<string> {
  const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64urlEncode(
    JSON.stringify({
      ...claims,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const signature = await hmac(JWT_SECRET, `${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

export async function verifyToken(token: string): Promise<OfficerClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = await hmac(JWT_SECRET, `${parts[0]}.${parts[1]}`);
  if (expected !== parts[2]) return null;
  const claims = JSON.parse(b64urlDecode(parts[1])) as OfficerClaims & { exp: number };
  if (claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

/** Extract auth context from the request. Returns null when unauthenticated. */
export async function auth(req: Request): Promise<OfficerClaims | null> {
  const header = req.headers.get("authorization");
  if (!header) {
    return Deno.env.get("ADMIN_AUTH_DISABLED") === "1"
      ? { role: "admin", username: "intranet" }
      : null;
  }
  const token = header.replace(/^Bearer\s+/i, "");
  return verifyToken(token);
}

export async function requireAdmin(req: Request): Promise<OfficerClaims | null> {
  const ctx = await auth(req);
  return ctx?.role === "admin" ? ctx : null;
}

// Reuse behaviour from backend helpers.
export async function getOfficerDermagas(officerId: string) {
  const { data, error } = await db
    .from("officer_dermagas")
    .select(`dermagas (id, name, code, regions (name, code))`)
    .eq("officer_id", officerId);
  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    id: d.dermagas.id,
    name: d.dermagas.name,
    code: d.dermagas.code,
    region_name: d.dermagas.regions?.name ?? "",
    region_code: d.dermagas.regions?.code ?? "",
  }));
}

export async function getDermagaRoutes(dermagaId: string) {
  const { data, error } = await db
    .from("routes")
    .select("id, name, route_from, route_to, distance, duration")
    .eq("dermaga_id", dermagaId);
  if (error) throw error;
  return data ?? [];
}

export function generateTripNo(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `TRP${dateStr}${random}`;
}
