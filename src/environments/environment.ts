export const environment = {
  production: false,

  // Default = Railway produksi (debug Chrome pun langsung ke server live).
  // Backend lokal hanya via Pengaturan Server (override manual) — bukan default.
  apiBaseUrl: 'https://aplikasi-trip-api-production.up.railway.app/api',

  geolocation: {
    rute1: 'https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252',
    rute2: 'https://www.google.com/maps?q=-6.1891005,106.8371641',
  },
};
