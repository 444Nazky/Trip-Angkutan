/**
 * Tes sinkronisasi & validasi geofence (sisi mobile).
 *
 * Fokus: data di perangkat harus SAMA dengan yang di-set admin:
 *   1. Kontrak respons backend → titik geofence lokal (nama, koordinat, radius
 *      default 100m, allowedRouteCodes, dermagaId).
 *   2. Jalur sync: force (setelah login / tombol manual) mengabaikan cooldown;
 *      siklus otomatis menghormatinya; 401/403 → `unauthorized` (tanpa tendang
 *      ke login — sesi dibuat tidak expired, token dipertahankan).
 *   3. PURGE-FIRST: cache lokal dibersihkan tiap fetch, sisa data lama/fiktif
 *      tidak menumpuk; daftar kosong dari server ikut mengosongkan perangkat.
 *   4. Cuma titik aktif + rute penugasan petugas yang disimpan.
 *   5. Server gagal/jaringan mati → data lama tetap dipakai (petugas tidak
 *      "mati lampu" saat offline).
 *   6. Blokir karena konfigurasi kosong ditandai `configMissing` supaya UI
 *      menawarkan tombol Sinkronkan, bukan menyuruh petugas pindah lokasi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getStoredGeofencePoints,
  saveGeofencePoints,
  purgeGeofenceCache,
  scopedGeofencePoints,
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
  /** Dermaga aktif yang dipilih petugas (permintaan ke backend). */
  dermaga: null as null | { id: string },
  /** Rute penugasan petugas dari sesi (untuk scoping lokal). */
  routes: [] as { code: string }[],
  /** Respons khusus per-path (mis. backend lama: filter dermaga kosong, master berisi). */
  byPath: {} as Record<string, { ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>,
}))

vi.mock('./api', () => ({
  api: {
    // api.isAuthenticated diakses syncGeofencesFromBackend (guard 401)
    isAuthenticated: true,
    async get(path: string) {
      h.paths.push(path)
      return h.byPath[path] ?? h.response
    },
  },
}))

