/**
 * Tes URL endpoint update (OTA) — dulu salah arah dan bikin update gagal total:
 *   1. Path dobel (baseUrl sudah berakhiran /api) → server 404.
 *   2. URL unduh APK di-prefix api.baseUrl padahal server sudah kirim absolute.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { api, setApiBaseUrlOverride } from './api'
import { getUpdateApiUrl, resolveDownloadUrl } from './updateService'

afterEach(() => {
  setApiBaseUrlOverride(null)
})

describe('url endpoint update', () => {
  it('tidak menggandakan /api (baseUrl default)', () => {
    const url = getUpdateApiUrl()
    expect(url).toBe(`${api.baseUrl}/app-version`)
    expect(url).not.toContain('/api/api')
  })

  it('tetap benar saat baseUrl di-override', () => {
    setApiBaseUrlOverride('https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api')
    expect(getUpdateApiUrl()).toBe('https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api/app-version')
    expect(getUpdateApiUrl()).not.toContain('/api/api')
  })
})

describe('url unduh APK', () => {
  it('downloadUrl absolute dipakai apa adanya (tidak di-prefix lagi)', () => {
    const abs = 'https://bmiruktfruunegtbydyw.supabase.co/storage/v1/object/public/apks/app-1.0.4.apk'
    expect(resolveDownloadUrl(abs)).toBe(abs)
  })

  it('downloadUrl relatif ditempel ke API base (…/functions/v1/api)', () => {
    const base = new URL(api.baseUrl).toString().replace(/\/$/, '')
    expect(resolveDownloadUrl('/app-download/1.0.9')).toBe(`${base}/app-download/1.0.9`)
    expect(resolveDownloadUrl('app-download/1.0.9')).toBe(`${base}/app-download/1.0.9`)
    // path milik API sendiri tidak boleh menjadi /api/api/...
    expect(resolveDownloadUrl('/app-download/1.0.9')).not.toContain('/api/api/')
  })
})
