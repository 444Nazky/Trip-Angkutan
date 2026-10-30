// ─── Sumber tunggal alamat backend (PRODUKSI) ────────────────────────────────
//
// Aplikasi hanya memakai server INTRANET kantor (PC lokal, port 3000). Tidak
// ada endpoint cloud: seluruh permintaan, unggahan berkas, dan pembaruan OTA
// dilayani mesin yang sama di jaringan lokal.
const INTRANET_API_BASE_URL = 'http://192.168.1.123:3000/api'

export const environment = {
  production: true,

  // Endpoint API tunggal (server intranet, port 3000).
  apiBaseUrl: INTRANET_API_BASE_URL,

  // Nama lama untuk endpoint yang sama; dipertahankan agar pemanggil lama
  // dan layar "Pilih Endpoint" tetap bekerja.
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
