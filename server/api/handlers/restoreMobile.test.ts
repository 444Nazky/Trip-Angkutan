/**
 * Uji validasi struktur arsip "Restore Data Mobile".
 *
 * Fokus: menolak arsip yang JSON-nya rusak/kosong atau kolom wajibnya tidak
 * sesuai SEBELUM satu baris pun ditulis ke database.
 *
 * Jalankan:
 *   deno test --allow-env server/api/handlers/restoreMobile.test.ts
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { collectPhotoRefs, validateExportPayload } from "./restoreMobile.ts";

function trip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientTripId: "TRP-2026-0001",
    officer: "Petugas Satu",
    routeFrom: "SBDZ",
    routeTo: "SJRE",
    load: "Ada Muatan",
    completedAt: "2026-11-18T12:00:00.000Z",
    photoUrl: "images/TRP-2026-0001-dokumentasi.jpg",
    selfieUrl: "images/TRP-2026-0001-swafoto.jpg",
    vehicles: [{ plate: "D 1234 AB", type: "Truck Besar", load: "loaded", tariff: 300000 }],
    ...overrides,
  };
}

Deno.test("menerima payload valid dan menormalkan kolom", () => {
  const result = validateExportPayload({ trips: [trip()] });
  assert(result.ok);
  if (!result.ok) return;
  assertEquals(result.trips.length, 1);
  assertEquals(result.trips[0].clientTripId, "TRP-2026-0001");
  assertEquals(result.trips[0].statusMuatan, "muatan");
  assertEquals(result.trips[0].vehicles[0].plate, "D 1234 AB");
  assertEquals(result.trips[0].vehicles[0].hasLoad, true);
  assertEquals(collectPhotoRefs(result.trips).sort(), [
    "images/TRP-2026-0001-dokumentasi.jpg",
    "images/TRP-2026-0001-swafoto.jpg",
  ]);
});

Deno.test("menolak JSON kosong / bukan objek", () => {
  for (const raw of [null, [], {}, { trips: [] }, { trips: "x" }]) {
    const result = validateExportPayload(raw);
    assertEquals(result.ok, false, `harus ditolak: ${JSON.stringify(raw)}`);
  }
});

Deno.test("menolak trip tanpa ID unik", () => {
  const result = validateExportPayload({ trips: [trip({ clientTripId: "", id: "" })] });
  assertEquals(result.ok, false);
  if (!result.ok) assert(result.error.includes("clientTripId"));
});

Deno.test("menolak clientTripId ganda dan status muatan tidak dikenal", () => {
  const duplicate = validateExportPayload({ trips: [trip(), trip()] });
  assertEquals(duplicate.ok, false);
  if (!duplicate.ok) assert(duplicate.error.includes("ganda"));

  const badStatus = validateExportPayload({ trips: [trip({ load: "entah" })] });
  assertEquals(badStatus.ok, false);
  if (!badStatus.ok) assert(badStatus.error.includes("statusMuatan"));
});

Deno.test("menolak rute, tanggal selesai, dan kendaraan yang tidak sesuai", () => {
  const noRoute = validateExportPayload({ trips: [trip({ routeFrom: "", routeTo: "" })] });
  assertEquals(noRoute.ok, false);
  if (!noRoute.ok) assert(noRoute.error.includes("routeFrom"));

  const noDate = validateExportPayload({ trips: [trip({ completedAt: "bukan tanggal" })] });
  assertEquals(noDate.ok, false);
  if (!noDate.ok) assert(noDate.error.includes("completedAt"));

  const badVehicles = validateExportPayload({ trips: [trip({ vehicles: "x" })] });
  assertEquals(badVehicles.ok, false);
  if (!badVehicles.ok) assert(badVehicles.error.includes("vehicles"));

  const emptyVehicle = validateExportPayload({ trips: [trip({ vehicles: [{ plate: "" }] })] });
  assertEquals(emptyVehicle.ok, false);
});
