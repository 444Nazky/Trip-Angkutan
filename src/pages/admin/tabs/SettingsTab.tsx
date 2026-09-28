import { Settings, LogOut, Sun, Moon } from 'lucide-react'
import { ZOOM_OPTIONS, ACCENT_OPTIONS, DEFAULT_THEME, loadTheme, saveTheme, applyTheme, type AdminTheme } from '../../../services/theme'
import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { ensureAdminBackendSession } from '../../../services/auth'

interface SettingsTabProps {
  onLogout: () => void
  serverState: 'connecting' | 'online' | 'offline'
  tariffs: unknown[]
  officers: unknown[]
  localTrips: unknown[]
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function SettingsTab({ onLogout, serverState, tariffs, officers, localTrips, showToast }: SettingsTabProps) {
  const [theme, setTheme] = useState<AdminTheme>(() => loadTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const updateTheme = (patch: Partial<AdminTheme>) => {
    const next = { ...theme, ...patch }
    setTheme(next)
    saveTheme(next)
  }

  return (
    <div className="space-y-6">
      {/* Tema & Tampilan */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <h3 className="text-lg font-bold text-slate-800 mb-1">Tema & Tampilan</h3>
        <p className="text-xs text-slate-500 mb-6">Sesuaikan tema situs, ukuran font, dan warna aksen</p>

        <div className="space-y-5">
          {/* Tema */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-slate-700">Tema Situs</p>
              <p className="text-[11px] text-slate-400">Terang atau gelap</p>
            </div>
            <div className="flex rounded-xl border border-slate-200 p-1 gap-1 bg-slate-50">
              {([['light', 'Terang', Sun], ['dark', 'Gelap', Moon]] as const).map(([m, label, Icon]) => (
                <button
                  key={m}
                  onClick={() => updateTheme({ mode: m })}
                  className={`px-4 py-2 rounded-lg text-[12px] font-bold transition-colors flex items-center gap-1.5 ${theme.mode === m ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-white'}`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>

          {/* Font */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-slate-700">Ukuran Font</p>
              <p className="text-[11px] text-slate-400">Skala teks seluruh halaman</p>
            </div>
            <div className="flex rounded-xl border border-slate-200 p-1 gap-1 bg-slate-50">
              {ZOOM_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateTheme({ zoom: opt.value })}
                  className={`px-3 py-2 rounded-lg text-[12px] font-bold transition-colors ${theme.zoom === opt.value ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-white'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Aksen */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-slate-700">Warna Aksen</p>
              <p className="text-[11px] text-slate-400">Warna tombol utama & tab aktif</p>
            </div>
            <div className="flex items-center gap-2">
              {ACCENT_OPTIONS.map(a => (
                <button
                  key={a.key}
                  onClick={() => updateTheme({ accent: a.key })}
                  title={a.label}
                  className={`w-9 h-9 rounded-xl transition-all flex items-center justify-center ${theme.accent === a.key ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: a.swatch }}
                >
                  {theme.accent === a.key && <Check size={15} className="text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-1 border-t border-slate-100 flex items-center justify-between">
            <p className="text-[11px] text-slate-400">
              {theme.mode === 'dark' ? 'Gelap' : 'Terang'} · {ZOOM_OPTIONS.find(z => z.value === theme.zoom)?.label} · {ACCENT_OPTIONS.find(a => a.key === theme.accent)?.label}
            </p>
            <button
              onClick={() => { setTheme({ ...DEFAULT_THEME }); saveTheme({ ...DEFAULT_THEME }); showToast('Pengaturan direset') }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Sistem */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <h3 className="text-lg font-bold text-slate-800 mb-1">Pengaturan Sistem</h3>
        <p className="text-xs text-slate-500 mb-6">Status koneksi dan data lokal</p>

        <div className="grid grid-cols-2 gap-6">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
            <p className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">Status API</p>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${serverState === 'online' ? 'bg-emerald-500' : serverState === 'offline' ? 'bg-amber-500' : 'bg-slate-400'}`} />
              <span className="text-sm font-semibold text-slate-800">
                {serverState === 'online' ? 'Backend Online' : serverState === 'offline' ? 'Offline (Lokal)' : 'Menghubungi...'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">http://localhost:3000/api</p>
            <button
              onClick={async () => {
                const ok = await ensureAdminBackendSession()
                showToast(ok ? 'Backend aktif' : 'Gagal', ok ? 'success' : 'error')
              }}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold text-xs hover:bg-blue-700"
            >
              Tes Koneksi
            </button>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
            <p className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">Data Lokal</p>
            <p className="text-xs text-slate-600">
              {tariffs.length} tarif · {officers.length} petugas · {localTrips.length} trip
            </p>
            <button
              onClick={() => {
                if (confirm('Hapus sesi & keluar?')) onLogout()
              }}
              className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 font-bold text-xs hover:bg-red-100"
            >
              Hapus Sesi & Keluar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
