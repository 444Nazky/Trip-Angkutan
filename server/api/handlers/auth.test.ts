// Uji handler login admin. Fokusnya satu: dashboard admin harus selalu bisa dibuka. Dua mode yang diuji: 1.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import bcryptjs from "npm:bcryptjs@2.4.3";



interface AdminRow {
  id: number;
  username: string | null;
  password: string | null;
}

// PostgREST tiruan untuk tabel admin_credentials.
function startFakePostgrest(rows: AdminRow[]): { url: string; rows: AdminRow[]; close: () => void } {
  const state = { nextId: rows.reduce((max, row) => Math.max(max, row.id), 0) + 1 };
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    if (!url.pathname.endsWith("/admin_credentials")) {
      return new Response("not found", { status: 404 });
    }
    const idFilter = url.searchParams.get("id");

    if (req.method === "GET") {
      return Response.json(rows);
    }
    if (req.method === "POST") {
      const body = await req.json();
      const created: AdminRow = {
        id: state.nextId++,
        username: body.username ?? null,
        password: body.password ?? null,
      };
      rows.push(created);
      return new Response(null, { status: 201 });
    }
    if (req.method === "PATCH") {
      const body = await req.json();
      const target = rows.find((row) => idFilter === `eq.${row.id}`);
      if (!target) return new Response("not found", { status: 404 });
      target.username = body.username ?? target.username;
      target.password = body.password ?? target.password;
      return Response.json(target);
    }
    if (req.method === "DELETE") {
      const index = rows.findIndex((row) => idFilter === `eq.${row.id}`);
      if (index >= 0) rows.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    return new Response("method not allowed", { status: 405 });
  });

  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    rows,
    close: () => server.shutdown(),
  };
}

// SATU server tiruan dipakai seluruh pengujian.
const fake = startFakePostgrest([]);



async function loadHandler() {
  // Handler membaca JWT_SECRET saat modul dimuat, jadi env harus di-set SEBELUM import. Impor dinamis dipakai untuk itu.
  Deno.env.set("JWT_SECRET", "secret-untuk-uji");
  Deno.env.set("POSTGREST_URL", fake.url);
  const module = await import("./auth.ts");
  return module as typeof import("./auth.ts");
}

/** Kosongkan tabel kredensial sebelum pengujian berikutnya. */
function resetRows(rows: AdminRow[]): void {
  rows.length = 0;
}



function loginRequest(username = "admin", password = ""): Request {
  return new Request("http://127.0.0.1:3000/api/auth/admin-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}



Deno.test("dashboard admin terbuka tanpa password saat ADMIN_AUTH_DISABLED=1", async () => {
  resetRows(fake.rows);
  try {
    Deno.env.set("ADMIN_AUTH_DISABLED", "1");
    Deno.env.set("ADMIN_USERNAME", "admin");
    Deno.env.set("ADMIN_PASSWORD", "");
    const { adminLogin } = await loadHandler();

    const res = await adminLogin(loginRequest());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertStringIncludes(String(body.token ?? ""), ".");
    assertEquals(body.admin?.role, "admin");
  } finally {
  }
});



Deno.test("mode ADMIN_AUTH_DISABLED=1 tidak menyentuh tabel kredensial", async () => {
  resetRows(fake.rows);
  try {
    Deno.env.set("ADMIN_AUTH_DISABLED", "1");
    const { adminLogin } = await loadHandler();

    await adminLogin(loginRequest());
    assertEquals(fake.rows.length, 0);
  } finally {
  }
});



Deno.test("login admin memakai ADMIN_PASSWORD saat mode proteksi aktif dan tabel kosong", async () => {
  resetRows(fake.rows);
  try {
    Deno.env.set("ADMIN_AUTH_DISABLED", "0");
    Deno.env.set("ADMIN_USERNAME", "admin");
    Deno.env.set("ADMIN_PASSWORD", "password-bootstrap");
    const { adminLogin } = await loadHandler();

    const ok = await adminLogin(loginRequest("admin", "password-bootstrap"));
    assertEquals(ok.status, 200);

    const salah = await adminLogin(loginRequest("admin", "password-keliru"));
    assertEquals(salah.status, 401);
  } finally {
  }
});



Deno.test("login admin memberi pesan yang bisa ditindaklanjuti saat kredensial belum diatur", async () => {
  resetRows(fake.rows);
  try {
    Deno.env.set("ADMIN_AUTH_DISABLED", "0");
    Deno.env.set("ADMIN_USERNAME", "admin");
    Deno.env.set("ADMIN_PASSWORD", "");
    const { adminLogin } = await loadHandler();

    const res = await adminLogin(loginRequest("admin", "apa-saja"));
    assertEquals(res.status, 503);
    const body = await res.json();
    assertStringIncludes(String(body.error), "ADMIN_PASSWORD");
  } finally {
  }
});



Deno.test("baris di database mengalahkan ADMIN_PASSWORD", async () => {
  const hash = bcryptjs.hashSync("password-yang-sudah-diubah", 10);
  resetRows(fake.rows);
  fake.rows.push({ id: 1, username: "admin", password: hash });
  try {
    Deno.env.set("ADMIN_AUTH_DISABLED", "0");
    Deno.env.set("ADMIN_USERNAME", "admin");
    Deno.env.set("ADMIN_PASSWORD", "password-bootstrap");
    const { adminLogin } = await loadHandler();

    const ok = await adminLogin(loginRequest("admin", "password-yang-sudah-diubah"));
    assertEquals(ok.status, 200);

    // Password lama dari environment harus ditolak.
    const lama = await adminLogin(loginRequest("admin", "password-bootstrap"));
    assertEquals(lama.status, 401);
  } finally {
  }
});



Deno.test("baris kredensial ganda dibersihkan saat login", async () => {
  const hash = bcryptjs.hashSync("password-sama", 10);
  resetRows(fake.rows);
  fake.rows.push({ id: 1, username: "admin", password: hash });
  fake.rows.push({ id: 2, username: "admin", password: hash });
  try {
    Deno.env.set("ADMIN_AUTH_DISABLED", "0");
    Deno.env.set("ADMIN_USERNAME", "admin");
    Deno.env.set("ADMIN_PASSWORD", "");
    const { adminLogin } = await loadHandler();

    const res = await adminLogin(loginRequest("admin", "password-sama"));
    assertEquals(res.status, 200);
    assertEquals(fake.rows.length, 1);
  } finally {
  }
});
