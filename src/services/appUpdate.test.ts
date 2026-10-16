/**
 * Tes alur pembaruan TUNGGAL ("Cek & Perbarui Aplikasi").
 *
 * Aturan yang dijaga:
 *   1. Satu tombol memeriksa dua kanal sekaligus (modul web + APK).
 *   2. Kalau ada paket APK baru, kanal itu yang dipakai — bukan modul.
 *   3. Kalau hanya modul yang baru, modul diterapkan tanpa ganti APK.
 *   4. Kalau keduanya terbaru, tombol berhenti di "up-to-date" tanpa aksi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'



const h = vi.hoisted(() => ({
  moduleAvailable: false as boolean | string,
  moduleState: 'idle' as string,
  apkInfo: null as null | Record<string, unknown>,
  apkState: 'up-to-date' as string,
  apkError: null as null | { message: string },
  installCalls: 0,
  applyCalls: 0,
  reloadCalls: 0,
  nativeVersion: '1.0.10',
}))



vi.mock('./ota', () => ({
  getCurrentVersion: async () => '1.0.10',
  checkForUpdate: async (_local: string | null | undefined, onState?: (s: { status: string }) => void) => {
    onState?.({ status: h.moduleState })
    return h.moduleAvailable ? { available: true, version: '1.0.20' } : { available: false }
  },
  applyUpdate: async () => {
    h.applyCalls++
    return true
  },
}))



vi.mock('./updateService', () => ({
  getNativeVersion: async () => h.nativeVersion,
  isNewerVersion: (current: string, latest: string) => latest > current,
  shouldForceUpdate: (_current: string, min: string | null) => Boolean(min),
  updateService: {
    get state() { return h.apkState },
    get currentVersion() { return '1.0.10' },
    get error() { return h.apkError },
    checkForUpdate: async () => h.apkInfo,
    installUpdate: async () => {
      h.installCalls++
      return true
    },
    reset: async () => {},
    refreshInstalledVersion: async () => h.nativeVersion,
  },
}))



vi.mock('./otaReload', () => ({
  hardReloadToNewBundle: async () => {
    h.reloadCalls++
  },
}))



import { appUpdate } from './appUpdate'



beforeEach(async () => {
  h.moduleAvailable = false
  h.moduleState = 'idle'
  h.apkInfo = null
  h.apkState = 'up-to-date'
  h.apkError = null
  h.installCalls = 0
  h.applyCalls = 0
  h.reloadCalls = 0
  h.nativeVersion = '1.0.10'
  await appUpdate.reset()
})



afterEach(() => {
  vi.clearAllMocks()
})



const apkRelease = {
  latestVersion: '1.1.0',
  updateAvailable: true,
  isForceUpdate: false,
  downloadUrl: 'http://server/api/v1/app-download/1.1.0',
  releaseNotes: 'Perbaikan rute',
  apkSize: 16_000_000,
  apkHash: 'abc',
  minVersion: null,
  releaseDate: null,
}



describe('alur pembaruan tunggal', () => {
  it('paket APK baru menang atas modul, dan satu tombol langsung memasang', async () => {
    h.apkInfo = apkRelease
    h.apkState = 'ready'
    h.moduleAvailable = true
    h.moduleState = 'ready'

    const state = await appUpdate.check()

    expect(state.status).toBe('ready')
    expect(state.kind).toBe('apk')
    expect(state.version).toBe('1.1.0')
    expect(state.notes).toBe('Perbaikan rute')

    expect(await appUpdate.apply()).toBe(true)
    expect(h.installCalls).toBe(1)
    // Modul tidak boleh diterapkan saat paket APK yang dipilih.
    expect(h.applyCalls).toBe(0)
  })

  it('hanya modul yang baru → diterapkan tanpa ganti APK', async () => {
    h.moduleAvailable = true
    h.moduleState = 'ready'

    const state = await appUpdate.check()

    expect(state.status).toBe('ready')
    expect(state.kind).toBe('module')
    expect(state.version).toBe('1.0.20')

    expect(await appUpdate.apply()).toBe(true)
    expect(h.applyCalls).toBe(1)
    expect(h.reloadCalls).toBe(1)
    expect(h.installCalls).toBe(0)
  })

  it('keduanya terbaru → up-to-date dan tombol tidak melakukan apa pun', async () => {
    const state = await appUpdate.check()

    expect(state.status).toBe('up-to-date')
    expect(state.kind).toBeNull()

    expect(await appUpdate.apply()).toBe(false)
    expect(h.installCalls).toBe(0)
    expect(h.applyCalls).toBe(0)
  })

  it('kegagalan kanal APK dilaporkan apa adanya, bukan diklaim terbaru', async () => {
    h.apkInfo = apkRelease
    h.apkState = 'error'
    h.apkError = { message: 'Gagal mengunduh setelah 3 percobaan' }

    const state = await appUpdate.check()

    expect(state.status).toBe('error')
    expect(state.error).toBe('Gagal mengunduh setelah 3 percobaan')
  })

  it('tanpa koneksi → status offline, bukan error menakutkan', async () => {
    h.moduleState = 'offline'

    const state = await appUpdate.check()

    expect(state.status).toBe('offline')
  })

  it('pemeriksaan beruntun tidak dijalankan dobel', async () => {
    h.apkInfo = apkRelease
    h.apkState = 'ready'

    const [first, second] = await Promise.all([appUpdate.check(), appUpdate.check()])

    expect(first).toBe(second)
    expect(first.status).toBe('ready')
  })
})
