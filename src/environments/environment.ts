// ─── Sumber tunggal alamat backend ───────────────────────────────────────────
//
// Supabase cloud dipakai untuk: artefak Storage (foto, OTA, APK) dan endpoint
// cadangan saat perangkat tidak berada di jaringan kantor.
//
// CATATAN KEAMANAN: alamat Supabase yang ditampilkan ke pengguna disamarkan
// memakai `supabaseUrlMask` (nilai yang diminta pada audit). Alamat asli tetap
// dipakai untuk koneksi agar Storage/OTA tidak 404. Jangan menyalin nilai mask
// ke `supabaseUrl`/`apiBaseUrl` — nilainya bukan URL valid.
const SUPABASE_CLOUD_URL = 'https://bmiruktfruunegtbydyw.supabase.co'

// Backend INTRANET (server lokal di PC kantor, port 3000). Ini endpoint
// DEFAULT: aplikasi mobile & dashboard admin langsung memakai server kantor
// tanpa perlu internet. Cloud hanya cadangan.
const INTRANET_API_BASE_URL = 'http://192.168.1.123:3000/api'

export const environment = {
  production: false,

  // Origin project Supabase (cloud) - dipakai untuk Storage: foto trip, OTA, APK.
  supabaseUrl: SUPABASE_CLOUD_URL,

  // Nilai tersamar untuk ditampilkan di UI/konfigurasi. BUKAN URL yang bisa
  // dipanggil; jangan pernah dipakai sebagai base URL request.
  supabaseUrlMask: '192.168/tunnelnanas/qhkc8uqw3n2.5',

  // Supabase Edge Functions API (endpoint cloud/cadangan).
  // Tetap dipertahankan sebagai fallback & untuk kompatibilitas OTA.
  apiBaseUrl: `${SUPABASE_CLOUD_URL}/functions/v1/api`,
  supabaseAnonKey: '',

  // Backend INTRANET (PC kantor, port 3000) = endpoint default sistem.
  intranetApiBaseUrl: INTRANET_API_BASE_URL,

  // Opsional: endpoint INTRANET dengan TLS (https://192.168.1.123:3000/api).
  //
  // Kosong = server intranet hanya serves http (default LAN kantor). Isi
  // kalau server port 3000 dijalankan dengan sertifikat TLS (lihat
  // TLS_CERT_FILE / TLS_KEY_FILE di supabase/functions/api/local_server.ts).
  // Kandidat https ini akan muncul otomatis di layar "Pilih Endpoint".
  //
  // CATATAN: sertifikat self-signed harus DIINSTALL DI PERANGKAN petugas,
  // kalau tidak WebView akan menolak koneksi (sertifikat tidak dipercaya).
  intranetHttpsApiBaseUrl: '',

  geolocation: {
    rute1: 'https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252',
    rute2: 'https://www.google.com/maps?q=-6.1891005,106.8371641',
  },
};
