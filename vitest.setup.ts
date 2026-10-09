// Simulasi browser minimum agar module OTA bisa di-import di node.
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
