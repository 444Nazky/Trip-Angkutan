import { useState } from 'react'
import { Server, X } from 'lucide-react'
import { api, apiBaseCandidateLabel, apiBaseCandidates, isPrivateHostUrl, normalizeApiBaseInput, probeServerHealth, resolveApiBaseUrl, setApiBaseUrlOverride } from '../services/api'
import { environment } from '../environments/environment'




interface Props {
  onClose: () => void
}




type Status = { kind: 'idle' | 'checking' | 'ok' | 'warn' | 'fail'; msg: string }




// Terjemahkan hasil probe jadi pesan yang benar: server hidup tapi diblokir CORS
// BUKAN "server tidak merespon" — dulu pesan itu yang membuat URL benar ikut dibuang.
function statusFromProbe(
  ms: number,
  reachable: boolean,
  blockedByCors: boolean,
  _status?: number,
  timedOut?: boolean,
  cleartextBlocked?: boolean,
  detail?: string,
): Status {
  if (reachable && blockedByCors) {
    return {
      kind: 'warn',
      msg: `Server hidup (${ms} ms) tetapi browser memblokir CORS. URL disimpan. Minta admin menambahkan origin ini ke CORS_ORIGIN server.`,
    }
  }
  if (reachable) {
    // Host hidup tetapi menjawab HTTP error (mis. 404 karena path /api berbeda).
    // Tetap disimpan, hanya diberi peringatan — dulu ini dilaporkan "tidak merespon"
    // sehingga URL yang sebenarnya benar ikut dibuang.
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
  const [url, setUrl] = useState(api.baseUrl)
  const [status, setStatus] = useState<Status>({ kind: 'idle', msg: '' })




  async function handleSave() {
    const v = url.trim()
    if (!v) {
      setStatus({ kind: 'fail', msg: 'URL kosong.' })
      return
    }
    if (/^http:\/\//i.test(v) && !isPrivateHostUrl(v)) {
      setStatus({ kind: 'fail', msg: 'Pakai https untuk host publik, kecuali alamat LAN/privat (192.168.x, 10.x, 172.16-31.x, localhost).' })
      return
    }
    setStatus({ kind: 'checking', msg: 'Mengetes koneksi…' })
    const r = await probeServerHealth(v)
    // URL yang bisa dijangkau tetap disimpan walau browser memblokir bacaannya
    // atau server menjawab HTTP error (host tetap hidup).
    if (r.reachable) {
      setApiBaseUrlOverride(normalizeApiBaseInput(v))
      setUrl(resolveApiBaseUrl())
    }
    setStatus(statusFromProbe(r.ms, r.reachable, r.blockedByCors, r.status, r.timedOut, r.cleartextBlocked, r.detail))
  }




  // Jalur darurat: tes bisa gagal karena sebab di luar URL (CORS, mixed content,
  // jaringan uji) — petugas/admin tetap harus bisa menyimpan URL yang dipilihnya.
  function handleSaveForce() {
    const v = url.trim()
    if (!v) {
      setStatus({ kind: 'fail', msg: 'URL kosong.' })
      return
    }
    setApiBaseUrlOverride(normalizeApiBaseInput(v))
    const applied = resolveApiBaseUrl()
    setUrl(applied)
    setStatus({
      kind: 'warn',
      msg: `URL disimpan tanpa tes: ${applied}. Kalau sinkron tetap gagal, periksa server/CORS di alamat ini.`,
    })
  }




  async function handleReset() {
    setApiBaseUrlOverride(null)
    setUrl(resolveApiBaseUrl())
    setStatus({ kind: 'checking', msg: 'Kembali default, mengetes…' })
    const r = await probeServerHealth(resolveApiBaseUrl())
    setStatus(r.reachable
      ? { kind: r.blockedByCors ? 'warn' : 'ok', msg: `Default aktif (${r.ms} ms)${r.blockedByCors ? ' — browser memblokir CORS' : ''}.` }
      : { kind: 'fail', msg: `Default tidak merespon (${r.ms} ms). Nyalakan backend lokal di port 3000 atau isi URL server.` })
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
            <p className="text-[11px] text-slate-400">
              Aktif: {resolveApiBaseUrl()}
              {apiBaseCandidateLabel(resolveApiBaseUrl()) ? ` (${apiBaseCandidateLabel(resolveApiBaseUrl())})` : ''}
            </p>
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
          <div className={`mt-3 px-4 py-3 rounded-xl ${status.kind === 'ok' ? 'bg-emerald-50' : status.kind === 'warn' ? 'bg-amber-50' : status.kind === 'fail' ? 'bg-red-50' : 'bg-slate-100'}`}>
            <p className={`text-xs ${status.kind === 'ok' ? 'text-emerald-600' : status.kind === 'warn' ? 'text-amber-700' : status.kind === 'fail' ? 'text-red-500' : 'text-slate-500'}`}>
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

        <div className="mt-2 flex gap-2">
          <button
            onClick={handleSaveForce}
            disabled={status.kind === 'checking'}
            className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Simpan tanpa tes
          </button>
        </div>

        <div className="mt-4">
          <p className="text-[11px] font-semibold text-slate-500 mb-2">Pilih cepat</p>
          <div className="flex flex-wrap gap-2">
            {apiBaseCandidates().map(c => (
              <button
                key={c.url}
                onClick={() => { setStatus({ kind: 'idle', msg: '' }); setUrl(c.url) }}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                  normalizeApiBaseInput(url) === c.url
                    ? 'border-[#1B3D6D] bg-[#1B3D6D] text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
                title={c.url}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
