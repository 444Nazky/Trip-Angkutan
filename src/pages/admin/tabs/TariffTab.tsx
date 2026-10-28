/**
 * Tab "Master Tarif Jenis Kendaraan" di admin dashboard.
 *
 * Sumber angka (resolver backend, handlers/tariffRules.ts -> resolveTariff):
 *
 *   1. Kategori Internal -> Rp 0 (kolom "internal" terkunci)
 *   2. Baris wilayah `region_tariff_rows` -> satu baris per (region, jenis):
 *      `lokal_tariff` untuk kategori Lokal, muatan/kosong untuk Eksternal.
 *   3. Tarif wilayah flat `region_tariffs` -> cadangan untuk lokal yang masih 0
 *
 * Edit seperti spreadsheet: klik angka, ubah, Enter/blur = autosave.
 * Semua region menulis barisnya sendiri.
 */

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
import {
  RegionTariffRow,
  bulkUpsertRegionTariffRows,
  deleteRegionTariffRow,
  fetchRegionTariffs,
  upsertRegionTariffRow,
} from '../../../services/tariffs'
import {
  createVehicleType,
  deleteVehicleType,
  fetchVehicleTypes,
  type VehicleType,
} from '../../../services/vehicleTypes'

interface TariffTabProps {
  /**
   * Status koneksi ke server API intranet.
   * `auth` berarti server hidup tetapi login admin ditolak.
   */
  serverState: 'connecting' | 'online' | 'offline' | 'auth'
  showToast: (msg: string, type?: 'success' | 'error') => void
}

/** Isi panel "Tambah / Edit Tarif". Semua nominal berupa string mentah. */
interface TariffForm {
  regionId: string
  type: string
  lokal: string
  muatan: string
  kosong: string
}

/** Nilai satu jenis kendaraan di satu region. `stored` = baris ada di server. */
interface Cell {
  type: string
  lokal: number
  muatan: number
  kosong: number
  stored: boolean
}

/** Nilai khusus: form region = "semua region". */
const ALL_REGIONS = '__all__'

const INPUT_CLS =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400'
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40'
const BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40'

const EMPTY_FORM: TariffForm = { regionId: '', type: '', lokal: '', muatan: '', kosong: '' }

const normalizeType = (t: string) =>
  String(t ?? '')
    .trim()
    .toLowerCase()
    .replace(/truck/g, 'truk')

/**
 * Ikon untuk jenis kendaraan.
 *
 * Dipilih dari kata kunci nama, bukan dari daftar hardcode. Jadi jenis baru
 * yang ditambahkan admin di database tetap tampil dengan ikon yang masuk akal
 * tanpa perlu mengubah kode.
 */
const iconForType = (type: string) => {
  const t = normalizeType(type)
  if (t.includes('motor') || t.includes('sepeda')) return Bike
  if (t.includes('mobil') || t.includes('pickup') || t.includes('bus')) return Car
  if (t.includes('trailer') || t.includes('container')) return Container
  return Truck
}

