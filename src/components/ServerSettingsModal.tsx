import { useState } from 'react'
import { Cloud, Server, X } from 'lucide-react'
import {
  applyEndpointInput,
  apiBaseCandidateLabel,
  apiBaseCandidates,
  defaultApiBaseUrl,
  isIntranetBaseUrl,
  probeServerHealth,
  resolveApiBaseUrl,
  setApiBaseUrlOverride,
  validateEndpointInput,
} from '../services/api'



interface Props {
  onClose: () => void
}



type Status = { kind: 'idle' | 'checking' | 'ok' | 'warn' | 'fail'; msg: string }

// Terjemahkan hasil probe jadi pesan yang benar: server hidup tapi diblokir CORS BUKAN "server tidak merespon"
function statusFromProbe(
  ms: number,
  reachable: boolean,
  blockedByCors: boolean,
  _status?: number,
  timedOut?: boolean,
  cleartextBlocked?: boolean,
  detail?: string,
): Status {
  // `blockedByCors` kini hanya diisi setelah probe opaque membuktikan host benar-benar menjawab.
  if (blockedByCors) {
    return {
      kind: 'warn',
      msg: `Server hidup (${ms} ms) tetapi browser memblokir CORS. URL disimpan. Minta admin menambahkan origin ini ke CORS_ORIGIN server.`,
    }
  }
  if (reachable) {
    // Host hidup tetapi menjawab HTTP error (mis. 404 karena path /api berbeda). Tetap disimpan, hanya diberi peringatan
    if (typeof _status === 'number' && (_status < 200 || _status >= 400)) {
      return {
        kind: 'warn',
        msg: `Server menjawab HTTP ${_status} (${ms} ms) — host hidup, cek apakah alamat /api sudah benar. URL disimpan.`,
      }
    }
    return { kind: 'ok', msg: `Tersambung (${ms} ms). URL diterapkan.` }
  }
  if (cleartextBlocked) {
    return {
      kind: 'fail',
      msg: `${detail ?? `http:// diblokir APK (hanya HTTPS).`} URL lama tetap dipakai.`,
    }
  }
  if (timedOut) {
    return { kind: 'fail', msg: `Server tidak merespon (timeout ${ms} ms). Periksa URL/jaringan. URL lama tetap dipakai.` }
  }
  return {
    kind: 'fail',
    msg: `Server tidak merespon (${ms} ms)${detail && detail !== 'Failed to fetch' ? ` — ${detail}` : ''}. Periksa URL/jaringan. URL lama tetap dipakai.`,
  }
}



