// ─── Atomic OTA Reload ────────────────────────────────────────────────────────
// Dipakai SETELAH bundle OTA baru terverifikasi penuh (applyUpdate() sukses).
// Tiga langkah "atomic reload" agar WebView native tidak memuat cache basi:
//   1. Kirim SKIP_WAITING ke service worker → SW baru mengambil alih segera.
//   2. navigator.serviceWorker.controller bisa null saat reload pertama,
//      jadi skip-waiting juga dikirim lewat registration (reg.waiting).
//   3. window.location.replace('/') — replace() menghapus halaman lama dari
//      history & memaksa fetch ulang index.html (bukan restore dari bfcache).

const SW_SKIP_MSG = { type: 'SKIP_WAITING' }

async function notifyServiceWorker(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return

    // 1. Jalur registrasi: berlaku juga saat SW belum mengontrol halaman
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg?.waiting) {
      reg.waiting.postMessage(SW_SKIP_MSG)
    }
    if (reg?.installing) {
      reg.installing.postMessage(SW_SKIP_MSG)
    }

    // 2. Jalur kontroler: SW yang sudah aktif
    navigator.serviceWorker.controller?.postMessage(SW_SKIP_MSG)
  } catch (err) {
    // Tidak fatal — reload tetap jalan; SW lama masih jalan, tapi index.html
    // baru sudah masuk cache OTA saat applyUpdate().
    console.warn('[ota-reload] gagal memberi tahu SW:', err)
  }
}

/** Beri waktu message SW terproses sebelum navigasi (best-effort). */
function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Reload penuh ke root app setelah bundle baru diaktifkan.
 * replace('/') dipilih karena bfcache/back-forward cache bisa menampilkan
 * halaman lama kalau kita reload() satu-satunya.
 * Native WebView (file:// / capacitor://) juga tetap aman: registrasi atau
 * controller tidak ada → skip langsung ke replace.
 */
export async function hardReloadToNewBundle(): Promise<void> {
  await notifyServiceWorker()
  await delay(150)
  try { sessionStorage.setItem('trip.ota.hardReload', String(Date.now())) } catch { /* */ }
  window.location.replace('/')
}
