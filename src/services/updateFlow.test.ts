/**
 * Tes alur pembaruan APK (fix issue #2).
 *
 * Akar masalah yang dijaga di sini:
 *   1. Server pernah mengiklankan versi tanpa berkas → unduhan 404, tetapi klien
 *      tetap menandai versi itu sebagai "terpasang". Sekarang versi resmi HANYA
 *      berubah bila App.getInfo() benar-benar menunjukkan versi baru.
 *   2. APK yang rusak/tidak lengkap (mis. respons error 404 JSON) harus ditolak,
 *      bukan diserahkan ke installer lalu diklaim "berhasil".
 *   3. Hash SHA-256 dari server (kalau ada) wajib dicocokkan sebelum ditawarkan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'



// jsdom tidak menyediakan SubtleCrypto (dipakai verifikasi SHA-256 APK). Ambil
// implementasi Node tanpa import statis supaya tsconfig non-Node tetap bersih.
const nodeSpecifier = ['node', 'crypto'].join(':')
async function ensureSubtleCrypto(): Promise<void> {
  if (globalThis.crypto?.subtle) return
  const mod = await import(/* @vite-ignore */ nodeSpecifier) as { webcrypto: Crypto }
  Object.defineProperty(globalThis, 'crypto', { value: mod.webcrypto, configurable: true })
}



/** base64 dari byte (jsdom tak punya Buffer). */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(binary)
}



const h = vi.hoisted(() => ({
  native: true,
  version: '1.0.8',
  bytes: new Uint8Array(0) as Uint8Array,
  statSize: 0,
  /** Installer Cordova (file-opener2) tersedia di APK; di jsdom harus dipasang manual. */
  installer: true,
  opened: [] as string[],
  httpCalls: [] as { url: string; data?: unknown }[],
  deleted: [] as string[],
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => h.native,
    getPlatform: () => 'android',
  },
  CapacitorHttp: {
    request: async (opts: { url: string; method?: string; data?: unknown }) => {
      h.httpCalls.push({ url: opts.url, data: opts.data })
      return { status: 200, data: {} }
    },
    get: async (opts: { url: string }) => {
      h.httpCalls.push({ url: opts.url })
      return { status: 200, data: {} }
    },
  },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Cache: 'CACHE' },
  Filesystem: {
    async mkdir() { return {} },
    async readdir() { return { files: [] } },
    async downloadFile({ path }: { path: string }) { return { path: `file:///data/${path}` } },
    async readFile() { return { data: toBase64(h.bytes) } },
    async stat() { return { size: h.statSize } },
    async deleteFile({ path }: { path: string }) { h.deleted.push(path) },
    async getUri({ path }: { path: string }) { return { uri: `content://fileprovider/data/${path}` } },
    async rmdir() { return {} },
  },
}))

vi.mock('@capacitor/app', () => ({
  App: {
    async getInfo() { return { version: h.version } },
    async addListener() { return { remove: () => {} } },
  },
}))

vi.mock('@capacitor/device', () => ({
  Device: { async getId() { return { identifier: 'test-device' } } },
}))

import { UpdateService } from './updateService'