/** "truk kecil" -> "Truk Kecil" (label tampilan). */
const prettyType = (t: string) =>
  String(t ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')

const fmtNum = (n: number) => Number(n || 0).toLocaleString('id-ID')
const digits = (s: string) => Number(String(s).replace(/[^\d]/g, '')) || 0

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
      <span className="mb-1 block text-[11px] font-semibold text-slate-600">
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
      className={`border border-slate-200 px-2 py-2 text-right text-[13px] tabular-nums ${
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
      className="cursor-not-allowed border border-slate-200 bg-slate-50/60 px-2 py-2 select-none"
    >
      <span className="block text-center text-[12px] text-slate-400">–</span>
    </td>
  )
}

export function TariffTab({ serverState, showToast }: TariffTabProps) {
  const [regions, setRegions] = useState<RegionTariffRow[]>([])
  /** Region yang barisnya sedang dibuka. Default: semua region terbuka. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /** Id region yang sudah pernah diproses (supaya pilihan collapse user tidak ditimpa). */
  const knownRegionIds = useRef<Set<string>>(new Set())
  const [filterRegion, setFilterRegion] = useState('')
  const [filterType, setFilterType] = useState('')
  const [form, setForm] = useState<TariffForm>(EMPTY_FORM)
  /** Master jenis kendaraan (dari database). */
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([])
  /** Nama jenis baru yang sedang diketik di panel master. */
  const [newTypeName, setNewTypeName] = useState('')
  /** Baris yang sedang diedit lewat panel kanan (null = mode tambah). */
  const [editTarget, setEditTarget] = useState<{ regionId: string; type: string } | null>(null)
  const [saving, setSaving] = useState(false)

  /** Muat ulang region + tarif flat + baris tarif dari server. */
  const reloadRegions = useCallback(async () => {
    const fresh = await fetchRegionTariffs()
    if (fresh) setRegions(fresh)
    else showToast('Gagal memuat tarif region', 'error')
  }, [showToast])

  /** Muat ulang master jenis kendaraan dari database. */
  const reloadTypes = useCallback(async () => {
    const fresh = await fetchVehicleTypes(true)
    if (fresh) setVehicleTypes(fresh)
    else showToast('Gagal memuat daftar jenis kendaraan', 'error')
  }, [showToast])

  useEffect(() => {
    void reloadRegions()
    void reloadTypes()
  }, [reloadRegions, reloadTypes])

  /**
   * Semua jenis kendaraan untuk tabel tarif.
   *
   * Sumbernya master di database (`vehicle_types`). Jenis yang hanya ada di
   * baris tarif region tapi belum terdaftar di master ikut ditampilkan (supaya
   * barisnya tidak "hilang"), dengan penanda bahwa jenis itu belum terdaftar.
   */
  const allTypes = useMemo(() => {
    const map = new Map<string, { name: string; sort: number }>()
    for (const t of vehicleTypes) {
      const key = normalizeType(t.name)
      if (key) map.set(key, { name: t.name, sort: t.sortOrder })
    }
    for (const r of regions) {
      for (const row of r.rows ?? []) {
        const key = normalizeType(row.vehicleType)
        if (key && !map.has(key)) {
          map.set(key, { name: String(row.vehicleType), sort: 999 })
        }
      }
    }
    return [...map.values()]
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .map((v) => v.name)
  }, [regions, vehicleTypes])

  /**
   * Katalog jenis kendaraan untuk form tarif.
   *
   * `registered` = jenis ini ada di master database. Jenis yang belum
   * terdaftar (baris tarif lama) tetap bisa dipilih, tapi ditandai supaya
   * admin bisa mendaftarkannya ke master.
   *
   * Ejaan asli dari DB dipakai sebagai nilai simpan supaya tidak tercipta
   * baris duplikat untuk region yang sama (mis. "Truk Kecil" vs "truk kecil").
   */
  const typeCatalog = useMemo(() => {
    const map = new Map<string, { value: string; label: string; registered: boolean; sort: number }>()
    for (const t of vehicleTypes) {
      const key = normalizeType(t.name)
      if (!key || map.has(key)) continue
      map.set(key, { value: t.name, label: t.name, registered: true, sort: t.sortOrder })
    }
    for (const r of regions) {
      for (const row of r.rows ?? []) {
        const raw = String(row.vehicleType ?? '').trim()
        if (!raw) continue
        const key = normalizeType(raw)
        if (!key || map.has(key)) continue
        map.set(key, { value: raw, label: prettyType(raw), registered: false, sort: 999 })
      }
    }
    return [...map.values()].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  }, [regions, vehicleTypes])

  /** Jenis master (aktif) - sumber daftar kartu filter. */
  const masterTypes = useMemo(
    () => vehicleTypes.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [vehicleTypes],
  )

  /** Berapa region yang memakai suatu jenis (untuk peringatan hapus). */
  const usageByType = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of regions) {
      for (const row of r.rows ?? []) {
        const key = normalizeType(row.vehicleType)
        map.set(key, (map.get(key) ?? 0) + 1)
      }
    }
    return map
  }, [regions])

  /** Region urut nama. */
  const orderedRegions = useMemo(
    () =>
      [...regions].sort((a, b) =>
        String(a.name ?? a.code).localeCompare(String(b.name ?? b.code)),
      ),
    [regions],
  )

  /** Nilai tampil per region: baris region bila ada, selain itu Rp 0. */
  const cellsFor = useCallback(
    (region: RegionTariffRow): Cell[] => {
      const overrides = new Map(region.rows?.map((o) => [normalizeType(o.vehicleType), o]) ?? [])
      return allTypes.map((type) => {
        const o = overrides.get(normalizeType(type))
        return {
          type: o?.vehicleType ?? type,
          // Baris yang belum tersimpan masih memakai tarif lokal wilayah.
          lokal: o ? o.lokalTariff : (region.lokal_tariff ?? 0),
          muatan: o ? o.muatanTariff : 0,
          kosong: o ? o.kosongTariff : 0,
          stored: !!o,
        }
      })
    },
    [allTypes],
  )

  /** Tabel yang terlihat setelah filter region/jenis. */
  const visibleGroups = useMemo(
    () =>
      orderedRegions
        .filter((r) => !filterRegion || r.id === filterRegion)
        .map((region) => ({
          region,
          cells: cellsFor(region).filter(
            (c) => !filterType || normalizeType(c.type) === filterType,
          ),
        }))
        .filter((g) => g.cells.length > 0),
    [orderedRegions, cellsFor, filterRegion, filterType],
  )

  /** Pilih region awal + buka semua accordion region secara default. */
  useEffect(() => {
    if (!orderedRegions.length) return
    if (!form.regionId) {
      setForm((f) => (f.regionId ? f : { ...f, regionId: orderedRegions[0].id }))
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

  /** Simpan satu sel: upsert baris (region, jenis) berisi lokal/muatan/kosong. */
  const commitCell = async (
    region: RegionTariffRow,
    cell: Cell,
    field: 'lokal' | 'muatan' | 'kosong',
    v: number,
  ): Promise<boolean> => {
    setSaving(true)
    try {
      const res = await upsertRegionTariffRow({
        regionId: region.id,
        vehicleType: cell.type,
        muatanTariff: field === 'muatan' ? v : cell.muatan,
        kosongTariff: field === 'kosong' ? v : cell.kosong,
        ...(field === 'lokal' ? { lokalTariff: v } : {}),
      })
      if (!res.ok) {
        showToast(res.reason ?? 'Tarif kendaraan gagal disimpan karena server menolak permintaan', 'error')
        return false
      }
      await reloadRegions()
      return true
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setEditTarget(null)
    setForm((f) => ({ ...EMPTY_FORM, regionId: f.regionId }))
  }

  const openEdit = (region: RegionTariffRow, cell: Cell) => {
    setEditTarget({ regionId: region.id, type: cell.type })
    setForm({
      regionId: region.id,
      // Tampilkan ejaan katalog (mis. "Truk Kecil"), bukan ejaan mentah di DB.
      type:
        typeCatalog.find((t) => normalizeType(t.value) === normalizeType(cell.type))?.value ??
        cell.type,
      lokal: String(cell.lokal),
      muatan: String(cell.muatan),
      kosong: String(cell.kosong),
    })
    setExpanded((prev) => new Set(prev).add(region.id))
  }

  /** Pilih jenis kendaraan → isi muatan/kosong dari baris region yang ada. */
  const changeFormType = (v: string) => {
    const region = regions.find((r) => r.id === form.regionId)
    const row = region?.rows?.find((o) => normalizeType(o.vehicleType) === normalizeType(v))
    setForm((f) => ({
      ...f,
      type: v,
      lokal: row ? String(row.lokalTariff) : String(region?.lokal_tariff ?? 0),
      muatan: !f.muatan && row ? String(row.muatanTariff) : f.muatan,
      kosong: !f.kosong && row ? String(row.kosongTariff) : f.kosong,
    }))
  }

  /**
   * Ganti region di form.
   *
   * - "Semua Region" → mode massal (bulk): tarif jenis yang dipilih diterapkan
   *   ke semua region (tambah) atau ke semua region yang sudah punya baris
   *   untuk jenis itu (edit).
   * - Region biasa → mode satu region. Saat sedang edit, target edit ikut
   *   pindah ke region yang dipilih untuk jenis yang sama.
   */
  const changeFormRegion = (id: string) => {
    if (id === ALL_REGIONS) {
      setForm((f) => ({ ...f, regionId: ALL_REGIONS, lokal: '' }))
      return
    }
    const r = regions.find((x) => x.id === id)
    if (editTarget) {
      // Mode edit: pindah target ke region lain untuk jenis yang sama.
      const row = r?.rows?.find((o) => normalizeType(o.vehicleType) === normalizeType(editTarget.type))
      setEditTarget({ regionId: id, type: editTarget.type })
      setForm((f) => ({
        ...f,
        regionId: id,
        lokal: row ? String(row.lokalTariff) : String(r?.lokal_tariff ?? 0),
        muatan: row ? String(row.muatanTariff) : f.muatan,
        kosong: row ? String(row.kosongTariff) : f.kosong,
      }))
      return
    }
    setForm((f) => ({ ...f, regionId: id, lokal: String(r?.lokal_tariff ?? 0) }))
  }

  /** Hapus baris tarif (region + jenis kendaraan). */
  const handleDeleteCell = async (region: RegionTariffRow, cell: Cell) => {
    const label = prettyType(cell.type)
    if (!confirm(`Hapus tarif "${label}" untuk region ${region.name || region.code}?`)) return
    setSaving(true)
    try {
      const res = await deleteRegionTariffRow(region.id, cell.type)
      if (!res.ok) {
        showToast(res.reason ?? 'Tarif kendaraan gagal dihapus karena server menolak permintaan', 'error')
        return
      }
      await reloadRegions()
      showToast(`Tarif ${label} dihapus dari region ${region.name || region.code}`)
      if (editTarget?.regionId === region.id && normalizeType(editTarget.type) === normalizeType(cell.type)) {
        resetForm()
      }
    } finally {
      setSaving(false)
    }
  }

  /** Simpan panel: upsert baris (region, jenis) + nominal lokal. */
  const submitForm = async () => {
    const isAll = form.regionId === ALL_REGIONS
    const type = form.type.trim()
    if (!type) return showToast('Jenis kendaraan wajib dipilih', 'error')

    const muatan = digits(form.muatan)
    const kosong = digits(form.kosong)

    // ---- Mode "Semua Region": satu harga untuk banyak region ----
    if (isAll) {
      setSaving(true)
      try {
        // Tambah → semua region. Edit → hanya region yang sudah punya baris
        // untuk jenis ini (agar jenis baru tidak muncul di region yang tak用它).
        const scope = editTarget ? 'existing' : 'all'
        const res = await bulkUpsertRegionTariffRows({
          vehicleType: type,
          muatanTariff: muatan,
          kosongTariff: kosong,
          scope,
        })
        if (!res.ok) {
          showToast(res.reason ?? 'Tarif gagal disimpan ke semua region karena server menolak permintaan', 'error')
          return
        }
        await reloadRegions()
        showToast(
          res.updated > 0
            ? `Tarif ${prettyType(type)} tersimpan di ${res.updated} region`
            : `Tidak ada region yang memakai tarif ${prettyType(type)}`,
        )
        resetForm()
      } finally {
        setSaving(false)
      }
      return
    }

    const region = regions.find((r) => r.id === form.regionId)
    if (!region) return showToast('Pilih region terlebih dahulu', 'error')

    const lokal = form.lokal.trim() === '' ? null : digits(form.lokal)

    if (editTarget) {
      const target = regions.find((r) => r.id === editTarget.regionId)
      if (!target) return showToast('Region tidak ditemukan', 'error')
      const existing = target.rows?.find(
        (o) => normalizeType(o.vehicleType) === normalizeType(editTarget.type),
      )
      const before: Cell = {
        type: editTarget.type,
        lokal: existing ? existing.lokalTariff : (target.lokal_tariff ?? 0),
        muatan: existing?.muatanTariff ?? 0,
        kosong: existing?.kosongTariff ?? 0,
        stored: !!existing,
      }
      if (muatan !== before.muatan && !(await commitCell(target, before, 'muatan', muatan))) return
      if (kosong !== before.kosong) {
        const nextCell: Cell = { ...before, muatan, kosong }
        if (!(await commitCell(target, nextCell, 'kosong', kosong))) return
      }
      if (lokal !== null && lokal !== before.lokal) {
        const nextCell: Cell = { ...before, muatan, kosong }
        if (!(await commitCell(target, nextCell, 'lokal', lokal))) return
      }
      showToast('Tarif diperbarui')
      resetForm()
      return
    }

    setSaving(true)
    try {
      const res = await upsertRegionTariffRow({
        regionId: region.id,
        vehicleType: type,
        muatanTariff: muatan,
        kosongTariff: kosong,
        ...(lokal === null ? {} : { lokalTariff: lokal }),
      })
      if (!res.ok) return showToast(res.reason ?? 'Tarif kendaraan gagal disimpan karena server menolak permintaan', 'error')

      await reloadRegions()
      setExpanded((prev) => new Set(prev).add(region.id))
      showToast('Tarif ditambahkan')
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  /** Jenis yang dipakai di baris tarif tapi belum terdaftar di master. */
  const unregisteredTypes = useMemo(
    () => typeCatalog.filter((t) => !t.registered),
    [typeCatalog],
  )

  /** Tambah jenis kendaraan ke master (langsung ke database). */
  const handleAddType = async () => {
    const name = newTypeName.trim()
    if (!name) return
    setSaving(true)
    try {
      const res = await createVehicleType(name)
      if (!res.ok) {
        showToast(res.reason ?? 'Jenis kendaraan gagal ditambahkan karena server menolak permintaan', 'error')
        return
      }
      setNewTypeName('')
      await reloadTypes()
      showToast(`Jenis kendaraan "${name}" ditambahkan ke master`)
    } finally {
      setSaving(false)
    }
  }

  /** Hapus jenis kendaraan dari master (baris tarif ikut terhapus). */
  const handleDeleteType = async (t: VehicleType) => {
    const used = usageByType.get(normalizeType(t.name)) ?? 0
    const warn = used > 0
      ? `\n\n${used} baris tarif untuk jenis ini juga akan dihapus. Riwayat trip lama tidak berubah.`
      : '\n\nRiwayat trip lama tidak berubah.'
    if (!confirm(`Hapus jenis kendaraan "${t.name}" dari master?${warn}`)) return
    setSaving(true)
    try {
      const res = await deleteVehicleType(t.id)
      if (!res.ok) {
        showToast(res.reason ?? 'Jenis kendaraan gagal dihapus karena server menolak permintaan', 'error')
        return
      }
      await Promise.all([reloadTypes(), reloadRegions()])
      if (normalizeType(form.type) === normalizeType(t.name)) resetForm()
      showToast(`Jenis kendaraan "${t.name}" dihapus dari master`)
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
    <div className="space-y-5">
      {/* Header halaman */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-900">Master Tarif Jenis Kendaraan</h3>
          <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
            Kelola tarif untuk setiap jenis kendaraan pada setiap region.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ${
            serverOk
              ? 'bg-emerald-50 text-emerald-600'
              : serverBad
                ? 'bg-red-50 text-red-600'
                : 'bg-amber-50 text-amber-600'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              serverOk ? 'bg-emerald-500' : serverBad ? 'bg-red-500' : 'bg-amber-500'
            }`}
          />
          Server: {serverLabel}
        </span>
      </div>

      {/* Filter */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto]">
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
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button
              onClick={() => {
                setFilterRegion('')
                setFilterType('')
              }}
              className={`${BTN_PRIMARY} h-[38px] w-full lg:w-auto`}
            >
              <Search size={14} /> Tampilkan
            </button>
          </div>
        </div>
      </div>

      {/* Master jenis kendaraan - sumber tunggal, disimpan di database */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-[13px] font-bold text-slate-800">Master Jenis Kendaraan</h4>
            <p className="text-[11px] text-slate-500">
              Daftar ini disimpan di database dan dipakai bersama oleh dashboard admin dan
              aplikasi petugas - jadi pilihan di kedua aplikasi selalu sama.
            </p>
          </div>
          <div className="flex w-full max-w-md gap-2 sm:w-auto">
            <input
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddType()
              }}
              placeholder="Contoh: Truk Ringan"
              className={INPUT_CLS}
            />
            <button
              type="button"
              onClick={() => void handleAddType()}
              disabled={saving || !newTypeName.trim()}
              className={`${BTN_PRIMARY} shrink-0`}
            >
              <Plus size={14} /> Tambah
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {masterTypes.length === 0 && (
            <p className="text-[11px] text-slate-400">
              Belum ada jenis kendaraan di master. Tambahkan lewat kolom di atas - jenis ini
              langsung tersimpan ke database dan langsung muncul di aplikasi petugas.
            </p>
          )}
          {masterTypes.map((t) => {
            const used = usageByType.get(normalizeType(t.name)) ?? 0
            return (
              <span
                key={t.id}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11.5px] font-medium text-slate-700"
              >
                {t.name}
                <span className="text-[10px] font-normal text-slate-400">
                  {used > 0 ? `${used} baris tarif` : 'belum dipakai'}
                </span>
                <button
                  type="button"
                  title={`Hapus jenis ${t.name} dari master`}
                  disabled={saving}
                  onClick={() => void handleDeleteType(t)}
                  className="rounded-full p-0.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            )
          })}
        </div>

        {unregisteredTypes.length > 0 && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            Ada baris tarif untuk jenis yang belum terdaftar di master:{' '}
            <b>{unregisteredTypes.map((t) => t.label).join(', ')}</b>. Daftarkan dulu supaya jenis ini
            muncul sebagai pilihan yang sama di aplikasi petugas.
          </p>
        )}
      </div>

      {/* Kartu jenis kendaraan (dari master database) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {masterTypes.map((t, i) => {
          const key = normalizeType(t.name)
          const active = filterType === key
          const Icon = iconForType(t.name)
          return (
            <button
              key={t.id}
              onClick={() => setFilterType(active ? '' : key)}
              title={active ? 'Tampilkan semua jenis' : `Filter jenis: ${t.name}`}
              className={`flex flex-col items-center gap-2 rounded-2xl border bg-white px-2 py-4 transition ${
                active
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                  : 'border-slate-200 hover:border-blue-200 hover:shadow-sm'
              }`}
            >
              <Icon size={34} strokeWidth={1.6} className="text-slate-500" />
              <span className="text-center text-[12px] font-semibold leading-tight text-slate-700">
                {i + 1}. {t.name}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Tabel tarif */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="border border-slate-200 px-4 py-2 text-left font-semibold">
                    Jenis Kendaraan
                  </th>
                  <th className="border border-slate-200 px-2 py-2 text-center font-semibold">
                    Internal
                  </th>
                  <th className="border border-slate-200 px-2 py-2 text-center font-semibold">
                    Lokal
                  </th>
                  <th className="border border-slate-200 px-2 py-2 text-center font-semibold">
                    Ada Muatan
                  </th>
                  <th className="border border-slate-200 px-2 py-2 text-center font-semibold">
                    Kosong
                  </th>
                  <th className="border border-slate-200 px-2 py-2 text-center font-semibold">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map(({ region, cells }) => {
                  const open = expanded.has(region.id)
                  return (
                    <Fragment key={region.id}>
                      <tr
                        className="cursor-pointer bg-slate-800 transition hover:bg-slate-700"
                        onClick={() => toggleRegion(region.id)}
                      >
                        <td colSpan={6} className="border-b border-slate-700 px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {open ? (
                              <ChevronDown size={15} className="text-slate-400" />
                            ) : (
                              <ChevronRight size={15} className="text-slate-400" />
                            )}
                            <span className="font-bold text-white">
                              Region {region.name || region.code}
                            </span>
                            <span className="text-[11px] text-slate-300">
                              {cells.length} jenis kendaraan
                            </span>
                            <span className="ml-auto flex items-center gap-2">
                              <span className="text-[11px] text-slate-300">
                                {open ? 'Sembunyikan' : 'Tampilkan'}
                              </span>
                            </span>
                          </div>
                        </td>
                      </tr>

                      {open &&
                        cells.map((cell, i) => {
                          const Icon = iconForType(cell.type)
                          return (
                            <tr
                              key={`${region.id}-${cell.type}-${i}`}
                              className={`${i % 2 === 1 ? 'bg-slate-50/40' : ''} hover:bg-blue-50/30 transition-colors duration-150`}
                            >
                              <td className="border border-slate-200 px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <Icon size={16} strokeWidth={1.7} className="text-slate-500" />
                                  <span className="font-medium text-slate-700">
                                    {prettyType(cell.type) || '—'}
                                  </span>
                                  {cell.stored && (
                                    <span
                                      title="Baris tarif region ini tersimpan"
                                      className="h-1.5 w-1.5 rounded-full bg-blue-500"
                                    />
                                  )}
                                </div>
                              </td>
                              <LockedInternalCell />
                              <SheetCell
                                value={cell.lokal}
                                onCommit={(v) => commitCell(region, cell, 'lokal', v)}
                                title="Tarif lokal jenis kendaraan ini"
                              />
                              <SheetCell
                                value={cell.muatan}
                                onCommit={(v) => commitCell(region, cell, 'muatan', v)}
                                title="Tarif region ini: kendaraan bermuatan"
                              />
                              <SheetCell
                                value={cell.kosong}
                                onCommit={(v) => commitCell(region, cell, 'kosong', v)}
                                title="Tarif region ini: kendaraan kosong"
                              />
                              <td className="border border-slate-200 px-2 py-1.5">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => openEdit(region, cell)}
                                    title="Edit tarif"
                                    className="rounded-md border border-blue-100 bg-blue-50 p-1 text-blue-600 transition hover:bg-blue-100"
                                  >
                                    <Pencil size={12} />
                                  </button>
                                  <button
                                    onClick={() => void handleDeleteCell(region, cell)}
                                    disabled={!cell.stored || saving}
                                    title={
                                      cell.stored
                                        ? 'Hapus tarif kendaraan ini'
                                        : 'Belum ada baris tarif untuk dihapus'
                                    }
                                    className="rounded-md border border-red-100 bg-red-50 p-1 text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
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
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                  disabled={saving}
                  className={INPUT_CLS}
                >
                  <option value="">Pilih Region</option>
                  <option value={ALL_REGIONS}>
                    Semua Region ({orderedRegions.length})
                  </option>
                  {orderedRegions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || r.code}
                    </option>
                  ))}
                </select>
              </Field>

              {form.regionId === ALL_REGIONS && (
                <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[10.5px] leading-relaxed text-blue-800">
                  Mode <b>Semua Region</b>: tarif untuk jenis kendaraan ini berlaku di{' '}
                  {orderedRegions.length} region sekaligus
                  {editTarget
                    ? ' (hanya region yang sudah memakai jenis ini).'
                    : ' (jenis baru ikut dibuat di semua region).'}
                </p>
              )}

              <Field label="Jenis Kendaraan" required>
                <select
                  value={form.type}
                  onChange={(e) => changeFormType(e.target.value)}
                  disabled={!!editTarget || saving}
                  className={INPUT_CLS}
                >
                  <option value="">Pilih jenis kendaraan</option>
                  {typeCatalog.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                      {t.registered ? '' : ' (belum terdaftar di master)'}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[10.5px] text-slate-400">
                  Daftar jenis diambil dari master di database. Tambah jenis baru lewat panel
                  &ldquo;Master Jenis Kendaraan&rdquo; di atas supaya langsung tersedia di aplikasi
                  petugas.
                </span>
              </Field>

              <div className="!mt-5 border-t border-slate-100 pt-3">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                  Nominal Tarif
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
                      disabled={form.regionId === ALL_REGIONS}
                      title={
                        form.regionId === ALL_REGIONS
                          ? 'Tarif lokal berlaku per wilayah dan jenis kendaraan, jadi tidak bisa disamakan ke semua region'
                          : undefined
                      }
                      className={INPUT_CLS}
                    />
                    {form.regionId === ALL_REGIONS && (
                      <span className="mt-1 block text-[10.5px] text-slate-400">
                        Tarif lokal berlaku per wilayah dan jenis kendaraan — isi per region.
                      </span>
                    )}
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
                  Jenis dikunci saat mengedit. Pilih <b>Semua Region</b> untuk menerapkan tarif ini ke
                  semua region yang memakai jenis tersebut. Klik Batal untuk menambah baris baru.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Keterangan singkat */}
      <div className="space-y-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-500 shadow-sm">
        <p>
          Tiap region punya baris tarifnya sendiri. Region yang belum punya baris untuk suatu jenis
          kendaraan tampil <b className="text-slate-700">Rp 0</b> — isi selnya untuk menetapkan
          harga. Sel lokal yang masih 0 memakai tarif lokal wilayah.
        </p>
        <p>
          <b className="text-slate-700">lokal</b> — harga per jenis kendaraan; isi 0 untuk memakai
          tarif lokal wilayah.
          <b className="text-slate-700"> internal</b> terkunci Rp 0 — kendaraan internal tidak
          ditagih. Titik <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" /> =
          baris tarif region ini sudah tersimpan.
        </p>
        <p>
          Pilih <b className="text-slate-700">Semua Region</b> di form tarif untuk menulis satu
          harga ke banyak region sekaligus — tidak perlu mengulang per region. Tombol{' '}
          <Trash2 size={11} className="inline text-red-600" /> menghapus baris tarif kendaraan
          tersebut pada region itu saja.
        </p>
      </div>
    </div>
  )
}
