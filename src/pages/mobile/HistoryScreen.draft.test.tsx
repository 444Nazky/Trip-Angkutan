import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import HistoryScreen from './HistoryScreen'

const mocks = vi.hoisted(() => ({
  go: vi.fn(),
  discard: vi.fn(),
  state: {
    draft: {
      routeCode: 'SJRE-SBDZ' as string | null,
      condition: 'muatan' as 'muatan' | 'kosong' | null,
      vehicles: [{ plate: 'B 1234 XY', type: 'Mobil', category: 'Lokal', tariff: 1000 }],
      vehicleForm: { plate: '', type: '', category: '', load: 'loaded' as const },
      photoUrl: 'data:image/jpeg;base64,aaa' as string | null,
      vPhotoUrl: undefined as string | undefined,
      selfieUrl: undefined as string | undefined,
    },
    info: { createdAt: Date.now(), savedAt: Date.now(), expiresAt: Date.now() + 12 * 3600_000 } as
      | { createdAt: number; savedAt: number; expiresAt: number }
      | null,
  },
}))

vi.mock('../store', () => ({
  useApp: () => ({
    trips: [],
    setDetailTripId: () => {},
    officer: { id: 'o1', name: 'Petugas' },
    draft: mocks.state.draft,
    draftInfo: mocks.state.info,
    discardDraft: mocks.discard,
  }),
  fmtDate: () => '30 Okt 2026',
  fmtTime: () => '10:00',
}))

vi.mock('../../services/sync', () => ({
  classifyTripSync: (_id: string, synced: boolean) => ({ state: synced ? 'synced' : 'local' }),
  onSyncQueueChange: () => () => {},
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.discard.mockReset()
  mocks.go.mockReset()
  mocks.state.info = { createdAt: Date.now(), savedAt: Date.now(), expiresAt: Date.now() + 12 * 3600_000 }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = async () => {
  await act(async () => { root.render(<HistoryScreen go={mocks.go} />) })
}

const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label))
  expect(button, `tombol "${label}" tidak ditemukan`).toBeTruthy()
  await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('draft di halaman Riwayat Trip', () => {
  it('menampilkan draft yang belum terkirim beserta sisa waktunya', async () => {
    await render()
    expect(container.textContent).toContain('Draft · belum terkirim')
    expect(container.textContent).toContain('SJRE → SBDZ')
    expect(container.textContent).toContain('Sisa 12j')
    expect(container.textContent).toContain('1 kendaraan')
  })

  it('tombol Lanjutkan membuka langkah terakhir draft', async () => {
    await render()
    await click('Lanjutkan')
    expect(mocks.go).toHaveBeenCalledWith('trip-summary')
  })

  it('draft hanya benar-benar dihapus setelah dikonfirmasi', async () => {
    await render()
    await click('Hapus')
    expect(mocks.discard).not.toHaveBeenCalled()
    await click('Hapus draft')
    expect(mocks.discard).toHaveBeenCalledTimes(1)
  })

  it('tanpa draft tidak ada kartu draft', async () => {
    mocks.state.info = null
    mocks.state.draft = {
      routeCode: null,
      condition: null,
      vehicles: [],
      vehicleForm: { plate: '', type: '', category: '', load: 'loaded' },
      photoUrl: null,
      vPhotoUrl: undefined,
      selfieUrl: undefined,
    }
    await render()
    expect(container.textContent).not.toContain('Draft · belum terkirim')
  })
})
