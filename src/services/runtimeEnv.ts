// ─── Deteksi mode pengembangan ───────────────────────────────────────────────
// Syarat "DEV mode" sebelumnya ditulis tiga kali (services/ota.ts,
// services/geofence.ts, pages/mobile/RouteSelectScreen.tsx) dan sempat berbeda
// satu sama lain. Sekarang satu definisi.
//
// Aturannya ketat dengan sengaja:
//   • `import.meta.env.DEV` harus true (build produksi → false / env tidak ada).
//   • `import.meta.env.MODE` juga harus 'development' (atau tidak terdefinisi):
//       – 'test' (vitest)  → DIMATI, supaya tes mengukur jalur produksi yang asli
//         (jaringan + GPS native + kebijakan blokir), bukan mock/fallback mode.
//         Tanpa ini, siklus rilis OTA (V1→V2→V3) buntu di "manifest not-found".
//       – 'production'     → mati otomatis lewat syarat DEV.
//
// Pemakaian: OTA (lewati fetch GitHub saat localhost/CORS), geofence (fallback
// mock location hanya bila GPS asli gagal), dan tombol lewati geofence di layar
// pilih rute (khusus pengujian).

export function isDevMode(): boolean {
  const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env
  if (!env?.DEV) return false
  if (env.MODE && env.MODE !== 'development') return false
  return true
}
