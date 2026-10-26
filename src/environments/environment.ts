// ─── Sumber tunggal alamat backend ───────────────────────────────────────────
//
// Aplikasi hanya memakai server INTRANET kantor (PC lokal, port 3000). Tidak
// ada endpoint cloud: seluruh permintaan, unggahan berkas, dan pembaruan OTA
// dilayani mesin yang sama di jaringan lokal.
const INTRANET_API_BASE_URL = 'http://192.168.1.123:3000/api'

export const environment = {
  production: false,

  // Endpoint API tunggal (server intranet, port 3000).
  apiBaseUrl: INTRANET_API_BASE_URL,

  // Nama lama untuk endpoint yang sama; dipertahankan agar pemanggil lama
  // dan layar "Pilih Endpoint" tetap bekerja.
  intranetApiBaseUrl: INTRANET_API_BASE_URL,

  // Opsional: endpoint INTRANET dengan TLS (https://192.168.1.123:3000/api).
  //
  // Kosong = server intranet hanya serves http (default LAN kantor). Isi
  // kalau server port 3000 dijalankan dengan sertifikat TLS (lihat
  // TLS_CERT_FILE / TLS_KEY_FILE di supabase/functions/api/local_server.ts).
  // Kandidat https ini akan muncul otomatis di layar "Pilih Endpoint".
  //
  // CATATAN: sertifikat self-signed harus DIINSTALL DI PERANGKAT petugas,
  // kalau tidak WebView akan menolak koneksi (sertifikat tidak dipercaya).
  intranetHttpsApiBaseUrl: '',

  geolocation: {
    rute1: 'https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252',
    rute2: 'https://www.google.com/maps?q=-6.1891005,106.8371641',
  },
};
