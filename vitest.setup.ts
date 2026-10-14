/**
 * Setup global untuk unit test (Vitest + jsdom).
 *
 * Masalah yang diselesaikan:
 * Node 22+ mengekspor `localStorage` sebagai accessor EXPERIMENTAL di
 * globalThis (butuh flag `--localstorage-file`) sehingga nilainya `undefined`.
 * Karena di environment jsdom `globalThis === window`, accessor rusak itu juga
 * terbaca sebagai `window.localStorage` — jsdom tidak pernah menimpanya, dan
 * `localStorage.clear()` melempar `TypeError: Cannot read properties of undefined`.
 *
 * Padahal seluruh kode aplikasi (auth.ts, sync.ts, store.tsx, seedData.ts)
 * membaca/menulis localStorage. Karena itu kita pasang penyimpanan in-memory
 * yang sepenuhnya API-compatible SEBELUM file test diimpor.
 */

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()

  get length(): number { return this.map.size }

  clear(): void { this.map.clear() }

  getItem(key: string): string | null {
    const k = String(key)
    return this.map.has(k) ? (this.map.get(k) as string) : null
  }

  key(index: number): string | null { return [...this.map.keys()][index] ?? null }

  removeItem(key: string): void { this.map.delete(String(key)) }

  setItem(key: string, value: string): void { this.map.set(String(key), String(value)) }

  // Storage DOM punya index signature — penuhi agar tipenya kompatibel.
  [name: string]: unknown
}

function isUsable(value: unknown): value is Storage {
  return !!value && typeof (value as Storage).getItem === 'function' &&
    typeof (value as Storage).clear === 'function'
}

function install(name: 'localStorage' | 'sessionStorage'): void {
  const g = globalThis as unknown as Record<string, unknown>
  // Periksa lewat DESCRIPTOR agar accessor experimental Node tidak dipanggil
  // (memanggilnya memunculkan ExperimentalWarning di tiap run).
  const desc = Object.getOwnPropertyDescriptor(globalThis, name)
  if (desc && 'value' in desc && isUsable(desc.value)) return // sudah ada (jsdom)
  const fallback = new MemoryStorage()
  try {
    Object.defineProperty(globalThis, name, {
      value: fallback,
      configurable: true,
      writable: true,
      enumerable: true,
    })
  } catch {
    g[name] = fallback
  }
  if (!isUsable(g[name])) {
    throw new Error(`[vitest.setup] ${name} tidak dapat dipasang di globalThis`)
  }
}

install('localStorage')
install('sessionStorage')

export {}
