/**
 * Tes alur pembaruan TUNGGAL ("Cek & Perbarui Aplikasi").
 *
 * Aturan yang dijaga:
 *   1. Satu tombol memeriksa paket APK dari server intranet.
 *   2. Kalau ada APK baru, status "ready" dan satu tombol langsung memasang.
 *   3. Kalau APK terpasang sudah yang terbaru, tombol berhenti di
 *      "up-to-date" tanpa aksi.
 *   4. Kanal OTA (bundel modul web) sudah dihapus — tidak boleh ada lagi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'



const h = vi.hoisted(() => ({
  apkInfo: null as null | Record<string, unknown>,
  apkState: 'up-to-date' as string,
  apkError: null as null | { message: string },
  installCalls: 0,
  nativeVersion: '1.0.10',
  nativeAndroid: true,
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



// Kanal APK hanya jalan di aplikasi native Android (lihat appUpdate.ts).
vi.mock('./apkInstaller', () => ({
  isNativeAndroid: () => h.nativeAndroid,
}))

// jsdom berjalan di hostname localhost, jadi mode dev harus dimatikan supaya
// alur pemeriksaan update benar-benar dijalankan (bukan dilewati).
vi.mock('./runtimeEnv', async importOriginal => ({
  ...(await importOriginal<typeof import('./runtimeEnv')>()),
  isLocalhostDev: () => false,
}))



import { appUpdate } from './appUpdate'



beforeEach(async () => {
  h.apkInfo = null
  h.apkState = 'up-to-date'
  h.apkError = null
  h.installCalls = 0
  h.nativeVersion = '1.0.10'
  h.nativeAndroid = true
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



describe('alur pembaruan tunggal (APK penuh)', () => {
  it('paket APK baru → status ready dan satu tombol langsung memasang', async () => {
    h.apkInfo = apkRelease
    h.apkState = 'ready'

    const state = await appUpdate.check()

    expect(state.status).toBe('ready')
    expect(state.kind).toBe('apk')
    expect(state.version).toBe('1.1.0')
    expect(state.notes).toBe('Perbaikan rute')

    expect(await appUpdate.apply()).toBe(true)
    expect(h.installCalls).toBe(1)
  })

  it('APK terpasang sudah terbaru → up-to-date dan tombol tidak melakukan apa pun', async () => {
    const state = await appUpdate.check()

    expect(state.status).toBe('up-to-date')
    expect(state.kind).toBeNull()

    expect(await appUpdate.apply()).toBe(false)
    expect(h.installCalls).toBe(0)
  })

  it('kegagalan kanal APK dilaporkan apa adanya, bukan diklaim terbaru', async () => {
    h.apkInfo = apkRelease
    h.apkState = 'error'
    h.apkError = { message: 'Gagal mengunduh setelah 3 percobaan' }

    const state = await appUpdate.check()

    expect(state.status).toBe('error')
    expect(state.error).toBe('Gagal mengunduh setelah 3 percobaan')
  })

  it('di browser kanal APK dilewati → up-to-date tanpa unduhan sia-sia', async () => {
    // Di web/mobile web berkas APK tidak bisa dipasang. Tidak ada kanal
    // pengganti lagi, jadi hasilnya "sudah versi terbaru".
    h.nativeAndroid = false
    h.apkInfo = apkRelease
    h.apkState = 'ready'

    const state = await appUpdate.check()

    expect(state.status).toBe('up-to-date')
    expect(h.installCalls).toBe(0)
  })

  it('pemeriksaan beruntun tidak dijalankan dobel', async () => {
    h.apkInfo = apkRelease
    h.apkState = 'ready'

    const [first, second] = await Promise.all([appUpdate.check(), appUpdate.check()])

    expect(first).toBe(second)
    expect(first.status).toBe('ready')
  })

  it('tidak ada lagi kanal modul web (OTA)', () => {
    // Kanal OTA dihapus: tidak ada status 'module' yang bisa muncul.
    expect(appUpdate.state.kind).not.toBe('module')
  })
})
