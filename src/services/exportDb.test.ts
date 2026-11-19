// ─── Unit Test: Ekspor Data Trip (services/exportDb.ts) ─────────────────────
// Memastikan ekspor hanya membawa trip yang SUDAH tersinkron, tidak menulis
// arsip kosong, memisahkan foto ke folder images/, dan tetap menemukan data
// dari cache lokal bila IndexedDB gagal.

import 'fake-indexeddb/auto'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import { dbClear, dbPut } from './localDb'
import {
  ARCHIVE_JSON_NAME,
  buildLocalDatabaseExport,
  buildTripArchive,
  exportLocalDatabase,
  LOCAL_TRIPS_CACHE_KEY,
} from './exportDb'
import { TARIFFS_STORAGE_KEY } from './masterTariffs'
import { ARCHIVE_ENCRYPTION_KIND, decryptArchivePayload } from '../../server/api/archiveCrypto'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const recent = new Date(NOW - 2 * DAY).toISOString()
const old = new Date(NOW - 400 * DAY).toISOString()

beforeEach(async () => {
  await dbClear('trips')
  await dbClear('pending')
  await dbClear('pending-cancel')
  await dbClear('meta')
  localStorage.clear()
})

describe('buildLocalDatabaseExport', () => {
  it('mengekspor SEMUA trip tersinkron tanpa batas umur', async () => {
    await dbPut('trips', { id: 'terkirim', synced: true, completedAt: recent })
    await dbPut('trips', { id: 'belum-terkirim', synced: false, completedAt: recent })
    await dbPut('trips', { id: 'lama', synced: true, completedAt: old })
    await dbPut('trips', { id: 'dibatalkan', synced: true, canceled: true, completedAt: recent })

    const { payload } = await buildLocalDatabaseExport(NOW, { id: 'o-1', name: 'Petugas Satu' })

    expect(payload.kind).toBe('synced-trips')
    expect(payload.officer.name).toBe('Petugas Satu')
    expect(payload.trips.map(t => t.id).sort()).toEqual(['lama', 'terkirim'])
    expect(payload.counts.trips).toBe(2)
    expect(JSON.stringify(payload)).toContain('terkirim')
  })

  it('memakai cache localStorage bila IndexedDB tidak berisi trip', async () => {
    localStorage.setItem(LOCAL_TRIPS_CACHE_KEY, JSON.stringify([
      { id: 'cache-terkirim', synced: true, completedAt: recent, route: 'A → B' },
      { id: 'cache-lokal', synced: false, completedAt: recent, route: 'C → D' },
    ]))

    const { payload } = await buildLocalDatabaseExport(NOW)

    expect(payload.trips.map(t => t.id)).toEqual(['cache-terkirim'])
    expect(payload.counts.trips).toBe(1)
  })

  it('mengisi tarif Eksternal yang kosong dari cache tarif perangkat', async () => {
    localStorage.setItem(TARIFFS_STORAGE_KEY, JSON.stringify([
      { id: 't-1', type: 'Truk Kecil', loadedNum: 70000, emptyNum: 50000 },
    ]))
    await dbPut('trips', {
      id: 'tarif-lama',
      synced: true,
      completedAt: recent,
      vehicles: [
        { plate: 'B 1 X', type: 'Truk Kecil', category: 'Eksternal', hasLoad: true, tariff: 0 },
        { plate: 'B 2 X', type: 'Truk Kecil', category: 'Eksternal', hasLoad: false, tariff: 0 },
        { plate: 'B 3 X', type: 'Truk Kecil', category: 'Internal', hasLoad: true, tariff: 0 },
        { plate: 'B 4 X', type: 'Truk Kecil', category: 'Lokal', hasLoad: true, tariff: 0 },
      ],
    })

    const { payload } = await buildLocalDatabaseExport(NOW)
    const trip = payload.trips[0] as Record<string, unknown>
    const vehicles = trip['vehicles'] as Array<Record<string, unknown>>

    expect(vehicles[0]['tariff']).toBe(70000)
    expect(vehicles[1]['tariff']).toBe(50000)
    expect(vehicles[2]['tariff']).toBe(0)
    expect(vehicles[3]['tariff']).toBe(0)
  })

  it('memisahkan foto ke images/ dan mengganti URL foto dengan referensi file', async () => {
    await dbPut('trips', {
      id: 'lengkap',
      synced: true,
      completedAt: recent,
      photoUrl: 'data:image/jpeg;base64,DOKUMENTASI',
      proofUrl: 'data:image/jpeg;base64,QlVLVEk=',
      selfieUrl: 'data:image/jpeg;base64,U1dBRk9UTw==',
      vehicles: [{ plate: 'B 1 X', photoUrl: 'data:image/png;base64,S0VOREFSQUFO' }],
    })

    const { payload, photos } = await buildLocalDatabaseExport(NOW)

    expect(payload.counts.photos).toBe(4)
    expect(payload.counts.withProof).toBe(1)
    expect(payload.counts.withDocumentation).toBe(1)
    expect(photos.map(p => p.path).sort()).toEqual([
      'images/lengkap-bukti.jpg',
      'images/lengkap-dokumentasi.jpg',
      'images/lengkap-kendaraan-1.png',
      'images/lengkap-swafoto.jpg',
    ])
    // JSON tidak lagi membawa base64 raksasa — hanya nama file.
    const trip = payload.trips[0] as Record<string, unknown>
    expect(trip.photoUrl).toBe('images/lengkap-dokumentasi.jpg')
    expect(trip.selfieUrl).toBe('images/lengkap-swafoto.jpg')
    expect(JSON.stringify(payload)).not.toContain('data:image')
    expect(photos[0].bytes.length).toBeGreaterThan(0)
  })
})

