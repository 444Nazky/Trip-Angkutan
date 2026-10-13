/**
 * Tes konfigurasi geofence (Aplikasi-Trip-Main).
 *
 * Yang dijaga:
 *   1. Tidak ada rule hardcode — konfigurasi hanya datang dari Admin Dashboard.
 *   2. `syncGeofenceConfig()` memetakan respons GET /api/geofences (array rule)
 *      ke config + menyimpannya ke localStorage (dipakai layar Pilih Rute).
 *   3. Server balas kosong / gagal (401-jaringan) → cache lokal TIDAK di-reset,
 *      jadi perangkat tidak kehilangan kunci rute secara diam-diam.
 *   4. Rule valid → hard-lock rute & validasi arah berfungsi seperti yang
 *      dipakai RouteSelectScreen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  syncGeofenceConfig,
  loadCachedGeofenceConfig,
  currentConfig,
  applyGeofenceConfig,
  findActiveGeofenceRule,
  getHardLockedRoute,
  validateRouteAgainstGeofence,
  DEFAULT_GEOFENCE_CONFIG,
  type GeofenceRule,
} from './geofence'

const h = vi.hoisted(() => ({
  response: { ok: true, data: [] as unknown[] } as { ok: boolean; data?: unknown; error?: { code?: string } },
  paths: [] as string[],
}))

vi.mock('./api', () => ({
  api: {
    async get(path: string) {
      h.paths.push(path)
      return h.response
    },
  },
}))

/** Bentuk baris nyata dari backend routes/geofences.js (shape()). */
function backendRule(over: Partial<GeofenceRule> = {}): unknown {
  return {
    id: 'geo-1',
    locationName: 'Badau Dermaga 1',
    latitude: -6.1891005,
    longitude: 106.8371641,
    radiusMeters: 100,
    allowedRouteCodes: ['SJRE-SBDZ'],
    allowedDirections: ['SJRE-SBDZ'],
    description: '',
    ...over,
  }
}

const RULE: GeofenceRule = backendRule() as GeofenceRule

beforeEach(() => {
  localStorage.clear()
  h.paths.length = 0
  h.response = { ok: true, data: [] }
  // Reset state runtime module (currentConfigRef dipakai lintas test)
  applyGeofenceConfig(DEFAULT_GEOFENCE_CONFIG)
})

describe('konfigurasi default', () => {
  it('KOSONG — tidak ada lagi rule hardcoded di dalam bundle', () => {
    expect(DEFAULT_GEOFENCE_CONFIG.rules).toEqual([])
    expect(loadCachedGeofenceConfig().rules).toEqual([])
    expect(currentConfig().rules).toEqual([])
  })
})

describe('syncGeofenceConfig', () => {
  it('memetakan array rule dari backend ke config + cache lokal', async () => {
    h.response = { ok: true, data: [backendRule()] }

    const ok = await syncGeofenceConfig()

    expect(ok).toBe(true)
    expect(h.paths).toEqual(['/geofences'])
    expect(currentConfig().rules).toHaveLength(1)
    expect(currentConfig().rules[0].locationName).toBe('Badau Dermaga 1')
    // Tersimpan ke localStorage → layar rute tetap terkunci saat app dibuka ulang
    expect(loadCachedGeofenceConfig().rules).toHaveLength(1)
  })

  it('server kosong → cache lokal dipertahankan (tidak di-reset ke default)', async () => {
    applyGeofenceConfig({ ...DEFAULT_GEOFENCE_CONFIG, rules: [RULE] })
    h.response = { ok: true, data: [] }

    const ok = await syncGeofenceConfig()

    expect(ok).toBe(true)
    expect(currentConfig().rules).toHaveLength(1)
    expect(loadCachedGeofenceConfig().rules).toHaveLength(1)
  })

  it('gagal (401/500) → false dan config tidak berubah', async () => {
    applyGeofenceConfig({ ...DEFAULT_GEOFENCE_CONFIG, rules: [RULE] })
    h.response = { ok: false, error: { code: '401' } }

    expect(await syncGeofenceConfig()).toBe(false)
    expect(currentConfig().rules).toHaveLength(1)
  })

  it('menolak baris dengan tipe koordinat salah (isGeofenceRuleShape)', async () => {
    h.response = { ok: true, data: [backendRule({ latitude: '-6.1891005' as unknown as number }), backendRule()] }

    expect(await syncGeofenceConfig()).toBe(true)
    expect(currentConfig().rules).toHaveLength(1)
    expect(typeof currentConfig().rules[0].latitude).toBe('number')
  })
})

describe('rule → kunci rute (dipakai RouteSelectScreen)', () => {
  it('di dalam radius → rule aktif; di luar → null', () => {
    const config = { ...DEFAULT_GEOFENCE_CONFIG, rules: [RULE] }
    expect(findActiveGeofenceRule(-6.1891005, 106.8371641, config, 8)?.id).toBe('geo-1')
    expect(findActiveGeofenceRule(-6.25, 106.9, config, 8)).toBeNull()
  })

  it('satu rute diizinkan → hard-lock ke kode itu; tanpa rule → tanpa lock', () => {
    expect(getHardLockedRoute(RULE)).toBe('SJRE-SBDZ')
    expect(getHardLockedRoute(null)).toBeNull()
    const multi = { ...RULE, allowedRouteCodes: ['A-B', 'C-D'] }
    expect(getHardLockedRoute(multi)).toBeNull()
  })

  it('validasi arah: diizinkan bila kode ATAU arah cocok', () => {
    expect(validateRouteAgainstGeofence('SJRE-SBDZ', 'SBDZ-SJRE', RULE).allowed).toBe(true)
    expect(validateRouteAgainstGeofence('LAIN-XYZ', 'LAIN-XYZ', RULE).allowed).toBe(false)
    expect(validateRouteAgainstGeofence('LAIN-XYZ', 'LAIN-XYZ', null).allowed).toBe(true)
  })
})
