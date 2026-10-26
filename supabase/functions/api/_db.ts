// Klien database lokal: pengganti @supabase/supabase-js.
//
// Semua query dari handler memakai API builder yang sama dengan Supabase
// (`db.from(...).select(...).eq(...)`), tetapi diterjemahkan menjadi HTTP ke
// PostgREST lokal (container `rest` di docker-compose). Penyimpanan file
// memakai direktori lokal, bukan Supabase Storage.
//
// ponytail: hanya method yang benar-benar dipakai handler yang diimplementasi.
// Kalau nanti ada method baru, tambahkan di sini — jangan bawa lagi SDK cloud.

import { join, normalize } from "https://deno.land/std@0.224.0/path/mod.ts";

const POSTGREST_URL = (Deno.env.get("POSTGREST_URL") || "http://127.0.0.1:3001").replace(/\/$/, "");
const STORAGE_DIR = Deno.env.get("STORAGE_DIR") || "/data/storage";
const PUBLIC_BASE_URL = (Deno.env.get("PUBLIC_BASE_URL") || `http://${Deno.env.get("LAN_IP") || "192.168.1.123"}:3000`).replace(/\/$/, "");

export type DbError = { message: string; details?: string | null; hint?: string | null; code?: string | null };
export type DbResult<T = unknown> = {
  data: T | null;
  error: DbError | null;
  count?: number | null;
  status: number;
  statusText: string;
};
type Row = Record<string, unknown>;

