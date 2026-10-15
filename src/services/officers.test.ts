/**
 * Tes fallback sinkronisasi petugas — dulu "Sesi petugas tidak valid" DILEMPAR
 * tiap kali token kosong/kedaluwarsa sehingga console penuh error dan siklus
 * offline-online ikut gagal. Sekarang: sesi mati atau jaringan putus = fallback
 * senyap ke data lokal, token usang dibersihkan supaya tidak nembak server terus.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  authed: false,
  ensure: false,
  response: { ok: true, data: [] as unknown[] } as { ok: boolean; data?: unknown; error?: { code?: string; message?: string } },
  tokens: [] as (string | null)[],
  calls: 0,
  saved: [] as { id: string }[][],
  pins: new Map<string, string>(),
}))

vi.mock('./api', () => ({
  api: {
    get isAuthenticated() { return h.authed },
    setToken(token: string | null) { h.authed = !!token; h.tokens.push(token) },
    async get() { h.calls += 1; return h.response },
  },
}))

vi.mock('./auth', () => ({
  ensureBackendSession: async () => h.ensure,
}))

vi.mock('./offlineDb', () => ({
  getPinHash: async (id: string) => h.pins.get(String(id)) ?? null,
  setPinHash: async (id: string, hash: string) => { h.pins.set(String(id), hash) },
  saveOfficers: async (rows: { id: string }[]) => { h.saved.push(rows) },
  listOfficers: async () => h.saved.flat(),
}))

vi.mock('./seedData', () => ({ seedRoster: () => [] }))

import { syncOfficersToLocal } from './officers'

const CACHE_KEY = 'trip.officers.cache.v1'

const BACKEND_ROW = {
  id: 'off-1',
  name: 'Petugas Satu',
  username: 'petugas1',
  region_id: 'reg-1',
  regions: [{ id: 'reg-1', name: 'Region Satu', code: 'R1' }],
  dermagas: [{ id: 'dm-1', name: 'Badau Dermaga 1', code: 'BAU1', region_id: 'reg-1' }],
  is_active: 1,
  pin_hash: '$2a$10$abcdefghijklmnopqrstuv',
}

function seedCache(rows: unknown[]): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ officers: rows, timestamp: Date.now() }))
}

beforeEach(() => {
  localStorage.clear()
  h.authed = false
  h.ensure = false
  h.response = { ok: true, data: [] }
  h.tokens.length = 0
  h.calls = 0
  h.saved.length = 0
  h.pins.clear()
})

describe('sesi petugas tidak valid', () => {
  it('tanpa token → fallback lokal, tanpa lempar error & tanpa request', async () => {
    const roster = await syncOfficersToLocal(true)
    expect(roster).toEqual([])
    expect(h.calls).toBe(0)
  })

  it('token usang dibersihkan supaya tidak nembak server terus', async () => {
    h.authed = true
    h.ensure = false

    expect(await syncOfficersToLocal(true)).toEqual([])
    expect(h.tokens).toEqual([null])
    expect(h.authed).toBe(false)
    expect(h.calls).toBe(0)
  })

  it('server balas 401 → token dibersihkan + pakai cache lokal', async () => {
    h.authed = true
    h.ensure = true
    h.response = { ok: false, error: { code: '401', message: 'Sesi habis. Login ulang.' } }
    seedCache([BACKEND_ROW])

    const roster = await syncOfficersToLocal(true)

    expect(h.tokens).toEqual([null])
    expect(roster.map(o => o.id)).toEqual(['off-1'])
    expect(h.saved.length).toBe(1)
  })

  it('jaringan/CORS gagal → pakai cache, tidak ada error dilempar', async () => {
    h.authed = true
    h.ensure = true
    h.response = { ok: false, error: { code: 'NETWORK', message: 'Failed to fetch' } }
    seedCache([BACKEND_ROW])

    const roster = await syncOfficersToLocal(true)

    expect(roster.map(o => o.id)).toEqual(['off-1'])
    expect(h.tokens).toEqual([])
  })
})

describe('sinkronisasi normal', () => {
  it('roster dari server disimpan ke perangkat + cache', async () => {
    h.authed = true
    h.ensure = true
    h.response = { ok: true, data: [BACKEND_ROW] }

    const roster = await syncOfficersToLocal(true)

    expect(roster.map(o => o.id)).toEqual(['off-1'])
    expect(h.saved[0].map(o => o.id)).toEqual(['off-1'])
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) as string).officers).toHaveLength(1)
  })
})
