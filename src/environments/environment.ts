// ─── Sumber tunggal alamat backend ─────────────────────────────────────────── Aplikasi hanya memakai server INTRANET kantor (PC lokal, port 3000).
const INTRANET_API_BASE_URL = 'http://192.168.1.123:3000/api'



export const environment = {
  production: false,

  apiBaseUrl: INTRANET_API_BASE_URL,

  // Nama lama untuk endpoint yang sama; dipertahankan agar pemanggil lama dan layar "Pilih Endpoint" tetap bekerja.
  intranetApiBaseUrl: INTRANET_API_BASE_URL,

  // Opsional: endpoint INTRANET dengan TLS (https://192.168.1.123:3000/api). Kosong = server intranet hanya serves http (default LAN kantor).
  intranetHttpsApiBaseUrl: '',

  geolocation: {
    rute1: 'https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252',
    rute2: 'https://www.google.com/maps?q=-6.1891005,106.8371641',
  },
};
