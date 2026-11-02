/**
 * Uji handler pengaturan aplikasi (server/api/handlers/settings.ts).
 *
 * Fokusnya: batas umur draft yang diubah admin harus selalu berupa angka
 * menit yang masuk akal. Nilai aneh (0, negatif, "abc", 10.000) tidak boleh
 * tersimpan ke tabel `app_settings` - kalau sampai, perangkat petugas
 * memakai batas draft yang tidak masuk akal (draft mati seketika, atau
 * draft tidak pernah meng expired).
 *
 * Jalankan:
 *   deno test --allow-env server/api/handlers/settings.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_DRAFT_TTL_MINUTES,
  MAX_DRAFT_TTL_MINUTES,
  MIN_DRAFT_TTL_MINUTES,
  normalizeDraftTtlMinutes,
} from "./settings.ts";

Deno.test("normalizeDraftTtlMinutes menerima angka bulat", () => {
  assertEquals(normalizeDraftTtlMinutes(10), 10);
  assertEquals(normalizeDraftTtlMinutes("20"), 20);
  assertEquals(normalizeDraftTtlMinutes(15.4), 15);
});

Deno.test("normalizeDraftTtlMinutes menolak nilai yang bukan angka", () => {
  assertEquals(normalizeDraftTtlMinutes("abc"), null);
  assertEquals(normalizeDraftTtlMinutes(null), null);
  assertEquals(normalizeDraftTtlMinutes(undefined), null);
  assertEquals(normalizeDraftTtlMinutes({}), null);
});

Deno.test("normalizeDraftTtlMinutes mengunci nilai di batas aman", () => {
  assertEquals(normalizeDraftTtlMinutes(0), MIN_DRAFT_TTL_MINUTES);
  assertEquals(normalizeDraftTtlMinutes(-5), MIN_DRAFT_TTL_MINUTES);
  assertEquals(normalizeDraftTtlMinutes(100_000), MAX_DRAFT_TTL_MINUTES);
});

Deno.test("nilai bawaan tetap 15 menit", () => {
  assertEquals(DEFAULT_DRAFT_TTL_MINUTES, 15);
  assertEquals(normalizeDraftTtlMinutes(DEFAULT_DRAFT_TTL_MINUTES), 15);
});
