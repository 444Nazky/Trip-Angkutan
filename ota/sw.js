/* ─────────────────────────────────────────────────────────────────────────────
 * Service worker OTA — Trip Angkutan
 *
 * Tugas: menyajikan bundle www hasil unduhan (OTG update) DI ATAS aset bawaan
 * APK, sehingga pembaruan bisa diterapkan tanpa install ulang .apk.
 *
 * Aturan:
 *   1. Hanya GET ke origin yang sama (CDN/API dibiarkan).
 *   2. Bila ada salinan di cache `trip-ota-active` → pakai itu.
 *   3. Selain itu → biarkan WebView yang melayani (aset bawaan) / jaringan.
 *   4. Gagal total saat offline pun tidak merusak: request jatuh ke fetch(),
 *      bila masih gagal untuk navigasi kita kirim halaman kosong yang aman.
 * ──────────────────────────────────────────────────────────────────────────── */

const ACTIVE_CACHE = 'trip-ota-active'
const CACHE_PREFIX = 'trip-ota-'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(
      names
        .filter(n => n.startsWith(CACHE_PREFIX) && n !== ACTIVE_CACHE)
        .map(n => caches.delete(n)),
    )
    await self.clients.claim()
  })())
})

async function matchOta(request) {
  try {
    const cache = await caches.open(ACTIVE_CACHE)
    if (request.mode === 'navigate') {
      // Navigasi selalu diarahkan ke index.html bundle terbaru
      const url = new URL(request.url)
      const candidate = url.pathname.endsWith('/') ? 'index.html' : url.pathname.slice(1)
      return (await cache.match(candidate)) ||
        (await cache.match('index.html')) ||
        (await cache.match('/index.html')) ||
        null
    }
    return await cache.match(request)
  } catch {
    return null
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  event.respondWith((async () => {
    const cached = await matchOta(request)
    if (cached) return cached
    try {
      return await fetch(request)
    } catch (err) {
      // Offline & tidak ada di cache. Untuk navigasi kirim shell aman agar
      // WebView tidak menampilkan halaman error bawaan.
      if (request.mode === 'navigate') {
        const fallback = await matchOta(new Request('/index.html'))
        if (fallback) return fallback
      }
      throw err
    }
  })())
})
