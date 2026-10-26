/**
 * Render harness — tab "Endpoint" (admin dashboard).
 *
 * Yang diuji: tab Endpoint menampilkan panel statistik server port 3000
 * (dengan URL sumber `http://192.168.1.123:3000/api/server-stats`) - BUKAN
 * Supabase.
 *
 * Semua sumber jaringan dimock; tidak ada panggilan jaringan sungguhan.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EndpointTab } from './EndpointTab'

let container: HTMLDivElement
let root: Root

const statsPayload = {
  ok: true,
  generatedAt: Date.now(),
  mode: 'intranet',
  instance: 'api-intranet',
  version: '3.0.0',
  metrics: {
    startedAt: Date.now() - 120_000,
    uptimeMs: 120_000,
    total: 42,
    ok: 41,
    clientError: 1,
    serverError: 0,
    successRate: 97.6,
    avgMs: 14,
    p95Ms: 40,
    maxMs: 90,
    rpsLastMinute: 3,
    requestsLastHour: 42,
    memory: { rss: 80 * 1024 * 1024, heapUsed: 10 * 1024 * 1024, heapTotal: 20 * 1024 * 1024, external: 0 },
    buckets: [{ minute: Date.now() - 60_000, total: 3, ok: 3, err: 0 }],
    topPaths: [{ path: '/trips', count: 10, errors: 0, avgMs: 12, lastMs: 9 }],
    lastRequestAt: Date.now(),
    uniqueClientsLastHour: 2,
  },
  components: [
    { id: 'api', label: 'Proses API', status: 'ok', detail: 'Server intranet aktif', ms: 0 },
    { id: 'database', label: 'Database (Supabase)', status: 'ok', detail: 'PostgreSQL terjangkau', ms: 30 },
  ],
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify(statsPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('tab Endpoint — panel statistik server port 3000', () => {
  it('menampilkan panel statistik dengan URL sumber server intranet', async () => {
    await act(async () => {
      root.render(<EndpointTab showToast={() => {}} />)
    })
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(container.textContent).toContain('Statistik Server Port 3000')
    expect(container.textContent).toContain('http://192.168.1.123:3000/api/server-stats')
    expect(container.textContent).toContain('Total Requests')
    expect(container.textContent).toContain('Success Rate')
    expect(container.textContent).toContain('Grafik Request per Menit')
  })

  it('meminta data ke server intranet, bukan ke Supabase', async () => {
    await act(async () => {
      root.render(<EndpointTab showToast={() => {}} />)
    })
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const called = fetchMock.mock.calls.map(c => String(c[0]))
    expect(called.length).toBeGreaterThan(0)
    expect(called.every(u => u.includes('192.168.1.123:3000/api'))).toBe(true)
    expect(called.some(u => u.includes('supabase.co'))).toBe(false)
  })

  it('menampilkan angka statistik dari server', async () => {
    await act(async () => {
      root.render(<EndpointTab showToast={() => {}} />)
    })
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(container.textContent).toContain('42')
    expect(container.textContent).toContain('97.6%')
  })
})
