



import { Capacitor } from '@capacitor/core'

export function isDevMode(): boolean {
  const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env
  if (!env?.DEV) return false
  if (env.MODE && env.MODE !== 'development') return false
  return true
}

/**
 * Cek apakah aplikasi berjalan di browser pengembangan (localhost/port dev).
 *
 * PENTING — aplikasi NATIVE (Android/iOS) dimuat dari origin LOKAL
 * `https://localhost`. Origin itu BUKAN mode pengembangan. Kalau native
 * dianggap dev, seluruh alur pembaruan mati di perangkat: tombol
 * "Cek Update" selalu dijawab "Sudah Terbaru" tanpa pernah menghubungi
 * server, dan baris versi di Profil tampil sebagai "—".
 *
 * Karena itu native platform selalu keluar dari pemeriksaan ini, apa pun
 * hostname/port-nya.
 */
export function isLocalhostDev(): boolean {
  if (typeof window === 'undefined') return false

  // Aplikasi native: bukan dev, meski hostname-nya "localhost".
  try {
    if (Capacitor.isNativePlatform()) return false
  } catch {
    // Capacitor belum siap - lanjut ke pemeriksaan manual di bawah.
  }

  const hostname = window.location.hostname || ''
  const port = window.location.port || ''
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  const isDevPort = port === '5173' || port === '5174' || port === '3000' || port === '4200' || port === '8080'
  return isLocalhost || isDevPort
}

/**
 * Cek apakah aplikasi berjalan di localhost (development web)
 * Tidak ada notifikasi update yang muncul di localhost
 */
export function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (Capacitor.isNativePlatform()) return false
  } catch {
    // Capacitor belum siap - lanjut ke pemeriksaan manual di bawah.
  }
  const hostname = window.location.hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}
