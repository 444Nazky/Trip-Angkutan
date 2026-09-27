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

  // Default for browser dev / emulator with adb reverse
  apiBaseUrl: 'http://localhost:3000/api',

  // For physical device - replace with your host machine IP address
  // Example: http://192.168.1.100:3000/api
  deviceApiBaseUrl: 'http://192.168.1.100:3000/api',
};
