/**
 * Tab "Master Dermaga" — kelola dermaga. Wilayah (region) bersifat tetap
 * (hardcoded lewat migrasi), tidak bisa ditambah/dihapus/diubah dari dashboard.
 *
 * Prinsip tab ini: DASHBOARD HARUS SAMA DENGAN DATABASE.
 *
 *   - Tidak ada data contoh/kosong: baris hanya muncul kalau benar-benar ada
 *     di server (`GET /regions`, `GET /dermagas`). Bila server tidak bisa
 *     dihubungi, tabel menampilkan pesan, bukan baris palsu.
 *   - Setiap tambah/hapus menulis ke server lebih dulu, lalu data dimuat ULANG
 *     dari server (`load()`). State lokal tidak pernah diubah sendiri, jadi
 *     yang tampil selalu apa yang tersimpan di database.
 *   - Dermaga yang wilayahnya sudah tidak ada di database tetap ditampilkan
 *     di bagian "tanpa wilayah" supaya tidak ada data yang tersembunyi.
 *
 * Tampilan tab ini memakai bahasa visual yang sama dengan tab master lain
 * (Master Tarif / Master Rute / Master Plat): kartu putih `rounded-2xl`,
 * input `rounded-xl`, tombol utama biru, pill status hijau/amber, dan tabel
 * dengan header uppercase kecil.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Landmark, MapPin, Plus, RefreshCw, Route as RouteIcon, Search, Trash2, TriangleAlert, Users } from 'lucide-react'
import {
  fetchAdminRegions,
  type AdminRegionRow,
} from '../../../services/tariffs'
import {
  fetchDermagas,
  createDermaga,
  deleteDermaga,
  fetchRoutes,
  type Dermaga,
  type Route,
} from '../../../services/dermagas'
import { api } from '../../../services/api'
import type { BackendOfficerRow } from '../components/types'

interface RegionTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

/** Wilayah master (tarif induk) — selalu tampil paling atas. */
const MASTER_REGION_NAME = 'BADAU'

/** Kunci kelompok untuk dermaga yang wilayahnya sudah tidak ada di database. */
const ORPHAN_KEY = '__orphan__'

/** Kode wilayah/dermaga: 2–16 karakter tanpa spasi. */
const CODE_RE = /^\S{2,16}$/

const labelOf = (row: { name?: string | null; code?: string | null }) =>
  String(row.name ?? '').trim() || String(row.code ?? '').trim() || '(tanpa nama)'

/* ------------------------------------------------------------------ */
/* Class bersama dengan tab master lain                                */
/* ------------------------------------------------------------------ */

const INPUT_CLS =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400'
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40'
const BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40'
const LABEL_CLS = 'text-[11px] text-slate-500 block mb-1'

/** Badge kecil untuk kode / jumlah pemakaian. */
const BADGE_NEUTRAL = 'inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600'
const BADGE_INFO = 'inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600'
const BADGE_OK = 'inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600'
const BADGE_WARN = 'inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700'

