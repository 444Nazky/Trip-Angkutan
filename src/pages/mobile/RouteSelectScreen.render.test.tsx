import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import RouteSelectScreen from './RouteSelectScreen'

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  startTrip: vi.fn(),
  routes: [
    { code: 'SJRE-TJPN', from: 'SJRE', to: 'TJPN', label: 'Rute lain' },
    { code: 'SBDZ-SJRE', from: 'SBDZ', to: 'SJRE', label: 'Rute utama' },
  ],
  state: {
    condition: 'muatan' as 'muatan' | 'kosong',
    routeCode: null as string | null,
    inside: true,
    lastFix: null as null | { lat: number; lng: number },
    gpsHangs: false,
  },
}))

vi.mock('../store', () => ({
  useApp: () => ({
    draft: { condition: mocks.state.condition, routeCode: mocks.state.routeCode, vehicles: [] },
    startTrip: mocks.startTrip,
    patchDraft: (p: { routeCode?: string }) => {
      mocks.patch(p)
      if (p.routeCode !== undefined) mocks.state.routeCode = p.routeCode
    },
    officer: {
      id: 'o1',
      name: 'Petugas',
      region: 'Belitung',
      dermagaAccess: [{ id: 'd1', name: 'Dermaga Sungai Jawi' }],
    },
  }),
}))

vi.mock('../../services/auth', () => ({
  getStoredRoutes: () => mocks.routes,
  refreshStoredRoutes: async () => mocks.routes,
  hasDockScopedRoutes: () => true,
}))

vi.mock('../../services/geofence', () => ({
  normalizeRouteCode: (code: string) => code.toUpperCase().trim().replace(/→|->|>/g, '-'),
  GEOFENCE_UPDATED_EVENT: 'trip:geofence-updated',
  resetGpsFixCache: () => {},
  pointIsForOtherDermaga: () => false,
  getCurrentPosition: () =>
    mocks.state.gpsHangs ? new Promise(() => {}) : Promise.resolve({ lat: 0, lng: 0 }),
  getLastKnownPosition: () => mocks.state.lastFix,
  getActiveGeofenceSnapshot: async () =>
    mocks.state.inside
      ? {
          valid: true,
          activePoint: {
            id: 'g1',
            name: 'Dermaga A',
            latitude: 0,
            longitude: 0,
            radiusMeters: 100,
            allowedRoutes: ['SBDZ-SJRE'],
            enabled: true,
          },
        }
      : { valid: false, activePoint: null, blocked: true },
  forceSyncGeofencesFromBackend: async () => ({ ok: true, count: 1 }),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.patch.mockClear()
  mocks.startTrip.mockClear()
  mocks.state.condition = 'muatan'
  mocks.state.routeCode = null
  mocks.state.inside = true
  mocks.state.lastFix = null
  mocks.state.gpsHangs = false
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = async (go: (screen: string) => void = () => {}, dockId?: string) => {
  await act(async () => { root.render(<RouteSelectScreen go={go} selectedDockId={dockId} />) })
  await act(async () => {})
}

describe('layar pilih rute', () => {
  it('menaruh rute yang diizinkan geofence paling atas', async () => {
    await render()
    const text = container.textContent ?? ''
    expect(text.indexOf('SBDZ → SJRE')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('SBDZ → SJRE')).toBeLessThan(text.indexOf('Sesuai lokasi Anda') + 60)
    expect(text).toContain('Sesuai lokasi Anda')
  })

  it('memilih otomatis rute yang tersedia tanpa diketuk', async () => {
    await render()
    expect(mocks.patch).toHaveBeenCalledWith({ routeCode: 'SBDZ-SJRE' })
  })

  it('menyembunyikan rute terkunci di balik tombol lipat', async () => {
    await render()
    expect(container.textContent).toContain('1 rute lain terkunci')
    expect(container.textContent).not.toContain('SJRE → TJPN')
  })

  it('menilai lokasi seketika dari fix GPS terakhir, tanpa menunggu GPS baru', async () => {
    // GPS cold start bisa puluhan detik; fix terakhir harus langsung dipakai
    // supaya layar tidak tertahan di "Memeriksa lokasi GPS...".
    mocks.state.lastFix = { lat: 0, lng: 0 }
    mocks.state.gpsHangs = true
    await render()
    expect(container.textContent).toContain('Sesuai lokasi Anda')
  })

  it('memakai pesan pendek saat di luar area bertugas', async () => {
    mocks.state.inside = false
    await render()
    expect(container.textContent).toContain('Anda sedang berada di luar area bertugas')
    expect(container.textContent).toContain('Segera kembali ke posisi.')
    expect(mocks.patch).not.toHaveBeenCalled()
  })

  it('menampilkan dermaga sebagai judul besar dan region sebagai sub-header', async () => {
    await render(undefined, 'd1')
    const paragraphs = [...container.querySelectorAll('p')]
    const dock = paragraphs.find(el => el.textContent?.trim() === 'Dermaga Sungai Jawi')
    const region = paragraphs.find(el => el.textContent?.trim() === 'Belitung')
    expect(dock).toBeTruthy()
    expect(region).toBeTruthy()
    // Dermaga adalah judul (16px), region hanya keterangan kecil (11px).
    expect(dock!.className).toContain('text-[16px]')
    expect(region!.className).toContain('text-[11px]')
    // Urutan tampil: dermaga dulu, region di bawahnya.
    expect(dock!.compareDocumentPosition(region!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('trip kosong lanjut ke Ringkasan tanpa membuka kamera', async () => {
    mocks.state.condition = 'kosong'
    mocks.state.routeCode = 'SBDZ-SJRE'
    const go = vi.fn()
    await render(go)
    const button = [...container.querySelectorAll('button')]
      .find(el => (el.textContent ?? '').includes('Lanjut Ringkasan'))
    expect(button).toBeTruthy()
    await act(async () => { button!.click() })
    expect(mocks.startTrip).toHaveBeenCalled()
    expect(go).toHaveBeenCalledWith('trip-summary')
    expect(go).not.toHaveBeenCalledWith('camera')
    expect(mocks.patch).toHaveBeenLastCalledWith({
      routeCode: 'SBDZ-SJRE',
      cameraFrom: undefined,
      cameraMode: undefined,
    })
  })
})
