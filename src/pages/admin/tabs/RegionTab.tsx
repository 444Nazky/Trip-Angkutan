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
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
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

  const handleCreateDermaga = async () => {
    const name = dermagaForm.name.trim()
    const code = dermagaForm.code.trim().toUpperCase()
    if (!dermagaForm.regionId) return showToast('Pilih wilayah untuk dermaga ini', 'error')
    if (!name) return showToast('Nama dermaga wajib diisi', 'error')
    if (!CODE_RE.test(code)) {
      return showToast('Kode dermaga 2–16 karakter tanpa spasi', 'error')
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
      return showToast(`Wilayah ini sudah punya dermaga berkode ${code}`, 'error')
    }

    setSaving(true)
    try {
      const id = await createDermaga({ region_id: dermagaForm.regionId, name, code })
      if (!id) return showToast('Server gagal menyimpan dermaga baru', 'error')
      const fresh = await load()
      if (!fresh) return showToast('Dermaga tersimpan, tetapi gagal memuat ulang dari server', 'error')
      setDermagaForm({ regionId: '', name: '', code: '' })
      showToast('Dermaga ditambahkan ke database')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDermaga = async (dermaga: Dermaga) => {
    const routeCount = routeCountOfDermaga(dermaga.id)
    const users = (officers ?? []).filter((o) => (o.dermagas ?? []).some((x) => String(x.id) === dermaga.id))

    const lines = [`Hapus dermaga ${labelOf(dermaga)} (${dermaga.code}) dari database?`, '']
    lines.push(
      routeCount === null
        ? '• Semua rute dermaga ini ikut terhapus, termasuk titik geofence-nya.'
        : `• ${routeCount} rute dermaga ini ikut terhapus, termasuk titik geofence-nya.`,
    )
    if (officers === null) {
      lines.push('• Akses petugas ke dermaga ini dihapus (jumlah petugas tidak bisa dipastikan).')
    } else if (users.length > 0) {
      lines.push(`• ${users.length} petugas kehilangan akses: ${users.map((o) => o.name).join(', ')}.`)
    }
    lines.push('• Riwayat trip lama tidak dihapus, tetapi tidak lagi terhubung ke dermaga ini.')
    if (!confirm(lines.join('\n'))) return

    setSaving(true)
    try {
      const ok = await deleteDermaga(dermaga.id)
      if (!ok) return showToast('Server gagal menghapus dermaga', 'error')
      const fresh = await load()
      if (!fresh) return showToast('Dermaga terhapus, tetapi gagal memuat ulang dari server', 'error')
      showToast('Dermaga dihapus dari database')
    } finally {
      setSaving(false)
    }
  }

  const dermagaRow = (d: Dermaga, indented: boolean, alt = false) => {
    const routeCount = routeCountOfDermaga(d.id)
    const users = (officers ?? []).filter((o) => (o.dermagas ?? []).some((x) => String(x.id) === d.id))
    return (
      <tr key={d.id} className={`admin-table-row ${alt ? 'bg-slate-50/40' : ''} hover:bg-slate-50/60 transition-colors duration-150`}>
        <td className={`border border-slate-200 px-3 py-2 text-slate-700 ${indented ? 'pl-10' : ''}`}>
          <span className="font-semibold">{labelOf(d)}</span>
        </td>
        <td className="border border-slate-200 px-3 py-2 font-mono text-slate-500 text-[12px]">{d.code || '—'}</td>
        <td className="border border-slate-200 px-3 py-2 text-[12px] text-slate-500">
          {routeCount === null ? 'rute: tidak termuat' : `${routeCount} rute`}
          {officers === null ? '' : ` · ${users.length} petugas`}
        </td>
        <td className="border border-slate-200 px-3 py-2 text-right whitespace-nowrap">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleDeleteDermaga(d)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-red-600 disabled:opacity-40"
          >
            <Trash2 size={12} /> Hapus Dermaga
          </button>
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Master Dermaga</h3>
          <p className="text-slate-500 text-[12px]">
            Tambah / hapus dermaga — wilayah tetap, setiap perubahan langsung ditulis ke database
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                state === 'ready'
                  ? 'bg-slate-900'
                  : state === 'offline'
                    ? 'bg-slate-400'
                    : 'bg-slate-300 animate-pulse'
              }`}
            />
            {state === 'ready'
              ? `${regions.length} wilayah · ${dermagas.length} dermaga`
              : state === 'offline'
                ? 'Server tidak merespons'
                : 'Memuat…'}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={state === 'loading' || saving}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            <RefreshCw size={12} /> Muat ulang
          </button>
        </div>
      </div>

      {officers === null && state === 'ready' && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] text-slate-600">
          Daftar petugas tidak bisa dimuat, jadi jumlah petugas pada konfirmasi hapus dermaga tidak bisa dipastikan.
          Tekan <span className="font-bold">Muat ulang</span> untuk mencoba lagi.
        </div>
      )}

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="font-bold mb-4">Tambah Dermaga</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Wilayah *</label>
            <select
              value={dermagaForm.regionId}
              onChange={(e) => setDermagaForm({ ...dermagaForm, regionId: e.target.value })}
              className="w-full border rounded-xl px-3 py-2 text-sm"
            >
              <option value="">— Pilih Wilayah —</option>
              {orderedRegions.map((r) => (
                <option key={r.id} value={r.id}>
                  {labelOf(r)} ({r.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Nama Dermaga *</label>
            <input
              value={dermagaForm.name}
              onChange={(e) => setDermagaForm({ ...dermagaForm, name: e.target.value })}
              placeholder="cth: Dermaga Badau"
              className="w-full border rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Kode Dermaga *</label>
            <input
              value={dermagaForm.code}
              onChange={(e) => setDermagaForm({ ...dermagaForm, code: e.target.value.toUpperCase() })}
              placeholder="cth: BDU"
              className="w-full border rounded-xl px-3 py-2 text-sm font-mono tracking-wide"
            />
          </div>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleCreateDermaga()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
        >
          <Plus size={16} /> Tambah Dermaga
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 border border-slate-200 text-left">Wilayah / Dermaga</th>
                <th className="px-3 py-2.5 border border-slate-200 text-left w-[140px]">Kode</th>
                <th className="px-3 py-2.5 border border-slate-200 text-left w-[220px]">Dipakai</th>
                <th className="px-3 py-2.5 border border-slate-200 text-right w-[170px]">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {state === 'offline' && (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-3 py-8 text-center text-[12px] text-slate-500">
                    Server tidak bisa dihubungi, jadi data wilayah & dermaga belum bisa ditampilkan. Tekan
                    <span className="font-bold"> Muat ulang</span> setelah server hidup.
                  </td>
                </tr>
              )}

              {state !== 'offline' && orderedRegions.length === 0 && orphans.length === 0 && (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-3 py-8 text-center text-[12px] text-slate-400">
                    {state === 'loading' ? 'Memuat data wilayah…' : 'Belum ada wilayah di database.'}
                  </td>
                </tr>
              )}

              {orderedRegions.map((region) => {
                const own = byRegion.get(String(region.id)) ?? []
                const users = officersOfRegion(String(region.id))
                return (
                  <Fragment key={region.id}>
                    <tr className="bg-slate-100">
                      <td className="border border-slate-200 px-3 py-2">
                        <span className="font-bold text-slate-800">{labelOf(region)}</span>{' '}
                        <span className="text-[11px] font-normal text-slate-400">wilayah</span>
                      </td>
                      <td className="border border-slate-200 px-3 py-2 font-mono text-[12px] uppercase text-slate-500">
                        {region.code || '—'}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-[12px] text-slate-500">
                        {own.length} dermaga{officers === null ? '' : ` · ${users.length} petugas`}
                      </td>
                    </tr>

                    {own.length === 0 && (
                      <tr key={`${region.id}-empty`}>
                        <td colSpan={4} className="border border-slate-200 px-3 py-3 pl-10 text-[12px] text-slate-400">
                          Belum ada dermaga di wilayah ini
                        </td>
                      </tr>
                    )}
                    {own.map((d, dIdx) => dermagaRow(d, true, dIdx % 2 === 1))}
                  </Fragment>
                )
              })}

              {orphans.length > 0 && (
                <Fragment>
                  <tr className="bg-slate-100">
                    <td colSpan={4} className="border border-slate-200 px-3 py-2">
                      <span className="inline-flex items-center gap-2 text-[12px] font-bold text-slate-700">
                        <TriangleAlert size={14} /> Dermaga tanpa wilayah ({orphans.length}) — wilayahnya sudah tidak ada
                        di database
                      </span>
                    </td>
                  </tr>
                  {orphans.map((d) => dermagaRow(d, true))}
                </Fragment>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
