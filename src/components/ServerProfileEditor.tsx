import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { getServerProfile, saveServerProfile, type ServerProfile } from '../services/api'

interface Props {
  onSaved: (profile: ServerProfile) => void
  onCancel: () => void
}

/**
 * Editor nama + URL server utama.
 *
 * Dipakai halaman login (Pengaturan Server) dan halaman server di aplikasi
 * mobile. Keduanya membaca/menulis profil yang sama di localStorage, jadi
 * perubahan di satu tempat langsung terlihat di tempat lain.
 */
export default function ServerProfileEditor({ onSaved, onCancel }: Props) {
  const initial = getServerProfile()
  const [label, setLabel] = useState(initial.label)
  const [url, setUrl] = useState(initial.url)
  const [error, setError] = useState('')

  function handleSave() {
    const res = saveServerProfile({ label, url })
    if (!res.ok) {
      setError(res.msg)
      return
    }
    onSaved(getServerProfile())
  }

  return (
    <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/70 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-slate-700">Edit Server</p>
        <button onClick={onCancel} aria-label="Tutup" className="text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      </div>

      <input
        value={label}
        onChange={e => { setError(''); setLabel(e.target.value) }}
        placeholder="Nama server"
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-300 focus:border-blue-500 focus:outline-none"
      />
      <input
        type="url"
        value={url}
        onChange={e => { setError(''); setUrl(e.target.value) }}
        placeholder="http://192.168.1.123:3000/api"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-300 focus:border-blue-500 focus:outline-none"
      />

      {error && <p className="text-[10px] text-red-600">{error}</p>}

      <button
        onClick={handleSave}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#1B3D6D] py-2 text-xs font-bold text-white transition-colors hover:bg-[#0f2847]"
      >
        <Check size={13} /> Simpan Server
      </button>
    </div>
  )
}
