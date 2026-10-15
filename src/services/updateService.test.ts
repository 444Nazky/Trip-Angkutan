/**
 * Tes URL endpoint update (OTA) — dulu salah arah dan bikin update gagal total:
 *   1. `/api/api/v1/app-version` (baseUrl sudah berakhiran /api) → server 404.
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
    expect(url).toBe(`${api.baseUrl}/v1`)
    expect(url).not.toContain('/api/api')
  })

  it('tetap benar saat baseUrl di-override', () => {
    setApiBaseUrlOverride('https://abc.trycloudflare.com')
    expect(getUpdateApiUrl()).toBe('https://abc.trycloudflare.com/api/v1')
    expect(getUpdateApiUrl()).not.toContain('/api/api')
  })
})

describe('url unduh APK', () => {
  it('downloadUrl absolute dipakai apa adanya (tidak di-prefix lagi)', () => {
    const abs = 'https://aplikasi-trip-api-production.up.railway.app/releases/app-1.0.4.apk'
    expect(resolveDownloadUrl(abs)).toBe(abs)
  })

  it('downloadUrl relatif ditempel ke ORIGIN (bukan ke /api — dulu double prefix)', () => {
    const origin = api.baseUrl.replace(/\/api\/?$/i, '')
    expect(resolveDownloadUrl('/releases/app-1.0.4.apk')).toBe(`${origin}/releases/app-1.0.4.apk`)
    expect(resolveDownloadUrl('releases/app-1.0.4.apk')).toBe(`${origin}/releases/app-1.0.4.apk`)
    // path milik API sendiri tidak boleh menjadi /api/api/...
    expect(resolveDownloadUrl('/api/v1/app-download/1.0.9')).toBe(`${origin}/api/v1/app-download/1.0.9`)
  })
})