vi.mock('./auth', () => ({
  getStoredDermaga: () => h.dermaga,
  getStoredRoutes: () => h.routes,
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
  h.dermaga = null
  h.routes = []
  h.response = { ok: true, data: [] }
  h.byPath = {}
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

  it('daftar kosong dari server MEMPERTAHANKAN cache perangkat (last-known-good)', async () => {
    saveGeofencePoints([{ id: 'lama', name: 'Titik Lama', latitude: -6.1, longitude: 106.8, radiusMeters: 100, allowedRoutes: ['A-B'], enabled: true }])
    h.response = { ok: true, data: [] }

    const result = await forceSyncGeofencesFromBackend()

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('empty')
    expect(result.count).toBe(1)
    expect(getStoredGeofencePoints().map(p => p.id)).toEqual(['lama'])
  })
})

describe('purge-first, scoping penugasan & jalur sesi habis', () => {
  it('purgeGeofenceCache menghapus titik + penanda sync', () => {
    saveGeofencePoints([POINT])
    localStorage.setItem(SYNC_KEY, String(Date.now()))

    purgeGeofenceCache()

    expect(getStoredGeofencePoints()).toEqual([])
    expect(localStorage.getItem(SYNC_KEY)).toBeNull()
  })

  it('titik hasil testing (id lain) tidak lagi nyangkut setelah tarik data baru', async () => {
    saveGeofencePoints([
      { id: 'seed:badau-d1', name: 'Badau Dermaga 1', latitude: -1.3, longitude: 110.5, radiusMeters: 200, allowedRoutes: ['SJRE-SBDZ'], enabled: true },
      { id: 'seed:entikong-d1', name: 'Entikong Dermaga 1', latitude: 0.8, longitude: 110.1, radiusMeters: 200, allowedRoutes: ['A4A4-B8B8'], enabled: true },
    ])
    h.response = { ok: true, data: [backendRow()] }

    await forceSyncGeofencesFromBackend()

    expect(getStoredGeofencePoints().map(p => p.id)).toEqual(['geo-1'])
  })

  it('hanya titik aktif + sesuai rute penugasan yang disimpan', async () => {
    h.routes = [{ code: 'SJRE-SBDZ' }]
    h.response = {
      ok: true,
      data: [
        backendRow(),
        backendRow({ id: 'geo-wilayah-lain', locationName: 'Entikong Dermaga 1', allowedRouteCodes: ['ENT-SRN'] }),
        backendRow({ id: 'geo-nonaktif', locationName: 'Titik Nonaktif', enabled: false }),
      ],
    }

    const result = await forceSyncGeofencesFromBackend()

    expect(result.count).toBe(1)
    expect(getStoredGeofencePoints().map(p => p.id)).toEqual(['geo-1'])
  })

  it('titik TANPA kode rute (berlaku umum) tetap tersimpan walau petugas punya penugasan', async () => {
    // Dashboard admin tidak selalu mengisi kode rute; dulu titik begini ikut
    // ter-filter → perangkat berakhir kosong ("Belum ada titik geofence tersimpan")
    // dan petugas tidak bisa input trip sama sekali.
    h.routes = [{ code: 'SJRE-SBDZ' }]
    h.response = {
      ok: true,
      data: [
        backendRow({ id: 'geo-umum', locationName: 'Pos Umum', allowedRouteCodes: [] }),
        backendRow({ id: 'geo-wilayah-lain', locationName: 'Entikong Dermaga 1', allowedRouteCodes: ['ENT-SRN'] }),
      ],
    }

    const result = await forceSyncGeofencesFromBackend()

    expect(result.count).toBe(1)
    expect(getStoredGeofencePoints().map(p => p.id)).toEqual(['geo-umum'])
  })

  it('scopedGeofencePoints tetap longgar sebelum rute penugasan tersimpan', () => {
    const points: GeofencePoint[] = [POINT, { ...POINT, id: 'geo-2', enabled: false }]
    expect(scopedGeofencePoints(points).map(p => p.id)).toEqual(['geo-1'])
  })

  it('dermaga aktif dipakai sebagai filter permintaan ke backend', async () => {
    h.dermaga = { id: 'dm-badau-1' }
    h.response = { ok: true, data: [backendRow()] }

    await forceSyncGeofencesFromBackend()

    expect(h.paths[0]).toBe('/geofences?dermagaId=dm-badau-1')
  })

  it('titik geofence di-sidebar: satu-dermaga device hanya dapat titik dermaga + umum (bukan semua device)', async () => {
    // Hanya titik yang dermagaId-nya cocok atau NULL yang masuk device ini. Titik
    // milik dermaga lain TIDAK boleh masuk — itu krusial supaya sinkronisasi benar-
    // benar berbeda per device (bukan semua device dapat semua titik).
    h.dermaga = { id: 'dm-badau-1' }
    h.byPath = {
      '/geofences?dermagaId=dm-badau-1': { ok: true, data: [
        backendRow({ id: 'geo-d1', allowedRouteCodes: ['SJRE-SBDZ'] }),
        backendRow({ id: 'geo-umum', dermagaId: '', allowedRouteCodes: ['SJRE-SBDZ'] }),
        backendRow({ id: 'geo-d2', dermagaId: 'dm-badau-2', allowedRouteCodes: ['ENT-SRN'] }),
      ] },
    }

    const result = await forceSyncGeofencesFromBackend()

    // Hanya satu permintaan: tidak ada fallback master (frontend tidak memaksa
    // /geofences kedua kalinya; filter terjadi di sisi klien).
    expect(h.paths).toEqual(['/geofences?dermagaId=dm-badau-1'])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(2)
    expect(getStoredGeofencePoints().map(p => p.id)).toEqual([
      'geo-d1',
      'geo-umum',
      // geo-d2 TIDAK ikut — milik dermaga lain.
    ])
    expect(getStoredGeofencePoints().filter(p => p.id === 'geo-d2')).toEqual([])
  })

  it('filter dermaga kosong & master juga kosong → tetap kosong (admin memang belum menyimpan titik)', async () => {
    h.dermaga = { id: 'dm-badau-1' }
    h.byPath = {
      '/geofences?dermagaId=dm-badau-1': { ok: true, data: [] },
      '/geofences': { ok: true, data: [] },
    }

    const result = await forceSyncGeofencesFromBackend()

    expect(result.reason).toBe('empty')
    expect(getStoredGeofencePoints()).toEqual([])
  })

  it('server/jaringan gagal → konfigurasi lama TIDAK dibuang', async () => {
    saveGeofencePoints([POINT])
    h.response = { ok: false, error: { code: 'NETWORK', message: 'Server tidak merespon' } }

    const result = await forceSyncGeofencesFromBackend()

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('network')
    expect(result.count).toBe(1)
    expect(getStoredGeofencePoints().map(p => p.id)).toEqual(['geo-1'])
  })

  it('401 dilaporkan sebagai unauthorized TANPA menendang ke login', async () => {
    saveGeofencePoints([POINT])
    h.response = { ok: false, error: { code: '401', message: 'Unauthorized' } }

    const result = await forceSyncGeofencesFromBackend()

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unauthorized')
    // cache dipertahankan, cooldown tidak dikunci
    expect(getStoredGeofencePoints().map(p => p.id)).toEqual(['geo-1'])
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

describe('radius tumpang tindih antar-dermaga (kasus Dewi: pilih D1 di lokasi D1)', () => {
  const D1_UUID = '11111111-1111-4111-8111-111111111111'
  const D2_UUID = '22222222-2222-4222-8222-222222222222'
  const LAT = -0.8506
  const LON = 108.8338
  // Titik D2 tersimpan DULUAN + radius raksasa menutupi D1 (input admin) —
  // dulu pemenang-tunggal selalu D2 → mismatch + tombol mati walau posisi di D1.
  const D2_FIRST: GeofencePoint[] = [
    { id: 'geo-d2', name: 'Badau Dermaga 2', dermagaId: D2_UUID, latitude: LAT, longitude: LON, radiusMeters: 5000, allowedRoutes: ['SBDZ-SJRE'], enabled: true },
    { id: 'geo-d1', name: 'Badau Dermaga 1', dermagaId: D1_UUID, latitude: LAT, longitude: LON, radiusMeters: 100, allowedRoutes: ['SJRE-SBDZ'], enabled: true },
  ]

  it('snapshot scoped D1 memilih titik D1 (bukan urutan storage)', async () => {
    saveGeofencePoints(D2_FIRST)
    h.position = { lat: LAT, lon: LON, accuracy: 8 }

    const scoped = await getActiveGeofenceSnapshot(undefined, D1_UUID)
    expect(scoped.valid).toBe(true)
    expect(scoped.activePoint?.id).toBe('geo-d1')

    // tanpa scope: perilaku lama dipertahankan (pemenang = urutan storage)
    resetGpsFixCache()
    const unscoped = await getActiveGeofenceSnapshot()
    expect(unscoped.activePoint?.id).toBe('geo-d2')
  })

  it('dermagaId warisan (BUKAN UUID) dianggap titik umum', async () => {
    saveGeofencePoints([
      { id: 'geo-d1', name: 'Badau Dermaga 1', dermagaId: 'BADAU-D1', latitude: LAT, longitude: LON, radiusMeters: 100, allowedRoutes: ['SJRE-SBDZ'], enabled: true },
    ])
    h.position = { lat: LAT, lon: LON, accuracy: 8 }

    const scoped = await getActiveGeofenceSnapshot(undefined, D1_UUID)
    expect(scoped.valid).toBe(true)
    expect(scoped.activePoint?.id).toBe('geo-d1')
  })

  it('validasi rute scoped D1 meloloskan rute D1 walau titik D2 duluan', async () => {
    saveGeofencePoints(D2_FIRST)
    h.position = { lat: LAT, lon: LON, accuracy: 8 }

    const ok = await validateRouteForCurrentLocation('SJRE-SBDZ', undefined, D1_UUID)
    expect(ok).toMatchObject({ valid: true })

    const wrong = await validateRouteForCurrentLocation('AAAA-BBBB', undefined, D1_UUID)
    expect(wrong.valid).toBe(false)
  })
})
