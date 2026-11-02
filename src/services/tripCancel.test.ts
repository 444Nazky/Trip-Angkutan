import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { buildCancelDocument, CANCEL_REASONS, isCancelReason } from './tripCancel'
import { dbClear, initLocalDb } from './localDb'
import type { Draft } from '../pages/store'

const draft: Draft = {
  routeCode: 'SJRE-SBDZ',
  condition: 'muatan',
  vehicles: [{ plate: 'B 1234 XY', type: 'Mobil', category: 'Lokal', load: 'loaded', tariff: 75000, photoUrl: 'data:image/jpeg;base64,ccc' }],
  vehicleForm: { plate: '', type: '', category: '', load: 'loaded' },
  photo: true,
  photoUrl: 'data:image/jpeg;base64,aaa',
  selfieUrl: 'data:image/jpeg;base64,bbb',
  vPhoto: false,
  cameraFrom: 'trip-summary',
  cameraMode: 'photo',
  startedAt: 1_700_000_000_000,
}

describe('dokumen pembatalan trip', () => {
  beforeEach(async () => {
    await initLocalDb()
    await dbClear('pending-cancel')
  })

  it('alasan pembatalan memakai daftar baku', () => {
    expect(CANCEL_REASONS.length).toBeGreaterThan(0)
    expect(isCancelReason('Kendaraan batal dimuat')).toBe(true)
    expect(isCancelReason('alasan karangan')).toBe(false)
  })

  it('dokumen memuat alasan + rincian trip yang dibatalkan', () => {
    const doc = buildCancelDocument(draft, { id: 'o1', name: 'Petugas' }, 'Pelanggan membatalkan', 'kapal ditunda')
    expect(doc.reason).toBe('Pelanggan membatalkan')
    expect(doc.note).toBe('kapal ditunda')
    expect(doc.routeFrom).toBe('SJRE')
    expect(doc.routeTo).toBe('SBDZ')
    expect(doc.vehicleCount).toBe(1)
    expect(doc.vehicles[0].plate).toBe('B 1234 XY')
    // foto trip + swafoto + foto kendaraan
    expect(doc.photoCount).toBe(3)
    expect(doc.officerId).toBe('o1')
    expect(doc.clientCancelId).toBeTruthy()
  })

  it('dokumen punya kunci idempoten (uuid) yang berbeda tiap pembatalan', () => {
    const a = buildCancelDocument(draft, { id: 'o1', name: 'Petugas' }, 'Lainnya')
    const b = buildCancelDocument(draft, { id: 'o1', name: 'Petugas' }, 'Lainnya')
    expect(a.clientCancelId).not.toBe(b.clientCancelId)
    expect(a.cancelId).not.toBe(b.cancelId)
  })
})
