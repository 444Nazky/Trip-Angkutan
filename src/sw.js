/* eslint-disable no-restricted-syntax */
// ─── OTA Service Worker — v4 (versi-aktif saja) ───────────────────────────────
//
// Prinsip:
//   1. HANYA SATU versi boleh menyajikan aplikasi. Versi aktif dibaca dari
//      cache meta (`trip-ota-meta/__active__.json`) yang ditulis oleh halaman
//      saat aktivasi. Cache versi lain diabaikan TOTAL — inilah yang mencegah
//      "update kedua tidak muncul" akibat entri cache lama ikut tersaji.
//   2. Bila berkas tidak ada di cache versi aktif → ambil dari jaringan
//      (bundle bawaan APK). Tidak pernah mengambil dari cache versi lain.
//   3. Saat aktivasi SW, semua cache versi selain yang aktif dibersihkan.
//   4. Permintaan dengan `ota_bypass=1` selalu lewat jaringan (dipakai saat
//      proses OTA agar tidak pernah dilayani cache basi).
//
// Pesan dari halaman: SKIP_WAITING · PURGE_ALL · SET_ACTIVE {version}

const META_CACHE = 'trip-ota-meta'
const META_KEY = '__active__.json'
const VERSION_PREFIX = 'trip-ota-v'
const LEGACY_CACHE = 'trip-ota-active'
const LEGACY_COMPLEMENT = 'trip-ota-complement'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim()
    const active = await readActiveVersion()
    const names = await caches.keys()
    await Promise.all(names.map(async (name) => {
      if (name === META_CACHE) return undefined
      // Sisa arsitektur v3 selalu dibuang (tidak pernah dibaca lagi).
      if (name === LEGACY_CACHE || name === LEGACY_COMPLEMENT) return caches.delete(name)
      if (!name.startsWith(VERSION_PREFIX)) return undefined
      // Cache versi lain hanya boleh dibuang kalau versi aktif SUDAH diketahui.
      // Bila meta belum ada (mis. halaman sedang membangun ulang cache dari
      // penyimpanan durable), jangan hapus apa pun — halaman yang berhak
      // memutuskan, dan versi tanpa meta tidak pernah disajikan SW.
      if (!active) return undefined
      if (name === VERSION_PREFIX + active) return undefined
      return caches.delete(name)
    }))
  })())
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
    return
  }
  if (data.type === 'PURGE_ALL') {
    event.waitUntil((async () => {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
    })())
    return
  }
  if (data.type === 'SET_ACTIVE' && typeof data.version === 'string') {
    // Halaman normalnya menulis meta sendiri; pesan ini hanya jalur cadangan.
    event.waitUntil((async () => {
      const cache = await caches.open(META_CACHE)
      await cache.put(new Request(new URL(META_KEY, self.location.origin).href), new Response(
        JSON.stringify({ version: data.version, assets: data.assets || [], savedAt: Date.now() }),
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
      ))
    })())
  }
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  if (req.url.startsWith('chrome-extension://')) return
  if (req.url.startsWith('capacitor://')) return
  if (req.url.startsWith('file://')) return
  // Lampiran/toolbar ekstensi & request lintas origin: biarkan apa adanya.
  let url
  try { url = new URL(req.url) } catch { return }
  if (url.origin !== self.location.origin) return
  // Bypass eksplisit (dipakai proses OTA).
  if (url.searchParams.get('ota_bypass') === '1') return

  if (!isBundleUrl(url)) return
  event.respondWith(handleRequest(req, url))
})

async function handleRequest(req, url) {
  // Selalu cari di cache VERSI AKTIF saja.
  const active = await readActiveVersion()
  if (active) {
    const cache = await caches.open(VERSION_PREFIX + active)
    const hit = await cache.match(canonical(req, url))
    if (hit) return withNoStore(hit)
    if (isNavigation(url)) {
      const index = await cache.match(cacheKey('index.html'))
      if (index) return withNoStore(index, 'text/html; charset=utf-8')
    }
  }

  // Tidak ada di cache versi aktif → jaringan (bundle bawaan APK).
  return fetch(req)
}

function withNoStore(res, contentType) {
  const headers = { 'Cache-Control': 'no-store', 'x-ota': 'true' }
  if (contentType) headers['Content-Type'] = contentType
  return new Response(res.body, { headers })
}

function isNavigation(url) {
  return url.pathname === '/' || url.pathname.endsWith('/') || /\/index\.html$/.test(url.pathname)
}

/** Cocokkan tanpa query (cache disimpan di URL kanonik). */
function canonical(req, url) {
  const clean = url.origin + url.pathname
  return new Request(clean, { method: 'GET' })
}

function cacheKey(path) {
  try {
    return new URL(path, self.location.origin).href
  } catch {
    return path
  }
}

async function readActiveVersion() {
  try {
    const cache = await caches.open(META_CACHE)
    const res = await cache.match(cacheKey(META_KEY))
    if (!res) return null
    const data = await res.json()
    return typeof data?.version === 'string' && data.version ? data.version : null
  } catch {
    return null
  }
}

function isBundleUrl(url) {
  const path = url.pathname
  if (isNavigation(url)) return true
  if (/^\/(assets|chunk|main|styles|ota)\//.test(path)) return true
  if (/\/(chunk|main|styles)-[\w-]+\.(js|css)$/.test(path)) return true
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|json|woff2|woff|ttf|eot)$/.test(path)) return true
  return false
}
