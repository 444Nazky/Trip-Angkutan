/**
 * Tab "Master Tarif Jenis Kendaraan" di admin dashboard.
 *
 * Tata letak mengikuti mockup admin:
 *   header -> filter (region/golongan) -> kartu jenis kendaraan
 *   -> tabel tarif per region (bisa dibuka/tutup) -> panel "Tambah / Edit Tarif".
 *
 * Sumber angka (resolver backend, handlers/tariffRules.ts -> resolveTariff):
 *
 *   1. Kategori Internal -> Rp 0 (kolom "internal" terkunci)
 *   2. Baris region        -> `region_tariff_rows` (golongan+jenis) milik
 *                             region itu sendiri; tiap region bisa beda harga
 *   3. Master tarif (BADAU) -> cadangan bila region belum punya baris tersebut
 *   4. Tarif region flat   -> kolom "lokal" (`region_tariffs`)
 *
 * Edit seperti spreadsheet: klik angka, ubah, Enter/blur = autosave.
 * BADAU menulis master `tariffs`; region lain menulis barisnya sendiri sehingga
 * tidak pernah mengubah BADAU maupun region lain.
 */

import {
  BADGE,
  BADGE_ERROR,
  BADGE_OK,
  BADGE_WARN,
  BTN_PRIMARY as BTN_PRIMARY_CLS,
  BTN_SECONDARY,
  CARD,
  CARD_SUBTLE,
  DOT_ERROR,
  DOT_OK,
  DOT_WARN,
  INPUT,
  LABEL,
  PAGE,
  PAGE_SUBTITLE,
  PAGE_TITLE,
  TABLE_HEAD_ROW,
  TABLE_SUBHEAD_ROW,
  TABLE_WRAP,
} from '../theme'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Bike,
  Car,
  ChevronDown,
  ChevronRight,
  Container,
  Pencil,
  Plus,
  Search,
  Trash2,
  Truck,
} from 'lucide-react'
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

interface AddRegionForm {
  name: string
  code: string
}

