import { describe, it, expect } from 'vitest'
import { partitionRoutes, pickAutoRouteCode, routeAllowed } from './routeAvailability'
import type { UiRoute } from './auth'

const route = (code: string, from: string, to: string): UiRoute => ({
  code,
  from,
  to,
  label: `${from} - ${to}`,
})

const SJRE = route('SJRE-SBDZ', 'SJRE', 'SBDZ')
const SBDZ = route('SBDZ-SJRE', 'SBDZ', 'SJRE')
const OTHER = route('SJRE-TJPN', 'SJRE', 'TJPN')
const ALL = [OTHER, SJRE, SBDZ]

describe('routeAllowed', () => {
  it('menganggap panah, spasi, dan huruf kecil sebagai rute yang sama', () => {
    expect(routeAllowed('SBDZ-SJRE', ['sbdz→sjre'])).toBe(true)
    expect(routeAllowed('sbdz - sjre', ['SBDZ-SJRE'])).toBe(true)
  })

  it('tanpa daftar izin, semua rute dianggap tidak diizinkan', () => {
    expect(routeAllowed('SBDZ-SJRE', [])).toBe(false)
    expect(routeAllowed('SBDZ-SJRE', null)).toBe(false)
  })
})

describe('partitionRoutes', () => {
  it('menaruh rute yang diizinkan di depan dan sisanya sebagai terkunci', () => {
    const { available, locked } = partitionRoutes(ALL, ['SBDZ-SJRE'])
    expect(available.map(r => r.code)).toEqual(['SBDZ-SJRE'])
    expect(locked.map(r => r.code)).toEqual(['SJRE-TJPN', 'SJRE-SBDZ'])
  })

  it('tanpa geofence aktif semua rute terkunci, urutan asli tetap', () => {
    const { available, locked } = partitionRoutes(ALL, [])
    expect(available).toEqual([])
    expect(locked.map(r => r.code)).toEqual(['SJRE-TJPN', 'SJRE-SBDZ', 'SBDZ-SJRE'])
  })
})

describe('pickAutoRouteCode', () => {
  it('memilih rute pertama yang diizinkan saat belum ada pilihan', () => {
    expect(pickAutoRouteCode({ routes: ALL, allowedRoutes: ['SBDZ→SJRE'] })).toBe('SBDZ-SJRE')
  })

  it('tidak menimpa pilihan petugas yang masih diizinkan', () => {
    expect(
      pickAutoRouteCode({ routes: ALL, allowedRoutes: ['SBDZ-SJRE', 'SJRE-SBDZ'], currentCode: 'SJRE-SBDZ' }),
    ).toBe('SJRE-SBDZ')
  })

  it('mengganti pilihan yang terkunci dengan rute yang tersedia', () => {
    expect(
      pickAutoRouteCode({ routes: ALL, allowedRoutes: ['SBDZ-SJRE'], currentCode: 'SJRE-TJPN' }),
    ).toBe('SBDZ-SJRE')
  })

  it('tidak memilih apa pun kalau tidak ada rute yang diizinkan', () => {
    expect(pickAutoRouteCode({ routes: ALL, allowedRoutes: [] })).toBeNull()
  })

  it('mengabaikan izin yang rutenya tidak ada di perangkat', () => {
    expect(pickAutoRouteCode({ routes: [SJRE], allowedRoutes: ['SBDZ-SJRE'] })).toBeNull()
  })
})
