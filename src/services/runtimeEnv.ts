



export function isDevMode(): boolean {
  const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env
  if (!env?.DEV) return false
  if (env.MODE && env.MODE !== 'development') return false
  return true
}