export default function ServerSettingsModal({ onClose }: Props) {
  const [url, setUrl] = useState(resolveApiBaseUrl())
  const [status, setStatus] = useState<Status>({ kind: 'idle', msg: '' })

  const activeUrl = resolveApiBaseUrl()
  const candidates = apiBaseCandidates()

  async function handleSave() {
    // Validasi dipusatkan di api.ts (validateEndpointInput) supaya layar ini dan EndpointPicker tidak pernah berbeda aturan soal http/https & mixed content.
    const check = validateEndpointInput(url)
    if (!check.ok) {
      setStatus({ kind: 'fail', msg: check.msg })
      return
    }
    setStatus({ kind: 'checking', msg: 'Mengetes koneksi…' })
    const r = await probeServerHealth(check.url)
    if (r.reachable || r.hostAlive) {
      applyEndpointInput(check.url)
      setUrl(resolveApiBaseUrl())
    }
    setStatus(statusFromProbe(r.ms ?? 0, r.reachable, r.blockedByCors ?? false, r.status, r.timedOut ?? false, r.cleartextBlocked ?? false, r.detail))
  }

  // Jalur darurat: tes bisa gagal karena sebab di luar URL (CORS, mixed content, jaringan uji)
  function handleSaveForce() {
    const res = applyEndpointInput(url)
    if (!res.ok) {
      setStatus({ kind: 'fail', msg: res.msg })
      return
    }
    setUrl(res.url)
    setStatus({
      kind: 'warn',
      msg: `URL disimpan tanpa tes: ${res.url}. Kalau sinkron tetap gagal, periksa server/CORS di alamat ini.`,
    })
  }

  async function handleReset() {
    setApiBaseUrlOverride(null)
    setUrl(resolveApiBaseUrl())
    setStatus({ kind: 'checking', msg: 'Kembali default, mengetes…' })
    const r = await probeServerHealth(resolveApiBaseUrl())
    setStatus(r.reachable
      ? { kind: r.blockedByCors ? 'warn' : 'ok', msg: `Default aktif (${r.ms} ms)${r.blockedByCors ? ' — browser memblokir CORS' : ''}.` }
      : { kind: 'fail', msg: `Default tidak merespon (${r.ms} ms). Periksa koneksi internet atau isi URL server.` })
  }

  function pickPreset(candidateUrl: string) {
    setStatus({ kind: 'idle', msg: '' })
    setUrl(candidateUrl)
  }

  return (
    <div className="mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Server size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-800">Pengaturan Server</p>
          <p className="truncate text-[10px] text-slate-400">
            Aktif: {activeUrl}
            {apiBaseCandidateLabel(activeUrl) ? ` (${apiBaseCandidateLabel(activeUrl)})` : ''}
          </p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Tutup">
          <X size={18} />
        </button>
      </div>


      <div className="mt-3 grid grid-cols-1 gap-2">
        {candidates.map((c) => {
          const selected = c.url === activeUrl
          const isCloud = !isIntranetBaseUrl(c.url)
          return (
            <button
              key={c.url}
              type="button"
              onClick={() => pickPreset(c.url)}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                selected
                  ? 'border-[#1B3D6D] bg-[#1B3D6D]/5'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isCloud ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'}`}>
                {isCloud ? <Cloud size={13} /> : <Server size={13} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-slate-800">
                  {c.label}
                  {selected && <span className="ml-1.5 text-[10px] font-medium text-[#1B3D6D]">- dipakai</span>}
                </span>
                <span className="block truncate text-[10px] text-slate-400">{c.url}</span>
                {c.hint && <span className="block text-[10px] text-slate-400">{c.hint}</span>}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3">
        <input
          type="url"
          value={url}
          onChange={e => { setStatus({ kind: 'idle', msg: '' }); setUrl(e.target.value) }}
          placeholder="http://192.168.1.123:3000/api"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-[#1B3D6D] transition-colors"
        />
        <p className="mt-1 text-[10px] text-slate-400">
          Default: {defaultApiBaseUrl()}
        </p>
      </div>

      {status.msg !== '' && (
        <div className={`mt-2 rounded-lg px-3 py-2 ${status.kind === 'ok' ? 'bg-emerald-50' : status.kind === 'warn' ? 'bg-amber-50' : status.kind === 'fail' ? 'bg-red-50' : 'bg-slate-100'}`}>
          <p className={`text-[11px] ${status.kind === 'ok' ? 'text-emerald-600' : status.kind === 'warn' ? 'text-amber-700' : status.kind === 'fail' ? 'text-red-500' : 'text-slate-500'}`}>
            {status.msg}
          </p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={status.kind === 'checking'}
          className="flex-1 rounded-lg bg-[#1B3D6D] py-2 font-medium text-xs text-white hover:bg-[#0f2847] disabled:opacity-50 transition-colors"
        >
          Simpan & Terapkan
        </button>
        <button
          onClick={() => void handleReset()}
          disabled={status.kind === 'checking'}
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          Reset
        </button>
      </div>

      <div className="mt-2">
        <button
          onClick={handleSaveForce}
          disabled={status.kind === 'checking'}
          className="w-full rounded-lg border border-slate-200 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          Simpan tanpa tes
        </button>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
        Ganti endpoint anytime. Antrian data offline tetap tersimpan dan dikirim ke server yang sedang aktif.
        Kalau server tidak bisa dihubungi, periksa alamat dan pastikan server kantor menyala.
      </p>
    </div>
  )
}
