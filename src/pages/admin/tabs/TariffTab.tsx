import { useState } from 'react'
import { Plus, Edit2, Trash2, Save } from 'lucide-react'
import type { TariffRow } from '../components/types'
import {
  createTariff,
  updateTariff,
  deleteTariff,
  fetchRegionTariffs,
  upsertRegionTariff,
  type RegionTariffRow,
} from '../../../services/tariffs'

interface TariffTabProps {
  tariffs: TariffRow[]
  serverState: 'connecting' | 'online' | 'offline'
  onSaveTariffs: (t: TariffRow[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

const VEHICLE_TYPES = ['motor', 'mobil', 'truk kecil', 'truk sedang', 'truk besar'] as const
type VehicleType = (typeof VEHICLE_TYPES)[number]

const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

function ChevronRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

export function TariffTab({ tariffs, serverState, onSaveTariffs, showToast }: TariffTabProps) {
  const [regionTariffs, setRegionTariffs] = useState<RegionTariffRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [addTar, setAddTar] = useState(false)
  const [editTarIdx, setEditTarIdx] = useState<number | null>(null)
  const [tarForm, setTarForm] = useState({
    golongan: '',
    type: '',
    loaded: '',
    loadedNum: 0,
    empty: '',
    emptyNum: 0,
    desc: '',
  })
  const [editTar, setEditTar] = useState({
    golongan: '',
    type: '',
    loaded: '',
    loadedNum: 0,
    empty: '',
    emptyNum: 0,
    desc: '',
  })

  if (!loaded) {
    fetchRegionTariffs().then((rt) => {
      if (rt) setRegionTariffs(rt)
    })
    setLoaded(true)
  }

  // ---------- helpers CRUD tarif umum ----------
  const handleAddTar = async () => {
    if (!tarForm.type || !tarForm.golongan) return showToast('Lengkapi form!', 'error')
    if (tarForm.loadedNum <= 0) return showToast('Nominal muatan harus lebih dari 0', 'error')
    if (tarForm.emptyNum < 0) return showToast('Nominal kosong tidak boleh negatif', 'error')
    const row: TariffRow = {
      ...tarForm,
      loaded: fmtRp(tarForm.loadedNum),
      empty: fmtRp(tarForm.emptyNum),
    }
    if (serverState === 'online') {
      const id = await createTariff(row)
      if (!id) return showToast('Server menolak tarif — data tidak disimpan', 'error')
      row.id = id
    }
    onSaveTariffs([...tariffs, row])
    setTarForm({ golongan: '', type: '', loaded: '', loadedNum: 0, empty: '', emptyNum: 0, desc: '' })
    setAddTar(false)
    showToast('Tarif ditambahkan')
  }

  const handleUpdTar = async () => {
    if (editTar.loadedNum <= 0) return showToast('Nominal muatan harus lebih dari 0', 'error')
    if (editTar.emptyNum < 0) return showToast('Nominal kosong tidak boleh negatif', 'error')
    const row: TariffRow = {
      ...editTar,
      loaded: fmtRp(editTar.loadedNum),
      empty: fmtRp(editTar.emptyNum),
    }
    if (serverState === 'online' && row.id) {
      const ok = await updateTariff(row)
      if (!ok) return showToast('Server gagal — tarif tidak diubah', 'error')
    }
    const ns = [...tariffs]
    if (editTarIdx !== null) {
      ns[editTarIdx] = row
      onSaveTariffs(ns)
    }
    setEditTarIdx(null)
    showToast('Tarif diupdate')
  }

  const handleDelTar = async (i: number) => {
    if (!confirm('Hapus?')) return
    const row = tariffs[i]
    const ns = tariffs.filter((_, idx) => idx !== i)
    onSaveTariffs(ns)
    if (editTarIdx === i) setEditTarIdx(null)
    else if (editTarIdx !== null && editTarIdx > i) setEditTarIdx(editTarIdx - 1)
    if (serverState === 'online' && row?.id) await deleteTariff(row)
    showToast('Tarif dihapus')
  }

  const handleSaveRegionTariff = async (rt: RegionTariffRow) => {
    const [a, b] = await Promise.all([
      upsertRegionTariff({
        regionId: rt.id,
        tariffType: 'lokal',
        nominal: rt.lokal_tariff ?? 0,
        aktif: !!rt.lokal_active,
      }),
      upsertRegionTariff({
        regionId: rt.id,
        tariffType: 'eksternal',
        nominal: rt.eksternal_tariff ?? 0,
        aktif: !!rt.eksternal_active,
      }),
    ])
    if (!a || !b) return showToast('Server gagal', 'error')
    const fresh = await fetchRegionTariffs()
    if (fresh) setRegionTariffs(fresh)
    showToast(`Tarif region ${rt.code} diupdate`)
  }

  // ---------- matriks tarif regional (BADAU / REGION) ----------
  const renderRegionMatrixTable = (
    regionName: string,
    baseValues?: { loaded: number; empty: number }[],
  ) => {
    const rows = baseValues
      ? VEHICLE_TYPES.map((vt, idx) => {
          const tv = baseValues[idx] ?? { loaded: 0, empty: 0 }
          return { vt, loaded: tv.loaded, empty: tv.empty }
        })
      : VEHICLE_TYPES.map((vt) => ({ vt, loaded: 0, empty: 0 }))

    return (
      <table className="w-full border-collapse border border-slate-300 text-sm">
        {/* Header wilayah */}
        <thead>
          <tr className="bg-slate-100">
            <th
              colSpan={5}
              className="text-center text-base font-black uppercase tracking-wide text-slate-800 border-b border-slate-300 px-2 py-2"
            >
              {regionName}
            </th>
          </tr>
          <tr className="bg-slate-50">
            <th
              colSpan={5}
              className="text-center text-xs font-bold uppercase text-slate-500 border-b border-slate-200 px-2 py-1"
            >
              GOLONGAN
            </th>
          </tr>
          {/* sub-header kolom */}
          <tr className="bg-slate-50">
            <th className="text-left text-[11px] font-bold uppercase text-slate-600 border-r border-slate-200 border-b border-slate-200 px-3 py-2 whitespace-nowrap">
              Jenis
            </th>
            <th className="text-center text-[11px] font-bold uppercase text-slate-600 border-b border-slate-200 px-2 py-2">
              internal
            </th>
            <th className="text-center text-[11px] font-bold uppercase text-slate-600 border-b border-slate-200 px-2 py-2">
              lokal
            </th>
            <th
              colSpan={2}
              className="text-center text-[11px] font-bold uppercase text-slate-600 border-b border-slate-200 px-2 py-2"
            >
              external
            </th>
          </tr>
          <tr className="bg-slate-50">
            <th className="w-0 border-r border-slate-200 border-b border-slate-200 px-3 py-0 text-[10px]"></th>
            <th className="w-0 border-b border-slate-200 px-2 py-0 text-[10px]"></th>
            <th className="w-0 border-b border-slate-200 px-2 py-0 text-[10px]"></th>
            <th className="w-0 text-center text-[10px] font-semibold uppercase text-slate-500 border-b border-slate-200 px-2 py-0">
              muatan
            </th>
            <th className="w-0 text-center text-[10px] font-semibold uppercase text-slate-500 border-b border-slate-200 px-2 py-0">
              kosong
            </th>
          </tr>
        </thead>
        {/* Badan data */}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50/70">
              <td className="text-left font-medium text-slate-800 border-r border-slate-200 border-b border-slate-200 px-3 py-2.5 align-left truncate">
                {row.vt}
              </td>
              {/* kolom internal: filled light gray (dikunci Rp 0) */}
              <td className="bg-slate-100 text-center text-[11px] font-bold text-slate-500 border-b border-slate-200 border-r border-slate-200 px-2 py-2.5">
                Rp 0
              </td>
              {/* kolom lokal:angka akurat jika baseValues ada, jika tidak (REGION) placeholder */}
              <td className="text-center border-b border-slate-200 px-2 py-2.5">
                {baseValues ? fmtRp(row.loaded) : 'tarif muatan'}
              </td>
              {/* external muatan */}
              <td className="text-center border-r border-slate-200 border-b border-slate-200 px-2 py-2.5">
                {baseValues ? fmtRp(row.empty) : 'tarif muatan'}
              </td>
              {/* external kosong */}
              <td className="text-center border-b border-slate-200 px-2 py-2.5">
                {baseValues ? fmtRp(Math.round(row.empty * 0.6)): 'tarif kosong'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header + tombol tambah */}
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
            serverState === 'online' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${serverState === 'online' ? 'bg-emerald-500' : 'bg-amber-500'}`}
          />
          Server: {serverState === 'online' ? 'Tersambung' : 'Offline'}
        </span>
        <button
          onClick={() => setAddTar(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700"
        >
          <Plus size={14} /> Tambah Golongan
        </button>
      </div>

      {/* Form tambah golongan */}
      {addTar && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm max-w-lg">
          <h3 className="font-bold mb-4">Tambah Golongan</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Golongan</label>
              <input
                value={tarForm.golongan}
                onChange={(e) => setTarForm({ ...tarForm, golongan: e.target.value })}
                placeholder="I, II, III"
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Jenis</label>
              <input
                value={tarForm.type}
                onChange={(e) => setTarForm({ ...tarForm, type: e.target.value })}
                placeholder="Truck Besar"
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="text-[11px] text-slate-500 block mb-1">Deskripsi</label>
            <input
              value={tarForm.desc}
              onChange={(e) => setTarForm({ ...tarForm, desc: e.target.value })}
              className="w-full border rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Muatan (Rp)</label>
              <input
                type="number"
                value={tarForm.loadedNum || ''}
                onChange={(e) =>
                  setTarForm({ ...tarForm, loadedNum: parseInt(e.target.value) || 0 })
                }
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Kosong (Rp)</label>
              <input
                type="number"
                value={tarForm.emptyNum || ''}
                onChange={(e) =>
                  setTarForm({ ...tarForm, emptyNum: parseInt(e.target.value) || 0 })
                }
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setAddTar(false)}
              className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold"
            >
              Batal
            </button>
            <button
              onClick={handleAddTar}
              className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700"
            >
              Simpan
            </button>
          </div>
        </div>
      )}

      {/* Modal edit */}
      {editTarIdx !== null && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm max-w-lg">
          <h3 className="font-bold mb-4">Edit Golongan</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Golongan</label>
              <input
                value={editTar.golongan}
                onChange={(e) => setEditTar({ ...editTar, golongan: e.target.value })}
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Jenis</label>
              <input
                value={editTar.type}
                onChange={(e) => setEditTar({ ...editTar, type: e.target.value })}
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="text-[11px] text-slate-500 block mb-1">Deskripsi</label>
            <input
              value={editTar.desc}
              onChange={(e) => setEditTar({ ...editTar, desc: e.target.value })}
              className="w-full border rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Muatan</label>
              <input
                type="number"
                value={editTar.loadedNum || ''}
                onChange={(e) =>
                  setEditTar({ ...editTar, loadedNum: parseInt(e.target.value) || 0 })
                }
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Kosong</label>
              <input
                type="number"
                value={editTar.emptyNum || ''}
                onChange={(e) =>
                  setEditTar({ ...editTar, emptyNum: parseInt(e.target.value) || 0 })
                }
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setEditTarIdx(null)}
              className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold"
            >
              Batal
            </button>
            <button
              onClick={handleUpdTar}
              className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700"
            >
              Update
            </button>
          </div>
        </div>
      )}

      {/* Tabel tarif umum (CRUD) — tersembunyi di layar tapi tetap dijaga fungsi CRUD-nya
          (bisa dikembangkan nanti). Untuk fokus UI sekarang, kita masukkan dua tabel matriks. */}

      {/* --- Tabel matriks BADAU (data riil) --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tabel Tarif Wilayah</span>
          <ChevronRight />
          <span className="text-sm font-black text-slate-800">BADAU</span>
        </div>
        {renderRegionMatrixTable('BADAU', tariffs.length ? [
          {
            loaded: tariffs.find((t) => t.type?.toLowerCase() === 'motor')?.loadedNum ?? 0,
            empty: tariffs.find((t) => t.type?.toLowerCase() === 'motor')?.emptyNum ?? 0,
          },
          {
            loaded: tariffs.find((t) => t.type?.toLowerCase() === 'mobil')?.loadedNum ?? 0,
            empty: tariffs.find((t) => t.type?.toLowerCase() === 'mobil')?.emptyNum ?? 0,
          },
          {
            loaded: tariffs.find((t) => t.type?.toLowerCase() === 'truk kecil')?.loadedNum ?? 0,
            empty: tariffs.find((t) => t.type?.toLowerCase() === 'truk kecil')?.emptyNum ?? 0,
          },
          {
            loaded: tariffs.find((t) => t.type?.toLowerCase() === 'truk sedang')?.loadedNum ?? 0,
            empty: tariffs.find((t) => t.type?.toLowerCase() === 'truk sedang')?.emptyNum ?? 0,
          },
          {
            loaded: tariffs.find((t) => t.type?.toLowerCase() === 'truk besar')?.loadedNum ?? 0,
            empty: tariffs.find((t) => t.type?.toLowerCase() === 'truk besar')?.emptyNum ?? 0,
          },
        ] : undefined)}
      </div>

      {/* --- Tabel matriks REGION (placeholder) --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tabel Tarif Wilayah</span>
          <ChevronRight />
          <span className="text-sm font-black text-slate-800">REGION</span>
        </div>
        {renderRegionMatrixTable('REGION')}
      </div>

      {/* Tabel konfigurasi tarif terpusat (penarifan plat) - tetap ada */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <p className="font-bold text-slate-800">Konfigurasi Tarif Terpusat (Penarifan Plat)</p>
          <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            <p>
              <b className="text-slate-700">Internal</b> = <b>selalu Rp 0</b> (dikunci, tidak dapat diubah).
            </p>
            <p>
              <b className="text-slate-700">Lokal</b> = tarif cadangan kebijakan —{' '}
              <b>bisa diubah</b> per region dan dapat diaktifkan/nonaktifkan.
            </p>
            <p>
              <b className="text-slate-700">Eksternal</b> = tarif region pos pemeriksaan (menyesuaikan region).
            </p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
            <tr>
              <th className="text-left p-4">Region</th>
              <th className="text-left p-4">Internal</th>
              <th className="text-left p-4">Lokal (Rp)</th>
              <th className="text-left p-4">Eksternal (Rp)</th>
              <th className="text-right p-4">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-slate-50/60">
              <td className="p-4 font-bold text-slate-600">Semua region</td>
              <td className="p-4">
                <span className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-[11px] font-black px-2.5 py-1 rounded-full">
                  Rp 0 - Dikunci
                </span>
              </td>
              <td className="p-4 text-[11px] text-slate-400" colSpan={2}>
                Plat internal tidak dikenakan tarif
              </td>
              <td className="p-4 text-right text-[11px] text-slate-300">—</td>
            </tr>
            {regionTariffs.map((rt, i) => (
              <tr key={rt.id} className="hover:bg-slate-50">
                <td className="p-4 font-bold">
                  {rt.name}{' '}
                  <span className="text-slate-400 font-mono text-[11px] font-normal">
                    {rt.code}
                  </span>
                </td>
                <td className="p-4">
                  <span className="bg-slate-100 text-slate-500 text-[11px] font-bold px-2.5 py-1 rounded-full">
                    Rp 0 (dikunci)
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={rt.lokal_tariff ?? 0}
                      onChange={(e) => {
                        const v = [...regionTariffs]
                        v[i] = { ...rt, lokal_tariff: parseInt(e.target.value) || 0 }
                        setRegionTariffs(v)
                      }}
                      className="w-28 border rounded-lg px-2 py-1.5 text-[13px]"
                    />
                    <label className="flex items-center gap-1 text-[11px] text-slate-500 font-semibold">
                      <input
                        type="checkbox"
                        checked={!!rt.lokal_active}
                        onChange={(e) => {
                          const v = [...regionTariffs]
                          v[i] = { ...rt, lokal_active: e.target.checked ? 1 : 0 }
                          setRegionTariffs(v)
                        }}
                      />
                      Aktif
                    </label>
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={rt.eksternal_tariff ?? 0}
                      onChange={(e) => {
                        const v = [...regionTariffs]
                        v[i] = { ...rt, eksternal_tariff: parseInt(e.target.value) || 0 }
                        setRegionTariffs(v)
                      }}
                      className="w-28 border rounded-lg px-2 py-1.5 text-[13px]"
                    />
                    <label className="flex items-center gap-1 text-[11px] text-slate-500 font-semibold">
                      <input
                        type="checkbox"
                        checked={!!rt.eksternal_active}
                        onChange={(e) => {
                          const v = [...regionTariffs]
                          v[i] = { ...rt, eksternal_active: e.target.checked ? 1 : 0 }
                          setRegionTariffs(v)
                        }}
                      />
                      Aktif
                    </label>
                  </div>
                </td>
                <td className="p-4 text-right">
                  <button
                    onClick={() => void handleSaveRegionTariff(rt)}
                    className="text-blue-600 font-bold text-sm"
                  >
                    Simpan
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
