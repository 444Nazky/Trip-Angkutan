import { describe, it, expect, beforeEach } from 'vitest'
import type { Draft } from '../pages/store'
import {
  DRAFT_MAX_MINUTES,
  DRAFT_TTL_MS,
  draftExpired,
  draftKeyFor,
  draftPhotoCount,
  draftRemainingMs,
  draftResumeTarget,
  draftRouteLabel,
  formatDraftRemaining,
  hasDraftContent,
  readDraftFor,
  writeDraftFor,
  type DraftInfo,
} from './tripDraft'

const baseDraft: Draft = {
  routeCode: null,
  condition: null,
  vehicles: [],
  vehicleForm: { plate: '', type: '', category: '', load: 'loaded' },
  editVehicleIndex: null,
  photo: false,
  vPhoto: false,
  cameraFrom: 'vehicle-form',
  cameraMode: 'photo',
  startedAt: null,
}

const vehicle = {
  plate: 'B 1234 XY',
  type: 'Mobil',
  category: 'Lokal',
  tariff: 1000,
}

describe('draft trip', () => {
  it('draft kosong tidak dianggap berisi walau layar kamera sempat dibuka', () => {
    expect(hasDraftContent(baseDraft)).toBe(false)
    expect(hasDraftContent({ ...baseDraft, cameraMode: 'selfie', cameraFrom: 'trip-summary' })).toBe(false)
  })

  it('isian apa pun membuat draft berisi', () => {
    expect(hasDraftContent({ ...baseDraft, condition: 'muatan' })).toBe(true)
    expect(hasDraftContent({ ...baseDraft, routeCode: 'SJRE-SBDZ' })).toBe(true)
    expect(hasDraftContent({ ...baseDraft, vehicles: [vehicle] })).toBe(true)
    expect(hasDraftContent({ ...baseDraft, photoUrl: 'data:image/jpeg;base64,aaa' })).toBe(true)
    expect(hasDraftContent({ ...baseDraft, vehicleForm: { ...baseDraft.vehicleForm, plate: 'B 1' } })).toBe(true)
  })

  it('umur draft dihitung dari pembuatan: 15 menit, tidak diperpanjang oleh edit', () => {
    const createdAt = 1_700_000_000_000
    const info: DraftInfo = { createdAt, savedAt: createdAt + 5 * 60_000, expiresAt: createdAt + DRAFT_TTL_MS }
    expect(draftRemainingMs(info, createdAt)).toBe(DRAFT_TTL_MS)
    expect(draftRemainingMs(info, createdAt + DRAFT_TTL_MS)).toBe(0)
    expect(draftRemainingMs(info, createdAt + DRAFT_TTL_MS + 60_000)).toBe(0)
    expect(draftRemainingMs(null)).toBe(0)
  })

  it('batas umur draft 15 menit', () => {
    expect(DRAFT_TTL_MS).toBe(15 * 60 * 1000)
    expect(DRAFT_MAX_MINUTES).toBe(15)
  })

  it('draft dianggap kedaluwarsa setelah 15 menit', () => {
    const info = { createdAt: 0, savedAt: 0, expiresAt: DRAFT_TTL_MS }
    expect(draftExpired(info, DRAFT_TTL_MS - 1)).toBe(false)
    expect(draftExpired(info, DRAFT_TTL_MS)).toBe(true)
    expect(draftExpired(info, DRAFT_TTL_MS + 1000)).toBe(true)
    expect(draftExpired(null)).toBe(false)
  })

  it('sisa waktu tampil ringkas', () => {
    expect(formatDraftRemaining(12 * 3600_000)).toBe('12j')
    expect(formatDraftRemaining(11 * 3600_000 + 20 * 60_000)).toBe('11j 20m')
    expect(formatDraftRemaining(45 * 60_000)).toBe('45 mnt')
    expect(formatDraftRemaining(15 * 60_000)).toBe('15 mnt')
    expect(formatDraftRemaining(0)).toBe('kedaluwarsa')
  })

  it('judul draft memakai rute, lalu status muatan', () => {
    expect(draftRouteLabel({ ...baseDraft, routeCode: 'SJRE-SBDZ' })).toBe('SJRE → SBDZ')
    expect(draftRouteLabel({ ...baseDraft, condition: 'kosong' })).toContain('rute belum dipilih')
    expect(draftRouteLabel(baseDraft)).toContain('status muatan belum dipilih')
  })

  it('foto draft dihitung dari trip, swafoto, form, dan kendaraan', () => {
    expect(draftPhotoCount(baseDraft)).toBe(0)
    expect(draftPhotoCount({
      ...baseDraft,
      photoUrl: 'data:a',
      selfieUrl: 'data:b',
      vPhotoUrl: 'data:c',
      vehicles: [vehicle, { ...vehicle, plate: 'B 9', photoUrl: 'data:d' }],
    })).toBe(4)
  })

  it('draft dilanjutkan dari langkah terakhir yang sudah dikerjakan', () => {
    expect(draftResumeTarget(baseDraft)).toBe('trip-condition')
    expect(draftResumeTarget({ ...baseDraft, condition: 'muatan' })).toBe('route-select')
    expect(draftResumeTarget({ ...baseDraft, condition: 'muatan', routeCode: 'SJRE-SBDZ' })).toBe('trip-summary')
  })
})

describe('penyimpanan draft per petugas', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('setiap petugas punya kunci draft sendiri', () => {
    expect(draftKeyFor('o1')).not.toBe(draftKeyFor('o2'))
    expect(draftKeyFor('')).toBe(draftKeyFor(null))
  })

  it('draft petugas A tidak muncul untuk petugas B', async () => {
    await writeDraftFor('o1', { createdAt: Date.now(), savedAt: Date.now(), officerId: 'o1', draft: { ...baseDraft, routeCode: 'SJRE-SBDZ' } })
    const untukB = await readDraftFor('o2')
    expect(untukB, 'draft petugas lain tidak boleh terbaca').toBeNull()
    const untukA = await readDraftFor('o1')
    expect(untukA?.draft.routeCode).toBe('SJRE-SBDZ')
  })

  it('draft lama (satu untuk semua petugas) dipakai sekali lalu dihapus', async () => {
    const { metaSet, metaGet } = await import('./localDb')
    await metaSet('trip.draft.v1', { savedAt: Date.now(), createdAt: Date.now(), draft: { ...baseDraft, condition: 'muatan' } })

    const migrated = await readDraftFor('o3')
    expect(migrated?.draft.condition).toBe('muatan')
    expect(await metaGet('trip.draft.v1'), 'kunci lama harus dibuang').toBeNull()
  })
})
