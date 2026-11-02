import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  buildCancelDocument,
  processCancelQueue,
  queueCancelDocument,
  readCancelQueue,
  readDeliveredCancels,
  CANCEL_REASONS,
  isCancelReason,
} from './tripCancel'
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
    await dbClear('meta')
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
    expect(doc.photos?.map(p => p.label)).toEqual([
      'Foto kondisi draft',
      'Swafoto petugas',
      'Foto kendaraan B 1234 XY',
    ])
    expect(doc.photos?.[0].mimeType).toBe('image/jpeg')
    expect(doc.officerId).toBe('o1')
    expect(doc.clientCancelId).toBeTruthy()
  })

  it('dokumen punya kunci idempoten (uuid) yang berbeda tiap pembatalan', () => {
    const a = buildCancelDocument(draft, { id: 'o1', name: 'Petugas' }, 'Lainnya')
    const b = buildCancelDocument(draft, { id: 'o1', name: 'Petugas' }, 'Lainnya')
    expect(a.clientCancelId).not.toBe(b.clientCancelId)
    expect(a.cancelId).not.toBe(b.cancelId)
  })

  it('mengirim foto sebagai multipart, bukan JSON', async () => {
    const doc = buildCancelDocument(draft, { id: 'o1', name: 'Petugas' }, 'Lainnya')
    await queueCancelDocument(doc)

    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('data:')) return new Response(new Blob(['x'], { type: 'image/jpeg' }))
      calls.push({ url, body: init?.body })
      return new Response(JSON.stringify({ id: 'c-1' }), { status: 200 })
    }))

    await processCancelQueue()

    const post = calls.find(c => c.url.endsWith('/trips/cancel'))
    expect(post?.body).toBeInstanceOf(FormData)
    const form = post?.body as FormData
    expect(form.getAll('photos')).toHaveLength(3)
    const payload = JSON.parse(String(form.get('payload')))
    expect(payload.photos).toEqual([
      { index: 0, label: 'Foto kondisi draft' },
      { index: 1, label: 'Swafoto petugas' },
      { index: 2, label: 'Foto kendaraan B 1234 XY' },
    ])
    // Berhasil kirim -> antrean kosong.
    expect(await readCancelQueue()).toHaveLength(0)
  })

  it('mencatat bukti terkirim dari server, bukan menyimpulkan dari antrean kosong', async () => {
    const doc = buildCancelDocument(draft, { id: 'o1', name: 'Petugas' }, 'Lainnya', 'uji')
    await queueCancelDocument(doc)

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('data:')) return new Response(new Blob(['x'], { type: 'image/jpeg' }))
      return new Response(JSON.stringify({ id: 'c-1', noCancel: 'CNL20261102AAAAAA' }), { status: 200 })
    }))

    await processCancelQueue()

    const delivered = await readDeliveredCancels()
    expect(delivered[doc.cancelId]?.deliveredAt).toBeGreaterThan(0)
    expect(delivered[doc.cancelId]?.noCancel).toBe('CNL20261102AAAAAA')
  })

  it('menandai dokumen yang DITOLAK server (kode error tersimpan)', async () => {
    const doc = buildCancelDocument(draft, { id: 'o1', name: 'Petugas' }, 'Lainnya', 'uji')
    await queueCancelDocument(doc)

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('data:')) return new Response(new Blob(['x'], { type: 'image/jpeg' }))
      return new Response(JSON.stringify({ error: 'Alasan pembatalan wajib diisi' }), { status: 400 })
    }))

    await processCancelQueue()

    const queue = await readCancelQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].lastErrorCode).toBe('400')
    expect((await readDeliveredCancels())[doc.cancelId]).toBeUndefined()
  })
})
