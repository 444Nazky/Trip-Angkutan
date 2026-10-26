// ─── Sumber tunggal alamat backend (PRODUKSI) ────────────────────────────────
//
// Endpoint DEFAULT adalah server INTRANET kantor (port 3000). Supabase cloud
// hanya cadangan untuk perangkat yang berada di luar jaringan kantor dan untuk
// artefak Storage (foto, OTA, APK).
const SUPABASE_CLOUD_URL = 'https://bmiruktfruunegtbydyw.supabase.co'
const INTRANET_API_BASE_URL = 'http://192.168.1.123:3000/api'

export const environment = {
  production: true,

  // Origin project Supabase (cloud) - dipakai untuk Storage: foto trip, OTA, APK.
  supabaseUrl: SUPABASE_CLOUD_URL,

  // Nilai tersamar untuk ditampilkan di UI/konfigurasi. BUKAN URL yang bisa
  // dipanggil; jangan pernah dipakai sebagai base URL request.
  supabaseUrlMask: '192.168/tunnelnanas/qhkc8uqw3n2.5',

  // Supabase Edge Functions API (endpoint cloud/cadangan).
  apiBaseUrl: `${SUPABASE_CLOUD_URL}/functions/v1/api`,
  supabaseAnonKey: '',

  // Backend INTRANET (PC kantor, port 3000) = endpoint default sistem.
  intranetApiBaseUrl: INTRANET_API_BASE_URL,

  // Opsional: endpoint INTRANET dengan TLS (https://192.168.1.123:3000/api).
  // Kosong = hanya serves http. Isi kalau server port 3000 dijalankan dengan
  // sertifikat TLS (TLS_CERT_FILE / TLS_KEY_FILE di local_server.ts).
  // CATATAN: sertifikat self-signed harus diinstall di perangkat petugas.
  intranetHttpsApiBaseUrl: '',

  geolocation: {
    rute1: 'https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252',
    rute2: 'https://www.google.com/maps?q=-6.1891005,106.8371641',
  },
};
