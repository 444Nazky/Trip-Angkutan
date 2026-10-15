export const environment = {
  production: false,

  // dev lokal → backend di laptop; build rilis pakai environment.prod.ts (Railway)
  apiBaseUrl: 'http://localhost:3000/api',

  geolocation: {
    rute1: 'https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252',
    rute2: 'https://www.google.com/maps?q=-6.1891005,106.8371641',
  },
};
