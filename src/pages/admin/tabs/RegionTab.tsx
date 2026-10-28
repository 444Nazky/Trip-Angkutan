/**
 * Tab "Master Region" — kelola wilayah (region) dan dermaga.
 *
 * Prinsip tab ini: DASHBOARD HARUS SAMA DENGAN DATABASE.
 *
 *   - Tidak ada data contoh/kosong: baris hanya muncul kalau benar-benar ada
 *     di server (`GET /regions`, `GET /dermagas`). Bila server tidak bisa
 *     dihubungi, tabel menampilkan pesan, bukan baris palsu.
 *   - Setiap tambah/hapus menulis ke server lebih dulu, lalu data dimuat ULANG
 *     dari server (`load()`). State lokal tidak pernah diubah sendiri, jadi
 *     yang tampil selalu apa yang tersimpan di database.
 *   - Wilayah yang masih dipakai (punya dermaga atau petugas) TIDAK dihapus
 *     dari dashboard. Di database, hapus wilayah membuat `dermagas.region_id`
 *     jadi NULL (ON DELETE SET NULL) sehingga dermaga menjadi yatim.
 */

import {
  BADGE,
  BADGE_MUTED,
  BADGE_OK,
  BADGE_WARN,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD,
  DOT_MUTED,
  DOT_OK,
  DOT_WARN,
  groupTint,
  INPUT,
  LABEL,
  PAGE,
  SECTION_TITLE,
  TABLE_CELL,
  TABLE_HEAD_CELL,
  TABLE_HEAD_ROW,
  TABLE_ROW_ALT,
  TABLE_WRAP,
} from '../theme'
import { PageHeader } from '../components/PageHeader'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import {
  fetchAdminRegions,
  createAdminRegion,
  deleteAdminRegion,
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

/** Wilayah master (tarif induk) — sama dengan aturan di tab Master Tarif. */
const MASTER_REGION_CODE = 'BADAU'

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
  const [regionForm, setRegionForm] = useState({ name: '', code: '' })
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

  const dermagasOfRegion = useCallback(
    (regionId: string) => dermagas.filter((d) => String(d.region_id ?? '') === regionId),
    [dermagas],
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
          Number(String(b.code ?? '').toUpperCase() === MASTER_REGION_CODE) -
            Number(String(a.code ?? '').toUpperCase() === MASTER_REGION_CODE) ||
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

  const handleCreateRegion = async () => {
    const name = regionForm.name.trim()
    const code = regionForm.code.trim().toUpperCase()
    if (!name) return showToast('Nama wilayah wajib diisi', 'error')
    if (!CODE_RE.test(code)) {
      return showToast('Kode wilayah 2–16 karakter tanpa spasi', 'error')
    }
    if (regions.some((r) => String(r.code ?? '').toUpperCase() === code)) {
      return showToast(`Kode wilayah ${code} sudah dipakai`, 'error')
    }

    setSaving(true)
    try {
      const id = await createAdminRegion({ name, code })
      if (!id) return showToast('Server gagal menyimpan wilayah baru', 'error')
      const fresh = await load()
      if (!fresh) return showToast('Wilayah tersimpan, tetapi gagal memuat ulang dari server', 'error')
      setRegionForm({ name: '', code: '' })
      showToast('Wilayah ditambahkan ke database')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRegion = async (region: AdminRegionRow) => {
    if (String(region.code ?? '').toUpperCase() === MASTER_REGION_CODE) {
      return showToast(`Wilayah ${MASTER_REGION_CODE} tidak bisa dihapus`, 'error')
    }
    const own = dermagasOfRegion(String(region.id))
    if (own.length > 0) {
      return showToast(
        `Wilayah ${labelOf(region)} masih punya ${own.length} dermaga (${own
          .map(labelOf)
          .join(', ')}). Hapus dermaganya dulu.`,
        'error',
      )
    }
    if (officers === null) {
      return showToast('Daftar petugas belum termuat — muat ulang sebelum menghapus wilayah', 'error')
    }
    const users = officersOfRegion(String(region.id))
    if (users.length > 0) {
      return showToast(
        `Wilayah ${labelOf(region)} masih dipakai ${users.length} petugas (${users
          .map((o) => o.name)
          .join(', ')}). Pindahkan petugasnya dulu.`,
        'error',
      )
    }
    if (!confirm(`Hapus wilayah ${labelOf(region)} dari database?`)) return

    setSaving(true)
    try {
      const ok = await deleteAdminRegion(String(region.id))
      if (!ok) return showToast('Server gagal menghapus wilayah', 'error')
      const fresh = await load()
      if (!fresh) return showToast('Wilayah terhapus, tetapi gagal memuat ulang dari server', 'error')
      showToast('Wilayah dihapus dari database')
    } finally {
      setSaving(false)
    }
  }

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
      <tr key={d.id} className={`admin-table-row ${alt ? TABLE_ROW_ALT : ''} hover:bg-slate-50/60`}>
        <td className={`${TABLE_CELL} text-slate-700 ${indented ? 'pl-10' : ''}`}>
          <span className="font-semibold">{labelOf(d)}</span>
        </td>
        <td className={`${TABLE_CELL} font-mono text-[12px] text-slate-500`}>{d.code || '—'}</td>
        <td className={`${TABLE_CELL} text-[12px] text-slate-500`}>
          {routeCount === null ? 'rute: tidak termuat' : `${routeCount} rute`}
          {officers === null ? '' : ` · ${users.length} petugas`}
        </td>
        <td className={`${TABLE_CELL} text-right whitespace-nowrap`}>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleDeleteDermaga(d)}
            className="inline-flex items-center gap-1 text-red-500 font-semibold text-xs hover:underline disabled:opacity-40"
          >
            <Trash2 size={12} /> Hapus Dermaga
          </button>
        </td>
      </tr>
    )
  }

  return (
    <div className={PAGE}>
      <PageHeader
        title="Master Region"
        subtitle="Tambah / hapus wilayah dan dermaga — setiap perubahan langsung ditulis ke database"
        actions={
          <>
            <span
              className={`${BADGE} ${
                state === 'ready'
                  ? BADGE_OK
                  : state === 'offline'
                    ? BADGE_WARN
                    : BADGE_MUTED
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  state === 'ready' ? DOT_OK : state === 'offline' ? DOT_WARN : DOT_MUTED
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
              className={`${BTN_SECONDARY} px-3 py-1.5`}
            >
              <RefreshCw size={12} /> Muat ulang
            </button>
          </>
        }
      />

      {officers === null && state === 'ready' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          Daftar petugas tidak bisa dimuat, jadi penghapusan wilayah dimatikan sementara supaya tidak ada wilayah
          terhapus yang masih dipakai petugas. Tekan <span className="font-bold">Muat ulang</span> untuk mencoba lagi.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${CARD} p-6`}>
          <h3 className={`${SECTION_TITLE} mb-4`}>Tambah Region</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className={`${LABEL} mb-1 block`}>Nama Wilayah *</label>
              <input
                value={regionForm.name}
                onChange={(e) => setRegionForm({ ...regionForm, name: e.target.value })}
                placeholder="cth: Wilayah Cirebon"
                className={INPUT}
              />
            </div>
            <div>
              <label className={`${LABEL} mb-1 block`}>Kode Wilayah *</label>
              <input
                value={regionForm.code}
                onChange={(e) => setRegionForm({ ...regionForm, code: e.target.value.toUpperCase() })}
                placeholder="cth: CRB"
                className={`${INPUT} font-mono tracking-wide`}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleCreateRegion()}
            className={`${BTN_PRIMARY} w-full py-3`}
          >
            <Plus size={16} /> Tambah Region
          </button>
        </div>

        <div className={`${CARD} p-6`}>
          <h3 className={`${SECTION_TITLE} mb-4`}>Tambah Dermaga</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className={`${LABEL} mb-1 block`}>Wilayah *</label>
              <select
                value={dermagaForm.regionId}
                onChange={(e) => setDermagaForm({ ...dermagaForm, regionId: e.target.value })}
                className={INPUT}
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
              <label className={`${LABEL} mb-1 block`}>Nama Dermaga *</label>
              <input
                value={dermagaForm.name}
                onChange={(e) => setDermagaForm({ ...dermagaForm, name: e.target.value })}
                placeholder="cth: Dermaga Badau"
                className={INPUT}
              />
            </div>
            <div>
              <label className={`${LABEL} mb-1 block`}>Kode Dermaga *</label>
              <input
                value={dermagaForm.code}
                onChange={(e) => setDermagaForm({ ...dermagaForm, code: e.target.value.toUpperCase() })}
                placeholder="cth: BDU"
                className={`${INPUT} font-mono tracking-wide`}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleCreateDermaga()}
            className={`${BTN_PRIMARY} w-full py-3`}
          >
            <Plus size={16} /> Tambah Dermaga
          </button>
        </div>
      </div>

      <div className={TABLE_WRAP}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <thead className={TABLE_HEAD_ROW}>
              <tr>
                <th className={`${TABLE_HEAD_CELL} text-left`}>Wilayah / Dermaga</th>
                <th className={`${TABLE_HEAD_CELL} text-left w-[140px]`}>Kode</th>
                <th className={`${TABLE_HEAD_CELL} text-left w-[220px]`}>Dipakai</th>
                <th className={`${TABLE_HEAD_CELL} text-right w-[170px]`}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {state === 'offline' && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-[12px] text-amber-700">
                    Server tidak bisa dihubungi, jadi data wilayah & dermaga belum bisa ditampilkan. Tekan
                    <span className="font-bold"> Muat ulang</span> setelah server hidup.
                  </td>
                </tr>
              )}

              {state !== 'offline' && orderedRegions.length === 0 && orphans.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-[12px] text-slate-400">
                    {state === 'loading' ? 'Memuat data wilayah…' : 'Belum ada wilayah di database.'}
                  </td>
                </tr>
              )}

              {orderedRegions.map((region, regionIdx) => {
                const own = byRegion.get(String(region.id)) ?? []
                const users = officersOfRegion(String(region.id))
                // Tiap wilayah memakai warna pengelompok sendiri supaya blok
                // wilayah + dermaganya jelas terpisah.
                const tint = groupTint(regionIdx)
                return (
                  <Fragment key={region.id}>
                    <tr className={tint.row}>
                      <td className={`${TABLE_CELL} ${tint.edge} pl-5`}>
                        <span className={`font-bold ${tint.text}`}>{labelOf(region)}</span>{' '}
                        <span className="text-[11px] font-normal text-slate-500">wilayah</span>
                      </td>
                      <td className={`${TABLE_CELL} font-mono text-[12px] uppercase text-slate-600`}>
                        {region.code || '—'}
                      </td>
                      <td className={`${TABLE_CELL} text-[12px] text-slate-500`}>
                        {own.length} dermaga{officers === null ? '' : ` · ${users.length} petugas`}
                      </td>
                      <td className={`${TABLE_CELL} text-right whitespace-nowrap`}>
                        <button
                          type="button"
                          disabled={saving || officers === null}
                          onClick={() => void handleDeleteRegion(region)}
                          title={officers === null ? 'Daftar petugas belum termuat' : undefined}
                          className="inline-flex items-center gap-1 text-red-500 font-semibold text-xs hover:underline disabled:opacity-40"
                        >
                          <Trash2 size={12} /> Hapus Wilayah
                        </button>
                      </td>
                    </tr>

                    {own.length === 0 && (
                      <tr key={`${region.id}-empty`}>
                        <td colSpan={4} className={`${TABLE_CELL} pl-10 text-[12px] text-slate-400`}>
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
                  <tr className="bg-amber-50">
                    <td colSpan={4} className={TABLE_CELL}>
                      <span className="inline-flex items-center gap-2 text-[12px] font-bold text-amber-800">
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
