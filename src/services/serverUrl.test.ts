import { describe, expect, it, afterEach } from 'vitest'
import { api, resolveApiBaseUrl, setApiBaseUrlOverride } from './api'
import { environment } from '../environments/environment'




afterEach(() => {
  setApiBaseUrlOverride(null)
})




describe('dynamic backend url', () => {
  it('pakai env bila tak ada override', () => {
    expect(resolveApiBaseUrl()).toBe(environment.apiBaseUrl.replace(/\/+$/, ''))
  })




  it('override menang + akhiran /api', () => {
    setApiBaseUrlOverride('https://abc.trycloudflare.com/')
    expect(resolveApiBaseUrl()).toBe('https://abc.trycloudflare.com/api')
    expect(api.baseUrl).toBe('https://abc.trycloudflare.com/api')
  })




  it('reset kembali ke default', () => {
    setApiBaseUrlOverride('https://abc.trycloudflare.com')
    setApiBaseUrlOverride(null)
    expect(resolveApiBaseUrl()).toBe(environment.apiBaseUrl.replace(/\/+$/, ''))
  })
})
