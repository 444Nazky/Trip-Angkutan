import { useState } from 'react'
import { Server, X } from 'lucide-react'
import { api, resolveApiBaseUrl, setApiBaseUrlOverride } from '../services/api'
import { environment } from '../environments/environment'




interface Props {
  onClose: () => void
}




type Status = { kind: 'idle' | 'checking' | 'ok' | 'fail'; msg: string }




// cek url baru sebelum disimpan
async function probeUrl(raw: string): Promise<{ ok: boolean; ms: number }> {
  let url = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  if (!/\/api$/i.test(url)) url = `${url}/api`
  const t0 = Date.now()
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), 10000)
    try {
      const r = await fetch(`${url}/health?_t=${Date.now()}`, { cache: 'no-store', signal: c.signal })
      return { ok: r.ok, ms: Date.now() - t0 }
    } finally {
      clearTimeout(t)
    }
  } catch {
    return { ok: false, ms: Date.now() - t0 }
  }
}




export default function ServerSettingsModal({ onClose }: Props) {
  const [url, setUrl] = useState(api.baseUrl)
  const [status, setStatus] = useState<Status>({ kind: 'idle', msg: '' })




  async function handleSave() {
    const v = url.trim()
    if (!v) {
      setStatus({ kind: 'fail', msg: 'URL kosong.' })
      return
    }
    if (/^http:\/\//i.test(v) && !/localhost|127\.0\.0\.1|192\.168\.|10\./.test(v)) {
      setStatus({ kind: 'fail', msg: 'Pakai https, kecuali localhost/LAN.' })
      return
    }
    setStatus({ kind: 'checking', msg: 'Mengetes koneksi…' })
    const r = await probeUrl(v)
    if (!r.ok) {
      setStatus({ kind: 'fail', msg: `Server tidak merespon (${r.ms} ms). URL lama tetap dipakai.` })
      return
    }
    setApiBaseUrlOverride(v)
    setUrl(api.baseUrl)
    setStatus({ kind: 'ok', msg: `Tersambung (${r.ms} ms). Silakan login ulang.` })
  }




  async function handleReset() {
    setApiBaseUrlOverride(null)
    setUrl(api.baseUrl)
    setStatus({ kind: 'checking', msg: 'Kembali default, mengetes…' })
    const r = await probeUrl(api.baseUrl)
    setStatus(r.ok
      ? { kind: 'ok', msg: `Default aktif (${r.ms} ms).` }
      : { kind: 'fail', msg: 'Default tidak merespon.' })
  }




  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Server size={16} />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800">Pengaturan Server</p>
            <p className="text-[11px] text-slate-400">Aktif: {resolveApiBaseUrl()}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Tutup">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4">
          <input
            type="url"
            value={url}
            onChange={e => { setStatus({ kind: 'idle', msg: '' }); setUrl(e.target.value) }}
            placeholder="https://xxxx.trycloudflare.com"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-[#1B3D6D] transition-colors"
          />
          <p className="mt-1.5 text-[11px] text-slate-400">Default: {environment.apiBaseUrl}</p>
        </div>

        {status.msg !== '' && (
          <div className={`mt-3 px-4 py-3 rounded-xl ${status.kind === 'ok' ? 'bg-emerald-50' : status.kind === 'fail' ? 'bg-red-50' : 'bg-slate-100'}`}>
            <p className={`text-xs ${status.kind === 'ok' ? 'text-emerald-600' : status.kind === 'fail' ? 'text-red-500' : 'text-slate-500'}`}>
              {status.msg}
            </p>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => void handleSave()}
            disabled={status.kind === 'checking'}
            className="flex-1 py-3 rounded-xl font-medium text-sm text-white bg-[#1B3D6D] hover:bg-[#0f2847] disabled:opacity-50 transition-colors"
          >
            Simpan & Terapkan
          </button>
          <button
            onClick={() => void handleReset()}
            disabled={status.kind === 'checking'}
            className="px-4 py-3 rounded-xl text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}
