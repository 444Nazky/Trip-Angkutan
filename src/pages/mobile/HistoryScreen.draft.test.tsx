import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import HistoryScreen from './HistoryScreen'

const mocks = vi.hoisted(() => ({
  go: vi.fn(),
  cancel: vi.fn(),
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
    info: { createdAt: Date.now(), savedAt: Date.now(), expiresAt: Date.now() + 15 * 60_000 } as
      | { createdAt: number; savedAt: number; expiresAt: number }
      | null,
    locked: false,
    intranetReachable: false,
  },
}))

vi.mock('../../services/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/api')>()
  return {
    ...actual,
    pingBaseUrl: vi.fn(async () => ({ ok: mocks.state.intranetReachable, ms: 1 })),
  }
})

vi.mock('../store', () => ({
  useApp: () => ({
    trips: [],
    setDetailTripId: () => {},
    officer: { id: 'o1', name: 'Petugas' },
    draft: mocks.state.draft,
    draftInfo: mocks.state.info,
    draftLocked: mocks.state.locked,
    cancelDraft: mocks.cancel,
  }),
  fmtDate: () => '30 Okt 2026',
  fmtTime: () => '10:00',
}))

vi.mock('../../services/sync', () => ({
  classifyTripSync: (_id: string, synced: boolean) => ({ state: synced ? 'synced' : 'local' }),
  onSyncQueueChange: () => () => {},
}))

vi.mock('../../services/tripCancel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/tripCancel')>()
  return { ...actual, readCancelQueue: async () => [] }
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.cancel.mockReset()
  mocks.go.mockReset()
  mocks.state.locked = false
  mocks.state.intranetReachable = false
  mocks.state.info = { createdAt: Date.now(), savedAt: Date.now(), expiresAt: Date.now() + 15 * 60_000 }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = async () => {
  await act(async () => {
    root.render(<HistoryScreen go={mocks.go} />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label))
  expect(button, `tombol "${label}" tidak ditemukan`).toBeTruthy()
  await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('draft di halaman Riwayat Trip', () => {
  it('tetap Offline saat perangkat online tetapi server intranet tidak terjangkau', async () => {
    await render()
    expect(container.textContent).toContain('Offline')
    expect(container.textContent).not.toContain('Online')
  })

  it('menampilkan Online hanya setelah server intranet berhasil dijangkau', async () => {
    mocks.state.intranetReachable = true
    await render()
    expect(container.textContent).toContain('Online')
  })

  it('menampilkan draft yang belum terkirim beserta sisa waktunya', async () => {
    await render()
    expect(container.textContent).toContain('Draft · belum terkirim')
    expect(container.textContent).toContain('SJRE → SBDZ')
    expect(container.textContent).toContain('Sisa 15 mnt')
    expect(container.textContent).toContain('1 kendaraan')
  })

  it('tombol Lanjutkan membuka langkah terakhir draft', async () => {
    await render()
    await click('Lanjutkan')
    expect(mocks.go).toHaveBeenCalledWith('trip-summary')
  })

  it('draft yang lewat 15 menit tidak bisa diedit, hanya kirim atau batalkan', async () => {
    mocks.state.locked = true
    mocks.state.info = { createdAt: Date.now() - 20 * 60_000, savedAt: Date.now() - 20 * 60_000, expiresAt: Date.now() - 5 * 60_000 }
    await render()
    expect(container.textContent).toContain('Kedaluwarsa')
    expect(container.textContent).not.toContain('Lanjutkan')
    expect(container.textContent).toContain('Kirim Trip')
    expect(container.textContent).toContain('Batalkan')
  })

  it('pembatalan draft wajib memakai alasan', async () => {
    await render()
    await click('Batalkan')
    // Dialog terbuka: tombol konfirmasi belum bisa ditekan tanpa alasan.
    const konfirmasi = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Batalkan Trip'))
    expect(konfirmasi, 'dialog pembatalan harus terbuka').toBeTruthy()
    expect((konfirmasi as HTMLButtonElement).disabled, 'tanpa alasan tombol harus nonaktif').toBe(true)
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('pembatalan dengan alasan meneruskan alasan ke store', async () => {
    await render()
    await click('Batalkan')
    const radio = [...container.querySelectorAll('input[type="radio"]')][0] as HTMLInputElement
    await act(async () => { radio.click() })
    const konfirmasi = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Batalkan Trip'))
    await act(async () => { konfirmasi!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
    expect(mocks.cancel.mock.calls[0][0]).toBeTruthy()
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

  it('draft yang belum ada kendaraan tidak dihitung sebagai draft', async () => {
    mocks.state.info = null
    mocks.state.draft = {
      routeCode: 'SJRE-SBDZ',
      condition: 'muatan',
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
