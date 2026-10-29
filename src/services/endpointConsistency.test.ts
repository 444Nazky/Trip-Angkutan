import { describe, expect, it } from 'vitest'
import { checkEndpointConsistency, parseEnvFromSource, } from '../../scripts/check-endpoint-consistency.mjs'

// Regression test untuk penjaga "split-brain" endpoint. Script ini memblokir build kalau aplikasi mobile dan dashboard admin menunjuk server berbeda.

const LAN = 'http://192.168.1.123:3000/api'



function parseBundle(source: string) {
  return parseEnvFromSource(source)
}



describe('readEnvFromBundle: nilai environment di bundle minify', () => {
  it('membaca nilai literal langsung', () => {
    const env = parseBundle(
      `var B$1={production:!0,apiBaseUrl:\`${LAN}\`,intranetApiBaseUrl:\`${LAN}\`};`,
    )
    expect(env.apiBaseUrl).toBe(LAN)
    expect(env.intranetApiBaseUrl).toBe(LAN)
  })

  it('mengikuti identifier yang di-hoist oleh minifier', () => {
    const env = parseBundle(
      `var Se$1=\`${LAN}\`;var B$1={production:!0,apiBaseUrl:Se$1,intranetApiBaseUrl:Se$1};`,
    )
    expect(env.apiBaseUrl).toBe(LAN)
    expect(env.intranetApiBaseUrl).toBe(LAN)
  })

  it('tidak tertelan string di sebelahnya (parser berhenti di akhir string)', () => {
    const env = parseBundle(
      `var Se$1=\`${LAN}\`;var B$1={apiBaseUrl:Se$1,intranetApiBaseUrl:Se$1,` +
      `intranetHttpsApiBaseUrl:\`\`,geolocation:{rute1:\`https://maps.example/x\`}};`,
    )
    expect(env.apiBaseUrl).toBe(LAN)
    expect(env.intranetApiBaseUrl).toBe(LAN)
  })

  it('membaca string dengan kutip tunggal dan ganda', () => {
    const env = parseBundle(
      `var B$1={apiBaseUrl:'${LAN}',intranetApiBaseUrl:"${LAN}"};`,
    )
    expect(env.apiBaseUrl).toBe(LAN)
    expect(env.intranetApiBaseUrl).toBe(LAN)
  })

  it('mengembalikan null kalau key-nya memang tidak ada', () => {
    const env = parseBundle('var B$1={production:!0};')
    expect(env.apiBaseUrl).toBeNull()
    expect(env.intranetApiBaseUrl).toBeNull()
  })
})



describe('checkEndpointConsistency: aturan split-brain', () => {
  it('meloloskan mobile & admin yang menunjuk server sama', () => {
    expect(
      checkEndpointConsistency({ apiBaseUrl: LAN, intranetApiBaseUrl: LAN }),
    ).toEqual([])
  })

  it('menolak mobile & admin yang menunjuk server BERBEDA', () => {
    const problems = checkEndpointConsistency({
      apiBaseUrl: LAN,
      intranetApiBaseUrl: 'http://192.168.1.2:3000/api',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/BERBEDA/i)
  })

  it('menolak endpoint Supabase cloud', () => {
    const cloud = 'https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api'
    const problems = checkEndpointConsistency({
      apiBaseUrl: cloud,
      intranetApiBaseUrl: cloud,
    })
    expect(problems.some(p => /supabase/i.test(p))).toBe(true)
  })

  it('menolak endpoint yang bukan host jaringan privat', () => {
    const problems = checkEndpointConsistency({
      apiBaseUrl: 'https://contoh.example.com/api',
      intranetApiBaseUrl: 'https://contoh.example.com/api',
    })
    expect(problems.some(p => /host jaringan privat/i.test(p))).toBe(true)
  })

  it('menolak environment yang tidak lengkap', () => {
    const problems = checkEndpointConsistency({ apiBaseUrl: LAN, intranetApiBaseUrl: null as never })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/tidak lengkap/i)
  })
})
