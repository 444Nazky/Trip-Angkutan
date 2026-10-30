/**
 * Tes konfigurasi GPS (services/geofence.ts).
 *
 * Akar masalah yang diuji:
 *   `GeolocationPositionError { code: 3, message: 'Timeout expired' }` di
 *   lapangan. Penyebabnya timeout permintaan GPS yang terlalu pendek (8
 *   detik) + tidak ada percobaan ulang ke provider jaringan + tidak ada
 *   fallback ke fix terakhir yang sudah diketahui.
 *
 * Yang dijaga di sini:
 *   1. Permintaan GPS memakai timeout panjang (>= 30 detik) dan
 *      enableHighAccuracy — cukup waktu bagi GPS chipset lock.
 *   2. Timeout (code 3) / POSITION_UNAVAILABLE (code 2) dicoba ulang dengan
 *      provider jaringan (enableHighAccuracy: false).
 *   3. Galat izin (code 1) TIDAK diulang.
 *   4. Kalau semua percobaan gagal, fix terakhir yang tersimpan tetap
 *      dipakai — petugas tidak diblokir total.
 *
 * Jalankan: npm run test:unit
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface FixOptions {
  enableHighAccuracy?: boolean
  timeout?: number
  maximumAge?: number
}

const h = vi.hoisted(() => ({
  calls: [] as FixOptions[],
  /** 'ok' | 'timeout' | 'denied' | 'unavailable' */
  mode: 'ok' as 'ok' | 'timeout' | 'denied' | 'unavailable',
  /** Berapa kali pertama gagal sebelum succeeds (untuk skenario timeout-once). */
  failFirst: 0,
  position: { lat: -6.1891005, lon: 106.8371641, accuracy: 7 },
}))

vi.mock('./api', () => ({
  api: {
    isAuthenticated: true,
    async get() { return { ok: true, data: [] } },
  },
}))

vi.mock('./auth', () => ({
  getStoredDermaga: () => null,
  getStoredRoutes: () => [],
  getStoredOfficer: () => null,
  renewSessionIfNeeded: async () => true,
}))

function makeError(code: number, message: string) {
  const err = new Error(message)
  ;(err as unknown as { code: number }).code = code
  return err
}

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    async getCurrentPosition(options: FixOptions = {}) {
      h.calls.push(options)
      // Mode 'denied' = izin ditolak -> SELALU gagal (tidak boleh diulang).
      if (h.mode === 'denied') throw makeError(1, 'User denied Geolocation')
      // `failFirst` = berapa banyak percobaan PERTAMA yang gagal. Setelah
      // itu permintaan berikutnya sukses (mencoba skenario "timeout sekali").
      if (h.failFirst > 0) {
        h.failFirst -= 1
        if (h.mode === 'timeout') throw makeError(3, 'Timeout expired')
        if (h.mode === 'unavailable') throw makeError(2, 'Position unavailable')
      }
      return {
        coords: {
          latitude: h.position.lat,
          longitude: h.position.lon,
          accuracy: h.position.accuracy,
        },
      }
    },
    async watchPosition() { return 'watch-1' },
    async clearWatch() { /* no-op */ },
  },
}))

import { getCurrentPosition, getLastKnownPosition, resetGpsFixCache } from './geofence'

beforeEach(() => {
  localStorage.clear()
  h.calls = []
  h.mode = 'ok'
  h.failFirst = 0
  h.position = { lat: -6.1891005, lon: 106.8371641, accuracy: 7 }
  resetGpsFixCache()
})

describe('konfigurasi permintaan GPS', () => {
  it('memakai timeout panjang + enableHighAccuracy (dulu 8 detik)', async () => {
    const pos = await getCurrentPosition()

    expect(pos).not.toBeNull()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].enableHighAccuracy).toBe(true)
    expect(h.calls[0].timeout).toBeGreaterThanOrEqual(30_000)
  })

  it('timeout (code 3) dicoba ulang dengan provider jaringan', async () => {
    h.mode = 'timeout'
    h.failFirst = 1 // percobaan pertama (high accuracy) gagal timeout

    const pos = await getCurrentPosition()

    expect(pos).not.toBeNull()
    expect(h.calls).toHaveLength(2)
    expect(h.calls[0].enableHighAccuracy).toBe(true)
    expect(h.calls[1].enableHighAccuracy).toBe(false)
    expect(h.calls[1].timeout).toBeGreaterThanOrEqual(10_000)
  })

  it('POSITION_UNAVAILABLE (code 2) juga dicoba ulang', async () => {
    h.mode = 'unavailable'
    h.failFirst = 1

    const pos = await getCurrentPosition()

    expect(pos).not.toBeNull()
    expect(h.calls).toHaveLength(2)
  })

  it('izin ditolak (code 1) TIDAK diulang (permissions tetap sama)', async () => {
    h.mode = 'denied'

    const pos = await getCurrentPosition()

    expect(pos).toBeNull()
    expect(h.calls).toHaveLength(1)
  })

  it('semua percobaan gagal -> pakai fix terakhir yang tersimpan', async () => {
    // 1. Fix berhasil dulu -> tersimpan di cache perangkat.
    const pertama = await getCurrentPosition()
    expect(pertama).not.toBeNull()

    // 2. GPS mati total, tapi fix lama masih ada.
    h.mode = 'denied'
    const kedua = await getCurrentPosition({ force: true })

    expect(kedua).not.toBeNull()
    expect(kedua!.lat).toBeCloseTo(h.position.lat, 6)
    expect(kedua!.lng).toBeCloseTo(h.position.lon, 6)
  })

  it('tidak ada fix sama sekali -> null (bukan exception)', async () => {
    h.mode = 'denied'
    const pos = await getCurrentPosition()
    expect(pos).toBeNull()
    expect(getLastKnownPosition()).toBeNull()
  })

  it('fix yang tersimpan bisa dibaca tanpa jaringan (dipakai saat upload)', async () => {
    await getCurrentPosition()
    const last = getLastKnownPosition()
    expect(last).not.toBeNull()
    expect(last!.lat).toBeCloseTo(h.position.lat, 6)
  })
})
