/**
 * Tab "Master Tarif" di admin dashboard.
 *
 * Dua panel matriks yang diletakkan berdampingan (BADAU | REGION), mengikuti
 * tata letak tabel tarif wilayah:
 *
 *   BADAU   -> master tarif yang dipakai aplikasi untuk menghitung tagihan
 *              trip (tabel `tariffs`: muatan + kosong per golongan kendaraan)
 *   REGION  -> tarif fallback per wilayah (tabel `region_tariffs`: lokal +
 *              eksternal), dipakai backend saat master tarif belum lengkap
 *
 * SEMUA angka di halaman ini diambil dari server. Tidak ada nominal hardcoded
 * di sini: nilai yang tampil adalah nilai yang benar-benar dipakai resolver
 * tarif di backend (handlers/tariffRules.ts -> resolveTariff), yaitu:
 *
 *   1. Kategori Internal  -> Rp 0 (kendaraan internal tidak ditagih)
 *   2. Master tarif       -> loaded_tariff (muatan) / empty_tariff (kosong)
 *   3. Tarif wilayah      -> nominal flat (lokal / eksternal)
 *
 * Kolom "internal" sengaja dikunci Rp 0 dan tidak bisa diedit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Save, Search, Trash2, X } from 'lucide-react'
import type { TariffRow } from '../components/types'
import {
  createTariff,
  deleteTariff,
  fetchRegionTariffs,
  fetchTariffs,
  updateTariff,
  upsertRegionTariff,
  type RegionTariffRow,
} from '../../../services/tariffs'
import { fetchRegions, type Region } from '../../../services/regions'

interface TariffTabProps {
  tariffs: TariffRow[]
  serverState: 'connecting' | 'online' | 'offline'
  onSaveTariffs: (t: TariffRow[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

/** Draft nilai master tarif per baris (key = id baris tarif). */
interface MasterDraft {
  loadedNum: number
  emptyNum: number
}

/** Draft nilai tarif wilayah per region (key = id region). */
interface RegionDraft {
  lokal: number
  lokalAktif: number
  eksternal: number
  eksternalAktif: number
}

interface NewTariffForm {
  golongan: string
  type: string
  loadedNum: string
  emptyNum: string
  desc: string
}

const EMPTY_NEW_FORM: NewTariffForm = {
  golongan: '',
  type: '',
  loadedNum: '',
  emptyNum: '',
  desc: '',
}

/** Golongan master tarif yang dipakai sistem (I..V). */
const GOLONGAN_OPTIONS = ['I', 'II', 'III', 'IV', 'V']

/** Jenis kendaraan baku. Dipakai hanya sebagai pilihan cepat pada form. */
const JENIS_OPTIONS = ['Motor', 'Mobil', 'Truck Kecil', 'Truck Sedang', 'Truck Besar']

const fmtRp = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`

/** Kunci draft baris master. Baris tanpa id (offline) tetap bisa diedit lokal. */
const masterKey = (row: TariffRow, index: number) => row.id || `local-${index}`

/** Kolom tabel matriks, dipakai untuk header dan pemetaan isi. */
const MATRIX_COLUMNS = ['Jenis', 'internal', 'lokal', 'muatan', 'kosong']

/** Input angka dengan awalan "Rp". */
function RpInput({
  value,
  onChange,
  tone = 'default',
}: {
  value: number
  onChange: (v: number) => void
  tone?: 'default' | 'muted'
}) {
  return (
    <div
      className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors ${
        tone === 'muted'
          ? 'border-slate-200 bg-slate-50'
          : 'border-slate-200 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100'
      }`}
    >
      <span className="text-[11px] font-semibold text-slate-400">Rp</span>
      <input
        type="number"
        min={0}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full min-w-0 bg-transparent text-right text-[13px] font-semibold text-slate-800 outline-none"
      />
    </div>
  )
}