export function RegionTab({ showToast }: RegionTabProps) {
  const [regions, setRegions] = useState<AdminRegionRow[]>([])
  const [dermagas, setDermagas] = useState<Dermaga[]>([])
  /** Rute seluruh wilayah — hanya untuk menghitung dampak hapus dermaga. */
  const [routes, setRoutes] = useState<Route[] | null>(null)
  /** Petugas — dipakai sebagai penjaga agar wilayah yang masih dipakai tidak dihapus. */
  const [officers, setOfficers] = useState<BackendOfficerRow[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading')
  const [saving, setSaving] = useState(false)
  const [dermagaForm, setDermagaForm] = useState({ regionId: '', name: '', code: '' })
  /** Pesan error yang tampil di dalam kartu form (toast tetap muncul). */
  const [formError, setFormError] = useState('')
  /** Pencarian di tabel (hanya tampilan, bukan query server). */
  const [query, setQuery] = useState('')

  /**
   * Muat ulang seluruh data dari server. Dipanggil saat tab dibuka dan setiap
   * selesai tambah/hapus, supaya tampilan selalu cerminan database.
   */
  const load = useCallback(async (): Promise<boolean> => {
    setState('loading')
    const [regionsRes, dermagasRes, routesRes, officersRes] = await Promise.all([
      fetchAdminRegions(),
      fetchDermagas(),
      fetchRoutes(),
      api.getOk<BackendOfficerRow[]>('/officers'),
    ])

    // Wilayah & dermaga adalah isi utama tab ini. Kalau salah satunya gagal,
    // tampilan tidak boleh menampilkan data lama seolah masih sinkron.
    if (!regionsRes || !dermagasRes) {
      setState('offline')
      return false
    }

    setRegions(regionsRes)
    setDermagas(dermagasRes)
    setRoutes(routesRes)
    setOfficers(officersRes)
    setState('ready')
    return true
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Petugas yang memakai wilayah ini (kolom region_id atau relasi officer_regions). */
  const officersOfRegion = useCallback(
    (regionId: string) =>
      (officers ?? []).filter(
        (o) =>
          String(o.region_id ?? '') === regionId ||
          (o.regions ?? []).some((r) => String(r.id) === regionId),
      ),
    [officers],
  )

  const routeCountOfDermaga = useCallback(
    (dermagaId: string) => (routes === null ? null : routes.filter((r) => r.dermaga_id === dermagaId).length),
    [routes],
  )

  /** Petugas yang punya akses ke sebuah dermaga. */
  const officersOfDermaga = useCallback(
    (dermagaId: string) =>
      (officers ?? []).filter((o) => (o.dermagas ?? []).some((x) => String(x.id) === dermagaId)),
    [officers],
  )

  /** Wilayah terurut: BADAU (master) di atas, sisanya urut nama. */
  const orderedRegions = useMemo(
    () =>
      [...regions].sort(
        (a, b) =>
          Number(labelOf(b).toUpperCase() === MASTER_REGION_NAME) -
            Number(labelOf(a).toUpperCase() === MASTER_REGION_NAME) ||
          labelOf(a).localeCompare(labelOf(b)),
      ),
    [regions],
  )

  /** Kelompokkan dermaga per wilayah; yang wilayahnya sudah hilang masuk "tanpa wilayah". */
  const { byRegion, orphans } = useMemo(() => {
    const regionIds = new Set(regions.map((r) => String(r.id)))
    const grouped = new Map<string, Dermaga[]>()
    for (const d of dermagas) {
      const key = d.region_id && regionIds.has(String(d.region_id)) ? String(d.region_id) : ORPHAN_KEY
      const list = grouped.get(key) ?? []
      list.push(d)
      grouped.set(key, list)
    }
    return { byRegion: grouped, orphans: grouped.get(ORPHAN_KEY) ?? [] }
  }, [regions, dermagas])

  /** Pencarian: cocok bila nama/kode dermaga atau nama wilayah mengandung kata kunci. */
  const matches = useCallback(
    (d: Dermaga, regionName?: string) => {
      const q = query.trim().toLowerCase()
      if (!q) return true
      return (
        String(d.name ?? '').toLowerCase().includes(q) ||
        String(d.code ?? '').toLowerCase().includes(q) ||
        String(regionName ?? '').toLowerCase().includes(q)
      )
    },
    [query],
  )

  /** Dermaga yang cocok dengan pencarian, dikelompokkan per wilayah. */
  const visibleByRegion = useMemo(() => {
    const map = new Map<string, Dermaga[]>()
    for (const [regionId, list] of byRegion) {
      const regionName = regionId === ORPHAN_KEY ? '' : labelOf(regions.find((r) => String(r.id) === regionId) ?? {})
      map.set(regionId, list.filter((d) => matches(d, regionName)))
    }
    return map
  }, [byRegion, matches, regions])

  const visibleOrphans = useMemo(
    () => (visibleByRegion.get(ORPHAN_KEY) ?? []),
    [visibleByRegion],
  )

  const visibleCount = useMemo(
    () =>
      [...visibleByRegion.values()].reduce((sum, list) => sum + list.length, 0),
    [visibleByRegion],
  )

  const resetForm = () => {
    setDermagaForm({ regionId: '', name: '', code: '' })
    setFormError('')
  }

  const handleCreateDermaga = async () => {
    const name = dermagaForm.name.trim()
    const code = dermagaForm.code.trim().toUpperCase()
    setFormError('')
    if (!dermagaForm.regionId) {
      const msg = 'Pilih wilayah untuk dermaga ini'
      setFormError(msg)
      return showToast(msg, 'error')
    }
    if (!name) {
      const msg = 'Nama dermaga wajib diisi'
      setFormError(msg)
      return showToast(msg, 'error')
    }
    if (!CODE_RE.test(code)) {
      const msg = 'Kode dermaga 2–16 karakter tanpa spasi'
      setFormError(msg)
      return showToast(msg, 'error')
    }
    // Kode dermaga hanya wajib unik DI DALAM satu wilayah. Di database kantor
    // setiap wilayah memakai kode yang sama (D1, D2, ...), jadi aturan unik
    // global akan memblokir penambahan dermaga di wilayah yang masih kosong.
    if (
      dermagas.some(
        (d) =>
          String(d.region_id ?? '') === dermagaForm.regionId &&
          String(d.code ?? '').toUpperCase() === code,
      )
    ) {
      const msg = `Wilayah ini sudah punya dermaga berkode ${code}`
      setFormError(msg)
      return showToast(msg, 'error')
    }

    setSaving(true)
    try {
      const res = await createDermaga({ region_id: dermagaForm.regionId, name, code })
      if (!res.ok) {
        const msg = res.reason ?? 'Dermaga gagal ditambahkan karena server menolak permintaan'
        setFormError(msg)
        return showToast(msg, 'error')
      }
      const fresh = await load()
      if (!fresh) {
        const msg = 'Dermaga tersimpan, tetapi gagal memuat ulang dari server'
        setFormError(msg)
        return showToast(msg, 'error')
      }
      resetForm()
      showToast('Dermaga ditambahkan ke database')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDermaga = async (dermaga: Dermaga) => {
    const routeCount = routeCountOfDermaga(dermaga.id)
    const users = officersOfDermaga(dermaga.id)

    // Server MENOLAK hapus dermaga yang masih punya rute atau masih dipakai
    // petugas (FK cascade). Jadi dialog konfirmasi harus jujur soal itu —
    // bukan menjanjikan "rute ikut terhapus".
    const lines = [`Hapus dermaga ${labelOf(dermaga)} (${dermaga.code}) dari database?`, '']
    lines.push(
      routeCount === null
        ? '• Jumlah rute dermaga ini tidak bisa dipastikan (data rute tidak termuat).'
        : routeCount > 0
          ? `• Dermaga masih punya ${routeCount} rute — hapus rutenya dulu, dermaga baru bisa dihapus.`
          : '• Dermaga tidak punya rute.',
    )
    if (officers === null) {
      lines.push('• Akses petugas ke dermaga ini belum bisa dipastikan — kalau masih ada, dermaga tidak bisa dihapus.')
    } else if (users.length > 0) {
      lines.push(`• Masih dipakai ${users.length} petugas: ${users.map((o) => o.name).join(', ')} — cabut aksesnya dulu.`)
    } else {
      lines.push('• Tidak ada petugas yang memakai dermaga ini.')
    }
    lines.push('• Riwayat trip lama tidak dihapus.')
    if (!confirm(lines.join('\n'))) return

    setSaving(true)
    try {
      const res = await deleteDermaga(dermaga.id)
      if (!res.ok) return showToast(res.reason ?? 'Dermaga gagal dihapus karena server menolak permintaan', 'error')
      const fresh = await load()
      if (!fresh) return showToast('Dermaga terhapus, tetapi gagal memuat ulang dari server', 'error')
      showToast('Dermaga dihapus dari database')
    } finally {
      setSaving(false)
    }
  }

  /** Baris tabel untuk satu dermaga. */
  const dermagaRow = (d: Dermaga, alt = false) => {
    const routeCount = routeCountOfDermaga(d.id)
    const users = officersOfDermaga(d.id)
    return (
      <tr
        key={d.id}
        className={`admin-table-row ${alt ? 'bg-slate-50/40' : ''} hover:bg-slate-50/60 transition-colors duration-150`}
      >
        <td className="border border-slate-200 px-3 py-2.5">
          <span className="font-semibold text-slate-800">{labelOf(d)}</span>
        </td>
        <td className="border border-slate-200 px-3 py-2.5">
          <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-slate-600 uppercase">
            {d.code || '—'}
          </span>
        </td>
        <td className="border border-slate-200 px-3 py-2.5">
          {routeCount === null ? (
            <span className={BADGE_WARN}>rute: tidak termuat</span>
          ) : routeCount > 0 ? (
            <span className={BADGE_INFO}>
              <MapPin size={11} /> {routeCount} rute
            </span>
          ) : (
            <span className={BADGE_NEUTRAL}>0 rute</span>
          )}
        </td>
        <td className="border border-slate-200 px-3 py-2.5">
          {officers === null ? (
            <span className={BADGE_WARN}>petugas: tidak termuat</span>
          ) : users.length > 0 ? (
            <span className={BADGE_OK} title={users.map((o) => o.name).join(', ')}>
              <Users size={11} /> {users.length} petugas
            </span>
          ) : (
            <span className={BADGE_NEUTRAL}>0 petugas</span>
          )}
        </td>
        <td className="border border-slate-200 px-3 py-2.5 text-right whitespace-nowrap">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleDeleteDermaga(d)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 transition hover:text-red-600 hover:underline disabled:opacity-40"
          >
            <Trash2 size={12} /> Hapus Dermaga
          </button>
        </td>
      </tr>
    )
  }

  const serverPill =
    state === 'ready'
      ? 'bg-emerald-50 text-emerald-600'
      : state === 'offline'
        ? 'bg-amber-50 text-amber-600'
        : 'bg-slate-100 text-slate-500'
  const serverDot =
    state === 'ready'
      ? 'bg-emerald-500'
      : state === 'offline'
        ? 'bg-amber-500'
        : 'bg-slate-400 animate-pulse'

  const formDirty = !!(dermagaForm.regionId || dermagaForm.name || dermagaForm.code)

  return (
    <div className="space-y-4">
      {/* Header halaman */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-900">Master Dermaga</h3>
          <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
            Tambah / hapus dermaga — wilayah tetap, setiap perubahan langsung ditulis ke database.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600">
            {regions.length} wilayah · {dermagas.length} dermaga
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ${serverPill}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${serverDot}`} />
            {state === 'ready' ? 'Server: Tersambung' : state === 'offline' ? 'Server tidak merespons' : 'Memuat...'}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={state === 'loading' || saving}
            className={BTN_GHOST}
          >
            <RefreshCw size={12} /> Muat ulang
          </button>
        </div>
      </div>

      {/* Ringkasan cepat */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Wilayah', value: regions.length, Icon: Landmark, tone: 'text-slate-700' },
          { label: 'Dermaga', value: dermagas.length, Icon: MapPin, tone: 'text-blue-600' },
          { label: 'Rute', value: routes === null ? '—' : routes.length, Icon: RouteIcon, tone: 'text-emerald-600' },
          { label: 'Petugas', value: officers === null ? '—' : officers.length, Icon: Users, tone: 'text-amber-600' },
        ].map(({ label, value, Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
              <Icon size={13} /> {label}
            </div>
            <p className={`mt-1 text-xl font-black ${tone}`}>{value}</p>
          </div>
        ))}
      </div>

      {officers === null && state === 'ready' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          Daftar petugas tidak bisa dimuat, jadi jumlah petugas pada konfirmasi hapus dermaga tidak bisa dipastikan.
          Tekan <span className="font-bold">Muat ulang</span> untuk mencoba lagi.
        </div>
      )}

      {/* Form tambah dermaga */}
      <div className="max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Plus size={15} />
          </span>
          <div>
            <h3 className="font-bold text-slate-800">Tambah Dermaga</h3>
            <p className="text-[11px] text-slate-500">
              Dermaga baru langsung tersimpan ke database dan dipakai aplikasi petugas.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={LABEL_CLS}>Wilayah *</label>
            <select
              value={dermagaForm.regionId}
              onChange={(e) => {
                setDermagaForm({ ...dermagaForm, regionId: e.target.value })
                setFormError('')
              }}
              className={INPUT_CLS}
            >
              <option value="">— Pilih Wilayah —</option>
              {orderedRegions.map((r) => (
                <option key={r.id} value={r.id}>
                  {labelOf(r)}
                  {r.code ? ` (${r.code})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Nama Dermaga *</label>
            <input
              value={dermagaForm.name}
              onChange={(e) => {
                setDermagaForm({ ...dermagaForm, name: e.target.value })
                setFormError('')
              }}
              placeholder="cth: Dermaga Badau"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Kode Dermaga *</label>
            <input
              value={dermagaForm.code}
              onChange={(e) => {
                setDermagaForm({ ...dermagaForm, code: e.target.value.toUpperCase() })
                setFormError('')
              }}
              placeholder="cth: BDU"
              className={`${INPUT_CLS} font-mono tracking-wide uppercase`}
            />
            <p className="mt-1 text-[10.5px] text-slate-400">
              2–16 karakter tanpa spasi, unik di dalam satu wilayah (bisa sama antar wilayah).
            </p>
          </div>
        </div>

        {formError && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-600">
            <TriangleAlert size={13} /> {formError}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleCreateDermaga()}
            className={`${BTN_PRIMARY} flex-1 sm:flex-none sm:min-w-[200px]`}
          >
            <Plus size={15} /> Tambah Dermaga
          </button>
          {formDirty && (
            <button type="button" onClick={resetForm} className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-[12.5px] font-semibold text-slate-600 transition hover:bg-slate-50">
              Bersihkan
            </button>
          )}
        </div>
      </div>

      {/* Tabel dermaga */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-[13px] font-bold text-slate-800">Daftar Dermaga</h3>
            <p className="text-[11px] text-slate-500">
              Dikelompokkan per wilayah · {visibleCount} dari {dermagas.length} dermaga ditampilkan
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama / kode dermaga…"
              aria-label="Cari dermaga"
              className={`${INPUT_CLS} pl-8 text-[12.5px]`}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="border border-slate-200 px-3 py-2.5 text-left">Dermaga</th>
                <th className="border border-slate-200 px-3 py-2.5 text-left w-[140px]">Kode</th>
                <th className="border border-slate-200 px-3 py-2.5 text-left w-[150px]">Rute</th>
                <th className="border border-slate-200 px-3 py-2.5 text-left w-[150px]">Petugas</th>
                <th className="border border-slate-200 px-3 py-2.5 text-right w-[170px]">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {state === 'offline' && (
                <tr>
                  <td colSpan={5} className="border border-slate-200 px-3 py-10 text-center text-[12px] text-slate-500">
                    Server tidak bisa dihubungi, jadi data wilayah & dermaga belum bisa ditampilkan. Tekan
                    <span className="font-bold"> Muat ulang</span> setelah server hidup.
                  </td>
                </tr>
              )}

              {state === 'loading' && (
                <tr>
                  <td colSpan={5} className="border border-slate-200 px-3 py-10 text-center text-[12px] text-slate-400">
                    <span className="inline-block animate-pulse">Memuat data wilayah…</span>
                  </td>
                </tr>
              )}

              {state === 'ready' && orderedRegions.length === 0 && orphans.length === 0 && (
                <tr>
                  <td colSpan={5} className="border border-slate-200 px-3 py-10 text-center text-[12px] text-slate-400">
                    Belum ada wilayah di database.
                  </td>
                </tr>
              )}

              {state === 'ready' &&
                orderedRegions.map((region) => {
                  const own = byRegion.get(String(region.id)) ?? []
                  const shown = visibleByRegion.get(String(region.id)) ?? []
                  const users = officersOfRegion(String(region.id))
                  return (
                    <Fragment key={region.id}>
                      <tr className="bg-slate-800">
                        <td colSpan={5} className="border border-slate-700 px-3 py-2">
                          <span className="flex flex-wrap items-center gap-2 text-[12px] font-bold text-white">
                            <span className="inline-flex items-center gap-2">
                              <Landmark size={13} /> {labelOf(region)}
                              <span className="font-normal text-slate-400">
                                {region.code ? `(${region.code})` : ''}
                              </span>
                            </span>
                            <span className="font-normal text-slate-300">
                              {own.length} dermaga
                              {officers === null ? '' : ` · ${users.length} petugas di wilayah ini`}
                              {own.length === 0 ? ' · belum ada dermaga di wilayah ini' : ''}
                            </span>
                          </span>
                        </td>
                      </tr>

                      {own.length === 0 && (
                        <tr>
                          <td colSpan={5} className="border border-slate-200 px-3 py-3 pl-10 text-[12px] text-slate-400">
                            Belum ada dermaga di wilayah ini
                          </td>
                        </tr>
                      )}

                      {own.length > 0 && shown.length === 0 && (
                        <tr>
                          <td colSpan={5} className="border border-slate-200 px-3 py-3 pl-10 text-[12px] text-slate-400">
                            Tidak ada dermaga yang cocok dengan pencarian
                          </td>
                        </tr>
                      )}

                      {shown.map((d, dIdx) => dermagaRow(d, dIdx % 2 === 1))}
                    </Fragment>
                  )
                })}

              {state === 'ready' && orphans.length > 0 && (
                <Fragment>
                  <tr className="bg-amber-500">
                    <td colSpan={5} className="border border-amber-600 px-3 py-2">
                      <span className="inline-flex items-center gap-2 text-[12px] font-bold text-white">
                        <TriangleAlert size={13} /> Dermaga tanpa wilayah ({orphans.length}) — wilayahnya sudah tidak
                        ada di database
                      </span>
                    </td>
                  </tr>
                  {visibleOrphans.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border border-slate-200 px-3 py-3 pl-10 text-[12px] text-slate-400">
                        Tidak ada dermaga yatim yang cocok dengan pencarian
                      </td>
                    </tr>
                  ) : (
                    visibleOrphans.map((d, dIdx) => dermagaRow(d, dIdx % 2 === 1))
                  )}
                </Fragment>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
