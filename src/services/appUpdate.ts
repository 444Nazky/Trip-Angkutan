import { applyUpdate, checkForUpdate, getCurrentVersion, type CheckResult, type UpdateState } from './ota'
import { getNativeVersion, isNewerVersion, shouldForceUpdate, updateService } from './updateService'
import { hardReloadToNewBundle } from './otaReload'



// Dua kanal pembaruan (modul web + paket APK) dijalankan oleh satu alur:
// tombol "Cek & Perbarui Aplikasi" tidak perlu tahu kanal mana yang aktif.
export type AppUpdateKind = 'module' | 'apk'



export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'up-to-date'
  | 'offline'
  | 'error'



export interface AppUpdateState {
  status: AppUpdateStatus
  kind: AppUpdateKind | null
  version: string | null
  notes: string | null
  isForce: boolean
  error: string | null
}



type Listener = (state: AppUpdateState) => void

const IDLE: AppUpdateState = {
  status: 'idle',
  kind: null,
  version: null,
  notes: null,
  isForce: false,
  error: null,
}



class AppUpdateController {
  private _state: AppUpdateState = { ...IDLE }
  private _listeners = new Set<Listener>()
  private _currentModule: string | null = null
  private _currentApp: string | null = null
  private _checking: Promise<AppUpdateState> | null = null



  get state(): AppUpdateState {
    return this._state
  }



  get currentModuleVersion(): string | null {
    return this._currentModule
  }



  get currentAppVersion(): string | null {
    return this._currentApp
  }



  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  }



  private set(patch: Partial<AppUpdateState>): void {
    this._state = { ...this._state, ...patch }
    for (const listener of [...this._listeners]) {
      try {
        listener(this._state)
      } catch (error) {
        console.error('[Update] listener gagal:', error)
      }
    }
  }



  async refreshVersions(): Promise<{ module: string | null; app: string | null }> {
    try {
      this._currentModule = (await getCurrentVersion()) ?? this._currentModule
    } catch { /* pakai nilai lama */ }
    try {
      this._currentApp = (await getNativeVersion()) ?? updateService.currentVersion ?? this._currentApp
    } catch { /* pakai nilai lama */ }
    this.set({})
    return { module: this._currentModule, app: this._currentApp }
  }



  // Pemeriksaan ganda; hasil lama tidak ditumpuk agar tombol tidak dobel proses.
  check(): Promise<AppUpdateState> {
    if (this._checking) return this._checking
    const run = this.runCheck().finally(() => { this._checking = null })
    this._checking = run
    return run
  }



  private async runCheck(): Promise<AppUpdateState> {
    this.set({ status: 'checking', error: null })
    const { module: moduleVersion } = await this.refreshVersions()

    // Paket APK diperiksa lebih dulu: kalau ada versi native baru, itu yang dipasang.
    const apkInfo = await updateService.checkForUpdate().catch(() => null)
    if (apkInfo?.updateAvailable && updateService.state === 'ready') {
      const force = Boolean(apkInfo.isForceUpdate)
        || shouldForceUpdate(this._currentApp ?? '0.0.0', apkInfo.minVersion)
      this.set({
        status: 'ready',
        kind: 'apk',
        version: apkInfo.latestVersion,
        notes: apkInfo.releaseNotes,
        isForce: force,
        error: null,
      })
      return this._state
    }

    let moduleState: UpdateState = { status: 'idle' }
    const result = await checkForUpdate(moduleVersion, state => { moduleState = state }, true)
      .catch((): CheckResult => ({ available: false }))
    if (result.available) {
      this.set({
        status: 'ready',
        kind: 'module',
        version: result.version ?? null,
        notes: null,
        isForce: false,
        error: null,
      })
      return this._state
    }

    const apkError = updateService.error
    if (apkError?.message) {
      this.set({ status: 'error', kind: 'apk', version: null, error: apkError.message })
      return this._state
    }
    if (moduleState.status === 'offline') {
      this.set({ status: 'offline', kind: null, version: null, error: null })
      return this._state
    }
    if (moduleState.status === 'error') {
      this.set({ status: 'error', kind: 'module', version: null, error: moduleState.error ?? 'Gagal menghubungi server pembaruan' })
      return this._state
    }

    this.set({ status: 'up-to-date', kind: null, version: null, notes: null, error: null })
    return this._state
  }



  async apply(): Promise<boolean> {
    if (this._state.kind === 'apk') return this.applyApk()
    if (this._state.kind === 'module') return this.applyModule()
    return false
  }



  private async applyApk(): Promise<boolean> {
    this.set({ status: 'installing', error: null })
    const started = await updateService.installUpdate()
    if (!started) {
      this.set({ status: 'error', error: updateService.error?.message ?? 'Gagal memulai pemasangan APK' })
      return false
    }
    // Versi baru hanya sah setelah aplikasi hidup kembali.
    setTimeout(() => { void this.syncInstalledVersion() }, 5000)
    return true
  }



  private async applyModule(): Promise<boolean> {
    this.set({ status: 'downloading', error: null })
    const version = this._state.version
    const applied = await applyUpdate()
    if (!applied) {
      this.set({ status: 'error', kind: 'module', error: 'Gagal menerapkan modul baru' })
      return false
    }
    this.set({ status: 'installing', error: null })
    await hardReloadToNewBundle(version ?? undefined)
    return true
  }



  // Dipanggil saat aplikasi aktif lagi: versi native dibaca ulang dari sistem.
  async syncInstalledVersion(): Promise<string | null> {
    const applied = await updateService.refreshInstalledVersion()
    this._currentApp = applied
    if (this._state.kind === 'apk' && this._state.version && !isNewerVersion(applied, this._state.version)) {
      this.set({ ...IDLE, status: 'up-to-date' })
      return applied
    }
    if (this._state.status === 'installing' && this._state.kind === 'apk') {
      this.set({ status: 'ready', error: updateService.error?.message ?? null })
      return applied
    }
    this.set({})
    return applied
  }



  async reset(): Promise<void> {
    await updateService.reset()
    this.set({ ...IDLE })
  }
}



export const appUpdate = new AppUpdateController()
