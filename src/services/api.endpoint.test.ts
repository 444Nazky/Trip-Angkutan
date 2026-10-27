import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  api,
  applyEndpointInput,
  apiBaseCandidates,
  apiBaseCandidateLabel,
  defaultApiBaseUrl,
  intranetApiBaseUrl,
  isIntranetBaseUrl,
  isLoopbackUrl,
  isMixedContentBlocked,
  isNativeApp,
  isPrivateHostUrl,
  normalizeApiBaseInput,
  normalizeBaseUrl,
  pingBaseUrl,
  probeServerHealth,
  resolveApiBaseUrl,
  setApiBaseUrlOverride,
  validateEndpointInput,
} from './api'
import { otaAssetsBase } from './ota'
import { environment } from '../environments/environment'

// `native` = apakah aplikasi dianggap berjalan di WebView native (Capacitor).
// Di native, halaman dimuat dari origin lokal https://localhost sehingga
// aturan mixed content browser TIDAK berlaku untuk request http:// ke LAN.
const h = vi.hoisted(() => ({ native: false }))
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => h.native,
    getPlatform: () => (h.native ? 'android' : 'web'),
  },
}))

const OVERRIDE_KEY = 'trip.api.baseUrl'

describe('endpoint intranet tunggal', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('hanya menawarkan kandidat endpoint intranet (tanpa cloud)', () => {
    const urls = apiBaseCandidates().map(c => c.url)
    expect(urls).toEqual([intranetApiBaseUrl()])
    expect(urls.some(u => u.includes('supabase'))).toBe(false)
  })

  it('default tanpa override adalah server intranet port 3000', () => {
    expect(resolveApiBaseUrl()).toBe(intranetApiBaseUrl())
    expect(isIntranetBaseUrl(resolveApiBaseUrl())).toBe(true)
  })

  it('override intranet dipakai dan di-normalisasi ke /api', () => {
    setApiBaseUrlOverride('http://192.168.1.123:3000')
    expect(resolveApiBaseUrl()).toBe('http://192.168.1.123:3000/api')
    expect(isIntranetBaseUrl(resolveApiBaseUrl())).toBe(true)
  })

  it('reset mengembalikan ke endpoint default intranet', () => {
    setApiBaseUrlOverride('http://192.168.1.124:3000/api')
    setApiBaseUrlOverride(null)
    expect(localStorage.getItem(OVERRIDE_KEY)).toBeNull()
    expect(resolveApiBaseUrl()).toBe(intranetApiBaseUrl())
  })

  it('host privat tanpa skema dinormalisasi ke http, bukan https', () => {
    expect(normalizeBaseUrl('192.168.1.123:3000')).toBe('http://192.168.1.123:3000/api')
    expect(normalizeApiBaseInput('192.168.1.123:3000')).toBe('http://192.168.1.123:3000/api')
  })

  it('host publik tetap dipaksa https', () => {
    expect(normalizeBaseUrl('contoh.example.com')).toBe('https://contoh.example.com/api')
  })

  it('membedakan host LAN dan host publik', () => {
    expect(isIntranetBaseUrl('http://192.168.1.123:3000/api')).toBe(true)
    expect(isIntranetBaseUrl('https://contoh.example.com/api')).toBe(false)
    expect(isPrivateHostUrl('http://192.168.1.123:3000/api')).toBe(true)
    expect(isPrivateHostUrl('https://contoh.example.com/api')).toBe(false)
  })

  it('label kandidat intranet menyebut jaringan lokal', () => {
    expect(apiBaseCandidateLabel('http://192.168.1.123:3000/api')).toContain('Intranet')
    expect(apiBaseCandidateLabel('https://contoh.example.com/api')).toBe('contoh.example.com')
  })

  it('api.baseUrl live: ganti endpoint langsung berlaku tanpa reload', () => {
    setApiBaseUrlOverride('http://192.168.1.123:3000/api')
    expect(api.baseUrl).toBe('http://192.168.1.123:3000/api')
    expect(api.url).toBe('http://192.168.1.123:3000/api')
  })

  it('bundel OTA diambil dari server intranet yang sedang aktif', () => {
    // Bundel disajikan server yang sama dengan API (/files/ota), jadi origin
    // aset harus mengikuti base URL aktif.
    setApiBaseUrlOverride('http://192.168.1.123:3000/api')
    expect(otaAssetsBase()).toBe('http://192.168.1.123:3000/files/ota/')
  })
})

