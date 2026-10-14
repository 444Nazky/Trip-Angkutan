// ─── Atomic OTA Reload ────────────────────────────────────────────────────────
// Dipakai SETELAH bundle OTA baru terverifikasi penuh (applyUpdate() sukses).
//
// Empat langkah agar WebView native TIDAK memuat cache basi:
//   1. Kirim SKIP_WAITING ke service worker → SW baru (bila ada) mengambil alih
//      segera, sehingga fetch berikutnya sudah dilayani SW terbaru.
//   2. Beri tahu SW versi aktif terbaru (pesan SET_ACTIVE) — jalur cadangan bila
//      penulisan meta di cache gagal; SW hanya menyajikan versi ini.
//   3. Muat ulang ke URL BER-VERSI (`/?ota=<versi>`). Query unik membuat HTTP
//      cache WebView (file:// maupun http) tidak bisa mengembalikan index.html
//      lama, sementara Service Worker tetap mencocokkan tanpa query sehingga
//      index.html versi baru yang tersaji.
//   4. replace() (bukan reload()) menghapus halaman lama dari history dan
//      melewati bfcache.
//
// Tanpa SW (mode web biasa / Capacitor tanpa SW) langkah 1-2 dilewati dan
// langkah 3-4 tetap memaksa unduhan index.html segar.

import { sleep } from './ota'

const SW_SKIP_MSG = { type: 'SKIP_WAITING' }

/** Versi yang terakhir diterapkan (dibaca dari state OTA) — untuk cache-buster. */
export function appliedCacheBuster(): string {
  try {
    const raw = localStorage.getItem('trip.ota.state')
    if (raw) {
      const st = JSON.parse(raw) as { latestVersion?: string; activeVersion?: string }
      const v = st.activeVersion ?? st.latestVersion
      if (v) return v
    }
    return localStorage.getItem('trip.ota.appliedVersion') ?? ''
  } catch {
    return ''
  }
}

async function notifyServiceWorker(version?: string): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return

    // 1. Jalur registrasi: berlaku juga saat SW belum mengontrol halaman
    const reg = await navigator.serviceWorker.getRegistration()
    const targets: (ServiceWorker | null | undefined)[] = [
      reg?.waiting,
      reg?.installing,
      navigator.serviceWorker.controller,
    ]
    for (const worker of targets) {
      try { worker?.postMessage(SW_SKIP_MSG) } catch { /* worker mati */ }
    }

    // 2. Cadangan: pastikan SW tahu versi yang harus disajikan.
    if (version) {
      const msg = { type: 'SET_ACTIVE', version }
      for (const worker of targets) {
        try { worker?.postMessage(msg) } catch { /* worker mati */ }
      }
    }
  } catch (err) {
    // Tidak fatal — reload tetap jalan; server-side sudah menulis meta versi.
    console.warn('[ota-reload] gagal memberi tahu SW:', err)
  }
}

/**
 * Reload penuh ke root app setelah bundle baru diaktifkan.
 * `version` opsional; bila tidak diberikan, diambil dari state OTA terakhir.
 */
export async function hardReloadToNewBundle(version?: string): Promise<void> {
  const target = version ?? appliedCacheBuster()
  await notifyServiceWorker(target || undefined)
  await sleep(150)
  try { sessionStorage.setItem('trip.ota.hardReload', String(Date.now())) } catch { /* */ }

  let url = '/'
  if (target) {
    try {
      const u = new URL('/', window.location.origin)
      u.searchParams.set('ota', target)
      url = u.pathname + u.search + u.hash
    } catch {
      url = `/?ota=${encodeURIComponent(target)}`
    }
  }
  window.location.replace(url)
}
