/**
 * Regresi keluhan lapangan (SESI geofence):
 *
 *   1. “geofence.ts: Sync: not authenticated, trying to renew session” →
 *      “session renewal failed”. Dulu renew MUSTAHIL karena hanya dipanggil saat
 *      token kosong sementara ensureBackendSession mensyaratkan token valid.
 *      Sekarang ada jalur “login diam-diam” dari kredensial lokal.
 *   2. Login ulang petugas yang SAMA tidak boleh menghapus cache geofence —
 *      dulu purge di tiap login + sync yang gagal = perangkat kosong permanen.
 *   3. Login offline tidak boleh menghapus token/dermaga petugas yang sama.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  token: null as string | null,
  posts: [] as Array<{ path: string; body: unknown }>,
  respond: {} as Record<string, { ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>,
  purgeCalls: 0,
}))

vi.mock('./api', () => ({
  api: {
    get isAuthenticated() { return !!h.token },
    get token() { return h.token },
    setToken(t: string | null) { h.token = t },
    baseUrl: 'http://test/api',
    async post(path: string, body?: unknown) {
      h.posts.push({ path, body })
      return h.respond[path] ?? { ok: false, error: { message: 'no mock', code: 'NETWORK' } }
    },
    async get() {
      return { ok: false, error: { message: 'no mock', code: 'NETWORK' } }
    },
  },
}))

vi.mock('./geofence', () => ({
  purgeGeofenceCache: () => { h.purgeCalls += 1 },
}))

vi.mock('./offlineDb', () => ({
  findOfficer: async () => null,
  hashPin: async (_id: string, pin: string) => `sha256:${pin}`,
  saveOfficers: async () => {},
  setPinHash: async () => {},
  verifyPin: async () => false,
}))

import { renewSessionIfNeeded, isSessionReady, loginWithPin } from './auth'

const CRED_KEY = 'trip.auth.lastCredential.v1'
const OFFICER_KEY = 'trip.auth.officer.v1'
const DERMAGA_KEY = 'trip.auth.dermaga.v1'

/** Token yang bisa dibaca jwtPayload() (payload base64, officerId cocok). */
function fakeJwt(officerId: string): string {
  const payload = btoa(JSON.stringify({ officerId, role: 'officer' }))
  return `header.${payload}.signature`
}

function officer(id: string) {
  return { id, name: 'Petugas Uji', regionId: 'r-1', regionName: 'Badau', regionCode: 'BADAU' }
}

beforeEach(() => {
  localStorage.clear()
  h.token = null
  h.posts.length = 0
  h.respond = {}
  h.purgeCalls = 0
})

describe('pemulihan sesi (login diam-diam)', () => {
  it('token kosong + kredensial tersimpan → mengambil token baru tanpa minta PIN', async () => {
    localStorage.setItem(CRED_KEY, JSON.stringify({ kind: 'pin', officerId: 'o-1', pin: '123456' }))
    h.respond['/auth/login'] = { ok: true, data: { token: fakeJwt('o-1'), officer: officer('o-1') } }

    expect(await renewSessionIfNeeded()).toBe(true)
    expect(h.token).toBe(fakeJwt('o-1'))
    expect(h.posts.map(p => p.path)).toEqual(['/auth/login'])
  })

  it('tanpa kredensial tersimpan → tidak menembak jaringan, cukup gagal dengan tenang', async () => {
    expect(await renewSessionIfNeeded()).toBe(false)
    expect(h.posts).toEqual([])
    expect(h.token).toBeNull()
  })

  it('kredensial member dipakai lewat /auth/member-login', async () => {
    localStorage.setItem(CRED_KEY, JSON.stringify({ kind: 'member', username: 'dewi', password: 'rahasia' }))
    h.respond['/auth/member-login'] = { ok: true, data: { token: fakeJwt('o-9'), officer: officer('o-9') } }

    expect(await isSessionReady()).toBe(true)
    expect(h.posts.map(p => p.path)).toEqual(['/auth/member-login'])
  })

  it('server menolak kredensial tersimpan → false & tidak memasang token palsu', async () => {
    localStorage.setItem(CRED_KEY, JSON.stringify({ kind: 'pin', officerId: 'o-1', pin: 'salah' }))
    h.respond['/auth/login'] = { ok: false, error: { code: '401', message: 'PIN salah' } }

    expect(await renewSessionIfNeeded()).toBe(false)
    expect(h.posts.map(p => p.path)).toEqual(['/auth/login'])
    expect(h.token).toBeNull()
  })

  it('token lama masih valid → sesi langsung siap tanpa memanggil login ulang', async () => {
    localStorage.setItem(OFFICER_KEY, JSON.stringify(officer('o-1')))
    h.token = fakeJwt('o-1')

    expect(await renewSessionIfNeeded()).toBe(true)
    expect(h.posts).toEqual([])
    expect(h.token).toBe(fakeJwt('o-1'))
  })
})

describe('cache geofence tidak dibuang saat petugas yang sama login ulang', () => {
  it('petugas sama → cache geofence DIPERTAHANKAN', async () => {
    localStorage.setItem(OFFICER_KEY, JSON.stringify(officer('o-1')))
    h.respond['/auth/login'] = { ok: true, data: { token: fakeJwt('o-1'), officer: officer('o-1'), dermagas: [{ id: 'd-1', name: 'D1', code: 'D1' }] } }

    const res = await loginWithPin('o-1', '123456')
    await new Promise(r => setTimeout(r, 0))

    expect(res.success).toBe(true)
    expect(h.purgeCalls).toBe(0)
  })

  it('petugas BEDA → cache dibersihkan (data petugas lama tidak nyangkut)', async () => {
    localStorage.setItem(OFFICER_KEY, JSON.stringify(officer('o-lama')))
    h.respond['/auth/login'] = { ok: true, data: { token: fakeJwt('o-baru'), officer: officer('o-baru') } }

    await loginWithPin('o-baru', '123456')
    await new Promise(r => setTimeout(r, 0))

    expect(h.purgeCalls).toBe(1)
  })

  it('login sukses menyimpan dermagaAccess ke sesi (filter geofence per dermaga jalan)', async () => {
    h.respond['/auth/login'] = {
      ok: true,
      data: {
        token: fakeJwt('o-1'),
        officer: officer('o-1'),
        dermagas: [{ id: 'd-1', name: 'Dermaga 1', code: 'D1' }, { id: 'd-2', name: 'Dermaga 2', code: 'D2' }],
      },
    }

    await loginWithPin('o-1', '123456')

    const stored = JSON.parse(localStorage.getItem(OFFICER_KEY) ?? '{}')
    expect(stored.dermagaAccess.map((d: { id: string }) => d.id)).toEqual(['d-1', 'd-2'])
    // dermaga tunggal otomatis aktif; dua dermaga → petugas memilih sendiri
    expect(localStorage.getItem(DERMAGA_KEY)).toBeNull()
  })
})
