export const environment = {
  production: true,

  // Supabase Edge Functions API (single endpoint: supabase/functions/api)
  apiBaseUrl: 'https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api',
  supabaseAnonKey: '',

  // Backend INTRANET (server lokal di PC kantor, port 3000).
  // Dipakai sebagai pilihan kedua di "Pengaturan Server" aplikasi mobile.
  intranetApiBaseUrl: 'http://192.168.1.123:3000/api',

  geolocation: {
    rute1: 'https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252',
    rute2: 'https://www.google.com/maps?q=-6.1891005,106.8371641',
  },
};
