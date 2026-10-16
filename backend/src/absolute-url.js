'use strict';

// Host lokal/LAN boleh tanpa TLS; host publik (Railway, CDN, tunnel) wajib https.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

/**
 * Pastikan URL dasar selalu absolut.
 *
 * Env seperti RAILWAY_STATIC_URL / APK_CDN_URL bisa diisi tanpa skema
 * ("aplikasi-trip-api-production.up.railway.app"). res.redirect() menerima
 * string seperti itu sebagai path relatif sehingga Location menjadi
 * "aplikasi-...railway.app/releases/app-1.0.5.apk" — APK tidak pernah terunduh
 * dan aplikasi mobile gagal update. Sekarang skema ditambahkan otomatis.
 *
 * @param {string} raw nilai env yang mungkin tanpa skema
 * @returns {string} URL absolut tanpa garis miring di akhir, '' bila kosong
 */
function absoluteBase(raw) {
  const value = String(raw == null ? '' : raw).trim().replace(/\/+$/, '');
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const host = value.split('/')[0];
  return `${LOCAL_HOST.test(host) ? 'http' : 'https'}://${value}`;
}

module.exports = { absoluteBase };