/** Input tarif wilayah dengan penanda aktif/nonaktif. */
function RegionInput({
  value,
  aktif,
  onChange,
  onToggle,
}: {
  value: number
  aktif: boolean
  onChange: (v: number) => void
  onToggle: (v: boolean) => void
}) {
  return (
    <div className="space-y-1">
      <RpInput value={value} onChange={onChange} tone={aktif ? 'default' : 'muted'} />
      <label className="flex items-center justify-end gap-1.5 text-[10px] font-semibold text-slate-500">
        <input
          type="checkbox"
          checked={aktif}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-3 w-3 rounded border-slate-300 accent-blue-600"
        />
        Aktif
      </label>
    </div>
  )
}

export function TariffTab({ tariffs, serverState, onSaveTariffs, showToast }: TariffTabProps) {
  const [regionTariffs, setRegionTariffs] = useState<RegionTariffRow[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [masterDrafts, setMasterDrafts] = useState<Record<string, MasterDraft>>({})
  const [regionDrafts, setRegionDrafts] = useState<Record<string, RegionDraft>>({})
  const [panelRegionId, setPanelRegionId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<NewTariffForm>(EMPTY_NEW_FORM)

  // Muat data pendukung (region + tarif wilayah) sekali saat tab dibuka.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [rts, regs] = await Promise.all([fetchRegionTariffs(), fetchRegions()])
      if (!alive) return
      if (rts) setRegionTariffs(rts)
      if (regs) setRegions(regs)
    })()
    return () => { alive = false }
  }, [])

  /** Region BADAU: panel kiri selalu menampilkan tarif wilayah Badau. */
  const badauRegion = useMemo(
    () => regions.find((r) => String(r.code ?? '').toUpperCase() === 'BADAU') ?? regions[0] ?? null,
    [regions],
  )

  /** Region yang dipilih untuk panel kanan (tarif wilayah lain). */
  const panelRegion = useMemo(
    () => regions.find((r) => r.id === panelRegionId) ?? null,
    [regions, panelRegionId],
  )

  // Default panel kanan: region pertama selain BADAU.
  useEffect(() => {
    if (panelRegionId || regions.length === 0) return
    const fallback = regions.find((r) => r.id !== badauRegion?.id) ?? regions[0]
    if (fallback) setPanelRegionId(fallback.id)
  }, [regions, panelRegionId, badauRegion])

  /** Ambil draft tarif wilayah; kalau belum diedit, pakai nilai dari server. */
  const regionDraft = useCallback(
    (regionId: string | undefined): RegionDraft => {
      if (!regionId) return { lokal: 0, lokalAktif: 1, eksternal: 0, eksternalAktif: 1 }
      const saved = regionDrafts[regionId]
      if (saved) return saved
      const src = regionTariffs.find((rt) => rt.id === regionId)
      return {
        lokal: src?.lokal_tariff ?? 0,
        lokalAktif: src?.lokal_active ?? 1,
        eksternal: src?.eksternal_tariff ?? 0,
        eksternalAktif: src?.eksternal_active ?? 1,
      }
    },
    [regionDrafts, regionTariffs],
  )

  /** Perbarui draft tarif wilayah satu region. */
  const patchRegionDraft = useCallback(
    (regionId: string | undefined, patch: Partial<RegionDraft>) => {
      if (!regionId) return
      setRegionDrafts((prev) => {
        const current = prev[regionId] ?? {
          lokal: 0,
          lokalAktif: 1,
          eksternal: 0,
          eksternalAktif: 1,
        }
        return { ...prev, [regionId]: { ...current, ...patch } }
      })
    },
    [],
  )

  /** Baris master tarif yang tampil (difilter pencarian). */
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = tariffs.map((row, i) => ({ row, key: masterKey(row, i), index: i }))
    if (!q) return rows
    return rows.filter(({ row }) =>
      [row.type, row.golongan, row.desc].some((v) => String(v ?? '').toLowerCase().includes(q)),
    )
  }, [tariffs, search])

  /** Draft master tarif per baris (default = nilai server). */
  const masterDraft = useCallback(
    (key: string, row: TariffRow): MasterDraft =>
      masterDrafts[key] ?? { loadedNum: row.loadedNum, emptyNum: row.emptyNum },
    [masterDrafts],
  )

  const masterDirty = Object.keys(masterDrafts).length > 0

  /** Apakah ada perubahan tarif wilayah pada satu region. */
  const regionDirty = (regionId: string | undefined) => {    if (!regionId) return false
    const src = regionTariffs.find((rt) => rt.id === regionId)
    if (!src) return false
    const draft = regionDraft(regionId)
    return (
      draft.lokal !== (src.lokal_tariff ?? 0) ||
      draft.lokalAktif !== (src.lokal_active ?? 1) ||
      draft.eksternal !== (src.eksternal_tariff ?? 0) ||
      draft.eksternalAktif !== (src.eksternal_active ?? 1)
    )
  }

  // ── Aksi: simpan master tarif ──────────────────────────────────────────────

  const handleSaveMaster = async () => {
    if (!masterDirty) return
    setSaving(true)
    try {
      let failed = false
      for (const [key, draft] of Object.entries(masterDrafts)) {
        const entry = visibleRows.find((r) => r.key === key)
        const row = entry?.row ?? tariffs.find((t, i) => masterKey(t, i) === key)
        if (!row?.id) {
          failed = true
          continue
        }
        const ok = await updateTariff({
          ...row,
          loaded: fmtRp(draft.loadedNum),
          loadedNum: draft.loadedNum,
          empty: fmtRp(draft.emptyNum),
          emptyNum: draft.emptyNum,
        })
        if (!ok) failed = true
      }
      const fresh = await fetchTariffs()
      if (fresh) onSaveTariffs(fresh)
      setMasterDrafts({})
      showToast(
        failed ? 'Sebagian tarif gagal disimpan — periksa koneksi server' : 'Master tarif tersimpan',
        failed ? 'error' : 'success',
      )
    } finally {
      setSaving(false)
    }
  }

  // ── Aksi: simpan tarif wilayah ─────────────────────────────────────────────

  const handleSaveRegion = async (regionId: string | undefined) => {
    if (!regionId) return showToast('Region belum tersedia', 'error')
    setSaving(true)
    try {
      const draft = regionDraft(regionId)
      const [lokal, eksternal] = await Promise.all([
        upsertRegionTariff({
          regionId,
          tariffType: 'lokal',
          nominal: draft.lokal,
          aktif: !!draft.lokalAktif,
        }),
        upsertRegionTariff({
          regionId,
          tariffType: 'eksternal',
          nominal: draft.eksternal,
          aktif: !!draft.eksternalAktif,
        }),
      ])
      if (!lokal || !eksternal) return showToast('Server menolak tarif wilayah', 'error')
      const fresh = await fetchRegionTariffs()
      if (fresh) setRegionTariffs(fresh)
      setRegionDrafts((prev) => {
        const next = { ...prev }
        delete next[regionId]
        return next
      })
      showToast('Tarif wilayah tersimpan')
    } finally {
      setSaving(false)
    }
  }

  // ── Aksi: tambah master tarif ──────────────────────────────────────────────

  const handleAddTariff = async () => {
    const golongan = form.golongan.trim().toUpperCase()
    const type = form.type.trim()
    const loadedNum = Number(form.loadedNum)
    const emptyNum = Number(form.emptyNum)
    if (!golongan || !type) return showToast('Golongan dan jenis kendaraan wajib diisi', 'error')
    if (!Number.isFinite(loadedNum) || loadedNum <= 0) {
      return showToast('Nominal muatan harus lebih dari 0', 'error')
    }
    if (!Number.isFinite(emptyNum) || emptyNum < 0) {
      return showToast('Nominal kosong tidak boleh negatif', 'error')
    }
    setSaving(true)
    try {
      const id = await createTariff({
        golongan,
        type,
        loaded: fmtRp(loadedNum),
        loadedNum,
        empty: fmtRp(emptyNum),
        emptyNum,
        desc: form.desc.trim(),
      })
      if (!id) return showToast('Server menolak tarif — data tidak disimpan', 'error')
      const fresh = await fetchTariffs()
      if (fresh) onSaveTariffs(fresh)
      setForm(EMPTY_NEW_FORM)
      setShowForm(false)
      showToast('Golongan tarif ditambahkan')
    } finally {
      setSaving(false)
    }
  }

  // ── Aksi: hapus master tarif ───────────────────────────────────────────────

  const handleDeleteTariff = async (row: TariffRow) => {
    if (!row.id) return showToast('Baris ini belum tersimpan di server', 'error')
    if (!confirm(`Hapus tarif ${row.golongan} - ${row.type}?`)) return
    setSaving(true)
    try {
      const ok = await deleteTariff(row)
      if (!ok) return showToast('Server gagal menghapus tarif', 'error')
      const fresh = await fetchTariffs()
      if (fresh) onSaveTariffs(fresh)
      showToast('Tarif dihapus')
    } finally {
      setSaving(false)
    }
  }

  /** Sel "jenis" + badge golongan, dipakai di kedua panel. */
  const renderVehicleCell = (row: TariffRow) => (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-slate-800 px-1.5 text-[11px] font-black text-white">
        {row.golongan || '-'}
      </span>
      <span className="font-semibold text-slate-800 whitespace-nowrap">{row.type}</span>
    </div>
  )

  /** Sel "internal": dikunci Rp 0 sesuai aturan resolver tarif backend. */
  const renderInternalCell = () => (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-500">
      Rp 0
      <span className="text-[9px] font-semibold uppercase tracking-wide">dikunci</span>
    </span>
  )

  return (
    <div className="space-y-5">
      {/* Header halaman */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Master Tarif</h3>
          <p className="text-slate-500 text-[12px] mt-0.5 max-w-2xl">
            Tarif dasar perjalanan yang dipakai aplikasi saat menghitung tagihan trip.
            Seluruh nilai di halaman ini diambil langsung dari server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
              serverState === 'online'
                ? 'bg-emerald-50 text-emerald-600'
                : serverState === 'offline'
                ? 'bg-red-50 text-red-600'
                : 'bg-amber-50 text-amber-600'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                serverState === 'online'
                  ? 'bg-emerald-500'
                  : serverState === 'offline'
                  ? 'bg-red-500'
                  : 'bg-amber-500'
              }`}
            />
            Server:{' '}
            {serverState === 'online'
              ? 'Tersambung'
              : serverState === 'offline'
              ? 'Offline'
              : 'Menghubungkan'}
          </span>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700"
          >
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? 'Batal' : 'Tambah Golongan'}
          </button>
        </div>
      </div>

      {/* Form tambah master tarif */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <p className="font-bold text-slate-800 mb-4">Tambah Golongan Tarif</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <label className="block">
              <span className="text-[11px] font-bold uppercase text-slate-500">Golongan</span>
              <input
                list="golongan-options"
                value={form.golongan}
                onChange={(e) => setForm((f) => ({ ...f, golongan: e.target.value }))}
                placeholder="I"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm uppercase"
              />
              <datalist id="golongan-options">
                {GOLONGAN_OPTIONS.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase text-slate-500">Jenis Kendaraan</span>
              <input
                list="jenis-options"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                placeholder="Motor"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
              <datalist id="jenis-options">
                {JENIS_OPTIONS.map((j) => (
                  <option key={j} value={j} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase text-slate-500">Tarif Muatan (Rp)</span>
              <input
                type="number"
                min={0}
                value={form.loadedNum}
                onChange={(e) => setForm((f) => ({ ...f, loadedNum: e.target.value }))}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase text-slate-500">Tarif Kosong (Rp)</span>
              <input
                type="number"
                min={0}
                value={form.emptyNum}
                onChange={(e) => setForm((f) => ({ ...f, emptyNum: e.target.value }))}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase text-slate-500">Keterangan</span>
              <input
                value={form.desc}
                onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
                placeholder="Opsional"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => {
                setForm(EMPTY_NEW_FORM)
                setShowForm(false)
              }}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Batal
            </button>
            <button
              onClick={() => void handleAddTariff()}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              Simpan Golongan
            </button>
          </div>
        </div>
      )}

      {/* Tabel matriks tarif */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div>
            <p className="font-bold text-slate-800">Tabel Tarif Wilayah</p>
            <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl">
              Kolom <b>muatan</b> dan <b>kosong</b> pada panel BADAU adalah master tarif yang
              dipakai aplikasi. Kolom <b>lokal</b> dan <b>eksternal</b> pada panel REGION berlaku
              flat untuk semua golongan kendaraan.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari golongan atau jenis kendaraan"
                className="w-64 border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-[13px]"
              />
            </div>
            {masterDirty && (
              <button
                onClick={() => void handleSaveMaster()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-60"
              >
                <Save size={14} /> Simpan Master
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm min-w-[1180px]">
            <thead>
              <tr>
                <th colSpan={5} className="bg-slate-900 text-white border-b border-slate-800 text-left">
                  <div className="px-4 py-2.5">
                    <p className="text-[13px] font-black uppercase tracking-wider">BADAU</p>
                    <p className="text-[10px] font-medium opacity-70">Master tarif wilayah Badau</p>
                  </div>
                </th>
                <th colSpan={5} className="bg-blue-900 text-white border-b border-blue-800">
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div>
                      <p className="text-[13px] font-black uppercase tracking-wider">Region</p>
                      <p className="text-[10px] font-medium opacity-70">Tarif fallback per wilayah</p>
                    </div>
                    <select
                      value={panelRegionId}
                      onChange={(e) => setPanelRegionId(e.target.value)}
                      className="rounded-lg border border-blue-700 bg-blue-800 px-2 py-1 text-[12px] font-semibold text-white outline-none"
                    >
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code} - {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="bg-slate-50 border-b border-slate-200" />
              </tr>
              <tr>
                <th
                  colSpan={5}
                  className="bg-slate-100 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200"
                >
                  Golongan
                </th>
                <th
                  colSpan={5}
                  className="bg-slate-100 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200"
                >
                  Golongan
                </th>
                <th className="bg-slate-50 border-b border-slate-200" />
              </tr>
              <tr className="bg-slate-50">
                {MATRIX_COLUMNS.map((h) => (
                  <th
                    key={h}
                    className="text-left text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200 px-3 py-2 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
                {MATRIX_COLUMNS.map((h) => (
                  <th
                    key={`reg-${h}`}
                    className="text-left text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200 px-3 py-2 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
                <th className="bg-slate-50 border-b border-slate-200" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-400 text-[13px]">
                    {tariffs.length === 0
                      ? 'Belum ada master tarif di server.'
                      : 'Tidak ada baris yang cocok dengan pencarian.'}
                  </td>
                </tr>
              )}
              {visibleRows.map(({ row, key }) => {
                const draft = masterDraft(key, row)
                const badau = regionDraft(badauRegion?.id)
                const region = regionDraft(panelRegion?.id)
                return (
                  <tr key={key} className="hover:bg-slate-50/70">
                    {/* Panel BADAU */}
                    <td className="px-3 py-2.5 border-b border-slate-200 align-top">
                      {renderVehicleCell(row)}
                    </td>
                    <td className="bg-slate-100 px-3 py-2.5 border-b border-slate-200 align-top">
                      {renderInternalCell()}
                    </td>
                    <td className="px-3 py-2.5 border-b border-slate-200 align-top">
                      <RegionInput
                        value={badau.lokal}
                        aktif={!!badau.lokalAktif}
                        onChange={(v) => patchRegionDraft(badauRegion?.id, { lokal: v })}
                        onToggle={(v) => patchRegionDraft(badauRegion?.id, { lokalAktif: v ? 1 : 0 })}
                      />
                    </td>
                    <td className="px-3 py-2.5 border-b border-slate-200 align-top">
                      <RpInput
                        value={draft.loadedNum}
                        onChange={(v) =>
                          setMasterDrafts((prev) => ({
                            ...prev,
                            [key]: { ...draft, loadedNum: v },
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5 border-b border-slate-200 align-top">
                      <RpInput
                        value={draft.emptyNum}
                        onChange={(v) =>
                          setMasterDrafts((prev) => ({
                            ...prev,
                            [key]: { ...draft, emptyNum: v },
                          }))
                        }
                      />
                    </td>

                    {/* Panel REGION */}
                    <td className="px-3 py-2.5 border-b border-slate-200 align-top">
                      {renderVehicleCell(row)}
                    </td>
                    <td className="bg-slate-100 px-3 py-2.5 border-b border-slate-200 align-top">
                      {renderInternalCell()}
                    </td>
                    <td className="px-3 py-2.5 border-b border-slate-200 align-top">
                      <RegionInput
                        value={region.lokal}
                        aktif={!!region.lokalAktif}
                        onChange={(v) => patchRegionDraft(panelRegion?.id, { lokal: v })}
                        onToggle={(v) => patchRegionDraft(panelRegion?.id, { lokalAktif: v ? 1 : 0 })}
                      />
                    </td>
                    <td className="px-3 py-2.5 border-b border-slate-200 align-top">
                      <RegionInput
                        value={region.eksternal}
                        aktif={!!region.eksternalAktif}
                        onChange={(v) => patchRegionDraft(panelRegion?.id, { eksternal: v })}
                        onToggle={(v) =>
                          patchRegionDraft(panelRegion?.id, { eksternalAktif: v ? 1 : 0 })
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5 border-b border-slate-200 align-top">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                          <span className="text-[11px] font-semibold text-slate-400">Rp</span>
                          <span className="w-full text-right text-[13px] font-semibold text-slate-500">
                            {Number(region.eksternal || 0).toLocaleString('id-ID')}
                          </span>
                        </div>
                        <p className="text-right text-[10px] font-medium text-slate-400">
                          tarif wilayah flat
                        </p>
                      </div>
                    </td>

                    {/* Aksi hapus baris master */}
                    <td className="px-2 py-2.5 border-b border-slate-200 align-top text-right">
                      <button
                        onClick={() => void handleDeleteTariff(row)}
                        title="Hapus tarif ini"
                        className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Panel kendali + catatan */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <div className="text-[11px] text-slate-500 space-y-1">
            <p>
              <b className="text-slate-700">internal</b> = Rp 0 (kendaraan internal tidak ditagih).
            </p>
            <p>
              <b className="text-slate-700">muatan</b> dan <b className="text-slate-700">kosong</b>{' '}
              pada panel BADAU adalah master tarif yang dipakai aplikasi saat menghitung tagihan.
            </p>
            <p>
              <b className="text-slate-700">kosong</b> pada panel REGION mengikuti tarif eksternal
              karena tarif wilayah bersifat flat.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {regionDirty(badauRegion?.id) && (
              <button
                onClick={() => void handleSaveRegion(badauRegion?.id)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-60"
              >
                <Save size={14} /> Simpan Tarif Badau
              </button>
            )}
            {regionDirty(panelRegion?.id) && (
              <button
                onClick={() => void handleSaveRegion(panelRegion?.id)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-60"
              >
                <Save size={14} /> Simpan Tarif Region
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
