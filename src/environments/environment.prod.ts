// Production / release build (ng build, `defaultConfiguration: "production"`).
// Ditukar otomatis dengan environment.ts oleh fileReplacements di angular.json,
// sehingga build rilis menunjuk ke Railway dan `ng serve` menunjuk ke lokal.
export const environment = {
  production: true,

  apiBaseUrl: 'https://aplikasi-trip-api-production.up.railway.app/api',
};
