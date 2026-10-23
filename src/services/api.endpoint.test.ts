/**
 * Test endpoint ganda (dual endpoint): Supabase (cloud) vs Intranet kantor (LAN).
 *
 * Aturan yang dijaga test ini:
 *   1. Mobile punya DUA pilihan backend yang bisa dipilih petugas.
 *   2. Endpoint intranet memakai http:// (server lokal tidak punya TLS).
 *   3. Host privat/LAN boleh http, host publik tetap dipaksa https.
 *   4. `api.baseUrl` HARUS live — kalau di-cache, ganti endpoint tidak
 *      ber efek sampai aplikasi di-reload (bug lama).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  api,
  apiBaseCandidates,
  apiBaseCandidateLabel,
  intranetApiBaseUrl,
  isIntranetBaseUrl,
  isPrivateHostUrl,
  normalizeApiBaseInput,
  resolveApiBaseUrl,
  setApiBaseUrlOverride,
} from './api'

const SUPABASE_URL = 'https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api'
const INTRANET_URL = 'http://192.168.1.123:3000/api'

describe('dual endpoint', () => {
  beforeEach(() => {
    localStorage.clear()
    setApiBaseUrlOverride(null)
  })

  it('menawarkan dua kandidat: Supabase (cloud) dan Intranet kantor', () => {
    const urls = apiBaseCandidates().map((c) => c.url)
    expect(urls).toContain(SUPABASE_URL)
    expect(urls).toContain(INTRANET_URL)
    expect(intranetApiBaseUrl()).toBe(INTRANET_URL)
  })

  it('membedakan label cloud vs intranet', () => {
    expect(apiBaseCandidateLabel(SUPABASE_URL)).toBe('Supabase')
    expect(apiBaseCandidateLabel(INTRANET_URL)).toContain('Intranet')
    expect(isIntranetBaseUrl(INTRANET_URL)).toBe(true)
    expect(isIntranetBaseUrl(SUPABASE_URL)).toBe(false)
  })

  it('mengenali host LAN sebagai host privat', () => {
    expect(isPrivateHostUrl('http://192.168.1.123:3000/api')).toBe(true)
    expect(isPrivateHostUrl('http://10.0.0.5:3000/api')).toBe(true)
    expect(isPrivateHostUrl(SUPABASE_URL)).toBe(false)
  })

  it('menormalkan input LAN tanpa skema menjadi http + suffix /api', () => {
    expect(normalizeApiBaseInput('192.168.1.123:3000')).toBe(INTRANET_URL)
    expect(normalizeApiBaseInput('192.168.1.123:3000/api')).toBe(INTRANET_URL)
    expect(normalizeApiBaseInput('http://192.168.1.123:3000/api')).toBe(INTRANET_URL)
  })

  it('default-nya Supabase cloud', () => {
    expect(resolveApiBaseUrl()).toBe(SUPABASE_URL)
    expect(api.baseUrl).toBe(SUPABASE_URL)
  })

  it('berpindah ke intranet setelah dipilih, tanpa perlu reload', () => {
    setApiBaseUrlOverride(INTRANET_URL)
    expect(resolveApiBaseUrl()).toBe(INTRANET_URL)
    // baseUrl harus live: nilai lama tidak boleh nyangkut.
    expect(api.baseUrl).toBe(INTRANET_URL)
    expect(api.url).toBe(INTRANET_URL)
  })

  it('kembali ke default cloud saat override dihapus', () => {
    setApiBaseUrlOverride(INTRANET_URL)
    setApiBaseUrlOverride(null)
    expect(resolveApiBaseUrl()).toBe(SUPABASE_URL)
  })

  it('override intranet tanpa suffix /api tetap dinormalkan jadi /api', () => {
    setApiBaseUrlOverride('http://192.168.1.123:3000')
    expect(resolveApiBaseUrl()).toBe(INTRANET_URL)
  })
})
