import { describe, expect, it, beforeEach } from 'vitest'
import {
  DEFAULT_DRAFT_TTL_MINUTES,
  getCachedSettings,
  pullAppSettings,
} from './appSettings'

/**
 * Pengaturan draft (batas umur) ditarik dari server, tapi HARUS tetap
 * punya nilai yang masuk akal di perangkat:
 *   - server tidak menjawab -> pakai nilai tersimpan, bukan 0/undefined
 *   - nilai aneh dari server -> dijepit ke rentang yang aman
 */

describe('getCachedSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('pakai nilai bawaan kalau belum pernah ada di perangkat', () => {
    expect(getCachedSettings().draftTtlMinutes).toBe(DEFAULT_DRAFT_TTL_MINUTES)
  })

  it('baca nilai yang tersimpan', () => {
    localStorage.setItem('trip.appSettings.v1', JSON.stringify({ draftTtlMinutes: 10 }))
    expect(getCachedSettings().draftTtlMinutes).toBe(10)
  })

  it('menjepit nilai rusak dari storage', () => {
    localStorage.setItem('trip.appSettings.v1', JSON.stringify({ draftTtlMinutes: 0 }))
    expect(getCachedSettings().draftTtlMinutes).toBe(DEFAULT_DRAFT_TTL_MINUTES)

    localStorage.setItem('trip.appSettings.v1', 'bukan json')
    expect(getCachedSettings().draftTtlMinutes).toBe(DEFAULT_DRAFT_TTL_MINUTES)
  })
})

describe('pullAppSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('menyimpan nilai dari server ke perangkat', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ draftTtlMinutes: 10 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch

    try {
      const s = await pullAppSettings()
      expect(s.draftTtlMinutes).toBe(10)
      expect(getCachedSettings().draftTtlMinutes).toBe(10)
    } finally {
      globalThis.fetch = original
    }
  })

  it('memakai nilai tersimpan saat server tidak menjawab', async () => {
    localStorage.setItem('trip.appSettings.v1', JSON.stringify({ draftTtlMinutes: 12 }))
    const original = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('offline') }) as typeof fetch

    try {
      const s = await pullAppSettings()
      expect(s.draftTtlMinutes).toBe(12)
    } finally {
      globalThis.fetch = original
    }
  })

  it('menjepit nilai aneh yang dikirim server', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ draftTtlMinutes: 99999 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch

    try {
      const s = await pullAppSettings()
      expect(s.draftTtlMinutes).toBe(240)
    } finally {
      globalThis.fetch = original
    }
  })
})