function q(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const s = String(value);
  if (/[,()"\\]/.test(s)) return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return s;
}

function list(values: unknown[]): string {
  return `(${values.map(q).join(",")})`;
}

function parseError(status: number, statusText: string, body: string): DbError {
  try {
    const parsed = JSON.parse(body);
    return {
      message: parsed.message || statusText,
      details: parsed.details ?? null,
      hint: parsed.hint ?? null,
      code: parsed.code ?? null,
    };
  } catch {
    return { message: body || statusText || `HTTP ${status}` };
  }
}

class QueryBuilder<T = Row> implements PromiseLike<DbResult<T>> {
  private table: string;
  private method: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD" = "GET";
  private params = new URLSearchParams();
  private headers: Record<string, string> = {};
  private body: unknown = undefined;
  private returning = false;
  private single = false;
  private maybeSingle = false;
  private wantsCount = false;
  private prefer: string[] = [];

  constructor(table: string) {
    this.table = table;
  }

  select(columns = "*", options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): this {
    if (this.method === "GET" || this.method === "HEAD") {
      this.params.set("select", columns);
    } else {
      // select() setelah insert/update/delete = minta baris hasil.
      this.returning = true;
      this.params.set("select", columns);
    }
    if (options?.count) {
      this.wantsCount = true;
      this.prefer.push(`count=${options.count}`);
      if (options.head) this.method = "HEAD";
    }
    return this;
  }

  insert(values: Row | Row[]): this {
    this.method = "POST";
    this.body = values;
    return this;
  }

  update(values: Row): this {
    this.method = "PATCH";
    this.body = values;
    return this;
  }

  upsert(values: Row | Row[], options?: { onConflict?: string }): this {
    this.method = "POST";
    this.body = values;
    this.prefer.push("resolution=merge-duplicates");
    if (options?.onConflict) this.params.set("on_conflict", options.onConflict);
    return this;
  }

  delete(): this {
    this.method = "DELETE";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.params.append(column, `eq.${q(value)}`);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.params.append(column, `neq.${q(value)}`);
    return this;
  }

  gt(column: string, value: unknown): this {
    this.params.append(column, `gt.${q(value)}`);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.params.append(column, `gte.${q(value)}`);
    return this;
  }

  lt(column: string, value: unknown): this {
    this.params.append(column, `lt.${q(value)}`);
    return this;
  }

  lte(column: string, value: unknown): this {
    this.params.append(column, `lte.${q(value)}`);
    return this;
  }

  like(column: string, pattern: string): this {
    this.params.append(column, `like.${q(pattern)}`);
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.params.append(column, `ilike.${q(pattern)}`);
    return this;
  }

  is(column: string, value: unknown): this {
    this.params.append(column, `is.${value === null ? "null" : q(value)}`);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.params.append(column, `in.${list(values)}`);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.params.append(column, `not.${operator}.${value === null ? "null" : q(value)}`);
    return this;
  }

  or(expression: string): this {
    this.params.set("or", `(${expression})`);
    return this;
  }

  filter(column: string, operator: string, value: unknown): this {
    this.params.append(column, `${operator}.${q(value)}`);
    return this;
  }

  match(values: Row): this {
    for (const [column, value] of Object.entries(values)) this.eq(column, value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const direction = options?.ascending === false ? "desc" : "asc";
    const nulls = options?.nullsFirst === undefined ? "" : options.nullsFirst ? ".nullsfirst" : ".nullslast";
    const existing = this.params.get("order");
    const clause = `${column}.${direction}${nulls}`;
    this.params.set("order", existing ? `${existing},${clause}` : clause);
    return this;
  }

  limit(count: number): this {
    this.params.set("limit", String(count));
    return this;
  }

  range(from: number, to: number): this {
    this.params.set("offset", String(from));
    this.params.set("limit", String(Math.max(0, to - from + 1)));
    return this;
  }

  single(): this {
    this.single = true;
    return this;
  }

  maybeSingle(): this {
    this.maybeSingle = true;
    return this;
  }

  private async execute(): Promise<DbResult<T>> {
    const url = `${POSTGREST_URL}/${encodeURIComponent(this.table)}?${this.params.toString()}`;
    const headers: Record<string, string> = { ...this.headers };
    if (this.returning || this.method === "POST" || this.method === "PATCH") {
      headers["Content-Type"] = "application/json";
    }
    const prefer = [...this.prefer];
    if (this.returning) prefer.push("return=representation");
    else if (this.method !== "GET" && this.method !== "HEAD") prefer.push("return=minimal");
    if (prefer.length) headers["Prefer"] = prefer.join(",");
    if (this.single || this.maybeSingle) headers["Accept"] = "application/vnd.pgrst.object+json";

    let response: Response;
    try {
      response = await fetch(url, {
        method: this.method,
        headers,
        body: this.body === undefined ? undefined : JSON.stringify(this.body),
      });
    } catch (err) {
      return {
        data: null,
        error: { message: `Database lokal tidak dapat dihubungi: ${(err as Error).message}` },
        status: 0,
        statusText: "",
      };
    }

    const text = await response.text();
    let count: number | null = null;
    const range = response.headers.get("content-range");
    if (range && range.includes("/")) {
      const total = range.split("/")[1];
      count = total === "*" ? null : Number(total);
    }

    if (!response.ok) {
      if (this.maybeSingle && response.status === 406) {
        return { data: null, error: null, status: response.status, statusText: response.statusText };
      }
      return {
        data: null,
        error: parseError(response.status, response.statusText, text),
        status: response.status,
        statusText: response.statusText,
      };
    }

    if (this.method === "HEAD" || !text) {
      return { data: null, error: null, count, status: response.status, statusText: response.statusText };
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        data: null,
        error: { message: "Respons database bukan JSON" },
        status: response.status,
        statusText: response.statusText,
      };
    }
    return { data: data as T, error: null, count, status: response.status, statusText: response.statusText };
  }

  then<R1 = DbResult<T>, R2 = never>(
    onfulfilled?: ((value: DbResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// ── Penyimpanan file lokal ───────────────────────────────────────────────────

function bucketDir(bucket: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(bucket)) throw new Error(`Bucket tidak valid: ${bucket}`);
  return join(STORAGE_DIR, bucket);
}

function objectPath(bucket: string, path: string): string {
  const root = bucketDir(bucket);
  const full = normalize(join(root, path));
  if (!full.startsWith(root + "/") && full !== root) throw new Error(`Path tidak valid: ${path}`);
  return full;
}

type UploadOptions = { contentType?: string; upsert?: boolean };

function storageBucket(bucket: string) {
  return {
    async upload(path: string, bytes: ArrayBuffer | Uint8Array, options: UploadOptions = {}): Promise<{ data: { path: string } | null; error: DbError | null }> {
      try {
        const target = objectPath(bucket, path);
        if (!options.upsert && await Deno.stat(target).then(() => true).catch(() => false)) {
          return { data: null, error: { message: "The resource already exists", code: "409" } };
        }
        await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
        await Deno.writeFile(target, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        return { data: { path }, error: null };
      } catch (err) {
        return { data: null, error: { message: (err as Error).message } };
      }
    },
    getPublicUrl(path: string): { data: { publicUrl: string } } {
      const clean = path.replace(/^\/+/, "");
      return { data: { publicUrl: `${PUBLIC_BASE_URL}/files/${bucket}/${clean}` } };
    },
    remove(paths: string[]): Promise<{ data: null; error: DbError | null }> {
      return Promise.all(paths.map((p) => Deno.remove(objectPath(bucket, p)).catch(() => {})))
        .then(() => ({ data: null, error: null }));
    },
  };
}

export const db = {
  from<T = Row>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table);
  },
  storage: {
    from(bucket: string) {
      return storageBucket(bucket);
    },
  },
};

// Dipakai local_server.ts untuk melayani /files/<bucket>/<path>.
export async function serveStoredFile(pathname: string): Promise<Response | null> {
  const match = pathname.match(/^\/files\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, bucket, object] = match;
  let target: string;
  try {
    target = objectPath(decodeURIComponent(bucket), decodeURIComponent(object));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  try {
    const body = await Deno.readFile(target);
    const ext = target.slice(target.lastIndexOf(".") + 1).toLowerCase();
    const types: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      apk: "application/vnd.android.package-archive",
      js: "text/javascript",
      css: "text/css",
      json: "application/json",
      html: "text/html",
    };
    return new Response(body, {
      headers: {
        "Content-Type": types[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
