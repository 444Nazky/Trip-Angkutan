import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => ({
  loginOffline: vi.fn(async () => ({ success: true as boolean, officer: undefined as unknown })),
  setOfficerId: vi.fn(),
  clearVerify: vi.fn(),
  go: vi.fn(),
}))

vi.mock('../../services/auth', () => ({
  loginOffline: h.loginOffline,
  loginWithPin: vi.fn(async () => ({ success: false })),
  SESSION_READY_EVENT: 'session-ready',
}))

vi.mock('../../services/prefetch', () => ({
  prefetchAllCriticalData: vi.fn(async () => {}),
}))

vi.mock('../../services/api', () => ({
  api: { isAuthenticated: false },
}))

vi.mock('../store', () => ({
  useApp: () => ({
    officer: { id: 'o-current', name: 'Petugas Lama' },
    officers: [{ id: 'o-target', name: 'Petugas Tujuan' }],
    pendingOfficerId: 'o-target',
    verifyIntent: 'switch',
    setOfficerId: h.setOfficerId,
    clearVerify: h.clearVerify,
  }),
}))

import PinVerifyScreen from './PinVerifyScreen'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
  if (!found) throw new Error(`Tombol "${text}" tidak ditemukan`)
  return found as HTMLButtonElement
}

beforeEach(() => {
  h.loginOffline.mockClear()
  h.setOfficerId.mockClear()
  h.clearVerify.mockClear()
  h.go.mockClear()
  h.loginOffline.mockImplementation(async () => ({ success: true, officer: undefined }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('PinVerifyScreen — gate PIN offline', () => {
  it('mengirim PIN yang diketik ke loginOffline(targetId, pin), bukan shortcut sesi', async () => {
    await act(async () => { root.render(<PinVerifyScreen go={h.go} />) })

    for (const digit of ['0', '0', '0', '0', '0', '0']) {
      await act(async () => { button(digit).click() })
    }
    await act(async () => { button('Konfirmasi PIN').click() })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    expect(h.loginOffline).toHaveBeenCalledWith('o-target', '000000')
    expect(h.setOfficerId).toHaveBeenCalledWith('o-target')
  })
})
