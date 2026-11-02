import { useCallback, useEffect, useState } from 'react'
import { Clock, Save } from 'lucide-react'
import { api } from '../../../services/api'

/**
 * Panel "Pengaturan Aplikasi" untuk dashboard admin.
 *
 * Saat ini hanya satu pengaturan yang bisa diubah: BATAS UMUR DRAFT TRIP
 * di aplikasi mobile (menit).
 *
 * Kenapa perlu bisa diubah: nilai ini tadinya ditulis langsung di kode
 * aplikasi, jadi mengubahnya berarti build ulang + publications baru ke
 * semua perangkat petugas. Sekarang nilainya dibaca dari server saat
 * aplikasi dibuka, jadi owner bisa menyetelnya (mis. 15 -> 10 menit) dan
 * perangkat petugas baru ikut berubah.
 *
 * Nilai lama (yang sudah tersimpan di perangkat) dipakai sebagai cadangan
 * saat server tidak bisa dihubungi, jadi pengaturan tidak hilang karena
 * sinyal hilang sesaat.
 */

/** Batas bawah/atas yang diterima server (menit). */
const MIN_MINUTES = 1
const MAX_MINUTES = 240

interface SettingsPanelProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function AppSettingsPanel({ showToast }: SettingsPanelProps) {
  const [minutes, setMinutes] = useState<number>(15)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await api.getOk<{ draftTtlMinutes: number }>('/settings')
    if (res && typeof res.draftTtlMinutes === 'number') {
      setMinutes(res.draftTtlMinutes)
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const res = await api.put<{ draftTtlMinutes: number }>('/settings', { draftTtlMinutes: minutes })
      if (res.ok) {
        const applied = res.data?.draftTtlMinutes ?? minutes
        setMinutes(applied)
        showToast(`Batas draft disimpan: ${applied} menit`, 'success')
      } else {
        showToast(res.error?.message || 'Gagal menyimpan pengaturan', 'error')
      }
    } catch {
      showToast('Server tidak bisa dihubungi', 'error')
    } finally {
      setSaving(false)
    }
  }

  const clamp = (n: number) => Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, n))

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Clock size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-bold text-slate-900">Batas Umur Draft Trip</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
            Berapa lama draft trip boleh diisi di aplikasi mobile. Setelah lewat,
            isian draft dikunci — petugas hanya bisa mengirim trip atau membatalkannya
            dengan alasan. Nilai dihitung sejak draft dibuat, bukan sejak terakhir diubah.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Batas (menit)
          </span>
          <input
            type="number"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            value={minutes}
            disabled={!loaded || saving}
            onChange={e => setMinutes(clamp(Number(e.target.value) || MIN_MINUTES))}
            className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-[13px] font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>

        <button
          onClick={() => void save()}
          disabled={!loaded || saving}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Save size={14} />
          {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
        </button>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        Nilai yang berlaku di perangkat petugas diambil saat aplikasi dibuka.
        Perangkat offline memakai nilai terakhir yang berhasil ditarik.
      </p>
    </div>
  )
}
