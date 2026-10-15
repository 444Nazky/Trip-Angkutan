// Development (ng serve / ng build --configuration development).
// Otomatis dipakai saat `npm start`; build rilis memakai environment.prod.ts
// lewat fileReplacements di angular.json.
export const environment = {
  production: false,

  // Backend lokal Express (backend/src/index.js) — default port 3000.
  apiBaseUrl: 'http://localhost:3000/api',

  geolocation: {
    rule1: 'https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252',
    rule2: 'https://www.google.com/maps?q=-6.1891005,106.8371641',
  },
};
