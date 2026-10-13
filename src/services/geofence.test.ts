/**
 * Tes sinkronisasi & validasi geofence (sisi mobile).
 *
 * Fokus: rantai yang membuat petugas melihat "Geofence belum dikonfigurasi
 * admin" padahal admin SUDAH mengisi Master Rute:
 *   1. Kontrak respons backend → titik geofence lokal (nama, koordinat, radius
 *      default 100m, allowedRouteCodes).
 *   2. Jalur sync: force (setelah login / tombol manual) mengabaikan cooldown;
 *      siklus otomatis menghormatinya; 401 dilaporkan sebagai `unauthorized`.
 *   3. Daftar kosong dari server TIDAK menghapus konfigurasi lokal (offline-first).
 *   4. Blokir karena konfigurasi kosong ditandai `configMissing` supaya UI
 *      menawarkan tombol Sinkronkan, bukan menyuruh petugas pindah lokasi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getStoredGeofencePoints,
  saveGeofencePoints,
  syncGeofencesFromBackend,
  forceSyncGeofencesFromBackend,
  getActiveGeofenceSnapshot,
  validateRouteForCurrentLocation,
  getCurrentPosition,
  resetGpsFixCache,
  GEOFENCE_UPDATED_EVENT,
  type GeofencePoint,
} from './geofence'

const h = vi.hoisted(() => ({
  response: { ok: true, data: [] as unknown[] } as { ok: boolean; data?: unknown; error?: { code?: string; message?: string } },
  position: null as null | { lat: number; lon: number; accuracy?: number | null },
  paths: [] as string[],
  /** Jumlah pemanggilan NATIVE ke GPS — ukuran performa (dedup + cache). */
  gpsCalls: 0,
}))

vi.mock('./api', () => ({
  api: {
    async get(path: string) {
      h.paths.push(path)
      return h.response
    },
  },
}))

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    async getCurrentPosition() {
      h.gpsCalls += 1
      if (!h.position) throw new Error('GPS tidak tersedia')
      return { coords: { latitude: h.position.lat, longitude: h.position.lon, accuracy: h.position.accuracy ?? 8 } }
    },
  },
}))

/** Bentuk baris yang benar-benar dikirim backend (lihat routes/geofences.js). */
function backendRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'geo-1',
    locationName: 'Badau Dermaga 1',
    latitude: -6.1891005,
    longitude: 106.8371641,
    radiusMeters: 100,
    allowedRouteCodes: ['SJRE-SBDZ'],
    allowedDirections: [],
    description: '',
    ...over,
  }
}

/** Titik siap pakai (bentuk hasil pemetaan, lengkap dengan flag enabled). */
const POINT: GeofencePoint = {
  id: 'geo-1',
  name: 'Badau Dermaga 1',
  latitude: -6.1891005,
  longitude: 106.8371641,
  radiusMeters: 100,
  allowedRoutes: ['SJRE-SBDZ'],
  enabled: true,
  strictEnforceOutsideArea: true,
}

const SYNC_KEY = 'trip.geofence.lastSync'
const STORAGE_KEY = 'trip.geofence.points'

beforeEach(() => {
  localStorage.clear()
  h.paths.length = 0
  h.position = null
  h.gpsCalls = 0
  h.response = { ok: true, data: [] }
  resetGpsFixCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pemetaan kontrak backend → titik geofence lokal', () => {
  it('memetakan locationName/allowedRouteCodes dan memberi radius default 100m', async () => {
    h.response = { ok: true, data: [backendRow({ radiusMeters: undefined, latitude: '-6.1891005', longitude: '106.8371641' })] }

    const result = await forceSyncGeofencesFromBackend()

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('ok')
    expect(result.count).toBe(1)
    const [p] = getStoredGeofencePoints()
    expect(p.name).toBe('Badau Dermaga 1')
    expect(p.latitude).toBeCloseTo(-6.1891005, 6)
    expect(p.longitude).toBeCloseTo(106.8371641, 6)
    expect(p.radiusMeters).toBe(100) // radius tidak dikirim → default 100m
    expect(p.allowedRoutes).toEqual(['SJRE-SBDZ'])
    expect(p.enabled).toBe(true)
    expect(h.paths[0]).toBe('/geofences')
  })

  it('membuang baris dengan koordinat tidak valid (placeholder/NaN)', async () => {
    h.response = {
      ok: true,
      data: [backendRow(), backendRow({ id: 'geo-2', latitude: 'Otomatis dari Link Maps' })],
    }
    const result = await forceSyncGeofencesFromBackend()
    expect(result.count).toBe(1)
    expect(getStoredGeofencePoints().map(p => p.id)).toEqual(['geo-1'])
  })
})