describe('split-brain endpoint: mobile app & dashboard admin wajib server sama', () => {
  it('apiBaseUrl dan intranetApiBaseUrl menunjuk server yang sama', () => {
    // Dua slot ini dibaca kode yang berbeda (mobile & dashboard), jadi kalau
    // satu menunjuk cloud dan satu intranet, aplikasi mobile menulis ke
    // database yang TIDAK dibaca dashboard admin. Gejalanya: "berhasil
    // terkirim" di aplikasi, trip tidak pernah muncul di dashboard.
    expect(environment.apiBaseUrl).toBe(environment.intranetApiBaseUrl)
  })

  it('tidak ada endpoint cloud di environment', () => {
    expect(environment.apiBaseUrl).not.toMatch(/supabase\.co/i)
    expect(environment.intranetApiBaseUrl).not.toMatch(/supabase\.co/i)
  })

  it('default aplikasi menunjuk server kantor (host privat)', () => {
    expect(isIntranetBaseUrl(environment.apiBaseUrl)).toBe(true)
    expect(isIntranetBaseUrl(defaultApiBaseUrl())).toBe(true)
  })
})

describe('normalisasi http/https hanya punya satu aturan', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('host publik tanpa skema tidak lagi menjadi http', () => {
    // Regresi: dulu normalizeApiBaseInput() selalu menambah http:// saat skema
    // tidak diketik, sehingga host publik tersimpan sebagai http dan mati
    // sebagai mixed content di halaman https.
    expect(normalizeApiBaseInput('contoh.example.com')).toBe('https://contoh.example.com/api')
    expect(normalizeApiBaseInput('contoh.example.com')).toBe(normalizeBaseUrl('contoh.example.com'))
  })

  it('host LAN/privat tetap boleh http tanpa skema', () => {
    expect(normalizeApiBaseInput('192.168.1.123:3000')).toBe('http://192.168.1.123:3000/api')
    expect(normalizeApiBaseInput('10.0.0.5:3000')).toBe('http://10.0.0.5:3000/api')
    expect(normalizeApiBaseInput('172.16.4.9:3000')).toBe('http://172.16.4.9:3000/api')
  })
})

describe('validateEndpointInput: aturan tunggal untuk semua layar pengaturan server', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('menormalkan host publik ke https + /api', () => {
    expect(validateEndpointInput('https://contoh.example.com', 'http:')).toEqual({
      ok: true,
      url: 'https://contoh.example.com/api',
    })
  })

  it('menolak http:// eksplisit untuk host publik', () => {
    const r = validateEndpointInput('http://contoh.example.com', 'http:')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.msg).toMatch(/https/i)
  })

  it('menolak URL kosong', () => {
    expect(validateEndpointInput('   ', 'http:').ok).toBe(false)
  })

  it('menerima intranet http dari halaman http, menolak dari halaman https (mixed content)', () => {
    expect(validateEndpointInput('http://192.168.1.123:3000', 'http:')).toEqual({
      ok: true,
      url: 'http://192.168.1.123:3000/api',
    })
    const blocked = validateEndpointInput('http://192.168.1.123:3000', 'https:')
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.msg).toMatch(/mixed content/i)
  })

  it('host publik tanpa skema dari halaman https dinormalkan ke https, bukan ditolak', () => {
    expect(validateEndpointInput('contoh.example.com', 'https:')).toEqual({
      ok: true,
      url: 'https://contoh.example.com/api',
    })
  })

  it('applyEndpointInput menyimpan URL ternormalisasi dan tidak mengubah endpoint aktif saat input ditolak', () => {
    const applied = applyEndpointInput('192.168.1.123:3000')
    expect(applied.ok).toBe(true)
    expect(resolveApiBaseUrl()).toBe('http://192.168.1.123:3000/api')
    expect(localStorage.getItem(OVERRIDE_KEY)).toBe('http://192.168.1.123:3000/api')

    const rejected = applyEndpointInput('http://contoh.example.com', 'http:')
    expect(rejected.ok).toBe(false)
    expect(resolveApiBaseUrl()).toBe('http://192.168.1.123:3000/api')
  })
})

