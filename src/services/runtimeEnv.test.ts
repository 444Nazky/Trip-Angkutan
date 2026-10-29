// Tes untuk `isLocalhostDev()` — penjaga alur pembaruan. Bug yang dijaga (2026-10-29): aplikasi NATIVE dimuat dari origin lokal `https://localhost`.
import { beforeEach, describe, expect, it, vi } from 'vitest'



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

  it('false di aplikasi native meski hostname-nya localhost', () => {
    cap.native = true
    expect(isLocalhostDev()).toBe(false)
    expect(isLocalhost()).toBe(false)
  })

  it('true di browser localhost (mode dev)', () => {
    cap.native = false
    expect(isLocalhostDev()).toBe(true)
  })

  it('hanya Disparuh saat native - guard update tidak mematikan di perangkat', () => {
    cap.native = true
    expect(window.location.hostname).toBe('localhost')
    expect(isLocalhostDev()).toBe(false)
  })
})
