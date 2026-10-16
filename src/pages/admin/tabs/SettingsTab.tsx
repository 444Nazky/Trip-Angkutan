import { Sun, Moon } from 'lucide-react'
import { ZOOM_OPTIONS, ACCENT_OPTIONS, DEFAULT_THEME, loadTheme, saveTheme, applyTheme, type AdminTheme } from '../../../services/theme'
import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { environment } from '../../../environments/environment'
import { ChangePasswordSection } from '../ChangePassword'
import { apiBaseCandidateLabel, apiBaseCandidates, autoDetectApiBaseUrl, normalizeBaseUrl, pingBaseUrl, resolveApiBaseUrl, setApiBaseUrlOverride } from '../../../services/api'




interface SettingsTabProps {
  onLogout: () => void
  serverState: 'connecting' | 'online' | 'offline'
  tariffs: unknown[]
  officers: unknown[]
  showToast: (msg: string, type?: 'success' | 'error') => void
}



export function SettingsTab({ onLogout, serverState, tariffs, officers, showToast }: SettingsTabProps) {
  const [theme, setTheme] = useState<AdminTheme>(() => loadTheme())
  const [serverUrl, setServerUrl] = useState(() => resolveApiBaseUrl())
  const [testing, setTesting] = useState(false)

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

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800 mb-1">Tema & Tampilan</h3>
        <p className="text-xs text-slate-500 mb-6">Sesuaikan tema situs, ukuran font, dan warna aksen</p>

        <div className="space-y-5">

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

      <ChangePasswordSection onLogout={onLogout} showToast={showToast} />
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800 mb-1">Pengaturan Lainnya</h3>
        <p className="text-xs text-slate-500 mb-6">Status koneksi dan data lokal</p>

        <div className="grid grid-cols-2 gap-6">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
            <p className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">Server / Endpoint</p>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${serverState === 'online' ? 'bg-emerald-500' : serverState === 'offline' ? 'bg-amber-500' : 'bg-slate-400'}`} />
              <span className="text-sm font-semibold text-slate-800">
                {serverState === 'online' ? 'Backend Online' : serverState === 'offline' ? 'Offline (Lokal)' : 'Menghubungi...'}
              </span>
            </div>

            <input
              type="url"
              value={serverUrl}
              onChange={e => setServerUrl(e.target.value)}
              placeholder="https://xxxx.trycloudflare.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[11px] text-slate-400 break-all">
              Aktif: {resolveApiBaseUrl()}
              {apiBaseCandidateLabel(resolveApiBaseUrl()) ? ` (${apiBaseCandidateLabel(resolveApiBaseUrl())})` : ''}
              <br />Default: {environment.apiBaseUrl}
            </p>

            <div className="flex flex-wrap gap-1.5">
              {apiBaseCandidates().map(c => (
                <button
                  key={c.url}
                  type="button"
                  onClick={() => setServerUrl(c.url)}
                  title={c.url}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                    normalizeBaseUrl(serverUrl) === c.url
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 text-slate-600 hover:bg-white'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                disabled={testing}
                onClick={async () => {
                  const v = serverUrl.trim()
                  if (!v) { showToast('URL kosong', 'error'); return }
                  if (/^http:\/\//i.test(v) && !/localhost|127\.0\.0\.1|192\.168\.|10\./.test(v)) {
                    showToast('Pakai https, kecuali localhost/LAN', 'error'); return
                  }
                  setTesting(true)
                  const r = await pingBaseUrl(v)
                  setTesting(false)
                  // URL yang bisa dijangkau tetap disimpan walau browser memblokir
                  // bacaannya (origin dashboard belum terdaftar di CORS_ORIGIN server).
                  if (!r.ok) {
                    showToast(r.mixedContent
                      ? (r.detail ?? 'Browser memblokir http:// dari halaman https (mixed content) — URL lama tetap dipakai')
                      : r.timedOut
                        ? `Server tidak merespon (timeout ${r.ms} ms) — URL lama tetap dipakai`
                        : `Server tidak merespon (${r.ms} ms) — URL lama tetap dipakai`, 'error')
                    return
                  }
                  setApiBaseUrlOverride(v)
                  setServerUrl(normalizeBaseUrl(v))
                  showToast(r.blockedByCors
                    ? `Server hidup (${r.ms} ms) tapi browser memblokir CORS. URL disimpan — minta admin server menambahkan origin ini ke CORS_ORIGIN`
                    : `Tersambung (${r.ms} ms), URL diterapkan`, r.blockedByCors ? 'error' : 'success')
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold text-xs hover:bg-blue-700 disabled:opacity-50"
              >
                {testing ? 'Mengetes…' : 'Simpan & Terapkan'}
              </button>
              <button
                disabled={testing}
                onClick={async () => {
                  setApiBaseUrlOverride(null)
                  setServerUrl(resolveApiBaseUrl())
                  setTesting(true)
                  const r = await pingBaseUrl(resolveApiBaseUrl())
                  setTesting(false)
                  showToast(r.ok
                    ? `Kembali default (${r.ms} ms)${r.blockedByCors ? ' — browser memblokir CORS' : ''}`
                    : `Default tidak merespon (${r.ms} ms)`, r.ok ? 'success' : 'error')
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 disabled:opacity-50"
              >
                Reset ke Default
              </button>
              <button
                disabled={testing}
                onClick={async () => {
                  setTesting(true)
                  const r = await pingBaseUrl(serverUrl)
                  setTesting(false)
                  showToast(
                    r.ok
                      ? `Backend aktif (${r.ms} ms)${typeof r.status === 'number' ? ` — HTTP ${r.status}` : ''}`
                      : r.mixedContent
                        ? (r.detail ?? 'http:// diblokir dari halaman https (mixed content)')
                        : `Gagal (${r.ms} ms)`,
                    r.ok ? 'success' : 'error',
                  )
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 disabled:opacity-50"
              >
                Tes Koneksi
              </button>
              <button
                disabled={testing}
                onClick={async () => {
                  setTesting(true)
                  const found = await autoDetectApiBaseUrl()
                  setTesting(false)
                  if (!found) {
                    showToast('Tidak ada endpoint kandidat yang menjawab — isi URL manual', 'error')
                    return
                  }
                  setServerUrl(found)
                  showToast(`Endpoint terjangkau: ${apiBaseCandidateLabel(found) ?? found}`, 'success')
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 disabled:opacity-50"
              >
                Deteksi Otomatis
              </button>
              <button
                disabled={testing}
                onClick={() => {
                  const v = serverUrl.trim()
                  if (!v) { showToast('URL kosong', 'error'); return }
                  setApiBaseUrlOverride(v)
                  const applied = resolveApiBaseUrl()
                  setServerUrl(applied)
                  showToast(`URL disimpan tanpa tes: ${applied}`, 'success')
                }}
                className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 font-bold text-xs hover:bg-amber-100 disabled:opacity-50"
              >
                Simpan tanpa tes
              </button>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
            <p className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">Data Lokal</p>
            <p className="text-xs text-slate-600">
              {tariffs.length} tarif · {officers.length} petugas
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
