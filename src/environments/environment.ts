// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.

// ─── API Base URL Configuration ────────────────────────────────────────────────
//
// For web browser development:        http://localhost:3000/api
// For mobile emulator (adb reverse):  http://localhost:3000/api
// For physical device:                http://<YOUR_IP>:3000/api
//
// Physical device setup:
//   1. Find host IP: hostname -I | awk '{print $1}'
//   2. Update this URL to: http://<HOST_IP>:3000/api
//   3. Or use adb reverse: adb reverse tcp:3000 tcp:3000
//
// ─────────────────────────────────────────────────────────────────────────────

export const environment = {
  production: false,

  // Browser dev (localhost) — HANYA berlaku di development server.
  // Build produksi (`ng build`) memakai environment.prod.ts (fileReplacements).
  apiBaseUrl: 'http://localhost:3000/api',

  // PERANGKAT FISIK (Android/iOS/webview) → SELALU backend produksi Railway.
  // Nilai lama (http://192.168.1.100:3000/api) membuat data trip dari HP
  // tidak pernah sampai ke dashboard admin.
  deviceApiBaseUrl: 'https://aplikasi-trip-api-production.up.railway.app/api',
};
