export const environment = {
  production: import.meta.env.PROD,
  apiBaseUrl: import.meta.env.PROD
    ? 'https://aplikasi-trip-api-production.up.railway.app/api'
    : 'http://localhost:3000/api',
}