describe('kebijakan sinkronisasi', () => {
  it('payload cache lama tanpa `enabled` dinormalisasi (tidak dianggap nonaktif)', () => {
    // Bentuk baris backend mentah yang mungkin tersimpan dari versi lama.
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{
      id: 'geo-1', locationName: 'Badau', latitude: -6.1891005, longitude: 106.8371641,
    }]))
    const [p] = getStoredGeofencePoints()
    expect(p.enabled).toBe(true)
    expect(p.radiusMeters).toBe(100)
    expect(p.allowedRoutes).toEqual([])
    expect(p.name).toBe('Titik Geofence') // field `name` tidak ada → fallback aman
  })

  it('cooldown hanya berlaku untuk siklus otomatis; force selalu menarik ulang', async () => {
    h.response = { ok: true, data: [backendRow()] }
    await forceSyncGeofencesFromBackend()
    expect(h.paths.length).toBe(1)

    // Otomatis: masih dalam 15 menit → tidak menyentuh jaringan
    const auto = await syncGeofencesFromBackend()
    expect(auto.reason).toBe('cached')
    expect(h.paths.length).toBe(1)

    // Force (setelah login / tombol manual): selalu menarik
    await forceSyncGeofencesFromBackend()
    expect(h.paths.length).toBe(2)
  })

  it('daftar kosong dari server TIDAK menghapus konfigurasi lokal', async () => {
    saveGeofencePoints([{ id: 'lama', name: 'Titik Lama', latitude: -6.1, longitude: 106.8, radiusMeters: 100, allowedRoutes: ['A-B'], enabled: true }])
    h.response = { ok: true, data: [] }

    const result = await forceSyncGeofencesFromBackend()

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('empty')
    expect(getStoredGeofencePoints().map(p => p.id)).toEqual(['lama'])
  })

  it('401 dilaporkan sebagai unauthorized (bukan diam-diam gagal)', async () => {
    h.response = { ok: false, error: { code: '401', message: 'Unauthorized' } }
    const result = await forceSyncGeofencesFromBackend()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unauthorized')
    expect(localStorage.getItem(SYNC_KEY)).toBeNull() // tidak mengunci cooldown
  })

  it('memancarkan GEOFENCE_UPDATED_EVENT saat konfigurasi berubah', async () => {
    const seen: number[] = []
    const listener = (e: Event) => seen.push((e as CustomEvent<{ count: number }>).detail.count)
    window.addEventListener(GEOFENCE_UPDATED_EVENT, listener)

    h.response = { ok: true, data: [backendRow()] }
    await forceSyncGeofencesFromBackend()
    // Sync ulang dengan data identik → tidak ada event baru
    await forceSyncGeofencesFromBackend()

    window.removeEventListener(GEOFENCE_UPDATED_EVENT, listener)
    expect(seen).toEqual([1])
  })
})

