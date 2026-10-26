import { useState } from 'react'
import { Plus, Edit2, Trash2, Check, X } from 'lucide-react'
import type { TariffRow } from '../components/types'
import {
  createTariff,
  deleteTariff,
  fetchRegionTariffs,
  updateTariff,
  upsertRegionTariff,
  type RegionTariffRow,
} from '../../../services/tariffs'
import { BADAU_TARIFF, REGION_TARIFF_PLACEHOLDERS, tariffData } from '../../../pages/data'
import {
  type MatrixRow,
  type EditableMatrixState,
  createEditableMatrixState,
  makeInitialMatrixRow,
  startAdd,
  cancelAdd,
  updateAddForm,
  commitAdd,
  startEdit,
  cancelEdit,
  updateEditForm,
  commitEdit,
  removeRow,
  cellInputClass,
  guessVehicleTypeFromLabel,
} from './_tariffMatrix'interface TariffTabProps {
  tariffs: TariffRow[]
  serverState: 'connecting' | 'online' | 'offline'
  onSaveTariffs: (t: TariffRow[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export type VehicleType = 'motor' | 'mobil' | 'truk kecil' | 'truk sedang' | 'truk besar'

export type BadauAddType = VehicleType | null

export type RegionAddType = VehicleType | null

const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

export const VEHICLE_ORDER: VehicleType[] = [
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

function fmtRpEdit(n: number): string {
  return n.toLocaleString('id-ID')
}

function parseNonNeg(v: string) {
  const n = parseInt(v, 10)
  return isNaN(n) ? 0 : Math.max(0, n)
}

function buildBadauMatrixWithAudit() {
  const rows: MatrixRow[] = []
  for (const vt of VEHICLE_ORDER) {
    const src = BADAU_TARIFF[vt]
    if (!src) continue
    rows.push({
      vt,
      cells: {
        internal: src.loadedNum === 0 ? 0 : src.loadedNum,
        lokal: src.loadedNum,
        externalMuatan: src.emptyNum,
        externalKosong: 0,
      },
    })
  }
  rows.sort((a, b) => VEHICLE_ORDER.indexOf(a.vt) - VEHICLE_ORDER.indexOf(b.vt))
  return rows
}

function renderBadauCell(n: number, placeholder: boolean): string {
  if (placeholder) return '0'
  if (n === 0) return '0'
  return fmtRp(n)
}

function renderRegionMatrixTable(
  label: 'BADAU' | 'REGION',
  state: EditableMatrixState,
  placeholder: boolean,
) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left p-3 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200 w-[160px]">Jenis</th>
            <th className="text-center p-3 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200 w-[90px]">internal</th>
            <th className="text-center p-3 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200 w-[110px]">lokal</th>
            <th className="text-center p-3 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <span className="inline-flex flex-wrap items-center justify-center gap-1">
                external
                <span className="text-[10px] font-normal text-slate-400">(muatan / kosong)</span>
              </span>
            </th>
            <th className="text-center p-3 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200 w-[120px]">aksi</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row) => (
            <RegionMatrixRowInner
              key={row.vt}
              row={row}
              placeholder={placeholder}
              renderCellValue={renderBadauCell}
              state={state}
              setState={(next) => {/* no-op: this table uses its own local state */}}
              onSave={() => {}}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RegionAddForm({
  vt,
  form,
  setForm,
  onSaveRegion,
  onCancel,
  lokal,
  setLokal,
  externalMuatan,
  setExternalMuatan,
  externalKosong,
  setExternalKosong,
}: {
  vt: VehicleType
  form: { lokal: string; externalMuatan: string; externalKosong: string }
  setForm: (next: { lokal: string; externalMuatan: string; externalKosong: string }) => void
  onSaveRegion: () => void
  onCancel: () => void
  lokal: string
  setLokal: (v: string) => void
  externalMuatan: string
  setExternalMuatan: (v: string) => void
  externalKosong: string
  setExternalKosong: (v: string) => void
}) {
  vt,
  form,
  setForm,
  onSaveRegion,
  onCancel,
  lokal,
  setLokal,
  externalMuatan,
  setExternalMuatan,
  externalKosong,
  setExternalKosong,
}: {
  vt,
  form,
  setForm,
  commit,
  cancel,
}: {
  vt: VehicleType
  form: { loadedNum: string; emptyNum: string }
  setForm: (next: { loadedNum: string; emptyNum: string }) => void
  commit: () => void
  cancel: () => void
}) {
  return (
    <div className="mt-4 p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tambah {vt}</span>
        <button type="button" className="text-xs text-slate-500 underline" onClick={cancel}>Batalkan</button>
      </div>        <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">Lokal / muatan (Rp)</label>
          <input
            type="text"
            inputMode="numeric"
            className="w-full border rounded-lg px-3 py-2 text-sm text-right"
            value={form.loadedNum}
            onChange={(e) => setForm({ ...form, loadedNum: e.target.value })}
            placeholder="0"
          />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">External kosong (Rp)</label>
          <input
            type="text"
            inputMode="numeric"
            className="w-full border rounded-lg px-3 py-2 text-sm text-right"
            value={form.emptyNum}
            onChange={(e) => setForm({ ...form, emptyNum: e.target.value })}
            placeholder="0"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="px-4 py-2 rounded-lg border text-sm font-semibold text-slate-700 hover:bg-slate-100"
          onClick={cancel}
        >
          Batal
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
          onClick={commit}
        >
          Simpan
        </button>
      </div>
    </div>
  )
}

export function TariffTab({ tariffs, serverState, onSaveTariffs, showToast }: TariffTabProps) {
  const [regionTariffs, setRegionTariffs] = useState<RegionTariffRow[]>([])
  const [loaded, setLoaded] = useState(false)

  const [badauState, setBadauState] = useState<EditableMatrixState>(() =>
    createEditableMatrixState(buildBadauMatrixWithAudit()),
  )

  const [addBadauType, setAddBadauType] = useState<BadauAddType>(null)
  const [addBadauForm, setAddBadauForm] = useState({ loadedNum: '', emptyNum: '' })

  const [regionState, setRegionState] = useState<EditableMatrixState>(() =>
    createEditableMatrixState([]),
  )

  const [addRegionType, setAddRegionType] = useState<RegionAddType>(null)
  const [addRegionForm, setAddRegionForm] = useState({ lokal: '', externalMuatan: '', externalKosong: '' })

  const openBadauAdd = (vt: VehicleType) => {
    setAddBadauType(vt)
    setAddBadauForm({ loadedNum: String(BADAU_TARIFF[vt]?.loadedNum ?? 0), emptyNum: String(BADAU_TARIFF[vt]?.emptyNum ?? 0) })
  }
  const closeBadauAdd = () => setAddBadauType(null)

  const commitBadauAdd = () => {
    const vt = addBadauType
    if (!vt) return
    const loaded = parseNonNeg(addBadauForm.loadedNum)
    const empty = parseNonNeg(addBadauForm.emptyNum)

    if (loaded === 0 && BADAU_TARIFF[vt]?.loadedNum !== 0) {
      return showToast('Muatan harus diisi', 'error')
    }
    if (empty === 0 && BADAU_TARIFF[vt]?.emptyNum !== 0) {
      return showToast('Kosong harus diisi', 'error')
    }

    setBadauState((prev) => {
      const existing = prev.rows.find((r) => r.vt === vt)
      if (existing) {
        const updated: MatrixRow = {
          vt,
          cells: {
            internal: existing.cells.internal,
            lokal: loaded,
            externalMuatan: empty,
            externalKosong: 0,
          },
        }
        const rows = prev.rows.map((r) => (r.vt === vt ? updated : r))
        return { ...prev, rows }
      }
      const added: MatrixRow = {
        vt,
        cells: { internal: 0, lokal: loaded, externalMuatan: empty, externalKosong: 0 },
      }
      const rows = [...prev.rows, added].sort((a, b) => VEHICLE_ORDER.indexOf(a.vt) - VEHICLE_ORDER.indexOf(b.vt))
      return { ...prev, rows }
    })
    closeBadauAdd()
    showToast(`Tarif ${vt} ditambahkan/updated`)
  }

  if (!loaded) {
    fetchRegionTariffs().then((rt) => {
      if (rt) setRegionTariffs(rt)
    })
    setLoaded(true)
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
        <div className="flex gap-2">
          {VEHICLE_ORDER.map((vt) => {
            const isAdding = addBadauType === vt
            return (
              <button
                key={vt}
                type="button"
                onClick={() => (isAdding ? closeBadauAdd() : openBadauAdd(vt))}
                className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border ${
                  isAdding
                    ? 'bg-white text-blue-700 border-blue-600'
                    : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                }`}
              >
                {isAdding ? `✕ Batal (${vt})` : `+ ${vt}`}
              </button>
            )
          })}
        </div>
      </div>

      {/* --- Tabel matriks BADAU (editable) --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tabel Tarif Wilayah</span>
          <ChevronRight />
          <span className="text-sm font-black text-slate-800">BADAU</span>
        </div>
        {renderRegionMatrixTable('BADAU', badauState, false)}

        {addBadauType !== null && (
          <BadauAddForm
            vt={addBadauType}
            form={addBadauForm}
            setForm={setAddBadauForm}
            commit={commitBadauAdd}
            cancel={closeBadauAdd}
          />
        )}
      </div>

      {/* --- Tabel matriks REGION (editable) --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tabel Tarif Wilayah</span>
            <ChevronRight />
            <span className="text-sm font-black text-slate-800">REGION</span>
          </div>
        </div>
        {renderRegionMatrixTable('REGION', regionState, true)}

        {addRegionType !== null && (
          <RegionAddForm
            vt={addRegionType}
            form={addRegionForm}
            setForm={setAddRegionForm}
            onSaveRegion={() => {
              const vt = addRegionType
              if (!vt) return

              setRegionState((prev) => {
                const existing = prev.rows.find((r) => r.vt === vt)
                const cells = {
                  lokal: parseNonNeg(addRegionForm.lokal),
                  externalMuatan: parseNonNeg(addRegionForm.externalMuatan),
                  externalKosong: parseNonNeg(addRegionForm.externalKosong),
                }

                const updated: MatrixRow = existing
                  ? { vt, cells }
                  : { vt, cells }

                const nextRows = existing
                  ? prev.rows.map((r) => (r.vt === vt ? updated : r))
                  : [...prev.rows, { vt, cells }]

                return {
                  ...prev,
                  rows: nextRows.sort(
                    (a, b) => VEHICLE_ORDER.indexOf(a.vt) - VEHICLE_ORDER.indexOf(b.vt),
                  ),
                }
              })

              setAddRegionType(null)
              showToast(`Tarif region ${vt} ditambahkan/updated`)
            }}
            onCancel={() => setAddRegionType(null)}
            lokal={addRegionLokal}
            setLokal={setAddRegionLokal}
            externalMuatan={addRegionMuatan}
            setExternalMuatan={setAddRegionMuatan}
            externalKosong={addRegionKosong}
            setExternalKosong={setAddRegionKosong}
          />
        )}
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

function RegionMatrixRowInner({
  row,
  placeholder,
  renderCellValue,
  state,
  setState,
  onSave,
}: {
  row: MatrixRow
  placeholder: boolean
  renderCellValue: (n: number, placeholder: boolean) => string
  state: EditableMatrixState
  setState: (next: EditableMatrixState) => void
  onSave: (updated: MatrixRow) => void
}) {
  const ed = state.editing[row.vt]
  const isEditing = ed?.mode === 'edit'

  function committing(updated: MatrixRow) {
    setState((prev) => {
      const rows = prev.rows.map((r) => (r.vt === updated.vt ? updated : r))
      const nextEditing = { ...prev.editing }
      delete nextEditing[updated.vt]
      return { ...prev, rows, editing: nextEditing }
    })
    onSave(updated)
  }

  return (
    <tr className="hover:bg-slate-50/70">
      <td className="text-left font-medium text-slate-800 border-r border-slate-200 border-b border-slate-200 px-3 py-2.5 align-left truncate">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              className={cellInputClass()}
              value={ed.vt}
              readOnly
            />
            <span className="text-[10px] text-slate-400">diEdit</span>
          </div>
        ) : (
          row.vt
        )}
      </td>
      <td className="bg-slate-100 text-center text-[11px] font-bold text-slate-500 border-b border-slate-200 border-r border-slate-200 px-2 py-2.5">
        {row.cells.internal === 0
          ? 'Rp 0 (dikunci)'
          : renderCellValue(row.cells.internal, placeholder)}
      </td>
      <td className="text-center border-b border-slate-200 px-2 py-2.5">
        {isEditing ? (
          <input
            className={cellInputClass()}
            inputMode="numeric"
            value={ed.lokal}
            onChange={(e) => {
              setState(updateEditForm(state, row.vt, 'lokal', e.target.value))
            }}
          />
        ) : (
          <span
            className="cursor-pointer inline-flex items-center gap-1"
            title="Klik untuk edit"
            onClick={() => setState(startEdit(state, row))}
          >
            {renderCellValue(row.cells.lokal, placeholder)}
            <Edit2 size={10} className="text-slate-400" />
          </span>
        )}
      </td>
      <td className="text-center border-r border-slate-200 border-b border-slate-200 px-2 py-2.5">
        {isEditing ? (
          <input
            className={cellInputClass()}
            inputMode="numeric"
            value={ed.externalMuatan}
            onChange={(e) => {
              setState(updateEditForm(state, row.vt, 'externalMuatan', e.target.value))
            }}
          />
        ) : (
          <span
            className="cursor-pointer inline-flex items-center gap-1"
            title="Klik untuk edit"
            onClick={() => setState(startEdit(state, row))}
          >
            {renderCellValue(row.cells.externalMuatan, placeholder)}
            <Edit2 size={10} className="text-slate-400" />
          </span>
        )}
      </td>
      <td className="text-center border-b border-slate-200 px-2 py-2.5">
        {isEditing ? (
          <>
            <input
              className={cellInputClass()}
              inputMode="numeric"
              value={ed.externalKosong}
              onChange={(e) => {
                setState(updateEditForm(state, row.vt, 'externalKosong', e.target.value))
              }}
            />
            <button
              type="button"
              className="ml-1 text-emerald-600 hover:text-emerald-700"
              title="Simpan"
              onClick={() => committing({
                vt: row.vt,
                cells: {
                  lokal: ed.lokal === '' ? 0 : parseInt(ed.lokal, 10) || 0,
                  externalMuatan: ed.externalMuatan === '' ? 0 : parseInt(ed.externalMuatan, 10) || 0,
                  externalKosong: ed.externalKosong === '' ? 0 : parseInt(ed.externalKosong, 10) || 0,
                },
              })}
            >
              <Check size={12} />
            </button>
            <button
              type="button"
              className="ml-1 text-slate-500 hover:text-slate-700"
              title="Batal"
              onClick={() => setState(cancelEdit(state))}
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <span
            className="cursor-pointer inline-flex items-center gap-1"
            title="Klik untuk edit"
            onClick={() => setState(startEdit(state, row))}
          >
            {renderCellValue(row.cells.externalKosong, placeholder)}
            <Edit2 size={10} className="text-slate-400" />
          </span>
        )}
      </td>
      <td className="text-center border-b border-slate-200 px-2 py-2.5">
        {isEditing ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 text-[11px] font-semibold"
            onClick={() => {
              setState(removeRow(state, row.vt))
              setState(cancelEdit(state))
            }}
          >
            <Trash2 size={11} /> Hapus
          </button>
        ) : (
          <span className="text-[11px] text-slate-400" />
        )}
      </td>
    </tr>
  )
}
