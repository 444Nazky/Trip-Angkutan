import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.plantation.tripangkut',
  appName: 'Trip Angkutan',
  webDir: 'www',
  android: {
    // Aplikasi native (WebView) memuat halaman dari origin LOKAL
    // `https://localhost`. Tanpa flag ini, WebView memblokir request
    // `http://192.168.1.123:3000` (server intranet kantor) sebagai mixed
    // content - sehingga data offline tidak bisa dikirim meski Wi-Fi LAN
    // sudah aktif. Flag ini + `android/app/src/main/res/xml/network_security_config.xml`
    // (cleartextTrafficPermitted) mengizinkan request cleartext ke LAN kantor.
    //
    // Kebijakan https-only untuk host PUBLIK tetap ditegakkan di kode
    // aplikasi (src/services/api.ts -> normalizeUrl / validateEndpointInput).
    allowMixedContent: true,
  },
};

export default config;