/** Isi panel "Tambah / Edit Tarif". Semua nominal berupa string mentah. */
interface TariffForm {
  regionId: string
  golongan: string
  type: string
  lokal: string
  muatan: string
  kosong: string
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

const VEHICLE_CARDS = [
  { key: 'motor', label: '1. Motor', Icon: Bike, tone: 'text-blue-600' },
  { key: 'mobil', label: '2. Mobil', Icon: Car, tone: 'text-emerald-600' },
  { key: 'truk kecil', label: '3. Truk Kecil', Icon: Truck, tone: 'text-amber-500' },
  { key: 'truk sedang', label: '4. Truk Sedang', Icon: Truck, tone: 'text-cyan-600' },
  { key: 'truk besar', label: '5. Truk Besar', Icon: Truck, tone: 'text-red-500' },
  { key: 'truk trailer', label: '6. Truk Trailer', sub: '(Opsional)', Icon: Container, tone: 'text-slate-500' },
]

// Class control diambil dari design token bersama (src/pages/admin/theme.ts)
// supaya warnanya sama dengan halaman admin lainnya.
const INPUT_CLS = INPUT
const BTN_PRIMARY = BTN_PRIMARY_CLS
const BTN_GHOST = BTN_SECONDARY

const EMPTY_FORM: TariffForm = { regionId: '', golongan: '', type: '', lokal: '', muatan: '', kosong: '' }

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
const digits = (s: string) => Number(String(s).replace(/[^\d]/g, '')) || 0

const isMasterRegion = (r: RegionTariffRow) =>
  String(r.code ?? '').toUpperCase() === MASTER_CODE

/** Kunci baris override: golongan + jenis kendaraan (truck == truk). */
const rowKey = (golongan: string, type: string) =>
  `${String(golongan ?? '').trim().toUpperCase()}|${normalizeType(type)}`

const iconForType = (type: string) => {
  const t = normalizeType(type)
  if (t.includes('motor')) return Bike
  if (t.includes('mobil')) return Car
  if (t.includes('trailer')) return Container
  return Truck
}

/** Kelompokkan sel per golongan, urut I..V. */
function groupByGolongan(cells: Cell[]): [string, Cell[]][] {
  const groups = new Map<string, Cell[]>()
  for (const c of cells) {
    const g = String(c.row.golongan || '—').toUpperCase()
    const list = groups.get(g)
    if (list) list.push(c)
    else groups.set(g, [c])
  }
  return [...groups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true }),
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className={`${LABEL} mb-1 block`}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  )
}

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
      className={`border-t border-slate-100 px-2 py-2 text-right text-[13px] tabular-nums ${
        editing ? 'ring-2 ring-inset ring-blue-300' : 'cursor-cell hover:bg-amber-50/70'
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
        <span className="block">
          <span className="mr-0.5 text-[11px] text-slate-400">Rp</span>
          {fmtNum(value)}
        </span>
      )}
    </td>
  )
}

/** Sel kolom "internal": terkunci (kendaraan internal selalu Rp 0). */
function LockedInternalCell() {
  return (
    <td
      title="Kendaraan internal tidak ditagih (Rp 0)"
      className="cursor-not-allowed border-t border-slate-100 bg-slate-50/60 px-2 py-2 select-none"
    >
      <span className="block text-center text-[12px] text-slate-400">–</span>
    </td>
  )
}

export function TariffTab({ tariffs, serverState, onSaveTariffs, showToast }: TariffTabProps) {
  const [regions, setRegions] = useState<RegionTariffRow[]>([])
  /** Region yang barisnya sedang dibuka. Default: semua region terbuka. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /** Id region yang sudah pernah diproses (supaya pilihan collapse user tidak ditimpa). */
  const knownRegionIds = useRef<Set<string>>(new Set())
  const [filterRegion, setFilterRegion] = useState('')
  const [filterGolongan, setFilterGolongan] = useState('')
  const [filterType, setFilterType] = useState('')
  const [form, setForm] = useState<TariffForm>(EMPTY_FORM)
  /** Baris yang sedang diedit lewat panel kanan (null = mode tambah). */
  const [editTarget, setEditTarget] = useState<{ regionId: string; cell: Cell } | null>(null)
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
  const cellsFor = useCallback(
    (region: RegionTariffRow): Cell[] => {
      const overrides = new Map<
        string,
        { golongan: string; type: string; muatan: number; kosong: number }
      >()
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
    },
    [sortedRows],
  )

  /** Tabel yang terlihat setelah filter region/golongan/jenis. */
  const visibleGroups = useMemo(
    () =>
      orderedRegions
        .filter((r) => !filterRegion || r.id === filterRegion)
        .map((region) => {
          const cells = cellsFor(region).filter(
            (c) =>
              (!filterGolongan ||
                String(c.row.golongan ?? '').toUpperCase() === filterGolongan) &&
              (!filterType || normalizeType(c.row.type) === filterType),
          )
          return { region, cells }
        })
        .filter((g) => g.cells.length > 0),
    [orderedRegions, cellsFor, filterRegion, filterGolongan, filterType],
  )

  /** Pilih region awal + buka semua accordion region secara default. */
  useEffect(() => {
    if (!orderedRegions.length) return
    if (!form.regionId) {
      const first = orderedRegions.find(isMasterRegion) ?? orderedRegions[0]
      setForm((f) => (f.regionId ? f : { ...f, regionId: first.id }))
    }
    // Semua region langsung TERBUKA saat halaman dimuat - tidak perlu klik
    // tombol "Tampilkan" satu per satu. Region yang baru muncul (mis. region
    // tambahan) ikut dibuka, tapi region yang sengaja dik-collapse oleh user
    // tidak dibuka lagi.
    const fresh = orderedRegions.filter((r) => !knownRegionIds.current.has(r.id))
    if (fresh.length === 0) return
    for (const r of fresh) knownRegionIds.current.add(r.id)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const r of fresh) next.add(r.id)
      return next
    })
  }, [orderedRegions, form.regionId])

  const toggleRegion = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
      // Salin nilai master sekali, supaya region baru langsung punya harga
      // sendiri dan tidak tampil "ikut BADAU" sampai tiap sel diedit.
      if (code !== MASTER_CODE) {
        for (const t of tariffs) {
          await upsertRegionTariffRow({
            regionId: id,
            golongan: t.golongan,
            vehicleType: t.type,
            muatanTariff: t.loadedNum,
            kosongTariff: t.emptyNum,
          })
        }
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
      if (editTarget?.regionId === r.id) resetForm()
      if (form.regionId === r.id) setForm((f) => ({ ...f, regionId: '' }))
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
  const masterFor = (golongan: string, type: string): TariffRow | undefined => {
    const t = normalizeType(type)
    if (!t) return undefined
    const g = golongan.trim().toUpperCase()
    return (
      tariffs.find(
        (x) => normalizeType(x.type) === t && String(x.golongan ?? '').toUpperCase() === g,
      ) ?? tariffs.find((x) => normalizeType(x.type) === t)
    )
  }

  const resetForm = () => {
    setEditTarget(null)
    setForm((f) => ({ ...EMPTY_FORM, regionId: f.regionId }))
  }

  const openEdit = (region: RegionTariffRow, cell: Cell) => {
    setEditTarget({ regionId: region.id, cell })
    setForm({
      regionId: region.id,
      golongan: cell.row.golongan,
      type: cell.row.type,
      lokal: String(region.lokal_tariff ?? 0),
      muatan: String(cell.muatan),
      kosong: String(cell.kosong),
    })
    setExpanded((prev) => new Set(prev).add(region.id))
  }

  /** Ketik jenis → isi muatan/kosong dari master yang sudah ada (bila kosong). */
  const changeFormType = (v: string) => {
    const m = masterFor(form.golongan, v)
    setForm((f) => ({
      ...f,
      type: v,
      golongan: f.golongan || (m?.golongan ?? ''),
      muatan: !f.muatan && m ? String(m.loadedNum) : f.muatan,
      kosong: !f.kosong && m ? String(m.emptyNum) : f.kosong,
    }))
  }

  const changeFormRegion = (id: string) => {
    const r = regions.find((x) => x.id === id)
    setForm((f) => ({ ...f, regionId: id, lokal: String(r?.lokal_tariff ?? 0) }))
  }

  /** Simpan panel: mode edit (harga saja) atau tambah baris baru. */
  const submitForm = async () => {
    const region = regions.find((r) => r.id === form.regionId)
    if (!region) return showToast('Pilih region terlebih dahulu', 'error')

    const muatan = digits(form.muatan)
    const kosong = digits(form.kosong)
    const lokal = form.lokal.trim() === '' ? null : digits(form.lokal)

    if (editTarget) {
      const target = regions.find((r) => r.id === editTarget.regionId)
      if (!target) return showToast('Region tidak ditemukan', 'error')
      const cell: Cell = { ...editTarget.cell, muatan, kosong }
      if (muatan !== editTarget.cell.muatan && !(await commitCell(target, cell, 'muatan', muatan))) return
      if (kosong !== editTarget.cell.kosong && !(await commitCell(target, cell, 'kosong', kosong))) return
      if (lokal !== null && lokal !== Number(target.lokal_tariff ?? 0)) {
        if (!(await commitLokal(target, lokal))) return
      }
      showToast('Tarif diperbarui')
      resetForm()
      return
    }

    const type = form.type.trim()
    if (!type) return showToast('Jenis kendaraan wajib diisi', 'error')
    const golongan =
      form.golongan.trim().toUpperCase() || masterFor(form.golongan, type)?.golongan || nextGolongan()

    const master = isMasterRegion(region)
    const existing = master
      ? tariffs.find(
          (t) =>
            normalizeType(t.type) === normalizeType(type) &&
            String(t.golongan ?? '').toUpperCase() === golongan,
        )
      : undefined

    setSaving(true)
    try {
      if (master) {
        if (existing?.id) {
          const ok = await updateTariff({
            ...existing,
            loadedNum: muatan,
            loaded: fmtRp(muatan),
            emptyNum: kosong,
            empty: fmtRp(kosong),
          })
          if (!ok) return showToast('Server menolak perubahan tarif', 'error')
        } else {
          const id = await createTariff({
            golongan,
            type,
            loaded: fmtRp(muatan),
            loadedNum: muatan,
            empty: fmtRp(kosong),
            emptyNum: kosong,
            desc: '',
          })
          if (!id) return showToast('Server menolak tarif baru', 'error')
        }
        await refreshMasterRows()
      } else {
        const ok = await upsertRegionTariffRow({
          regionId: region.id,
          golongan,
          vehicleType: type,
          muatanTariff: muatan,
          kosongTariff: kosong,
        })
        if (!ok) return showToast('Server menolak tarif region', 'error')
      }

      if (lokal !== null && lokal !== Number(region.lokal_tariff ?? 0)) {
        const ok = await upsertRegionTariff({
          regionId: region.id,
          tariffType: 'lokal',
          nominal: lokal,
          aktif: lokal > 0,
        })
        if (!ok) return showToast('Server menolak tarif wilayah', 'error')
      }

      await reloadRegions()
      setExpanded((prev) => new Set(prev).add(region.id))
      showToast(existing ? 'Tarif diperbarui' : 'Tarif ditambahkan')
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  const serverLabel =
    serverState === 'online'
      ? 'Tersambung'
      : serverState === 'offline'
        ? 'Offline'
        : serverState === 'auth'
          ? 'Gagal Login'
          : 'Menghubungkan'
  const serverOk = serverState === 'online'
  const serverBad = serverState === 'offline' || serverState === 'auth'

  return (
    <div className={PAGE}>
      {/* Header halaman */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className={PAGE_TITLE}>Master Tarif Jenis Kendaraan</h3>
          <p className={`${PAGE_SUBTITLE} mt-0.5 max-w-2xl`}>
            Kelola tarif untuk setiap jenis kendaraan pada setiap region.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRegionFormOpen(true)}
            disabled={saving || regionFormOpen}
            className={`${BTN_PRIMARY} px-3 py-1.5`}
          >
            <Plus size={13} /> Region
          </button>
          <span
            className={`${BADGE} ${serverOk ? BADGE_OK : serverBad ? BADGE_ERROR : BADGE_WARN}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${serverOk ? DOT_OK : serverBad ? DOT_ERROR : DOT_WARN}`}
            />
            Server: {serverLabel}
          </span>
        </div>
      </div>

      {/* Formulir region baru */}
      {regionFormOpen && (
        <div className={`${CARD} flex flex-wrap items-center gap-2 px-3 py-2`}>
          <input
            autoFocus
            value={regionForm.name}
            placeholder="nama region"
            onChange={(e) => setRegionForm((f) => ({ ...f, name: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreateRegion()}
            className={`${INPUT} min-w-[180px] flex-1 px-2 py-1.5 text-[12px]`}
          />
          <input
            value={regionForm.code}
            placeholder="kode"
            onChange={(e) => setRegionForm((f) => ({ ...f, code: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreateRegion()}
            className={`${INPUT} w-28 px-2 py-1.5 text-[12px] uppercase`}
          />
          <button onClick={() => void handleCreateRegion()} disabled={saving} className={BTN_PRIMARY}>
            Simpan
          </button>
          <button
            onClick={() => {
              setRegionFormOpen(false)
              setRegionForm({ name: '', code: '' })
            }}
            disabled={saving}
            className={BTN_GHOST}
          >
            Batal
          </button>
        </div>
      )}

      {/* Filter */}
      <div className={`${CARD} p-3`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <Field label="Region">
            <select
              value={filterRegion}
              onChange={(e) => {
                setFilterRegion(e.target.value)
                if (e.target.value) setExpanded((prev) => new Set(prev).add(e.target.value))
              }}
              className={INPUT_CLS}
            >
              <option value="">Semua Region</option>
              {orderedRegions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.code}
                  {isMasterRegion(r) ? ' (Master)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Golongan">
            <select
              value={filterGolongan}
              onChange={(e) => setFilterGolongan(e.target.value)}
              className={INPUT_CLS}
            >
              <option value="">Semua Golongan</option>
              {GOLONGAN_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  Golongan {g}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button
              onClick={() => {
                setFilterRegion('')
                setFilterGolongan('')
                setFilterType('')
              }}
              className={`${BTN_PRIMARY} h-[38px] w-full lg:w-auto`}
            >
              <Search size={14} /> Tampilkan
            </button>
          </div>
        </div>
      </div>

      {/* Kartu jenis kendaraan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {VEHICLE_CARDS.map((v) => {
          const active = filterType === v.key
          const Icon = v.Icon
          return (
            <button
              key={v.key}
              onClick={() => setFilterType(active ? '' : v.key)}
              title={active ? 'Tampilkan semua jenis' : `Filter jenis: ${v.label.replace(/^\d+\.\s*/, '')}`}
              className={`flex flex-col items-center gap-2 rounded-2xl border bg-white px-2 py-4 transition ${
                active
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                  : 'border-slate-200 hover:border-blue-300 hover:shadow-sm'
              }`}
            >
              <Icon size={34} strokeWidth={1.6} className={v.tone} />
              <span className="text-center text-[12px] font-semibold leading-tight text-slate-700">
                {v.label}
                {v.sub && (
                  <span className="block text-[10px] font-normal text-slate-400">{v.sub}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Tabel tarif */}
        <div className={TABLE_WRAP}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th rowSpan={3} className="border-b border-slate-200 px-4 py-2 text-left font-semibold">
                    Jenis Kendaraan
                  </th>
                  <th colSpan={4} className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold">
                    Golongan Tarif
                  </th>
                  <th rowSpan={3} className="border-b border-slate-200 px-2 py-2 text-center font-semibold">
                    Aksi
                  </th>
                </tr>
                <tr className={TABLE_HEAD_ROW}>
                  <th className="border-b border-slate-200 px-2 py-2 text-center font-semibold">
                    Internal
                  </th>
                  <th className="border-b border-slate-200 px-2 py-2 text-center font-semibold">
                    Lokal
                  </th>
                  <th colSpan={2} className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold">
                    Eksternal
                  </th>
                </tr>
                <tr className={TABLE_SUBHEAD_ROW}>
                  <th colSpan={2} className="border-b border-slate-200 px-2 py-1.5" />
                  <th className="border-b border-slate-200 px-2 py-1.5 text-center font-medium">
                    Ada Muatan
                  </th>
                  <th className="border-b border-slate-200 px-2 py-1.5 text-center font-medium">
                    Kosong
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map(({ region, cells }) => {
                  const master = isMasterRegion(region)
                  const open = expanded.has(region.id)
                  const golonganGroups = groupByGolongan(cells)
                  const typeCount = new Set(cells.map((c) => normalizeType(c.row.type))).size
                  return (
                    <Fragment key={region.id}>
                      <tr
                        className="cursor-pointer border-b border-slate-200 bg-slate-100 transition hover:bg-slate-200/70"
                        onClick={() => toggleRegion(region.id)}
                      >
                        <td colSpan={6} className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {open ? (
                              <ChevronDown size={15} className="text-slate-500" />
                            ) : (
                              <ChevronRight size={15} className="text-slate-500" />
                            )}
                            <span className="font-bold text-slate-800">
                              Region {region.name || region.code}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {golonganGroups.length} golongan • {typeCount} jenis kendaraan
                            </span>
                            {master && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                                MASTER
                              </span>
                            )}
                            <span className="ml-auto flex items-center gap-2">
                              {!master && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void handleDeleteRegion(region)
                                  }}
                                  disabled={saving}
                                  title={`Hapus region ${region.code}`}
                                  className="rounded-md p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                              <span className="text-[11px] text-slate-400">
                                {open ? 'Sembunyikan' : 'Tampilkan'}
                              </span>
                            </span>
                          </div>
                        </td>
                      </tr>

                      {open &&
                        golonganGroups.map(([golongan, groupCells]) => (
                          <Fragment key={`${region.id}-${golongan}`}>
                            <tr className="bg-slate-50">
                              <td
                                colSpan={6}
                                className="border-b border-slate-100 px-5 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400"
                              >
                                Golongan {golongan}
                              </td>
                            </tr>
                            {[...groupCells]
                              .sort(
                                (a, b) =>
                                  typeOrderIndex(a.row.type) - typeOrderIndex(b.row.type) ||
                                  normalizeType(a.row.type).localeCompare(normalizeType(b.row.type)),
                              )
                              .map((cell, i) => {
                                const Icon = iconForType(cell.row.type)
                                return (
                                  <tr
                                    key={`${region.id}-${golongan}-${cell.row.id || cell.row.type}-${i}`}
                                    className="hover:bg-blue-50/30"
                                  >
                                    <td className="border-t border-slate-100 px-4 py-2">
                                      <div className="flex items-center gap-2">
                                        <Icon size={16} strokeWidth={1.7} className="text-slate-500" />
                                        <span className="font-medium capitalize text-slate-700">
                                          {cell.row.type || '—'}
                                        </span>
                                        {cell.overridden && (
                                          <span
                                            title="Harga khusus region ini"
                                            className="h-1.5 w-1.5 rounded-full bg-blue-500"
                                          />
                                        )}
                                      </div>
                                    </td>
                                    <LockedInternalCell />
                                    <SheetCell
                                      value={region.lokal_tariff ?? 0}
                                      onCommit={(v) => commitLokal(region, v)}
                                      title="Tarif lokal wilayah ini"
                                    />
                                    <SheetCell
                                      value={cell.muatan}
                                      onCommit={(v) => commitCell(region, cell, 'muatan', v)}
                                      title={
                                        cell.overridden
                                          ? 'Tarif region ini: kendaraan bermuatan'
                                          : 'Sama dengan BADAU (bisa diubah): kendaraan bermuatan'
                                      }
                                    />
                                    <SheetCell
                                      value={cell.kosong}
                                      onCommit={(v) => commitCell(region, cell, 'kosong', v)}
                                      title={
                                        cell.overridden
                                          ? 'Tarif region ini: kendaraan kosong'
                                          : 'Sama dengan BADAU (bisa diubah): kendaraan kosong'
                                      }
                                    />
                                    <td className="border-t border-slate-100 px-2 py-1.5">
                                      <div className="flex items-center justify-center gap-1">
                                        <button
                                          onClick={() => openEdit(region, cell)}
                                          title="Edit tarif"
                                          className="rounded-md border border-blue-100 bg-blue-50 p-1 text-blue-600 transition hover:bg-blue-100"
                                        >
                                          <Pencil size={12} />
                                        </button>
                                        {master && (
                                          <button
                                            onClick={() => void handleDeleteRow(cell.row)}
                                            title="Hapus baris ini"
                                            className="rounded-md border border-red-100 bg-red-50 p-1 text-red-500 transition hover:bg-red-100"
                                          >
                                            <Trash2 size={12} />
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                          </Fragment>
                        ))}
                    </Fragment>
                  )
                })}
                {visibleGroups.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-[12px] text-slate-400">
                      {regions.length === 0
                        ? 'Belum ada region di server.'
                        : 'Tidak ada tarif yang cocok dengan filter.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Panel tambah / edit */}
        <aside id="tariff-form" className="xl:sticky xl:top-6">
          <div className={CARD}>
            <div className="flex items-start gap-2 border-b border-slate-100 px-4 py-3.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                <Plus size={15} />
              </span>
              <div>
                <h4 className="text-[13px] font-bold text-slate-800">
                  {editTarget ? 'Edit Tarif' : 'Tambah / Edit Tarif'}
                </h4>
                <p className="text-[11px] text-slate-400">
                  {editTarget
                    ? 'Ubah nominal tarif yang dipilih.'
                    : 'Tambahkan baris tarif baru per region.'}
                </p>
              </div>
            </div>

            <div className="space-y-3 px-4 py-4">
              <Field label="Region" required>
                <select
                  value={form.regionId}
                  onChange={(e) => changeFormRegion(e.target.value)}
                  disabled={!!editTarget || saving}
                  className={INPUT_CLS}
                >
                  <option value="">Pilih Region</option>
                  {orderedRegions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || r.code}
                      {isMasterRegion(r) ? ' (Master)' : ''}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Jenis Kendaraan" required>
                <input
                  list="tariff-type-options"
                  value={form.type}
                  onChange={(e) => changeFormType(e.target.value)}
                  disabled={!!editTarget || saving}
                  placeholder="Pilih jenis kendaraan"
                  className={INPUT_CLS}
                />
              </Field>

              <Field label="Golongan" required>
                <select
                  value={form.golongan}
                  onChange={(e) => setForm((f) => ({ ...f, golongan: e.target.value }))}
                  disabled={!!editTarget || saving}
                  className={INPUT_CLS}
                >
                  <option value="">Pilih Golongan</option>
                  {GOLONGAN_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      Golongan {g}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="!mt-5 border-t border-slate-100 pt-3">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                  Golongan Tarif
                </p>
                <div className="space-y-3">
                  <Field label="Internal (Rp)" required>
                    <input
                      value="0"
                      disabled
                      title="Kendaraan internal tidak ditagih"
                      className={INPUT_CLS}
                    />
                  </Field>
                  <Field label="Lokal (Rp)" required>
                    <input
                      inputMode="numeric"
                      value={form.lokal}
                      onChange={(e) => setForm((f) => ({ ...f, lokal: e.target.value }))}
                      placeholder="Contoh: 15000"
                      className={INPUT_CLS}
                    />
                  </Field>
                  <Field label="Eksternal — Ada Muatan (Rp)" required>
                    <input
                      inputMode="numeric"
                      value={form.muatan}
                      onChange={(e) => setForm((f) => ({ ...f, muatan: e.target.value }))}
                      placeholder="Contoh: 25000"
                      className={INPUT_CLS}
                    />
                  </Field>
                  <Field label="Eksternal — Kosong (Rp)" required>
                    <input
                      inputMode="numeric"
                      value={form.kosong}
                      onChange={(e) => setForm((f) => ({ ...f, kosong: e.target.value }))}
                      placeholder="Contoh: 18000"
                      className={INPUT_CLS}
                    />
                  </Field>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button onClick={resetForm} disabled={saving} className={`${BTN_GHOST} flex-1`}>
                  Batal
                </button>
                <button
                  onClick={() => void submitForm()}
                  disabled={saving}
                  className={`${BTN_PRIMARY} flex-1`}
                >
                  {saving ? 'Menyimpan…' : 'Simpan'}
                </button>
              </div>

              {editTarget && (
                <p className="text-[10.5px] leading-relaxed text-slate-400">
                  Jenis, golongan, dan region dikunci saat mengedit. Klik Batal untuk menambah
                  baris baru.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Keterangan singkat */}
      <div className={`${CARD_SUBTLE} space-y-1 px-4 py-3 text-[11px] text-slate-500`}>
        <p>
          <b className="text-slate-700">{MASTER_CODE}</b> — master tarif. Tiap region punya salinan
          barisnya sendiri, jadi mengubah {MASTER_CODE} tidak mengubah region lain.
        </p>
        <p>
          <b className="text-slate-700">Region lain</b> — ubah sel di tabel region itu sendiri
          (mis. motor {MASTER_CODE} Rp 50.000, BELITUNG Rp 45.000). Hanya baris baru yang belum
          pernah ada di region tersebut yang masih memakai nilai {MASTER_CODE}.
        </p>
        <p>
          <b className="text-slate-700">lokal</b> — nominal flat per wilayah (`region_tariffs`).
          <b className="text-slate-700"> internal</b> terkunci Rp 0 — kendaraan internal tidak
          ditagih. Titik <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" /> =
          harga khusus region tersebut.
        </p>
      </div>

      <datalist id="tariff-type-options">
        {[...new Set([...TYPE_ORDER, ...tariffs.map((t) => t.type)])]
          .filter(Boolean)
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
    </div>
  )
}
