



export function isDevMode(): boolean {
  const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env
  if (!env?.DEV) return false
  if (env.MODE && env.MODE !== 'development') return false
  return true
}

/**
 * Cek apakah aplikasi berjalan di localhost (development web)
 * Tidak ada notifikasi update yang muncul di localhost
 */
export function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}
