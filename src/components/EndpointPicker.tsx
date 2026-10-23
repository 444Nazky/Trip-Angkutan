import { useState } from 'react'
import { Cloud, RefreshCw, Server } from 'lucide-react'
import {
  apiBaseCandidateLabel,
  apiBaseCandidates,
  isIntranetBaseUrl,
  isPrivateHostUrl,
  normalizeApiBaseInput,
  probeServerHealth,
  resolveApiBaseUrl,
  setApiBaseUrlOverride,
} from '../services/api'

interface Props {
  /** Dipanggil setelah endpoint berhasil diterapkan. */
  onApplied?: (url: string) => void
  /** Tampilkan judul + deskripsi di atas daftar. */
  withHeader?: boolean
}

type Status = { kind: 'idle' | 'checking' | 'ok' | 'warn' | 'fail'; msg: string }

function messageFor(r: Awaited<ReturnType<typeof probeServerHealth>>): Status {
  if (r.reachable && r.blockedByCors) {
    return { kind: 'warn', msg: `Server hidup (${r.ms} ms), tetapi browser memblokir CORS. URL tetap disimpan — minta admin menambahkan origin ini ke CORS_ORIGIN.` }
  }
  if (r.reachable) {
    if (typeof r.status === 'number' && (r.status < 200 || r.status >= 400)) {
      return { kind: 'warn', msg: `Server menjawab HTTP ${r.status} (${r.ms} ms). Host hidup — cek alamat /api. URL disimpan.` }
    }
    return { kind: 'ok', msg: `Tersambung (${r.ms} ms). Endpoint diterapkan.` }
  }
  if (r.timedOut) return { kind: 'fail', msg: `Server tidak merespon (timeout ${r.ms} ms). URL lama tetap dipakai.` }
  return { kind: 'fail', msg: `Server tidak merespon (${r.ms} ms)${r.detail && r.detail !== 'Failed to fetch' ? ` — ${r.detail}` : ''}. URL lama tetap dipakai.` }
}

export default function EndpointPicker({ onApplied, withHeader = true }: Props) {
  const [url, setUrl] = useState(() => resolveApiBaseUrl())
  const [status, setStatus] = useState<Status>({ kind: 'idle', msg: '' })
  const [busy, setBusy] = useState(false)

  const activeUrl = resolveApiBaseUrl()
  const candidates = apiBaseCandidates()

  function apply(next: string) {
    setApiBaseUrlOverride(normalizeApiBaseInput(next))
    const applied = resolveApiBaseUrl()
    setUrl(applied)
    onApplied?.(applied)
    return applied
  }

  async function handleTestAndApply() {
    const v = url.trim()
    if (!v) {
      setStatus({ kind: 'fail', msg: 'URL kosong.' })
      return
    }
    if (/^http:\/\//i.test(v) && !isPrivateHostUrl(v)) {
      setStatus({ kind: 'fail', msg: 'Pakai https untuk host publik. http:// hanya untuk alamat LAN/privat.' })
      return
    }
    setBusy(true)
    setStatus({ kind: 'checking', msg: 'Mengetes koneksi…' })
    const r = await probeServerHealth(normalizeApiBaseInput(v))
    setBusy(false)
    if (r.reachable) {
      apply(v)
      setStatus(messageFor(r))
      return
    }
    setStatus(messageFor(r))
  }

  async function handleTestOnly() {
    setBusy(true)
    setStatus({ kind: 'checking', msg: 'Mengetes koneksi…' })
    const r = await probeServerHealth(normalizeApiBaseInput(url))
    setBusy(false)
    setStatus(messageFor(r))
  }

  function handleSaveForce() {
    const v = url.trim()
    if (!v) {
      setStatus({ kind: 'fail', msg: 'URL kosong.' })
      return
    }
    const applied = apply(v)
    setStatus({ kind: 'warn', msg: `URL disimpan tanpa tes: ${applied}` })
  }

  async function handleReset() {
    setBusy(true)
    setApiBaseUrlOverride(null)
    const applied = resolveApiBaseUrl()
    setUrl(applied)
    onApplied?.(applied)
    setStatus({ kind: 'checking', msg: 'Kembali ke default, mengetes…' })
    const r = await probeServerHealth(applied)
    setBusy(false)
    setStatus(r.reachable
      ? { kind: r.blockedByCors ? 'warn' : 'ok', msg: `Default aktif (${r.ms} ms)${r.blockedByCors ? ' — browser memblokir CORS' : ''}.` }
      : { kind: 'fail', msg: `Default tidak merespon (${r.ms} ms).` })
  }

  return (
    <div className="space-y-4">
      {withHeader && (
        <div>
          <h3 className="text-lg font-bold text-slate-800 mb-1">Pilih Endpoint</h3>
          <p className="text-xs text-slate-500">
            Tentukan server mana yang dipakai aplikasi: Supabase (cloud, butuh internet) atau Intranet kantor (LAN).
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {candidates.map((c) => {
          const selected = c.url === activeUrl
          const isCloud = !isIntranetBaseUrl(c.url)
          return (
            <button
              key={c.url}
              type="button"
              onClick={() => { setStatus({ kind: 'idle', msg: '' }); setUrl(c.url) }}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                selected ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isCloud ? 'bg-sky-100 text-sky-600' : 'bg-emerald-100 text-emerald-600'}`}>
                {isCloud ? <Cloud size={16} /> : <Server size={16} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-slate-800">
                  {c.label}
                  {selected && <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">Aktif</span>}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">{c.url}</span>
                {c.hint && <span className="mt-0.5 block text-[10px] text-slate-400">{c.hint}</span>}
              </span>
            </button>
          )
        })}
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">URL manual</label>
        <input
          type="url"
          value={url}
          onChange={e => { setStatus({ kind: 'idle', msg: '' }); setUrl(e.target.value) }}
          placeholder="http://192.168.1.123:3000/api"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-blue-500"
        />
        <p className="mt-1 text-[10px] text-slate-400">
          Aktif sekarang: <span className="font-semibold text-slate-600">{activeUrl}</span>
          {apiBaseCandidateLabel(activeUrl) ? ` (${apiBaseCandidateLabel(activeUrl)})` : ''}
        </p>
      </div>

      {status.msg !== '' && (
        <div className={`rounded-lg px-3 py-2 ${status.kind === 'ok' ? 'bg-emerald-50' : status.kind === 'warn' ? 'bg-amber-50' : status.kind === 'fail' ? 'bg-red-50' : 'bg-slate-100'}`}>
          <p className={`text-[11px] ${status.kind === 'ok' ? 'text-emerald-700' : status.kind === 'warn' ? 'text-amber-700' : status.kind === 'fail' ? 'text-red-600' : 'text-slate-500'}`}>
            {status.msg}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void handleTestAndApply()}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Memproses…' : 'Simpan & Terapkan'}
        </button>
        <button
          onClick={() => void handleTestOnly()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={13} /> Tes Koneksi
        </button>
        <button
          onClick={() => void handleReset()}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          Reset ke Default
        </button>
        <button
          onClick={handleSaveForce}
          disabled={busy}
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
        >
          Simpan tanpa tes
        </button>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-400">
        Antrian data offline tetap tersimpan dan dikirim ke endpoint yang sedang aktif. Kalau server intranet
        tidak bisa dihubungi, pindah kembali ke Supabase (Cloud).
      </p>
    </div>
  )
}
