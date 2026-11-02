import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import HomeScreen from './HomeScreen'

const mocks = vi.hoisted(() => ({
  go: vi.fn(),
  startTrip: vi.fn(),
  resetDraft: vi.fn(),
  state: {
    trips: [] as Array<{
      id: string
      officer: string
      officerId: string
      canceled?: boolean
      synced?: boolean
      vehicle: string
      vehicles: Array<{ plate: string }>
      load: string
      route: string
      time: string
    }>,
    draft: {
      routeCode: 'SJRE-SBDZ' as string | null,
      condition: 'muatan' as 'muatan' | 'kosong' | null,
      vehicles: [{ plate: 'B 1234 XY', type: 'Mobil', category: 'Lokal', tariff: 1000 }],
      vehicleForm: { plate: '', type: '', category: '', load: 'loaded' as const },
      photoUrl: null as string | null,
    },
    info: { createdAt: Date.now(), savedAt: Date.now(), expiresAt: Date.now() + 15 * 60_000 } as
      | { createdAt: number; savedAt: number; expiresAt: number }
      | null,
    locked: false,
    counted: true,
  },
}))

vi.mock('../store', () => ({
  useApp: () => ({
    trips: mocks.state.trips,
    setDetailTripId: () => {},
    officer: { id: 'o1', name: 'Petugas', dermagaAccess: [{ id: 'd1', name: 'Dermaga A' }] },
    draft: mocks.state.draft,
    draftInfo: mocks.state.info,
    draftLocked: mocks.state.locked,
    draftCounted: mocks.state.counted,
    resetDraft: mocks.resetDraft,
  }),
}))

vi.mock('../../services/sync', () => ({
  classifyTripSync: (_id: string, synced: boolean) => ({ state: synced ? 'synced' : 'local' }),
  getPendingCount: () => 0,
  onSyncQueueChange: () => () => {},
  syncNow: async () => ({ synced: 0, failed: 0, reachable: true }),
}))

vi.mock('../../services/prefetch', () => ({
  prefetchAllCriticalData: async () => undefined,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.go.mockReset()
  mocks.startTrip.mockReset()
  mocks.resetDraft.mockReset()
  mocks.state.locked = false
  mocks.state.counted = true
  mocks.state.trips = []
  mocks.state.info = { createdAt: Date.now(), savedAt: Date.now(), expiresAt: Date.now() + 15 * 60_000 }
  mocks.state.draft = {
    routeCode: 'SJRE-SBDZ',
    condition: 'muatan',
    vehicles: [{ plate: 'B 1234 XY', type: 'Mobil', category: 'Lokal', tariff: 1000 }],
    vehicleForm: { plate: '', type: '', category: '', load: 'loaded' },
    photoUrl: null,
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = async () => {
  await act(async () => { root.render(<HomeScreen go={mocks.go} onStartTrip={mocks.startTrip} />) })
}

const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label))
  expect(button, `tombol "${label}" tidak ditemukan`).toBeTruthy()
  await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('penguncian tombol Mulai Trip saat masih ada draft', () => {
  it('draft yang sudah ada kendaraan mengunci tombol Mulai Trip', async () => {
    await render()
    expect(container.textContent).toContain('Trip belum terkirim')
    expect(container.textContent).toContain('Mulai Trip (terkunci)')
  })

  it('mengetuk tombol terkunci memunculkan panduan lanjutkan/hapus draft di Riwayat', async () => {
    await render()
    await click('Mulai Trip (terkunci)')
    expect(container.textContent).toContain('Trip baru belum bisa dimulai')
    expect(container.textContent).toContain('Lanjutkan atau batalkan draft dengan alasan')
    expect(container.textContent).toContain('Riwayat')
    // Trip baru TIDAK boleh dimulai diam-diam.
    expect(mocks.startTrip).not.toHaveBeenCalled()
  })

  it('panduan punya tombol Buka Riwayat', async () => {
    await render()
    await click('Mulai Trip (terkunci)')
    await click('Buka Riwayat')
    expect(mocks.go).toHaveBeenCalledWith('history')
  })

  it('tombol Lanjutkan Trip membuka ringkasan draft yang sudah ada', async () => {
    await render()
    await click('Lanjutkan Trip')
    expect(mocks.go).toHaveBeenCalledWith('trip-summary')
  })

  it('draft yang lewat batas umur langsung ke ringkasan', async () => {
    mocks.state.locked = true
    await render()
    await click('Lanjutkan Trip')
    expect(mocks.go).toHaveBeenCalledWith('trip-summary')
  })

  it('belum ada kendaraan: draft tidak dihitung, tombol Mulai Trip aktif', async () => {
    mocks.state.counted = false
    mocks.state.draft = {
      routeCode: null,
      condition: 'muatan',
      vehicles: [],
      vehicleForm: { plate: '', type: '', category: '', load: 'loaded' },
      photoUrl: null,
    }
    await render()
    expect(container.textContent).not.toContain('Mulai Trip (terkunci)')
    await click('Mulai Trip')
    expect(mocks.startTrip).toHaveBeenCalled()
  })

  it('tidak menghitung trip yang dibatalkan sebagai tercatat atau belum terkirim', async () => {
    mocks.state.trips = [
      {
        id: 'trip-active', officer: 'Petugas', officerId: 'o1', synced: false,
        vehicle: 'B 1234 XY', vehicles: [{ plate: 'B 1234 XY' }],
        load: 'Ada Muatan', route: 'Dermaga A → Dermaga B', time: '10:00',
      },
      {
        id: 'trip-cancelled', officer: 'Petugas', officerId: 'o1', canceled: true, synced: false,
        vehicle: 'B 5678 XY', vehicles: [{ plate: 'B 5678 XY' }],
        load: 'Ada Muatan', route: 'Dermaga C → Dermaga D', time: '09:00',
      },
    ]

    await render()

    const totalLabel = [...container.querySelectorAll('p')].find(p => p.textContent === 'Total Trip tercatat')
    expect(totalLabel?.parentElement?.querySelector('p')?.textContent).toBe('1')
    expect(container.textContent).toContain('1 belum terkirim')
    expect(container.textContent).not.toContain('2 belum terkirim')
  })
})
