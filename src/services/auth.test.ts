// ─── Unit Test: Autentikasi Offline-First ─────────────────────────────────────
// Cakupan (sesuai audit cross-check modul 1.1 / 1.2 / 1.5):
//   1. Enkripsi/hash PIN  — hash deterministik, ber-salt per petugas, format
//                           bcrypt (seed/server) & sha256 (lokal) sama-sama
//                           terverifikasi; PIN polos TIDAK PERNAH tersimpan.
//   2. Seed data bawaan   — tertanam ke penyimpanan lokal saat init.
//   3. tryOfflineLogin    — login offline instan (tanpa jaringan) + multi-akun:
//                           ganti petugas tetap mulus, PIN salah / nonaktif ditolak.
//
// Jalankan: npm run test:unit

import { beforeAll, describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import {
  getPinHash,
  hashPin,
  initOfflineDb,
  saveOfficers,
  setPinHash,
  verifyPin,
} from './offlineDb'
import { getStoredOfficer, loginOffline, verifyPinOffline } from './auth'
import { SEED_OFFICERS, seedRoster, verifySeedPin } from './seedData'
import { tryOfflineLogin } from '../pages/LoginPage'

const PIN_A = '987654'
const PIN_B = '555555'

/** Simpan petugas uji (id/username/hash PIN) ke penyimpanan offline. */
async function seedTestOfficer(opts: {
  id: string
  username: string
  name: string
  pin: string
  isActive?: boolean
  status?: string
}): Promise<void> {
  const { id, username, name, pin } = opts
  await saveOfficers([{
    id,
    username,
    name,
    regionId: 'region-uji',
    regionName: 'Badau',
    regionCode: 'BADAU',
    isActive: opts.isActive ?? true,
    payload: {
      id, username, name,
      region: 'BADAU',
      regions: ['BADAU'],
      regionId: 'region-uji',
      regionName: 'Badau',
      regionCode: 'BADAU',
      status: opts.status ?? (opts.isActive === false ? 'Nonaktif' : 'Aktif'),
      dermagaAccess: [],
    },
  }])
  await setPinHash(id, await hashPin(id, pin))
}

beforeAll(async () => {
  localStorage.clear()
  // Init sekali → menanam SELURUH data bawaan (roster, hash PIN, rute)
  await initOfflineDb()
})

// ── 1. Enkripsi hash PIN ─────────────────────────────────────────────────────

describe('enkripsi hash PIN', () => {
  it('deterministik, ber-salt per petugas, dan tidak pernah menyimpan PIN polos', async () => {
    const h1 = await hashPin('petugas-a', PIN_A)
    const h2 = await hashPin('petugas-a', PIN_A)
    const h3 = await hashPin('petugas-b', PIN_A) // salt = officerId

    expect(h1).toBe(h2)                 // hash sama untuk input sama
    expect(h1).not.toBe(h3)             // beda petugas → beda hash
    expect(h1.startsWith('sha256:')).toBe(true)
    expect(h1).not.toContain(PIN_A)     // PIN polos tidak pernah muncul
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('tersimpan lalu terverifikasi (benar → true, salah → false)', async () => {
    const id = 'off-hash-check'
    const hash = await hashPin(id, PIN_A)
    await setPinHash(id, hash)

    expect(await getPinHash(id)).toBe(hash)
    expect(await verifyPin(id, PIN_A)).toBe(true)
    expect(await verifyPin(id, '000000')).toBe(false)
    expect(await verifyPin('tidak-ada', PIN_A)).toBe(false)
  })

  it('mendukung format bcrypt milik server & hash legacy (PIN polos tercatat)', async () => {
    const bcryptId = 'off-bcrypt'
    await setPinHash(bcryptId, bcrypt.hashSync(PIN_A, 4))
    expect((await getPinHash(bcryptId))?.startsWith('$2')).toBe(true)
    expect(await verifyPin(bcryptId, PIN_A)).toBe(true)
    expect(await verifyPin(bcryptId, '000000')).toBe(false)

    const legacyId = 'off-legacy'
    await setPinHash(legacyId, `plain:${PIN_A}`) // migrasi data lama
    expect(await verifyPin(legacyId, PIN_A)).toBe(true)
  })
})

// ── 2. Seed data bawaan ──────────────────────────────────────────────────────

describe('seed data bawaan', () => {
  it('tertanam ke penyimpanan lokal lengkap dengan hash bcrypt', async () => {
    for (const seed of SEED_OFFICERS) {
      const hash = await getPinHash(seed.id)
      expect(hash, `hash seed ${seed.username}`).toBeTruthy()
      expect(hash?.startsWith('$2')).toBe(true) // format identik server
    }
  })

  it('roster berisi seluruh petugas bawaan dengan status aktif/nonaktif', () => {
    const roster = seedRoster()
    expect(roster).toHaveLength(SEED_OFFICERS.length)
    for (const [officer, seed] of roster.map((r, i) => [r, SEED_OFFICERS[i]] as const)) {
      expect(officer.id).toBe(seed.id)
      expect(officer.username).toBe(seed.username)
      expect(officer.dermagaAccess.length).toBeGreaterThan(0) // scope dermaga
      expect(officer.status).toBe((seed.isActive ?? 1) === 1 ? 'Aktif' : 'Nonaktif')
    }
  })

  it('menolak PIN yang tidak cocok / identifier yang tidak dikenal', () => {
    const [pertama] = SEED_OFFICERS
    expect(verifySeedPin(pertama.id, '999999')).toBe(false)
    expect(verifySeedPin('petugas-tidak-ada', '999999')).toBe(false)
    expect(verifySeedPin(pertama.id, '')).toBe(false)
  })
})

// ── 3. tryOfflineLogin (login instan tanpa jaringan) ─────────────────────────

describe('tryOfflineLogin', () => {
  it('berhasil memakai username + PIN tersimpan, tanpa menyentuh jaringan', async () => {
    await seedTestOfficer({ id: 'off-uji-a', username: 'uji-a', name: 'Petugas Uji A', pin: PIN_A })

    expect(await tryOfflineLogin('uji-a', PIN_A)).toBe(true)
    expect(getStoredOfficer()?.id).toBe('off-uji-a')
    expect(getStoredOfficer()?.name).toBe('Petugas Uji A')
  })

  it('menolak PIN salah tanpa merusak sesi petugas yang sedang aktif', async () => {
    const sebelum = getStoredOfficer()
    expect(await tryOfflineLogin('uji-a', '000000')).toBe(false)
    expect(getStoredOfficer()?.id).toBe(sebelum?.id)
  })

  it('menolak identifier yang tidak dikenal & input kosong', async () => {
    expect(await tryOfflineLogin('petugas-tidak-ada', PIN_A)).toBe(false)
    expect(await tryOfflineLogin('', '')).toBe(false)
  })

  it('menolak petugas NONAKTIF meski PIN benar', async () => {
    await seedTestOfficer({
      id: 'off-uji-nonaktif', username: 'uji-nonaktif', name: 'Petugas Nonaktif',
      pin: PIN_A, isActive: false,
    })
    expect(await verifyPinOffline('uji-nonaktif', PIN_A)).toBe(false)
    expect(await tryOfflineLogin('uji-nonaktif', PIN_A)).toBe(false)
  })
})

// ── 4. Ganti petugas antar-dermaga saat OFFLINE ──────────────────────────────

describe('loginOffline (ganti petugas offline)', () => {
  it('dua petugas bisa bergantian masuk dengan PIN masing-masing', async () => {
    await seedTestOfficer({ id: 'off-uji-b', username: 'uji-b', name: 'Petugas Uji B', pin: PIN_B })

    const a = await loginOffline('uji-a', PIN_A)
    expect(a.success).toBe(true)
    expect(getStoredOfficer()?.id).toBe('off-uji-a')

    const b = await loginOffline('uji-b', PIN_B)
    expect(b.success).toBe(true)
    expect(getStoredOfficer()?.id).toBe('off-uji-b') // sesi berganti mulus

    // PIN petugas A tidak membuka akun B (dan sebaliknya)
    expect((await loginOffline('uji-b', PIN_A)).success).toBe(false)
    expect((await loginOffline('uji-a', PIN_B)).success).toBe(false)
    expect(getStoredOfficer()?.id).toBe('off-uji-b') // sesi tidak berubah saat gagal
  })
})
