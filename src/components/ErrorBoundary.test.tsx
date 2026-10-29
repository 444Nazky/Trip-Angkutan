// ErrorBoundary harus benar-benar menahan error render-time.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ErrorBoundary } from './ErrorBoundary'

;(globalThis as unknown as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true



function Boom(): React.ReactElement {
  throw new Error('ledakan render')
}



describe('ErrorBoundary', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    vi.restoreAllMocks()
  })

  it('menampilkan pesan error alih-alih blank screen', async () => {
    await act(async () => {
      root.render(
        React.createElement(ErrorBoundary, { label: 'Admin Dashboard' },
          React.createElement(Boom)),
      )
    })

    const body = container.textContent ?? ''
    expect(body).toContain('Admin Dashboard')
    expect(body).toContain('ledakan render')
    expect(body).toContain('Coba Lagi')
  })

  it('merender children dengan normal saat tidak ada error', async () => {
    await act(async () => {
      root.render(
        React.createElement(ErrorBoundary, null,
          React.createElement('div', null, 'isi normal')),
      )
    })

    expect(container.textContent).toContain('isi normal')
  })

  it('memulihkan subtree setelah menekan Coba Lagi', async () => {
    let shouldThrow = true
    function Flaky(): React.ReactElement {
      if (shouldThrow) throw new Error('sementara')
      return React.createElement('div', null, 'sudah pulih')
    }

    await act(async () => {
      root.render(
        React.createElement(ErrorBoundary, null, React.createElement(Flaky)),
      )
    })
    expect(container.textContent).toContain('sementara')

    shouldThrow = false
    const retry = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Coba Lagi'))
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('sudah pulih')
  })
})
