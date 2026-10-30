/**
 * Tes untuk `isLocalhostDev()` — penjaga alur pembaruan.
 *
 * Bug yang dijaga (2026-10-29): aplikasi NATIVE dimuat dari origin lokal
 * `https://localhost`. Dulu origin itu dianggap "mode dev", sehingga seluruh
 * alur pembaruan mati di perangkat: tombol "Cek Update" di halaman Profil
 * selalu dijawab "Sudah Terbaru" tanpa pernah menghubungi server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cap = vi.hoisted(() => ({ native: false }))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => cap.native,
    getPlatform: () => (cap.native ? 'android' : 'web'),
  },
}))

const { isLocalhostDev, isLocalhost } = await import('./runtimeEnv')

describe('isLocalhostDev', () => {
  beforeEach(() => {
    cap.native = false
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('false di aplikasi native meski hostname-nya localhost', () => {
    // jsdom memuat halaman dari http://localhost:3000 -> hostname "localhost"
    cap.native = true
    expect(isLocalhostDev()).toBe(false)
    expect(isLocalhost()).toBe(false)
  })

  it('true di browser localhost (mode dev)', () => {
    cap.native = false
    expect(isLocalhostDev()).toBe(true)
  })

  it('hanya Disparuh saat native - guard update tidak mematikan di perangkat', () => {
    // Regresi: ini yang membuat tombol "Cek Update" tidak berefek di HP.
    cap.native = true
    expect(window.location.hostname).toBe('localhost')
    expect(isLocalhostDev()).toBe(false)
  })

  it('false di mobile web produksi yang disajikan di port 5173', () => {
    // Regresi (2026-10-30): di deployment kantor, mobile web PRODUKSI
    // disajikan nginx DI PORT 5173 (lihat nginx.conf). Dulu port dev ikut
    // dianggap "dev" -> tombol "Cek Update" selalu dijawab "Sudah Terbaru"
    // tanpa pernah menghubungi server update.
    vi.stubEnv('DEV', false)
    vi.stubGlobal('location', { hostname: '192.168.1.123', port: '5173' })
    cap.native = false
    expect(isLocalhostDev()).toBe(false)
  })
})
