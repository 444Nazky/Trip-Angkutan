// Tes master data offline + cek status plat tanpa server.
import { beforeEach, describe, expect, it, vi } from 'vitest'



const h = vi.hoisted(() => ({
  getResponse: { ok: true, data: {} as unknown } as {
    ok: boolean
    data?: unknown
    error?: { code?: string; message?: string }
  },
  postResponse: { ok: false, error: { code: 'NETWORK', message: 'Network error' } } as {
    ok: boolean
    data?: unknown
    error?: { code?: string; message?: string }
  },
  officer: { id: 'ofc-1', name: 'Petugas Uji', regionId: 'reg-bekasi', regionCode: 'BKS' },
  getUrl: '' as string,
  postUrl: '' as string,
}))



vi.mock('./api', () => ({
  api: {
    get isAuthenticated() {
      return true
    },
    async get(url: string) {
      h.getUrl = url
      return h.getResponse
    },
    async post(url: string) {
      h.postUrl = url
      return h.postResponse
    },
  },
}))



vi.mock('./auth', () => ({
  getStoredOfficer: () => h.officer,
}))



import { OFFLINE_MASTER_KEY, getOfflineMaster, getOfflineMasterStatus, pullOfflineMaster } from './offlineMaster'
import { checkPlate, checkPlateOffline } from './plates'



const PACK = {
  pulledAt: 1,
  regions: [
    { id: 'reg-bekasi', name: 'Bekasi', code: 'BKS' },
    { id: 'reg-jakarta', name: 'Jakarta', code: 'JKT' },
  ],
  plates: [
    { plate: 'B 1234 XY', status: 'internal', originRegionId: 'reg-bekasi', originRegionCode: 'BKS' },
    { plate: 'B9999ZZ', status: 'lokal', originRegionId: 'reg-jakarta', originRegionCode: 'JKT' },
    { plate: 'B 5555 UV', status: 'internal', originRegionId: 'reg-bekasi', originRegionCode: 'BKS' },
  ],
  regionTariffs: [
    { regionId: 'reg-bekasi', regionCode: 'BKS', tariffType: 'lokal', nominalTariff: 25000, isActive: true },
    { regionId: 'reg-bekasi', regionCode: 'BKS', tariffType: 'eksternal', nominalTariff: 40000, isActive: true },
  ],
}



beforeEach(() => {
  localStorage.clear()
  h.getUrl = ''
  h.postUrl = ''
  h.officer = { id: 'ofc-1', name: 'Petugas Uji', regionId: 'reg-bekasi', regionCode: 'BKS' }
  h.getResponse = { ok: true, data: PACK }
  h.postResponse = { ok: false, error: { code: 'NETWORK', message: 'Network error' } }
})



