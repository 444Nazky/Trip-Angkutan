import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import HistoryDetailScreen from './HistoryDetailScreen'

const trip = {
  id: 'TRIP-1',
  officerId: 'o1',
  officer: 'Petugas',
  route: 'Dermaga A - Dermaga B',
  date: '2026-10-30',
  time: '08:00',
  duration: '10m',
  synced: false,
  vehicles: [{ plate: 'B 1234 XY', type: 'Mobil', category: 'Lokal', tariff: 1000 }],
}

const state = { synced: false }

vi.mock('../store', () => ({
  useApp: () => ({
    trips: [{ ...trip, synced: state.synced }],
    detailTripId: trip.id,
    officer: { id: 'o1', name: 'Petugas' },
    patchDraft: () => {},
    patchVehiclePhoto: () => {},
  }),
  unitLabel: (_v: unknown, i: number) => `Unit ${i + 1}`,
}))

vi.mock('../../services/sync', () => ({
  classifyTripSync: (_id: string, synced: boolean) => ({ state: synced ? 'synced' : 'pending' }),
  onSyncQueueChange: () => () => {},
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  state.synced = false
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = async () => {
  await act(async () => { root.render(<HistoryDetailScreen go={() => {}} />) })
}

describe('detail riwayat trip', () => {
  it('boleh mengubah detail kendaraan sebelum trip terkirim', async () => {
    await render()
    expect(container.textContent).toContain('Ubah')
  })

  it('tidak boleh mengubah detail kendaraan setelah trip terkirim', async () => {
    state.synced = true
    await render()
    expect(container.textContent).not.toContain('Ubah')
  })
})
