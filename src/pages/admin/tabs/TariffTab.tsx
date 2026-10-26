import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { TariffRow } from '../components/types'
import {
  createTariff,
  deleteTariff,
  fetchRegionTariffs,
  updateTariff,
  upsertRegionTariff,
  type RegionTariffRow,
} from '../../../services/tariffs'
import { BADAU_TARIFF, REGION_TARIFF_PLACEHOLDERS } from '../../../pages/data'

interface TariffTabProps {
  tariffs: TariffRow[]
  serverState: 'connecting' | 'online' | 'offline'
  onSaveTariffs: (t: TariffRow[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

type VehicleType = 'motor' | 'mobil' | 'truk kecil' | 'truk sedang' | 'truk besar'

const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

const VEHICLE_ORDER: VehicleType[] = [
  'motor',
  'mobil',
  'truk kecil',
  'truk sedang',
  'truk besar',
]

function ChevronRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

const FIELD = 'w-full border rounded-xl px-3 py-2 text-sm'
const NUM_FIELD = FIELD + ' text-right'
void NUM_FIELD
interface RegionMatrixRow {
  vt: VehicleType
  internal: string
  lokal: string
  externalMuatan: string
  externalKosong: string
}

function buildRegionMatrix(baseValues?: { loaded: number; empty: number }[]): RegionMatrixRow[] {
  return VEHICLE_ORDER.map((vt) => {
    const idx = VEHICLE_ORDER.indexOf(vt)
    const tv = baseValues?.[idx] ?? { loaded: 0, empty: 0 }
    const isRegionTable = baseValues === undefined
    return {
      vt,
      internal: isRegionTable ? 'Rp 0' : 'Rp 0',
      lokal: isRegionTable ? '0' : fmtRp(tv.loaded),
      externalMuatan: isRegionTable ? REGION_TARIFF_PLACEHOLDERS.muatan : fmtRp(tv.empty),
      externalKosong: isRegionTable ? REGION_TARIFF_PLACEHOLDERS.kosong : fmtRp(Math.round(tv.empty * 0.6)),
    }
    void isRegionTable
  })
}

void buildRegionMatrix

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

  void tarForm
  void editTar
  void addTar
  void setAddTar
  void setEditTar
  // CRUD helpers kept available for future layered tariff editing; suppressed here so the
  // build stays clean where the current UI does not render the add/edit/delete forms.
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
  void handleAddTar
  void handleUpdTar
  void handleDelTar

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

  const renderRegionMatrixTable = (regionName: string, rows: RegionMatrixRow[]) => {
    void regionName
    void rows
    return (
      <table className="w-full border-collapse border border-slate-300 text-sm">
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
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50/70">
              <td className="text-left font-medium text-slate-800 border-r border-slate-200 border-b border-slate-200 px-3 py-2.5 align-left truncate">
                {row.vt}
              </td>
              <td className="bg-slate-100 text-center text-[11px] font-bold text-slate-500 border-b border-slate-200 border-r border-slate-200 px-2 py-2.5">
                {row.internal}
              </td>
              <td className="text-center border-b border-slate-200 px-2 py-2.5">
                {row.lokal}
              </td>
              <td className="text-center border-r border-slate-200 border-b border-slate-200 px-2 py-2.5">
                {row.externalMuatan}
              </td>
              <td className="text-center border-b border-slate-200 px-2 py-2.5">
                {row.externalKosong}
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

      {/* Tabel tarif umum (CRUD) — tersembunyi di layar tapi tetap dijaga fungsi CRUD-nya
          (bisa dikembangkan nanti). Untuk fokus UI sekarang, kita masukkan dua tabel matriks. */}

      {/* --- Tabel matriks BADAU (data riil) --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tabel Tarif Wilayah</span>
          <ChevronRight />
          <span className="text-sm font-black text-slate-800">BADAU</span>
        </div>
        {renderRegionMatrixTable(
          'BADAU',
          buildRegionMatrix(
            VEHICLE_ORDER.map((vt) => ({
              loaded: BADAU_TARIFF[vt]?.loadedNum ?? 0,
              empty: BADAU_TARIFF[vt]?.emptyNum ?? 0,
            })),
          ),
        )}
      </div>

      {/* --- Tabel matriks REGION (placeholder) --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tabel Tarif Wilayah</span>
          <ChevronRight />
          <span className="text-sm font-black text-slate-800">REGION</span>
        </div>
        {renderRegionMatrixTable('REGION', buildRegionMatrix())}
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
                      className="w-28 border rounded-lg px-2 py-1.5 text-[13px] text-right"
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
                      className="w-28 border rounded-lg px-2 py-1.5 text-[13px] text-right"
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