describe('performa pemindaian lokasi (cache & dedup fix GPS)', () => {
  it('permintaan bersamaan berbagi SATU sesi GPS', async () => {
    h.position = { lat: -6.1891005, lon: 106.8371641, accuracy: 8 }
    // Meniru pemicu layar: mount + focus + online + interval berbarengan.
    const results = await Promise.all([
      getCurrentPosition(),
      getCurrentPosition(),
      getCurrentPosition(),
      getCurrentPosition(),
      getCurrentPosition(),
    ])
    expect(h.gpsCalls).toBe(1)
    expect(results.every(r => r?.lat === -6.1891005)).toBe(true)
  })

  it('panggilan berikutnya dalam 12 dtk memakai cache — TANPA sesi GPS baru', async () => {
    h.position = { lat: -6.1891005, lon: 106.8371641, accuracy: 8 }
    await getCurrentPosition()
    await getCurrentPosition()
    await getCurrentPosition()
    expect(h.gpsCalls).toBe(1)
  })

  it('lewat jendela freshness → GPS diminta ulang (interval 15 dtk tetap mendeteksi gerak)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      h.position = { lat: -6.1891005, lon: 106.8371641, accuracy: 8 }
      await getCurrentPosition()
      vi.setSystemTime(Date.now() + 13_000)
      await getCurrentPosition()
      expect(h.gpsCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('kegagalan GPS TIDAK di-cache — retry petugas langsung menembak perangkat', async () => {
    h.position = null
    expect(await getCurrentPosition()).toBeNull()
    expect(h.gpsCalls).toBe(1)

    h.position = { lat: -6.1891005, lon: 106.8371641, accuracy: 8 }
    const retry = await getCurrentPosition()
    expect(h.gpsCalls).toBe(2)
    expect(retry?.lat).toBe(-6.1891005)
  })

  it('snapshot geofence memakai cache yang sama (tanpa pemeriksaan GPS ekstra)', async () => {
    saveGeofencePoints([POINT])
    h.position = { lat: POINT.latitude, lon: POINT.longitude, accuracy: 8 }

    await getCurrentPosition()
    const snap = await getActiveGeofenceSnapshot()
    const route = await validateRouteForCurrentLocation('SJRE-SBDZ')

    expect(snap.valid).toBe(true)
    expect(route.valid).toBe(true)
    expect(h.gpsCalls).toBe(1) // 3 pemeriksaan → 1 sesi GPS
  })
})

describe('validasi lokasi terhadap konfigurasi', () => {
  it('konfigurasi kosong → diblokir dengan penanda configMissing', async () => {
    localStorage.removeItem(STORAGE_KEY)

    const snap = await getActiveGeofenceSnapshot()
    expect(snap.valid).toBe(false)
    expect(snap.blocked).toBe(true)
    expect(snap.configMissing).toBe(true)

    const route = await validateRouteForCurrentLocation('SJRE-SBDZ')
    expect(route.blocked).toBe(true)
    expect(route.configMissing).toBe(true)
  })

  it('di dalam radius → valid & titik aktif terbaca; di luar → blokir biasa', async () => {
    saveGeofencePoints([POINT])

    h.position = { lat: -6.1891005, lon: 106.8371641, accuracy: 8 }
    const inside = await getActiveGeofenceSnapshot()
    expect(inside.valid).toBe(true)
    expect(inside.activePoint?.id).toBe('geo-1')
    expect(inside.configMissing).toBeUndefined()
    expect(await validateRouteForCurrentLocation('SJRE-SBDZ')).toMatchObject({ valid: true })

    // Petugas berpindah jauh → lewati jendela freshness (cache 12 dtk) dan
    // minta fix baru, persis seperti yang dilakukan interval layar tiap 15 dtk.
    h.position = { lat: -6.25, lon: 106.9, accuracy: 8 } // ±7 km dari titik
    resetGpsFixCache()
    const outside = await getActiveGeofenceSnapshot()
    expect(outside.blocked).toBe(true)
    expect(outside.configMissing).toBeUndefined()
  })

  it('rute yang tidak diizinkan di titik aktif → diblokir dengan daftar rute sah', async () => {
    saveGeofencePoints([POINT])
    h.position = { lat: -6.1891005, lon: 106.8371641, accuracy: 8 }

    const res = await validateRouteForCurrentLocation('LAIN-XYZ')
    expect(res.valid).toBe(false)
    expect(res.blocked).toBe(true)
    expect(res.reason).toContain('SJRE-SBDZ')
  })

  it('GPS mati → diblokir (tidak ada fallback koordinat hardcoded)', async () => {
    saveGeofencePoints([POINT])
    h.position = null
    const res = await getActiveGeofenceSnapshot()
    expect(res.blocked).toBe(true)
    expect(res.reason).toMatch(/GPS/i)
  })
})
