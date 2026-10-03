import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.plantation.tripangkut',
  appName: 'Trip Angkutan',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    // Live-reload ke dev server (hanya untuk pengembangan).
    // Dibiarkan aktif → APK selalu menyalin konten dari :8100 dan TIDAK jalan
    // mandiri di perangkat. Aktifkan hanya saat `ng serve` berjalan:
    // url: 'http://10.0.2.2:8100',
    // cleartext: true,
  },
};

export default config;
