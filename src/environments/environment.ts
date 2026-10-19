export const environment = {
  production: false,

  // Default = backend LAN (Wi-Fi lokal) tempat mobile, dashboard, dan API
  // dijalankan bersama. Ubah ke Railway hanya bila memang menguji server live.
  apiBaseUrl: 'http://192.168.1.124:3000/api',

  geolocation: {
    rute1: 'https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252',
    rute2: 'https://www.google.com/maps?q=-6.1891005,106.8371641',
  },
};
