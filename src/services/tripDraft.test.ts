import { describe, it, expect } from 'vitest'
import type { Draft } from '../pages/store'
import {
  DRAFT_TTL_MS,
  draftPhotoCount,
  draftRemainingMs,
  draftResumeTarget,
  draftRouteLabel,
  formatDraftRemaining,
  hasDraftContent,
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

  it('umur draft dihitung dari pembuatan: 12 jam, tidak diperpanjang oleh edit', () => {
    const createdAt = 1_700_000_000_000
    const info: DraftInfo = { createdAt, savedAt: createdAt + 5 * 3600_000, expiresAt: createdAt + DRAFT_TTL_MS }
    expect(draftRemainingMs(info, createdAt)).toBe(DRAFT_TTL_MS)
    expect(draftRemainingMs(info, createdAt + DRAFT_TTL_MS)).toBe(0)
    expect(draftRemainingMs(info, createdAt + DRAFT_TTL_MS + 60_000)).toBe(0)
    expect(draftRemainingMs(null)).toBe(0)
  })

  it('sisa waktu tampil ringkas', () => {
    expect(formatDraftRemaining(12 * 3600_000)).toBe('12j')
    expect(formatDraftRemaining(11 * 3600_000 + 20 * 60_000)).toBe('11j 20m')
    expect(formatDraftRemaining(45 * 60_000)).toBe('45 mnt')
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
