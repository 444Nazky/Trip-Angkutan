import { useState } from 'react'
import { Globe, Lock, Server, RotateCcw } from 'lucide-react'
import { probeServer } from '../../services/sync'
import type { MobileScreen } from '../types'

interface SettingsScreenProps {
  go: (s: MobileScreen) => void
}

export default function SettingsScreen({ go }: SettingsScreenProps) {
  const [connection, setConnection] = useState<{ ok: boolean | null; checking: boolean }>({ ok: null, checking: false })

  const online = typeof navigator !== 'undefined' ? navigator.onLine : false
  const serverOk = connection.ok
  const checking = connection.checking
  const masked = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin.replace(/^https?:\/\//, '').slice(0, 24) + '…'
    : '—'

  const checkConnectionClick = () => {
    setConnection({ ok: null, checking: true })
    void probeServer(true).then((ok) => setConnection({ ok, checking: false }))
  }

  const footer = (
    <div className="flex flex-col gap-2 mt-6 border-t border-slate-100 pt-4">
      <p className="text-[10px] text-slate-400 leading-relaxed">
        Trip Angkutan · Aplikasi mitra operasional petugas lapangan.
      </p>
      <p className="text-[10px] text-slate-400">
        Offline-first · {online ? 'Online' : 'Offline'}
      </p>
    </div>
  )

  return (
    <div className="px-4 pt-2 pb-4">
      {/* Versi Aplikasi / Update OTA */}
      <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center shrink-0">
            <RotateCcw size={18} />
          </div>
          <div className="flex-1">
            <p className="text-[12px] font-bold text-slate-800">Versi Aplikasi</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              OTA online — lihat ayat di Langsung Selesaikan Trip Kosong
            </p>
          </div>
          <button
            onClick={() => void go('home')}
            className="text-[10px] font-black text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-1.5 shrink-0"
          >
            Kembali
          </button>
        </div>
      </div>

      {/* Jaringan */}
      <div className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-slate-100 mt-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${serverOk === true ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
          <Globe size={18} />
        </div>
        <div className="flex-1">
          <p className="text-[12px] font-bold text-slate-800 leading-none">Jaringan</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {serverOk === null
              ? 'Memeriksa koneksi ke server…'
              : serverOk
                ? 'Server terjangkau (ping aktif ✓)'
                : 'Server belum terjangkau — mode lokal aktif'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
            serverOk === true
              ? 'bg-emerald-100 text-emerald-700'
              : serverOk === false
                ? 'bg-amber-100 text-amber-700'
              : 'bg-slate-100 text-slate-500'
          }`}>
            {serverOk === true ? 'Terhubung' : serverOk === false ? 'Offline' : 'Cek…'}
          </span>
          <button
            onClick={() => void checkConnectionClick()}
            disabled={checking}
            className="text-[9px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded px-1.5 py-0.5 disabled:opacity-50"
          >
            {checking ? 'Memeriksa…' : 'Cek Koneksi'}
          </button>
        </div>
      </div>

      {/* Konfigurasi Server (read-only) */}
      <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-slate-100 mt-3">
        <div className="flex items-center gap-2 mb-3">
          <Lock size={13} className="text-slate-400 shrink-0" />
          <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Konfigurasi Server</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3">
          <Server size={13} className="text-slate-400 shrink-0" />
          <span className="flex-1 text-[12px] font-mono text-slate-600 truncate select-none">{masked}</span>
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 bg-white border border-slate-200 rounded px-1.5 py-0.5 shrink-0">
            Read-only
          </span>
        </div>
        <div className="flex items-start gap-2 mt-3 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Lock size={11} className="shrink-0 mt-0.5" />
          <span>Endpoint locked by default by admin</span>
        </div>
      </div>

      {footer}
    </div>
  )
}
