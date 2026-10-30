/**
 * Render harness — halaman server (Endpoint) di aplikasi mobile.
 *
 * Yang diuji:
 *  1. Halaman server mobile menyisakan DUA tombol saja: "Simpan &
 *     Terapkan" dan "Tes Koneksi".
 *  2. Tombol yang mengulang fungsi "Simpan & Terapkan" ("Reset ke Default"
 *     dan "Simpan tanpa tes") TIDAK lagi tampil di halaman mobile.
 *
 * Dashboard admin memakai komponen yang sama (EndpointPicker) dengan
 * `showExtraActions` default `true`, jadi kedua tombol itu masih ada di
 * tab Endpoint admin — perilaku itu tidak diuji di sini.
 *
 * Semua sumber jaringan dimock; tidak ada panggilan jaringan sungguhan.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import EndpointScreen from './EndpointScreen'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('halaman server (mobile)', () => {
  it('menyisakan tombol Simpan & Terapkan dan Tes Koneksi', async () => {
    await act(async () => {
      root.render(<EndpointScreen go={() => {}} />)
    })
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(container.textContent).toContain('Simpan & Terapkan')
    expect(container.textContent).toContain('Tes Koneksi')
  })

  it('tidak menampilkan tombol yang mengulang fungsi Simpan & Terapkan', async () => {
    await act(async () => {
      root.render(<EndpointScreen go={() => {}} />)
    })
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(container.textContent).not.toContain('Reset ke Default')
    expect(container.textContent).not.toContain('Simpan tanpa tes')
  })
})