describe('pullOfflineMaster', () => {
  it('menyimpan paket master offline (region + plat + tarif region)', async () => {
    const res = await pullOfflineMaster()

    expect(h.getUrl).toBe('/master/offline')
    expect(res.ok).toBe(true)
    expect(res.plates).toBe(3)
    expect(res.regions).toBe(2)
    expect(res.tariffs).toBe(2)

    const stored = getOfflineMaster()
    expect(stored?.plates[0].key).toBe('B1234XY')
    expect(stored?.plates[0].plate).toBe('B 1234 XY')
    expect(getOfflineMasterStatus().hasPack).toBe(true)
  })

  it('respons kosong tidak menghapus cache lama', async () => {
    await pullOfflineMaster()
    h.getResponse = { ok: true, data: { regions: [], plates: [], regionTariffs: [] } }

    const res = await pullOfflineMaster({ force: true })

    expect(res.ok).toBe(false)
    expect(getOfflineMasterStatus().plates).toBe(3)
  })

  it('server gagal tidak menghapus cache lama', async () => {
    await pullOfflineMaster()
    h.getResponse = { ok: false, error: { code: 'NETWORK', message: 'Network error' } }

    const res = await pullOfflineMaster({ force: true })

    expect(res.ok).toBe(false)
    expect(getOfflineMasterStatus().plates).toBe(3)
  })

  it('paket yang masih segar tidak ditarik ulang', async () => {
    await pullOfflineMaster()
    h.getUrl = ''

    const res = await pullOfflineMaster()

    expect(h.getUrl).toBe('')
    expect(res.ok).toBe(true)
    expect(res.plates).toBe(3)
  })

  it('paket tidak tersimpan bila server gagal sejak awal', async () => {
    h.getResponse = { ok: false, error: { code: 'NETWORK', message: 'Network error' } }

    const res = await pullOfflineMaster()

    expect(res.ok).toBe(false)
    expect(localStorage.getItem(OFFLINE_MASTER_KEY)).toBeNull()
  })

  it('endpoint belum ada di server ditandai "missing" (belum ter-deploy)', async () => {
    h.getResponse = { ok: false, error: { code: '404', message: 'Not found' } }

    const res = await pullOfflineMaster()

    expect(res.ok).toBe(false)
    expect(res.missing).toBe(true)
    expect(localStorage.getItem(OFFLINE_MASTER_KEY)).toBeNull()
  })

  it('error jaringan BUKAN "missing" (kegagalan sungguhan)', async () => {
    h.getResponse = { ok: false, error: { code: 'NETWORK', message: 'Network error' } }

    const res = await pullOfflineMaster()

    expect(res.ok).toBe(false)
    expect(res.missing).toBeFalsy()
  })
})



describe('checkPlateOffline', () => {
  beforeEach(async () => {
    await pullOfflineMaster()
  })

  it('plat internal terdeteksi dan tidak ditagih', () => {
    const res = checkPlateOffline('B 1234 XY')

    expect(res).not.toBeNull()
    expect(res?.found).toBe(true)
    expect(res?.status).toBe('internal')
    expect(res?.jenisTarif).toBeNull()
    expect(res?.tariffAmount).toBe(0)
    expect(res?.offline).toBe(true)
    expect(res?.checkpointRegionId).toBe('reg-bekasi')
  })

  it('plat lokal dari region lain menjadi eksternal', () => {
    const res = checkPlateOffline('B9999ZZ')

    expect(res?.found).toBe(true)
    expect(res?.status).toBe('eksternal')
    expect(res?.jenisTarif).toBe('eksternal')
    expect(res?.tariffAmount).toBe(40000)
    expect(res?.originRegionCode).toBe('JKT')
  })

  it('plat tidak terdaftar dianggap lokal di region cek', () => {
    const res = checkPlateOffline('X 111 XX')

    expect(res?.found).toBe(false)
    expect(res?.status).toBe('lokal')
    expect(res?.tariffAmount).toBe(25000)
  })

  it('mengembalikan null bila paket master belum pernah ditarik', () => {
    localStorage.clear()
    expect(checkPlateOffline('B 1234 XY')).toBeNull()
  })
})



describe('checkPlate', () => {
  it('memakai jawaban server bila server terjangkau', async () => {
    await pullOfflineMaster()
    h.postResponse = {
      ok: true,
      data: {
        found: true,
        plate: 'S 111 AA',
        owner: 'PT XYZ',
        status: 'internal',
        jenisTarif: null,
        originRegionId: 'reg-bekasi',
        originRegionCode: 'BKS',
        checkpointRegionId: 'reg-bekasi',
        checkpointRegionCode: 'BKS',
        tariffAmount: 0,
      },
    }

    const res = await checkPlate('S 111 AA')

    expect(h.postUrl).toBe('/plates/check')
    expect(res?.owner).toBe('PT XYZ')
    expect(res?.offline).toBeUndefined()
  })

  it('jatuh ke cache offline saat server tidak terjangkau', async () => {
    await pullOfflineMaster()

    const res = await checkPlate('B 5555 UV')

    expect(res?.status).toBe('internal')
    expect(res?.found).toBe(true)
    expect(res?.offline).toBe(true)
  })

  it('tidak mengarang jawaban saat server gagal dan cache kosong', async () => {
    const res = await checkPlate('S 333 CC')
    expect(res).toBeNull()
  })
})
