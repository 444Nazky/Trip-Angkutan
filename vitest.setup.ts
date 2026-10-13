// Simulasi browser minimum agar module OTA & geofence bisa di-import di node.
if (typeof global.window === 'undefined') {
  const storage = () => ({
    store: {} as Record<string, string>,
    getItem(this: any, key: string) { return this.store[key] ?? null },
    setItem(this: any, key: string, value: string) { this.store[key] = String(value) },
    removeItem(this: any, key: string) { delete this.store[key] },
    clear(this: any) { this.store = {} },
  })
  global.window = {
    localStorage: storage(),
    sessionStorage: storage(),
    addEventListener() {},
    removeEventListener() {},
    navigator: {
      userAgent: 'Vitest',
      onLine: true,
    },
  } as any
}
if (typeof global.navigator === 'undefined') {
  global.navigator = (global.window as any).navigator
}

/**
 * localStorage & sessionStorage GLOBAL.
 *
 * Node ≥ 22 mengekspor keduanya sebagai accessor EXPERIMENTAL di globalThis
 * yang mengembalikan undefined kecuali flag `--localstorage-file` dipasang
 * (dan memunculkan ExperimentalWarning bila dipanggil). Kode aplikasi —
 * services/geofence.ts, ota.ts, auth.ts — memakai `localStorage` global, jadi
 * kita pasang penyimpanan in-memory SEBELUM file test diimpor.
 *
 * Pemeriksaan lewat DESCRIPTOR supaya accessor experimental itu tidak pernah
 * dipanggil saat instalasi.
 */
function installGlobalStorage(name: 'localStorage' | 'sessionStorage'): void {
  const desc = Object.getOwnPropertyDescriptor(globalThis, name)
  const usable = (v: unknown): v is Storage =>
    !!v && typeof (v as Storage).getItem === 'function' && typeof (v as Storage).clear === 'function'

  if (desc && 'value' in desc && usable(desc.value)) return

  const fromWindow = (global.window as unknown as Record<string, unknown> | undefined)?.[name]
  const value = usable(fromWindow) ? fromWindow : new MemoryStorage()

  try {
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    })
  } catch {
    ;(globalThis as unknown as Record<string, unknown>)[name] = value
  }
}

/** Storage in-memory yang memenuhi kontrak Storage DOM (index signature termasuk). */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()

  get length(): number { return this.map.size }
  clear(): void { this.map.clear() }
  getItem(key: string): string | null { return this.map.has(key) ? (this.map.get(key) as string) : null }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null }
  removeItem(key: string): void { this.map.delete(String(key)) }
  setItem(key: string, value: string): void { this.map.set(String(key), String(value)) }
  [name: string]: unknown
}

installGlobalStorage('localStorage')
installGlobalStorage('sessionStorage')

export {}
