import { Capacitor, registerPlugin } from '@capacitor/core'



// Plugin native milik aplikasi ini (bukan plugin pihak ketiga): android/app/src/main/java/com/plantation/tripangkut/ApkInstallerPlugin.java,…
interface ApkInstallerPlugin {
  install(options: { path: string }): Promise<{ opened: boolean }>
}



const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller')



export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  } catch {
    return false
  }
}



export function normalizeAbsolutePath(uri: string): string {
  const raw = String(uri ?? '').trim()
  if (!raw) return ''
  if (!raw.startsWith('file://')) return raw
  const tanpaSkema = raw.substring('file://'.length)
  try {
    return decodeURI(tanpaSkema)
  } catch {
    return tanpaSkema
  }
}



// Peluncur APK versi lama (plugin Cordova). Disimpan hanya sebagai jaring pengaman untuk build yang masih membundelnya; bukan jalur utama lagi.
type LegacyFileOpener = {
  open: (path: string, mime: string, opt: { success: () => void; error: (e: unknown) => void }) => void
}



function legacyFileOpener(): LegacyFileOpener | null {
  try {
    const w = window as unknown as { cordova?: { plugins?: { fileOpener2?: LegacyFileOpener } } }
    return w.cordova?.plugins?.fileOpener2 ?? null
  } catch {
    return null
  }
}



function legacyOpen(opener: LegacyFileOpener, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    opener.open(path, 'application/vnd.android.package-archive', {
      success: () => resolve(),
      error: (e) => reject(e instanceof Error ? e : new Error('Gagal membuka installer')),
    })
  })
}



export type OpenInstallerResult = { ok: true } | { ok: false; message: string }



// Buka installer paket Android untuk berkas APK di `absolutePath`.
export async function openApkInstaller(absolutePath: string): Promise<OpenInstallerResult> {
  const path = normalizeAbsolutePath(absolutePath)
  if (!path) {
    return { ok: false, message: 'Path berkas APK kosong — unduh ulang pembaruan.' }
  }
  if (!isNativeAndroid()) {
    return {
      ok: false,
      message: 'Pemasangan APK hanya bisa dijalankan dari aplikasi Android, bukan dari browser.',
    }
  }

  try {
    await ApkInstaller.install({ path })
    return { ok: true }
  } catch (error) {
    const pesan = error instanceof Error ? error.message : String(error)

    const legacy = legacyFileOpener()
    if (legacy) {
      try {
        await legacyOpen(legacy, path)
        return { ok: true }
      } catch {  }
    }

    return { ok: false, message: `Gagal membuka installer APK: ${pesan}` }
  }
}