describe('buildTripArchive', () => {
  it('membuat ZIP berisi data_trip.json terenkripsi + folder images dengan nama sesuai petugas', async () => {
    await dbPut('trips', {
      id: 'arsip-1',
      synced: true,
      completedAt: recent,
      officer: 'Petugas Satu',
      photoUrl: 'data:image/jpeg;base64,RE9L',
    })

    const { bytes, filename } = await buildTripArchive(NOW, { id: 'o-1', name: 'Petugas Satu' })

    expect(filename).toMatch(/^export_trip_PETUGAS_SATU_\d{8}-\d{6}\.zip$/)
    const zip = await JSZip.loadAsync(bytes)
    expect(zip.file(ARCHIVE_JSON_NAME)).not.toBeNull()
    expect(zip.file('images/arsip-1-dokumentasi.jpg')).not.toBeNull()

    const envelope = JSON.parse(await zip.file(ARCHIVE_JSON_NAME)!.async('string'))
    // Isi ZIP tidak boleh lagi membocorkan data trip secara terbaca.
    expect(envelope.kind).toBe(ARCHIVE_ENCRYPTION_KIND)
    expect(envelope.trips).toBeUndefined()
    expect(JSON.stringify(envelope)).not.toContain('arsip-1')

    const decrypted = await decryptArchivePayload(envelope)
    expect(decrypted.ok).toBe(true)
    if (!decrypted.ok) return
    expect(decrypted.encrypted).toBe(true)
    const json = decrypted.payload as { trips: Array<Record<string, unknown>> }
    expect(json.trips).toHaveLength(1)
    expect(json.trips[0]['photoUrl']).toBe('images/arsip-1-dokumentasi.jpg')
  })
})

describe('exportLocalDatabase', () => {
  it('menolak membuat arsip kosong saat belum ada trip tersinkron', async () => {
    const result = await exportLocalDatabase({ name: 'Petugas Satu' })

    expect(result.ok).toBe(false)
    expect(result.size).toBe(0)
    expect(result.message).toContain('Belum ada trip tersinkron')
  })
})
