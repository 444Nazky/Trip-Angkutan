import { sleep } from './ota'




const SW_SKIP_MSG = { type: 'SKIP_WAITING' }




export function appliedCacheBuster(): string {
  try {
    const raw = localStorage.getItem('trip.ota.state')
    if (raw) {
      const st = JSON.parse(raw) as { latestVersion?: string; activeVersion?: string }
      const v = st.activeVersion ?? st.latestVersion
      if (v) return v
    }
    return localStorage.getItem('trip.ota.appliedVersion') ?? ''
  } catch {
    return ''
  }
}




async function notifyServiceWorker(version?: string): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return

    const reg = await navigator.serviceWorker.getRegistration()
    const targets: (ServiceWorker | null | undefined)[] = [
      reg?.waiting,
      reg?.installing,
      navigator.serviceWorker.controller,
    ]
    for (const worker of targets) {
      try { worker?.postMessage(SW_SKIP_MSG) } catch { /* worker mati */ }
    }

    if (version) {
      const msg = { type: 'SET_ACTIVE', version }
      for (const worker of targets) {
        try { worker?.postMessage(msg) } catch { /* worker mati */ }
      }
    }
  } catch (err) {
    console.warn('[ota-reload] gagal memberi tahu SW:', err)
  }
}




export async function hardReloadToNewBundle(version?: string): Promise<void> {
  const target = version ?? appliedCacheBuster()
  await notifyServiceWorker(target || undefined)
  await sleep(150)
  try { sessionStorage.setItem('trip.ota.hardReload', String(Date.now())) } catch { /* */ }

  let url = '/'
  if (target) {
    try {
      const u = new URL('/', window.location.origin)
      u.searchParams.set('ota', target)
      url = u.pathname + u.search + u.hash
    } catch {
      url = `/?ota=${encodeURIComponent(target)}`
    }
  }
  window.location.replace(url)
}
