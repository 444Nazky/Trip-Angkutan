
import { beforeAll, describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import { getPinHash, hashPin, initOfflineDb, saveOfficers, setPinHash, verifyPin, } from './offlineDb'
import { getStoredOfficer, loginOffline, verifyPinOffline } from './auth'
import { seedRoster, verifySeedPin } from './seedData'
import { tryOfflineLogin } from '../pages/LoginPage'



const PIN_A = '987654'



const PIN_B = '555555'



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
  await initOfflineDb()
})



describe('enkripsi hash PIN', () => {
  it('deterministik, ber-salt per petugas, dan tidak pernah menyimpan PIN polos', async () => {
    const h1 = await hashPin('petugas-a', PIN_A)
    const h2 = await hashPin('petugas-a', PIN_A)
    const h3 = await hashPin('petugas-b', PIN_A)

    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)
    expect(h1.startsWith('sha256:')).toBe(true)
    expect(h1).not.toContain(PIN_A)
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
    await setPinHash(legacyId, `plain:${PIN_A}`)
    expect(await verifyPin(legacyId, PIN_A)).toBe(true)
  })
})



describe('seed data bawaan', () => {
  it('tidak ada roster seed sama sekali (tidak ada data palsu di perangkat)', async () => {
    // SECURITY + KEBENARAN DATA: roster seed (nama petugas contoh, region yang sudah dihapus dari database) sudah dihapus.
    expect(seedRoster()).toEqual([])
    const hash = await getPinHash('apapun')
    expect(hash).toBeNull()
  })

  it('verifySeedPin selalu false (seed credentials tidak tersedia)', () => {
    // SECURITY: verifySeedPin selalu return false karena PIN hash dihapus Offline login memerlukan credentials yang sudah disinkronkan dari server
    expect(verifySeedPin('petugas-tidak-ada', '999999')).toBe(false)
    expect(verifySeedPin('petugas-tidak-ada', '')).toBe(false)
    expect(verifySeedPin('petugas-tidak-ada', '123456')).toBe(false)
  })
})



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



describe('loginOffline (ganti petugas offline)', () => {
  it('dua petugas bisa bergantian masuk dengan PIN masing-masing', async () => {
    await seedTestOfficer({ id: 'off-uji-b', username: 'uji-b', name: 'Petugas Uji B', pin: PIN_B })

    const a = await loginOffline('uji-a', PIN_A)
    expect(a.success).toBe(true)
    expect(getStoredOfficer()?.id).toBe('off-uji-a')

    const b = await loginOffline('uji-b', PIN_B)
    expect(b.success).toBe(true)
    expect(getStoredOfficer()?.id).toBe('off-uji-b')

    expect((await loginOffline('uji-b', PIN_A)).success).toBe(false)
    expect((await loginOffline('uji-a', PIN_B)).success).toBe(false)
    expect(getStoredOfficer()?.id).toBe('off-uji-b')
  })
})
