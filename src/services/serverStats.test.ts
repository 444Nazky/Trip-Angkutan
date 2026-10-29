import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fetchServerStats, formatBytes, formatMs, formatUptime, intranetStatsBaseUrl, } from './serverStats'



describe('panel statistik server intranet', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sumber data adalah server intranet port 3000', () => {
    expect(intranetStatsBaseUrl()).toBe('http://192.168.1.123:3000/api')
    expect(intranetStatsBaseUrl()).not.toContain('://contoh.example.com')
  })

  it('mengambil statistik dari /server-stats di server intranet', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      ok: true,
      generatedAt: Date.now(),
      mode: 'intranet',
      instance: 'api-intranet',
      version: '3.0.0',
      metrics: {
        startedAt: Date.now() - 60_000,
        uptimeMs: 60_000,
        total: 10, ok: 9, clientError: 1, serverError: 0,
        successRate: 90, avgMs: 12, p95Ms: 30, maxMs: 50,
        rpsLastMinute: 4, requestsLastHour: 10,
        memory: { rss: 1024, heapUsed: 512, heapTotal: 2048, external: 0 },
        buckets: [], topPaths: [], lastRequestAt: Date.now(),
        uniqueClientsLastHour: 2,
      },
      components: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchServerStats()
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.metrics.total).toBe(10)
      expect(res.data.metrics.successRate).toBe(90)
    }
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('http://192.168.1.123:3000/api/server-stats')
  })

  it('mengembalikan pesan error yang jelas saat server tidak merespon', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const res = await fetchServerStats()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0)
  })

  it('format angka ringkas', () => {
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB')
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatMs(250)).toBe('250 ms')
    expect(formatMs(1500)).toBe('1.5 s')
    expect(formatUptime(3_600_000)).toContain('jam')
  })
})
