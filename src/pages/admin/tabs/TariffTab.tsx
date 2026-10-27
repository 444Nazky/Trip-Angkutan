/**
 * Tab "Master Tarif" di admin dashboard — satu tabel gaya spreadsheet per
 * region, mengikuti tabel tarif wilayah:
 *
 *   Jenis | internal | lokal | external (muatan | kosong)
 *
 * Sumber angka (resolver backend, handlers/tariffRules.ts -> resolveTariff):
 *
 *   1. Kategori Internal -> Rp 0 (kolom "internal" terkunci)
 *   2. Master tarif (BADAU) -> kolom external: muatan / kosong per golongan
 *   3. Override region     -> `region_tariff_rows` (golongan+jenis), fallback
 *                             ke master bila region belum punya baris
 *   4. Tarif region flat   -> kolom "lokal" (`region_tariffs`)
 *
 * Edit seperti spreadsheet: klik angka, ubah, Enter/blur = autosave.
 * Menulis di tabel BADAU mengubah master (berlaku ke semua region yang belum
 * punya override); menulis di tabel region lain membuat/mengubah override.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type { TariffRow } from '../components/types'
import {
  RegionTariffRow,
  createAdminRegion,
  createTariff,
  deleteAdminRegion,
  deleteTariff,
  fetchRegionTariffs,
  fetchTariffs,
  updateTariff,
  upsertRegionTariff,
  upsertRegionTariffRow,
} from '../../../services/tariffs'

interface TariffTabProps {
  tariffs: TariffRow[]
  /**
   * Status koneksi ke server API intranet.
   * `auth` berarti server hidup tetapi login admin ditolak.
   */
  serverState: 'connecting' | 'online' | 'offline' | 'auth'
  onSaveTariffs: (t: TariffRow[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

interface AddRowForm {
  golongan: string
  type: string
  muatan: string
  kosong: string
}

interface AddRegionForm {
  name: string
  code: string
}

/** Nilai satu baris yang tampil di tabel region (override atau master). */
interface Cell {
  row: TariffRow
  muatan: number
  kosong: number
  overridden: boolean
}

const GOLONGAN_OPTIONS = ['I', 'II', 'III', 'IV', 'V']
const MASTER_CODE = 'BADAU'

/** Urutan baris mengikuti sketsa spreadsheet: motor .. truk besar. */
const TYPE_ORDER = ['motor', 'mobil', 'truk kecil', 'truk sedang', 'truk besar']

const normalizeType = (t: string) =>
  String(t ?? '')
    .trim()
    .toLowerCase()
    .replace(/truck/g, 'truk')

const typeOrderIndex = (t: string) => {
  const i = TYPE_ORDER.indexOf(normalizeType(t))
  return i === -1 ? TYPE_ORDER.length : i
}

const fmtNum = (n: number) => Number(n || 0).toLocaleString('id-ID')
const fmtRp = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`

const BORDER = 'border border-slate-300'

const isMasterRegion = (r: RegionTariffRow) =>
  String(r.code ?? '').toUpperCase() === MASTER_CODE

/** Kunci baris override: golongan + jenis kendaraan (truck == truk). */
const rowKey = (golongan: string, type: string) =>
  `${String(golongan ?? '').trim().toUpperCase()}|${normalizeType(type)}`

/** Sel angka gaya spreadsheet: klik -> edit -> Enter/blur autosave. */
function SheetCell({
  value,
  onCommit,
  title = '',
}: {
  value: number
  onCommit: (n: number) => Promise<boolean>
  title?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const [pending, setPending] = useState(false)
  const skipCommit = useRef(false)

  const commit = async () => {
    setEditing(false)
    const cleaned = draft.replace(/[^\d]/g, '')
    if (!cleaned) return
    const n = Number(cleaned)
    if (!Number.isFinite(n) || n === value) return
    setPending(true)
    try {
      await onCommit(n)
    } finally {
      setPending(false)
    }
  }

  return (
    <td
      title={title}
      onClick={() => !editing && !pending && setEditing(true)}
      className={`border border-slate-300 px-2 py-1 text-right text-[13px] tabular-nums ${
        editing ? 'ring-2 ring-inset ring-blue-300' : 'cursor-cell hover:bg-amber-50/80'
      } ${pending ? 'animate-pulse text-slate-400' : 'text-slate-700'}`}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          inputMode="numeric"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit()
            } else if (e.key === 'Escape') {
              skipCommit.current = true
              setEditing(false)
            }
          }}
          onBlur={() => {
            if (skipCommit.current) {
              skipCommit.current = false
              return
            }
            void commit()
          }}
          className="w-full min-w-0 bg-transparent text-right text-[13px] font-medium outline-none"
        />
      ) : (
        <span className="block">{fmtNum(value)}</span>
      )}
    </td>
  )
}

/** Sel kolom "internal": terkunci (kendaraan internal selalu Rp 0). */
function LockedInternalCell() {
  return (
    <td
      title="Kendaraan internal tidak ditagih (Rp 0)"
      className="border border-slate-300 bg-slate-200/70 px-2 py-1 select-none cursor-not-allowed"
    >
      <span className="block text-center text-[12px] text-slate-400">–</span>
    </td>
  )
}

interface SheetProps {
  region: RegionTariffRow
  cells: Cell[]
  master: boolean
  saving: boolean
  getLokal: () => number
  commitLokal: (v: number) => Promise<boolean>
  commitCell: (cell: Cell, field: 'muatan' | 'kosong', v: number) => Promise<boolean>
  onDeleteRow: (row: TariffRow) => void
  onDeleteRegion: (r: RegionTariffRow) => void
  footer?: ReactNode
}

function RegionSheet({
  region,
  cells,
  master,
  saving,
  getLokal,
  commitLokal,
  commitCell,
  onDeleteRow,
  onDeleteRegion,
  footer,
}: SheetProps) {
  const headerCls =
    'border border-slate-300 bg-slate-50/80 px-2 py-1 text-center text-[12px] font-semibold text-slate-600'

  return (
    <div className="flex-1 min-w-[460px] rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th colSpan={5} className="border border-slate-300 px-2 py-2.5">
              <div className="flex items-center justify-between gap-3 px-2">
                <span className="text-[15px] font-bold tracking-[0.08em] text-slate-800">
                  {String(region.code || region.name || '—').toUpperCase()}
                  {region.name && region.name.toUpperCase() !== String(region.code).toUpperCase() && (
                    <span className="ml-2 text-[11px] font-medium tracking-normal text-slate-400">
                      {region.name}
                    </span>
                  )}
                </span>
                {!master && (
                  <button
                    onClick={() => onDeleteRegion(region)}
                    disabled={saving}
                    title={`Hapus region ${region.code}`}
                    className="rounded-md p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </th>
          </tr>
          <tr>
            <th
              colSpan={5}
              className="border border-slate-300 px-2 py-1.5 text-center text-[12px] font-bold tracking-wide text-slate-700"
            >
              GOLONGAN
            </th>
          </tr>
          <tr>
            <th rowSpan={2} className={`${headerCls} text-left`}>
              Jenis
            </th>
            <th rowSpan={2} className={headerCls}>
              internal
            </th>
            <th rowSpan={2} className={headerCls}>
              lokal
            </th>
            <th colSpan={2} className={headerCls}>
              external
            </th>
          </tr>
          <tr>
            <th className={`${headerCls} text-[11px] font-medium`}>muatan</th>
            <th className={`${headerCls} text-[11px] font-medium`}>kosong</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((cell, i) => (
            <tr key={cell.row.id ?? `local-${i}`} className="group">
              <td className="border border-slate-300 px-2 py-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-slate-800 whitespace-nowrap">{cell.row.type || '—'}</span>
                  {master && (
                    <button
                      onClick={() => onDeleteRow(cell.row)}
                      title="Hapus baris ini"
                      className="rounded p-0.5 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </td>
              <LockedInternalCell />
              <SheetCell value={getLokal()} onCommit={commitLokal} title="Tarif lokal wilayah ini" />
              <SheetCell
                value={cell.muatan}
                onCommit={(v) => commitCell(cell, 'muatan', v)}
                title={cell.overridden ? 'Override region: kendaraan bermuatan' : 'Mengikuti master: kendaraan bermuatan'}
              />
              <SheetCell
                value={cell.kosong}
                onCommit={(v) => commitCell(cell, 'kosong', v)}
                title={cell.overridden ? 'Override region: kendaraan kosong' : 'Mengikuti master: kendaraan kosong'}
              />
            </tr>
          ))}
          {cells.length === 0 && (
            <tr>
              <td colSpan={5} className="border border-slate-300 px-3 py-8 text-center text-[12px] text-slate-400">
                Belum ada tarif di server.
              </td>
            </tr>
          )}
        </tbody>
        {footer}
      </table>
    </div>
  )
}

export function TariffTab({ tariffs, serverState, onSaveTariffs, showToast }: TariffTabProps) {
  const [regions, setRegions] = useState<RegionTariffRow[]>([])
  /** Region yang sedang membuka baris tambah (id) — hanya satu pada satu waktu. */
  const [addRegionId, setAddRegionId] = useState<string | null>(null)
  const [addForm, setAddForm] = useState<AddRowForm>({ golongan: '', type: '', muatan: '', kosong: '' })
  const [regionForm, setRegionForm] = useState<AddRegionForm>({ name: '', code: '' })
  const [regionFormOpen, setRegionFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  /** Muat ulang region + tarif flat + override dari server. */
  const reloadRegions = useCallback(async () => {
    const fresh = await fetchRegionTariffs()
    if (fresh) setRegions(fresh)
    else showToast('Gagal memuat tarif region', 'error')
  }, [showToast])

  useEffect(() => {
    void reloadRegions()
  }, [reloadRegions])

  /** Baris master diurut sesuai sketsa: motor .. truk besar. */
  const sortedRows = useMemo(
    () =>
      [...tariffs].sort(
        (a, b) =>
          typeOrderIndex(a.type) - typeOrderIndex(b.type) ||
          normalizeType(a.type).localeCompare(normalizeType(b.type)) ||
          String(a.golongan).localeCompare(b.golongan),
      ),
    [tariffs],
  )

  /** Region BADAU di atas, sisanya urut nama. */
  const orderedRegions = useMemo(
    () =>
      [...regions].sort(
        (a, b) =>
          Number(isMasterRegion(b)) - Number(isMasterRegion(a)) ||
          String(a.name ?? a.code).localeCompare(String(b.name ?? b.code)),
      ),
    [regions],
  )

  /** Nilai tampil per region: override region bila ada, selain itu master. */
  const cellsFor = (region: RegionTariffRow): Cell[] => {
    const overrides = new Map<string, { golongan: string; type: string; muatan: number; kosong: number }>()
    for (const o of region.rows ?? []) {
      overrides.set(rowKey(o.golongan, o.vehicleType), {
        golongan: o.golongan,
        type: o.vehicleType,
        muatan: o.muatanTariff,
        kosong: o.kosongTariff,
      })
    }
    const cells: Cell[] = sortedRows.map((row) => {
      const o = overrides.get(rowKey(row.golongan, row.type))
      return {
        row,
        muatan: o ? o.muatan : row.loadedNum,
        kosong: o ? o.kosong : row.emptyNum,
        overridden: !!o,
      }
    })
    // Baris override yang jenisnya tidak ada di master tetap ditampilkan.
    for (const [key, o] of overrides) {
      if (sortedRows.some((row) => rowKey(row.golongan, row.type) === key)) continue
      cells.push({
        row: { id: '', golongan: o.golongan, type: o.type, loaded: '', loadedNum: o.muatan, empty: '', emptyNum: o.kosong, desc: '' },
        muatan: o.muatan,
        kosong: o.kosong,
        overridden: true,
      })
    }
    return cells
  }

  const refreshMasterRows = async () => {
    const fresh = await fetchTariffs()
    if (fresh) onSaveTariffs(fresh)
    else showToast('Gagal memuat ulang master tarif', 'error')
  }

  /** Simpan master tarif (BADAU): kolom muatan / kosong satu golongan. */
  const commitMasterField = async (
    row: TariffRow,
    field: 'loadedNum' | 'emptyNum',
    v: number,
  ): Promise<boolean> => {
    if (!row.id) return false
    setSaving(true)
    try {
      const updated: TariffRow =
        field === 'loadedNum'
          ? { ...row, loadedNum: v, loaded: fmtRp(v) }
          : { ...row, emptyNum: v, empty: fmtRp(v) }
      const ok = await updateTariff(updated)
      if (!ok) {
        showToast('Server menolak perubahan tarif', 'error')
        return false
      }
      await refreshMasterRows()
      // Region yang belum punya override ikut berubah → segarkan tampilan.
      await reloadRegions()
      return true
    } finally {
      setSaving(false)
    }
  }

  /** Simpan nominal lokal (tarif wilayah flat) untuk satu region. */
  const commitLokal = async (region: RegionTariffRow, v: number): Promise<boolean> => {
    setSaving(true)
    try {
      const ok = await upsertRegionTariff({
        regionId: region.id,
        tariffType: 'lokal',
        nominal: v,
        aktif: (region.lokal_active ?? 0) === 1 || v > 0,
      })
      if (!ok) {
        showToast('Server menolak tarif wilayah', 'error')
        return false
      }
      await reloadRegions()
      return true
    } finally {
      setSaving(false)
    }
  }

  /** Simpan satu sel external: BADAU -> master, region lain -> override. */
  const commitCell = async (
    region: RegionTariffRow,
    cell: Cell,
    field: 'muatan' | 'kosong',
    v: number,
  ): Promise<boolean> => {
    if (isMasterRegion(region)) {
      return commitMasterField(cell.row, field === 'muatan' ? 'loadedNum' : 'emptyNum', v)
    }
    setSaving(true)
    try {
      // Override butuh pasangan muatan+kosong: pakai nilai lain yang tampil.
      const ok = await upsertRegionTariffRow({
        regionId: region.id,
        golongan: cell.row.golongan,
        vehicleType: cell.row.type,
        muatanTariff: field === 'muatan' ? v : cell.muatan,
        kosongTariff: field === 'kosong' ? v : cell.kosong,
      })
      if (!ok) {
        showToast('Server menolak tarif region', 'error')
        return false
      }
      await reloadRegions()
      return true
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRow = async (row: TariffRow) => {
    if (!row.id) return showToast('Baris belum tersimpan di server', 'error')
    if (!confirm(`Hapus baris golongan ${row.golongan || '-'} (${row.type})?`)) return
    setSaving(true)
    try {
      const ok = await deleteTariff(row)
      if (!ok) return showToast('Server gagal menghapus tarif', 'error')
      await refreshMasterRows()
      await reloadRegions()
      showToast('Baris tarif dihapus')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateRegion = async () => {
    const name = regionForm.name.trim()
    const code = regionForm.code.trim().toUpperCase()
    if (!name || !code) {
      showToast('Nama dan kode region wajib diisi', 'error')
      return
    }
    if (regions.some((r) => String(r.code ?? '').toUpperCase() === code)) {
      showToast('Kode region sudah digunakan', 'error')
      return
    }
    setSaving(true)
    try {
      const id = await createAdminRegion({ name, code })
      if (!id) {
        showToast('Gagal menyimpan region', 'error')
        return
      }
      await reloadRegions()
      setRegionForm({ name: '', code: '' })
      setRegionFormOpen(false)
      showToast('Region berhasil ditambahkan')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRegion = async (r: RegionTariffRow) => {
    if (isMasterRegion(r)) {
      showToast('Region BADAU tidak bisa dihapus', 'error')
      return
    }
    if (!confirm(`Hapus region ${r.name || r.code}?`)) return
    setSaving(true)
    try {
      const ok = await deleteAdminRegion(r.id)
      if (!ok) {
        showToast('Gagal menghapus region', 'error')
        return
      }
      await reloadRegions()
      showToast('Region berhasil dihapus')
    } finally {
      setSaving(false)
    }
  }

  /** Golongan default baris baru: yang belum terpakai di master. */
  const nextGolongan = () => {
    const used = new Set(tariffs.map((t) => String(t.golongan ?? '').toUpperCase()))
    return GOLONGAN_OPTIONS.find((g) => !used.has(g)) ?? 'I'
  }

  /** Baris master yang cocok dengan isian form — dipakai untuk prefill. */
  const masterFor = (form: AddRowForm): TariffRow | undefined => {
    const type = normalizeType(form.type)
    if (!type) return undefined
    const gol = form.golongan.trim().toUpperCase()
    return (
      tariffs.find(
        (t) => normalizeType(t.type) === type && String(t.golongan ?? '').toUpperCase() === gol,
      ) ?? tariffs.find((t) => normalizeType(t.type) === type)
    )
  }

  const closeAdd = () => {
    setAddRegionId(null)
    setAddForm({ golongan: '', type: '', muatan: '', kosong: '' })
  }

  /** Buka form tambah baris; region non-master diisi nilai tarif yang sudah ada. */
  const beginAdd = (region: RegionTariffRow) => {
    const override = region.rows?.[0]
    const seed = override
      ? {
          golongan: override.golongan,
          type: override.vehicleType,
          muatan: String(override.muatanTariff),
          kosong: String(override.kosongTariff),
        }
      : sortedRows[0]
        ? {
            golongan: sortedRows[0].golongan,
            type: sortedRows[0].type,
            muatan: String(sortedRows[0].loadedNum),
            kosong: String(sortedRows[0].emptyNum),
          }
        : { golongan: '', type: '', muatan: '', kosong: '' }
    setAddForm(isMasterRegion(region) ? { golongan: '', type: '', muatan: '', kosong: '' } : seed)
    setAddRegionId(region.id)
  }

  /** Ketik jenis → langsung isi muatan/kosong dari master yang sudah ada. */
  const changeAddType = (v: string) => {
    const m = masterFor({ ...addForm, type: v })
    setAddForm((f) => ({
      ...f,
      type: v,
      golongan: f.golongan || (m?.golongan ?? ''),
      muatan: m ? String(m.loadedNum) : f.muatan,
      kosong: m ? String(m.emptyNum) : f.kosong,
    }))
  }

  /** Simpan baris baru: BADAU -> master, region lain -> override region. */
  const submitAdd = async (region: RegionTariffRow) => {
    const type = addForm.type.trim()
    if (!type) {
      showToast('Jenis kendaraan wajib diisi', 'error')
      return
    }
    const master = isMasterRegion(region)
    const golongan =
      addForm.golongan.trim().toUpperCase() || masterFor(addForm)?.golongan || nextGolongan()
    const muatan = Number(addForm.muatan.replace(/[^\d]/g, '')) || 0
    const kosong = Number(addForm.kosong.replace(/[^\d]/g, '')) || 0
    setSaving(true)
    try {
      if (master) {
        const id = await createTariff({
          golongan,
          type,
          loaded: fmtRp(muatan),
          loadedNum: muatan,
          empty: fmtRp(kosong),
          emptyNum: kosong,
          desc: '',
        })
        if (!id) {
          showToast('Server menolak tarif baru', 'error')
          return
        }
        await refreshMasterRows()
        showToast('Baris golongan ditambahkan')
      } else {
        const ok = await upsertRegionTariffRow({
          regionId: region.id,
          golongan,
          vehicleType: type,
          muatanTariff: muatan,
          kosongTariff: kosong,
        })
        if (!ok) {
          showToast('Server menolak tarif region', 'error')
          return
        }
        showToast('Baris region ditambahkan')
      }
      await reloadRegions()
      closeAdd()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header halaman */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Master Tarif</h3>
          <p className="text-slate-500 text-[12px] mt-0.5 max-w-2xl">
            Satu tabel per region. Edit seperti spreadsheet: klik angka, ubah, lalu Enter —
            perubahan otomatis tersimpan ke server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRegionFormOpen(true)}
            disabled={saving || regionFormOpen}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40"
          >
            <Plus size={13} /> Region
          </button>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
              serverState === 'online'
                ? 'bg-emerald-50 text-emerald-600'
                : serverState === 'offline' || serverState === 'auth'
                  ? 'bg-red-50 text-red-600'
                  : 'bg-amber-50 text-amber-600'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                serverState === 'online'
                  ? 'bg-emerald-500'
                  : serverState === 'offline' || serverState === 'auth'
                    ? 'bg-red-500'
                    : 'bg-amber-500'
              }`}
            />
            Server:{' '}
            {serverState === 'online'
              ? 'Tersambung'
              : serverState === 'offline'
                ? 'Offline'
                : serverState === 'auth'
                  ? 'Gagal Login'
                  : 'Menghubungkan'}
          </span>
        </div>
      </div>

      {/* Formulir region baru */}
      {regionFormOpen && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <input
            autoFocus
            value={regionForm.name}
            placeholder="nama region"
            onChange={(e) => setRegionForm((f) => ({ ...f, name: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreateRegion()}
            className="min-w-[180px] flex-1 rounded border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-blue-400"
          />
          <input
            value={regionForm.code}
            placeholder="kode"
            onChange={(e) => setRegionForm((f) => ({ ...f, code: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreateRegion()}
            className="w-28 rounded border border-slate-200 px-2 py-1 text-[12px] uppercase outline-none focus:border-blue-400"
          />
          <button
            onClick={() => void handleCreateRegion()}
            disabled={saving}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40"
          >
            simpan
          </button>
          <button
            onClick={() => {
              setRegionFormOpen(false)
              setRegionForm({ name: '', code: '' })
            }}
            disabled={saving}
            className="rounded-md bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-40"
          >
            batal
          </button>
        </div>
      )}

      {/* Satu tabel per region; BADAU (master) paling atas. */}
      <div className="flex flex-wrap items-start gap-6">
        {orderedRegions.map((region) => {
          const master = isMasterRegion(region)
          return (
            <RegionSheet
              key={region.id}
              region={region}
              cells={cellsFor(region)}
              master={master}
              saving={saving}
              getLokal={() => region.lokal_tariff ?? 0}
              commitLokal={(v) => commitLokal(region, v)}
              commitCell={(cell, field, v) => commitCell(region, cell, field, v)}
              onDeleteRow={handleDeleteRow}
              onDeleteRegion={handleDeleteRegion}
              footer={
                addRegionId === region.id ? (
                  <tfoot>
                    <tr className="bg-amber-50/60">
                      <td className={`${BORDER} border-slate-300 px-2 py-1.5`}>
                        <div className="flex items-center gap-1">
                          <input
                            list="tariff-golongan-options"
                            value={addForm.golongan}
                            placeholder={nextGolongan()}
                            onChange={(e) => setAddForm((f) => ({ ...f, golongan: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && void submitAdd(region)}
                            title="Golongan (I..V)"
                            className="w-10 border border-slate-200 rounded px-1 py-1 text-center text-[12px] uppercase outline-none focus:border-blue-400"
                          />
                          <input
                            autoFocus
                            value={addForm.type}
                            placeholder="jenis kendaraan"
                            onChange={(e) => changeAddType(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && void submitAdd(region)}
                            className="flex-1 min-w-0 border border-slate-200 rounded px-2 py-1 text-[12px] outline-none focus:border-blue-400"
                          />
                          <button
                            onClick={closeAdd}
                            title="Batal"
                            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                      <LockedInternalCell />
                      <td className={`${BORDER} border-slate-300 bg-slate-50`} />
                      <td className={`${BORDER} border-slate-300 px-2 py-1.5`}>
                        <input
                          value={addForm.muatan}
                          inputMode="numeric"
                          placeholder="0"
                          onChange={(e) => setAddForm((f) => ({ ...f, muatan: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && void submitAdd(region)}
                          className="w-full bg-transparent text-right text-[13px] tabular-nums outline-none"
                        />
                      </td>
                      <td className={`${BORDER} border-slate-300 px-2 py-1.5`}>
                        <input
                          value={addForm.kosong}
                          inputMode="numeric"
                          placeholder="0"
                          onChange={(e) => setAddForm((f) => ({ ...f, kosong: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && void submitAdd(region)}
                          className="w-full bg-transparent text-right text-[13px] tabular-nums outline-none"
                        />
                      </td>
                    </tr>
                  </tfoot>
                ) : (
                  <tfoot>
                    <tr>
                      <td colSpan={5} className={`${BORDER} border-slate-300`}>
                        <button
                          onClick={() => beginAdd(region)}
                          disabled={saving}
                          className="w-full py-1.5 text-center text-[11px] font-medium text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 disabled:opacity-40"
                        >
                          + tambah baris
                        </button>
                      </td>
                    </tr>
                  </tfoot>
                )
              }
            />
          )
        })}
        <datalist id="tariff-golongan-options">
          {GOLONGAN_OPTIONS.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </div>

      {/* Keterangan singkat */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-500 shadow-sm space-y-1">
        <p>
          <b className="text-slate-700">{MASTER_CODE}</b> — kolom <b>muatan</b> dan <b>kosong</b> adalah
          master tarif yang dipakai aplikasi menghitung tagihan trip. Perubahan di sini berlaku ke semua
          region yang belum punya override.
        </p>
        <p>
          <b className="text-slate-700">Region lain</b> — mengikuti master sampai sel diubah; setelah
          diubah baris itu tersimpan sebagai override region (muatan + kosong sekaligus).
        </p>
        <p>
          <b className="text-slate-700">lokal</b> — nominal flat per wilayah (`region_tariffs`).
          <b className="text-slate-700"> internal</b> terkunci Rp 0 — kendaraan internal tidak ditagih.
        </p>
      </div>
    </div>
  )
}
