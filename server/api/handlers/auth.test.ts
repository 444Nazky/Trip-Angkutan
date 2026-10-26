/**
 * Uji handler login admin.
 *
 * Fokusnya satu: memastikan dashboard admin selalu bisa login pada instalasi
 * baru. Instalasi baru berarti tabel admin_credentials kosong, dan kredensial
 * diambil dari environment ADMIN_PASSWORD.
 *
 * Jalankan:
 *   deno test --allow-net --allow-env server/api/handlers/auth.test.ts
 */

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import bcryptjs from "npm:bcryptjs@2.4.3";

interface AdminRow {
  id: number;
  username: string | null;
  password: string | null;
}

/**
 * PostgREST tiruan untuk tabel admin_credentials.
 *
 * Hanya operasi yang dipakai handler yang didukung: GET (daftar), POST
 * (sisip), PATCH (ubah), DELETE (hapus).
 */
function startFakePostgrest(rows: AdminRow[]): { url: string; rows: AdminRow[]; close: () => void } {
  const state = { nextId: rows.reduce((max, row) => Math.max(max, row.id), 0) + 1 };
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, (req) => {
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

async function loadHandler(postgrestUrl: string) {
  // Handler membaca JWT_SECRET saat modul dimuat, jadi env harus di-set
  // SEBELUM import. Impor dinamis dipakai untuk itu.
  Deno.env.set("JWT_SECRET", "secret-untuk-uji");
  Deno.env.set("POSTGREST_URL", postgrestUrl);
  const module = await import("./auth.ts");
  return module as typeof import("./auth.ts");
}

function loginRequest(username: string, password: string): Request {
  return new Request("http://127.0.0.1:3000/api/auth/admin-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

Deno.test("login admin memakai ADMIN_PASSWORD saat tabel admin_credentials kosong", async () => {
  const fake = startFakePostgrest([]);
  try {
    Deno.env.set("ADMIN_USERNAME", "admin");
    Deno.env.set("ADMIN_PASSWORD", "password-bootstrap");
    const { adminLogin } = await loadHandler(fake.url);

    const ok = await adminLogin(loginRequest("admin", "password-bootstrap"));
    assertEquals(ok.status, 200);
    const body = await ok.json();
    assertStringIncludes(String(body.token ?? ""), ".");

    const salah = await adminLogin(loginRequest("admin", "password-keliru"));
    assertEquals(salah.status, 401);
  } finally {
    fake.close();
  }
});

Deno.test("login admin memberi pesan yang bisa ditindaklanjuti saat kredensial belum diatur", async () => {
  const fake = startFakePostgrest([]);
  try {
    Deno.env.set("ADMIN_USERNAME", "admin");
    Deno.env.set("ADMIN_PASSWORD", "");
    const { adminLogin } = await loadHandler(fake.url);

    const res = await adminLogin(loginRequest("admin", "apa-saja"));
    assertEquals(res.status, 503);
    const body = await res.json();
    assertStringIncludes(String(body.error), "ADMIN_PASSWORD");
  } finally {
    fake.close();
  }
});

Deno.test("baris di database mengalahkan ADMIN_PASSWORD", async () => {
  const hash = bcryptjs.hashSync("password-yang-sudah-diubah", 10);
  const fake = startFakePostgrest([{ id: 1, username: "admin", password: hash }]);
  try {
    Deno.env.set("ADMIN_USERNAME", "admin");
    Deno.env.set("ADMIN_PASSWORD", "password-bootstrap");
    const { adminLogin } = await loadHandler(fake.url);

    const ok = await adminLogin(loginRequest("admin", "password-yang-sudah-diubah"));
    assertEquals(ok.status, 200);

    // Password lama dari environment harus ditolak.
    const lama = await adminLogin(loginRequest("admin", "password-bootstrap"));
    assertEquals(lama.status, 401);
  } finally {
    fake.close();
  }
});

Deno.test("ganti password menyimpan satu baris saja dan langsung bisa dipakai", async () => {
  const fake = startFakePostgrest([]);
  try {
    Deno.env.set("ADMIN_USERNAME", "admin");
    Deno.env.set("ADMIN_PASSWORD", "password-bootstrap");
    const { adminLogin, changeAdminPassword } = await loadHandler(fake.url);

    const change = await changeAdminPassword(
      new Request("http://127.0.0.1:3000/api/auth/change-admin-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: "password-bootstrap", newPassword: "password-baru-2026" }),
      }),
    );
    assertEquals(change.status, 200);
    assertEquals(fake.rows.length, 1);

    const ok = await adminLogin(loginRequest("admin", "password-baru-2026"));
    assertEquals(ok.status, 200);

    const lama = await adminLogin(loginRequest("admin", "password-bootstrap"));
    assertEquals(lama.status, 401);
  } finally {
    fake.close();
  }
});

Deno.test("baris kredensial ganda dibersihkan saat login", async () => {
  const hash = bcryptjs.hashSync("password-sama", 10);
  const fake = startFakePostgrest([
    { id: 1, username: "admin", password: hash },
    { id: 2, username: "admin", password: hash },
  ]);
  try {
    Deno.env.set("ADMIN_USERNAME", "admin");
    Deno.env.set("ADMIN_PASSWORD", "");
    const { adminLogin } = await loadHandler(fake.url);

    const res = await adminLogin(loginRequest("admin", "password-sama"));
    assertEquals(res.status, 200);
    assertEquals(fake.rows.length, 1);
  } finally {
    fake.close();
  }
});
