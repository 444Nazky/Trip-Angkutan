import { useState, useEffect } from 'react'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { probeServer } from '../../services/sync'
import {
  getCurrentVersion,
  checkForUpdate,
  applyUpdate,
  semverLabel,
  type UpdateState,
} from '../../services/ota'
import type { MobileScreen } from '../types'

interface SettingsScreenProps {
  go: (s: MobileScreen) => void
}

export default function SettingsScreen({ go }: SettingsScreenProps) {
  const [connection, setConnection] = useState<{ ok: boolean | null; checking: boolean }>({ ok: null, checking: false })
  const [currentVersion, setCurrentVersion] = useState<string>('—')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const online = typeof navigator !== 'undefined' ? navigator.onLine : false
  const masked = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin.replace(/^https?:\/\//, '').slice(0, 24) + '…'
    : '—'

  useEffect(() => {
    getCurrentVersion().then(v => { if (v) setCurrentVersion(v) })
  }, [])

  const checkConnection = () => {
    setConnection({ ok: null, checking: true })
    void probeServer(true).then(ok => setConnection({ ok, checking: false }))
  }

  const checkForAppUpdate = async () => {
    setCheckingUpdate(true)
    setNote(null)
    try {
      const local = currentVersion === '—' ? await getCurrentVersion() : currentVersion
      let last: UpdateState = { status: 'idle' }
      const r = await checkForUpdate(local, s => { last = s }, true)
      if (r.available) {
        setUpdateVersion(r.version ?? null)
        setNote(`Update ${semverLabel(r.version ?? '')} tersedia`)
      } else if (last.status === 'error') {
        setNote(last.error ?? 'Gagal memeriksa pembaruan')
      } else if (last.status === 'offline') {
        setNote('Tidak ada koneksi')
      } else {
        setNote('Sudah versi terbaru')
      }
    } finally {
      setCheckingUpdate(false)
    }
  }

  const applyNow = async () => {
    setNote('Menerapkan update…')
    if (await applyUpdate()) {
      window.location.reload()
    } else {
      setUpdateVersion(null)
      setNote('Gagal menerapkan update')
    }
  }

  const versionDisplay = currentVersion !== '—' ? semverLabel(currentVersion) : '—'

  return (
    <div className="min-h-full bg-white">
      <div className="flex items-center px-4 py-3 border-b border-slate-200">
        <button onClick={() => go('profile')} className="w-11 h-11 flex items-center justify-start -ml-2">
          <ChevronLeft size={20} className="text-blue-600" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-slate-900 mr-11">Pengaturan</h1>
      </div>

      <div className="px-4 py-5 space-y-5">
        {/* Aplikasi */}
        <section>
          <h2 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Aplikasi</h2>
          <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[15px] text-slate-900">Versi</span>
              <span className="text-[15px] text-slate-500">{versionDisplay}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[15px] text-slate-900">Pembaruan</span>
              <button
                onClick={() => void (updateVersion ? applyNow() : checkForAppUpdate())}
                disabled={checkingUpdate}
                className="text-[15px] text-blue-600 disabled:text-slate-400 flex items-center gap-1.5"
              >
                {checkingUpdate && <RefreshCw size={14} className="animate-spin" />}
                {updateVersion ? 'Terapkan' : 'Periksa'}
              </button>
            </div>
          </div>
          {note && <p className="text-[13px] text-slate-500 mt-2">{note}</p>}
        </section>

        {/* Koneksi */}
        <section>
          <h2 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Koneksi</h2>
          <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[15px] text-slate-900">Jaringan</span>
              <span className={`text-[15px] ${online ? 'text-emerald-600' : 'text-slate-500'}`}>{online ? 'Online' : 'Offline'}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[15px] text-slate-900">Server</span>
              <span className="text-[15px] text-slate-500">
                {connection.ok === null ? 'Belum diperiksa' : connection.ok ? 'Terhubung' : 'Tidak terjangkau'}
              </span>
            </div>
            <button
              onClick={() => void checkConnection()}
              disabled={connection.checking}
              className="w-full flex items-center justify-between px-4 py-3 text-[15px] text-blue-600 disabled:text-slate-400"
            >
              <span>Periksa Koneksi</span>
              {connection.checking && <RefreshCw size={14} className="animate-spin" />}
            </button>
          </div>
        </section>

        {/* Server */}
        <section>
          <h2 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Server</h2>
          <div className="bg-slate-50 rounded-xl border border-slate-200 px-4 py-3">
            <span className="text-[13px] font-mono text-slate-500 break-all">{masked}</span>
          </div>
        </section>

        {/* Footer */}
        <div className="pt-6 text-center">
          <p className="text-[13px] text-slate-500">Trip Angkutan</p>
          <p className="text-[12px] text-slate-400 mt-1">Offline-first · Data tersimpan lokal</p>
        </div>
      </div>
    </div>
  )
}
