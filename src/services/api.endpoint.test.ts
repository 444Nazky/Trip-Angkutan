import { describe, expect, it, beforeEach } from 'vitest'
import {
  api,
  apiBaseCandidates,
  apiBaseCandidateLabel,
  intranetApiBaseUrl,
  isIntranetBaseUrl,
  isPrivateHostUrl,
  normalizeApiBaseInput,
  normalizeBaseUrl,
  resolveApiBaseUrl,
  setApiBaseUrlOverride,
  supabaseProjectOrigin,
} from './api'
import { otaAssetsBase } from './ota'

const OVERRIDE_KEY = 'trip.api.baseUrl'

describe('dual endpoint (Supabase cloud + intranet kantor)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('menawarkan dua kandidat endpoint: Supabase dan intranet LAN', () => {
    const urls = apiBaseCandidates().map(c => c.url)
    expect(urls).toContain('https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api')
    expect(urls).toContain(intranetApiBaseUrl())
    expect(urls.length).toBeGreaterThanOrEqual(2)
  })

  it('default tanpa override adalah Supabase cloud', () => {
    expect(resolveApiBaseUrl()).toBe('https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api')
  })

  it('override intranet dipakai dan di-normalisasi ke /api', () => {
    setApiBaseUrlOverride('http://192.168.1.123:3000')
    expect(resolveApiBaseUrl()).toBe('http://192.168.1.123:3000/api')
    expect(isIntranetBaseUrl(resolveApiBaseUrl())).toBe(true)
  })

  it('reset mengembalikan ke Supabase cloud', () => {
    setApiBaseUrlOverride('http://192.168.1.123:3000/api')
    setApiBaseUrlOverride(null)
    expect(localStorage.getItem(OVERRIDE_KEY)).toBeNull()
    expect(resolveApiBaseUrl()).toBe('https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api')
  })

  it('host privat tanpa skema dinormalisasi ke http, bukan https', () => {
    expect(normalizeBaseUrl('192.168.1.123:3000')).toBe('http://192.168.1.123:3000/api')
    expect(normalizeApiBaseInput('192.168.1.123:3000')).toBe('http://192.168.1.123:3000/api')
  })

  it('host publik tetap dipaksa https', () => {
    expect(normalizeBaseUrl('contoh.example.com')).toBe('https://contoh.example.com/api')
  })

  it('membedakan endpoint cloud dan intranet', () => {
    expect(isIntranetBaseUrl('http://192.168.1.123:3000/api')).toBe(true)
    expect(isIntranetBaseUrl('https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api')).toBe(false)
    expect(isPrivateHostUrl('http://192.168.1.123:3000/api')).toBe(true)
    expect(isPrivateHostUrl('https://contoh.example.com/api')).toBe(false)
  })

  it('label kandidat intranet menyebut jaringan lokal', () => {
    expect(apiBaseCandidateLabel('https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api')).toBe('Supabase')
    expect(apiBaseCandidateLabel('http://192.168.1.123:3000/api')).toContain('Intranet')
  })

  it('api.baseUrl live: ganti endpoint langsung berlaku tanpa reload', () => {
    setApiBaseUrlOverride('http://192.168.1.123:3000/api')
    expect(api.baseUrl).toBe('http://192.168.1.123:3000/api')
    expect(api.url).toBe('http://192.168.1.123:3000/api')
  })

  it('bundel OTA tetap diambil dari host Supabase, bukan server intranet', () => {
    // Kalau origin storage ikut mengikuti endpoint aktif, begitu petugas
    // memilih intranet, unduhan bundel OTA jadi 404.
    setApiBaseUrlOverride('http://192.168.1.123:3000/api')
    expect(otaAssetsBase()).toBe(`${supabaseProjectOrigin()}/storage/v1/object/public/ota/`)
    expect(otaAssetsBase()).not.toContain('192.168.1.123')
  })
})