describe('mixed content: aplikasi native boleh pakai endpoint LAN http://', () => {
  beforeEach(() => {
    localStorage.clear()
    h.native = false
  })
  afterEach(() => {
    h.native = false
    vi.unstubAllGlobals()
  })

  it('browser di halaman https tetap diblokir untuk host LAN', () => {
    expect(isMixedContentBlocked('http://192.168.1.123:3000/api', 'https:')).toBe(true)
    expect(isMixedContentBlocked('http://192.168.1.123:3000/api', 'http:')).toBe(false)
  })

  it('aplikasi native (WebView) TIDAK diblokir walau protokol halaman https', () => {
    h.native = true
    expect(isNativeApp()).toBe(true)
    expect(isMixedContentBlocked('http://192.168.1.123:3000/api', 'https:')).toBe(false)
  })

  it('loopback exempt dari mixed content (origin loopback dianggap trustworthy)', () => {
    expect(isLoopbackUrl('http://localhost:3000/api')).toBe(true)
    expect(isLoopbackUrl('http://127.0.0.1:3000/api')).toBe(true)
    expect(isLoopbackUrl('http://192.168.1.123:3000/api')).toBe(false)
    expect(isMixedContentBlocked('http://localhost:3000/api', 'https:')).toBe(false)
  })

  it('endpoint https tidak pernah dianggap mixed content', () => {
    expect(isMixedContentBlocked('https://192.168.1.123:3000/api', 'https:')).toBe(false)
    expect(isMixedContentBlocked('https://contoh.example.com/api', 'https:')).toBe(false)
  })

  it('validateEndpointInput menerima endpoint LAN http:// di aplikasi native', () => {
    h.native = true
    const res = validateEndpointInput('http://192.168.1.123:3000', 'https:')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.url).toBe('http://192.168.1.123:3000/api')
  })

  it('pingBaseUrl di aplikasi native tidak menandai mixed content', async () => {
    h.native = true
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))

    const r = await pingBaseUrl('http://192.168.1.123:3000/api')
    expect(r.mixedContent).toBeUndefined()
    expect(r.ok).toBe(true)
  })

  it('pingBaseUrl di browser https menandai mixed content tanpa memanggil server', async () => {
    h.native = false
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const r = await pingBaseUrl('http://192.168.1.123:3000/api', 5000, 'https:')
    expect(r.mixedContent).toBe(true)
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('probeServerHealth: membedakan host mati dari CORS', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('host hidup tetapi CORS memblokir → hostAlive true, blockedByCors true', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      init?.mode === 'no-cors'
        ? Promise.resolve(new Response(null, { status: 200 }))
        : Promise.reject(new TypeError('Failed to fetch')),
    )
    vi.stubGlobal('fetch', fetchMock)

    const r = await probeServerHealth('http://192.168.1.123:3000/api')

    expect(r.reachable).toBe(false)
    expect(r.hostAlive).toBe(true)
    expect(r.blockedByCors).toBe(true)
    // Probe opaque dijalankan sekali sebagai pembeda.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ mode: 'no-cors' })
  })

  it('host benar-benar mati → hostAlive false dan tanpa blockedByCors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const r = await probeServerHealth('http://192.168.1.123:3000/api')

    expect(r.reachable).toBe(false)
    expect(r.hostAlive).toBe(false)
    expect(r.blockedByCors).toBeUndefined()
  })

  it('timeout tidak menambah request kedua', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)

    const r = await probeServerHealth('http://192.168.1.123:3000/api', 50)

    expect(r.timedOut).toBe(true)
    expect(r.hostAlive).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('server menjawab HTTP 500 tetap counted sebagai host hidup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))

    const r = await probeServerHealth('http://192.168.1.123:3000/api')

    expect(r.reachable).toBe(true)
    expect(r.hostAlive).toBe(true)
    expect(r.status).toBe(500)
  })

  it('pingBaseUrl menganggap host CORS-blocked sebagai ok (dipakai dashboard admin)', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      init?.mode === 'no-cors'
        ? Promise.resolve(new Response(null, { status: 200 }))
        : Promise.reject(new TypeError('Failed to fetch')),
    ))

    const r = await pingBaseUrl('http://192.168.1.123:3000/api')

    expect(r.ok).toBe(true)
    expect(r.blockedByCors).toBe(true)
    expect(r.hostAlive).toBe(true)
  })
})