beforeEach(async () => {
  await ensureSubtleCrypto()
  h.native = true
  h.version = '1.0.8'
  h.bytes = new Uint8Array(0)
  h.statSize = 0
  h.installer = true
  h.opened.length = 0
  h.httpCalls.length = 0
  h.deleted.length = 0
  localStorage.clear()

  // Simulasi shell Capacitor: cordova + plugin file-opener2 (seperti di APK).
  const w = window as unknown as { cordova?: unknown }
  w.cordova = {
    plugins: {
      fileOpener2: h.installer
        ? {
            open(path: string, _mime: string, opts: { success: () => void }) {
              h.opened.push(path)
              opts.success()
            },
          }
        : undefined,
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})



async function makeService(): Promise<UpdateService> {
  const svc = new UpdateService()
  await svc.refreshInstalledVersion()
  return svc
}



// APK uji harus punya ukuran wajar (>1 MB) supaya lewat guard "berkas cacat".
function apkBytes(): Uint8Array {
  const bytes = new Uint8Array(1_200_000)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
  return bytes
}



async function sha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto.subtle
  const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}



describe('unduh APK: hash & versi yang jujur', () => {
  it('hash tidak cocok → ditolak, berkas dibuang, versi TIDAK berubah', async () => {
    h.bytes = new Uint8Array([1, 2, 3, 4, 5])
    h.statSize = h.bytes.length
    const svc = await makeService()

    const ok = await svc.downloadUpdate('1.0.9', '/api/v1/app-download/1.0.9', 'deadbeef')

    expect(ok).toBe(false)
    expect(svc.state).toBe('error')
    expect(svc.error?.code).toBe('HASH_MISMATCH')
    expect(svc.currentVersion).toBe('1.0.8')
    expect(h.deleted.some(p => p.includes('updates/'))).toBe(true)
  })

  it('hash cocok → siap dipasang, tetapi versi aplikasi TETAP versi lama', async () => {
    h.bytes = new Uint8Array([9, 8, 7, 6, 5, 4])
    h.statSize = h.bytes.length
    const expected = await sha256(h.bytes)
    const svc = await makeService()

    const ok = await svc.downloadUpdate('1.0.9', '/api/v1/app-download/1.0.9', expected)

    expect(ok).toBe(true)
    // `ready` = berkas siap; BUKAN berarti sudah terpasang.
    expect(svc.state).toBe('ready')
    expect(svc.pendingVersion).toBe('1.0.9')
    expect(svc.currentVersion).toBe('1.0.8')
    expect(localStorage.getItem('trip.update.currentVersion')).toBe('1.0.8')
  })

  it('server tanpa hash → unduhan diterima (integritas tak dapat diverifikasi)', async () => {
    h.bytes = new Uint8Array([1, 2, 3])
    h.statSize = h.bytes.length
    const svc = await makeService()

    const ok = await svc.downloadUpdate('1.0.9', '/api/v1/app-download/1.0.9', null)

    expect(ok).toBe(true)
    expect(svc.state).toBe('ready')
  })
})



describe('pasang APK: jangan klaim berhasil kalau tidak jadi terpasang', () => {
  it('berkas tidak wajar (respons error kecil) → gagal dengan pesan jelas', async () => {
    h.bytes = new Uint8Array([1, 2, 3])
    h.statSize = 500 // mis. body JSON 404 yang tersimpan sebagai "APK"
    const svc = await makeService()
    await svc.downloadUpdate('1.0.9', '/api/v1/app-download/1.0.9', null)

    const ok = await svc.installUpdate()

    expect(ok).toBe(false)
    expect(svc.state).toBe('error')
    expect(svc.error?.code).toBe('DOWNLOAD_FAILED')
    expect(svc.currentVersion).toBe('1.0.8')
  })

  it('versi native naik setelah pemasangan → pending dibersihkan, versi dilaporkan ke server', async () => {
    const svc = await makeService()
    h.bytes = new Uint8Array([1, 2, 3])
    h.statSize = h.bytes.length
    await svc.downloadUpdate('1.0.9', '/api/v1/app-download/1.0.9', null)

    // Pengguna menyelesaikan pemasangan → App.getInfo() mengembalikan versi baru.
    h.version = '1.0.9'
    const version = await svc.refreshInstalledVersion()

    expect(version).toBe('1.0.9')
    expect(svc.currentVersion).toBe('1.0.9')
    expect(svc.pendingVersion).toBeNull()
    expect(svc.state).toBe('up-to-date')
    const reported = h.httpCalls.filter(c => c.url.includes('/report-version'))
    expect(reported.some(c => (c.data as { version?: string })?.version === '1.0.9')).toBe(true)
  })

  it('installer Android tanpa plugin → gagal jelas (bukan klaim berhasil)', async () => {
    h.installer = false
    // Shell tanpa plugin Cordova file-opener2 (cordova.js tidak ter-inject).
    ;(window as unknown as { cordova: { plugins: { fileOpener2?: unknown } } }).cordova.plugins.fileOpener2 = undefined
    const svc = await makeService()
    h.bytes = apkBytes()
    h.statSize = h.bytes.length
    await svc.downloadUpdate('1.0.9', '/api/v1/app-download/1.0.9', null)

    const ok = await svc.installUpdate()

    expect(ok).toBe(false)
    expect(svc.state).toBe('error')
    expect(svc.error?.code).toBe('INSTALL_FAILED')
    expect(svc.currentVersion).toBe('1.0.8')
  })

  it('versi native belum berubah setelah installer dibuka → status kembali "siap", bukan sukses', async () => {
    const svc = await makeService()
    h.bytes = apkBytes()
    h.statSize = h.bytes.length
    await svc.downloadUpdate('1.0.9', '/api/v1/app-download/1.0.9', null)
    const started = await svc.installUpdate()
    expect(started).toBe(true)
    expect(h.opened).toHaveLength(1)
    expect(svc.state).toBe('installing')

    // Belum benar-benar terpasang (pengguna membatalkan dialog pemasangan).
    const version = await svc.refreshInstalledVersion()

    expect(version).toBe('1.0.8')
    expect(svc.currentVersion).toBe('1.0.8')
    expect(svc.state).toBe('ready')
    expect(svc.error?.message).toMatch(/belum selesai/i)
  })
})
