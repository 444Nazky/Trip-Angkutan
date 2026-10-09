/* eslint-disable no-restricted-syntax */
const CACHE_NAME = 'trip-ota-active'
const COMPLEMENT = 'trip-ota-complement'

const PRECOMMIT_FILES = new Set(['index.html', 'sw.js'])

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.delete(COMPLEMENT).catch(() => {}),
    ]),
  )
})

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    e.waitUntil(self.skipWaiting())
  }
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  if (req.url.startsWith('chrome-extension://')) return
  if (req.url.startsWith('capacitor://')) return
  if (req.url.startsWith('file://')) return

  e.respondWith(handleRequest(req))
})

async function handleRequest(req) {
  const url = new URL(req.url)

  if (!isBundleUrl(url)) {
    return fetch(req)
  }

  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(req)

  if (cached) {
    return new Response(cached.body, {
      headers: {
        'Cache-Control': 'no-store',
        'x-ota': 'true',
      },
    })
  }

  if (url.pathname === '/' || url.pathname.endsWith('/')) {
    const index = await cache.match(cacheKey('index.html'))
    if (index) {
      return new Response(index.body, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'x-ota': 'true',
        },
      })
    }
  }

  return fetch(req)
}

function isBundleUrl(url) {
  const path = url.pathname
  if (PRECOMMIT_FILES.has(url.filename || '')) return true
  if (/^\/(?:assets|chunk|main|styles|ota)\//.test(path)) return true
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|json|woff2|woff|ttf|eot)$/.test(path)) return true
  return false
}

function cacheKey(path) {
  try {
    return new URL(path, self.location.origin).toString()
  } catch {
    return path
  }
}
