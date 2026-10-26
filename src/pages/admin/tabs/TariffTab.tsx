/**
 * Tab "Master Tarif" di admin dashboard — dua tabel gaya spreadsheet
 * (BADAU | REGION) mengikuti tabel tarif wilayah di cerdas sheet:
 *
 *   BADAU  -> master tarif yang dipakai aplikasi menghitung tagihan trip
 *             (tabel `tariffs`: muatan + kosong per golongan kendaraan)
 *   REGION -> tarif lokal per wilayah (tabel `region_tariffs`, nominal flat)
 *
 * SEMUA angka dihalaman ini diambil dari server (tarif trip yang asli),
 * tidak ada nominal hardcoded: nilai yang tampil adalah nilai yang dipakai
 * resolver tarif di backend (handlers/tariffRules.ts -> resolveTariff):
 *
 *   1. Kategori Internal -> Rp 0 (kolom "internal" terkunci di semua panel)
 *   2. Master tarif      -> kolom "external": muatan / kosong per golongan
 *   3. Tarif region      -> kolom "lokal" (nominal flat per wilayah)
 *
 * Cara edit seperti spreadsheet: klik angka di sel -> ubah -> Enter/blur,
 * tanpa tombol simpan: tiap sel autosave ke server saat commit.
 * Konfigurasi tarif terpusat (tarif flat eksternal + toggle aktif) sudah
 * dihapus dari halaman ini sesuai arahan owner.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type { TariffRow } from '../components/types'
import {
  createTariff,
  deleteTariff,
  fetchRegionTariffs,
  fetchTariffs,
  updateTariff,
  upsertRegionTariff,
} from '../../../services/tariffs'
import { fetchRegions, type Region } from '../../../services/regions'

interface TariffTabProps {
  tariffs: TariffRow[]
  serverState: 'connecting' | 'online' | 'offline'
  onSaveTariffs: (t: TariffRow[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

/** Draft baris baru: nominal lokal wilayah per region id (key = region id). */
interface LokalTarif {
  lokal: number
  aktif: boolean
}

interface AddRowForm {
  golongan: string
  type: string
  muatan: string
  kosong: string
}

const GOLONGAN_OPTIONS = ['I', 'II', 'III', 'IV', 'V']

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

const fmtRp = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`
const fmtNum = (n: number) => Number(n || 0).toLocaleString('id-ID')

const BORDER = 'border border-slate-300'

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

/** Sel placeholder teks (panel REGION: "tarif muatan" / "tarif kosong"). */
function PlaceholderCell({ label, hint }: { label: string; hint?: string }) {
  return (
    <td
      title={hint}
      className="border border-slate-300 px-2 py-1 text-center text-[11px] text-slate-400 select-none cursor-default"
    >
      <span className="italic">{label}</span>
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
  title: string
  titleExtra?: ReactNode
  rows: TariffRow[]
  /** Panel REGION: kolom external menampilkan placeholder, bukan angka. */
  placeholdersExternal?: boolean
  getLokal: () => number
  commitLokal: (v: number) => Promise<boolean>
  commitMuatan: (row: TariffRow, v: number) => Promise<boolean>
  commitKosong: (row: TariffRow, v: number) => Promise<boolean>
  onDelete: (row: TariffRow) => void
  footer?: ReactNode
}

function GolonganSheet({
  title,
  titleExtra,
  rows,
  placeholdersExternal,
  getLokal,
  commitLokal,
  commitMuatan,
  commitKosong,
  onDelete,
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
                <span className="text-[15px] font-bold tracking-[0.08em] text-slate-800">{title}</span>
                {titleExtra}
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
          {rows.map((row, i) => (
            <tr
              key={row.id ?? `local-${i}`}
              className="group"
            >
              <td className="border border-slate-300 px-2 py-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-slate-800 whitespace-nowrap">{row.type || '—'}</span>
                  <button
                    onClick={() => onDelete(row)}
                    title="Hapus baris ini"
                    className="rounded p-0.5 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </td>
              <LockedInternalCell />
              <SheetCell value={getLokal()} onCommit={commitLokal} title="Tarif lokal wilayah ini" />
              {placeholdersExternal ? (
                <>
                  <PlaceholderCell
                    label="tarif muatan"
                    hint="Mengacu kolom muatan pada tabel BADAU (tarif trip asli)"
                  />
                  <PlaceholderCell
                    label="tarif kosong"
                    hint="Mengacu kolom kosong pada tabel BADAU (tarif trip asli)"
                  />
                </>
              ) : (
                <>
                  <SheetCell
                    value={row.loadedNum}
                    onCommit={(v) => commitMuatan(row, v)}
                    title="Tarif trip asli: kendaraan bermuatan"
                  />
                  <SheetCell
                    value={row.emptyNum}
                    onCommit={(v) => commitKosong(row, v)}
                    title="Tarif trip asli: kendaraan kosong"
                  />
                </>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
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
  const [regions, setRegions] = useState<Region[]>([])
  const [lokalNotus, setLokalTarif] = useState<Record<string, LokalTarif>>({})
  const [panelRegionId, setPanelRegionId] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState<AddRowForm>({ golongan: '', type: '', muatan: '', kosong: '' })
  const [saving, setSaving] = useState(false)

  /** Terjemah baris `RegionTariffRow[]` server -> peta per region id. */
  const ingestRegionTariffs = useCallback((rows: Awaited<ReturnType<typeof fetchRegionTariffs>>) => {
    if (!rows) return
    const map: Record<string, LokalTarif> = {}
    for (const rt of rows) {
      map[rt.id] = { lokal: rt.lokal_tariff ?? 0, aktif: (rt.lokal_active ?? 0) === 1 }
    }
    setLokalTarif(map)
  }, [])

  // Muat region + tarif wilayah lokal sekali saat tab dibuka.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [rts, regs] = await Promise.all([fetchRegionTariffs(), fetchRegions()])
      if (!alive) return
      if (regs) setRegions(regs)
      if (rts) ingestRegionTariffs(rts)
    })()
    return () => {
      alive = false
    }
  }, [ingestRegionTariffs])

  /** Region tabel kiri (BADAU): tarif wilayah Badau. */
  const badauRegion = useMemo(
    () => regions.find((r) => String(r.code ?? '').toUpperCase() === 'BADAU') ?? regions[0] ?? null,
    [regions],
  )

  /** Region tabel kanan: default = region pertama selain BADAU. */
  const panelRegion = useMemo(
    () =>
      regions.find((r) => r.id === panelRegionId) ??
      regions.find((r) => r.id !== badauRegion?.id) ??
      regions[0] ??
      null,
    [regions, panelRegionId, badauRegion],
  )

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

  // ── Aksi commit: autosave per sel ────────────────────────────────────────

  /** Simpan nominal lokal (tarif wilayah) untuk satu region. */
  const commitLokalFor = async (region: Region | null, v: number): Promise<boolean> => {
    if (!region) {
      showToast('Region belum tersedia', 'error')
      return false
    }
    setSaving(true)
    try {
      const src = lokalNotus[region.id]
      const ok = await upsertRegionTariff({
        regionId: region.id,
        tariffType: 'lokal',
        nominal: v,
        // Baris baru langsung aktif; baris lama mempertahankan statusnya.
        aktif: src ? src.aktif || v > 0 : true,
      })
      if (!ok) {
        showToast('Server menolak tarif wilayah', 'error')
        return false
      }
      ingestRegionTariffs(await fetchRegionTariffs())
      return true
    } finally {
      setSaving(false)
    }
  }

  /** Muat ulang daftar master tarif dari server setelah committed. */
  const refreshMasterRows = async () => {
    const fresh = await fetchTariffs()
    if (fresh) onSaveTariffs(fresh)
    else showToast('Gagal memuat ulang master tarif', 'error')
  }

  /** Simpan master tarif (muatan / kosong) satu baris golongan. */
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
      return true
    } finally {
      setSaving(false)
    }
  }

  const commitMuatan = (row: TariffRow, v: number) => commitMasterField(row, 'loadedNum', v)
  const commitKosong = (row: TariffRow, v: number) => commitMasterField(row, 'emptyNum', v)

  const handleDelete = async (row: TariffRow) => {
    if (!row.id) return showToast('Baris belum tersimpan di server', 'error')
    if (!confirm(`Hapus baris golongan ${row.golongan || '-'} (${row.type})?`)) return
    setSaving(true)
    try {
      const ok = await deleteTariff(row)
      if (!ok) return showToast('Server gagal menghapus tarif', 'error')
      await refreshMasterRows()
      showToast('Baris tarif dihapus')
    } finally {
      setSaving(false)
    }
  }

  /** Golongan default baris baru: yang belum terpakai di master. */
  const nextGolongan = () => {
    const used = new Set(tariffs.map((t) => String(t.golongan ?? '').toUpperCase()))
    return GOLONGAN_OPTIONS.find((g) => !used.has(g)) ?? 'I'
  }

  const submitAdd = async () => {
    const type = addForm.type.trim()
    const golongan = addForm.golongan.trim().toUpperCase() || nextGolongan()
    const muatan = Number(addForm.muatan.replace(/[^\d]/g, '')) || 0
    const kosong = Number(addForm.kosong.replace(/[^\d]/g, '')) || 0
    if (!type) {
      showToast('Jenis kendaraan wajib diisi', 'error')
      return
    }
    setSaving(true)
    try {
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
      setAddOpen(false)
      setAddForm({ golongan: '', type: '', muatan: '', kosong: '' })
      showToast('Baris golongan ditambahkan')
    } finally {
      setSaving(false)
    }
  }

  /** Nominal lokal tampil per tabel (BADAU vs REGION). */
  const lokalOf = (region: typeof badauRegion) => lokalNotus[region?.id ?? '']?.lokal ?? 0

  return (
    <div className="space-y-5">
      {/* Header halaman */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Master Tarif</h3>
          <p className="text-slate-500 text-[12px] mt-0.5 max-w-2xl">
            Tarif trip yang asli dipakai aplikasi. Edit seperti spreadsheet: klik angka,
            ubah, lalu Enter — perubahan otomatis tersimpan ke server.
          </p>
        </div>
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
      </div>

      {/* Dua tabel spreadsheet berdampingan: BADAU | REGION */}
      <div className="flex flex-wrap items-start gap-6">
        {/* Panel BADAU: master tarif trip asli (muatan/kosong per golongan).
            Tambah baris lewat ikon + pada header. */}
        <GolonganSheet
          title="BADAU"
          titleExtra={
            <button
              onClick={() => setAddOpen((v) => !v)}
              title="Tambah baris golongan"
              disabled={saving}
              className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            >
              {addOpen ? <X size={14} /> : <Plus size={14} />}
            </button>
          }
          rows={sortedRows}
          getLokal={() => lokalOf(badauRegion)}
          commitLokal={(v) => commitLokalFor(badauRegion, v)}
          commitMuatan={commitMuatan}
          commitKosong={commitKosong}
          onDelete={handleDelete}
          footer={
            <tfoot>
              {addOpen ? (
                <tr className="bg-amber-50/60">
                  <td className={`${BORDER} border-slate-300 px-2 py-1.5`}>
                    <div className="flex items-center gap-1">
                      <input
                        list="tariff-golongan-options"
                        value={addForm.golongan}
                        placeholder={nextGolongan()}
                        onChange={(e) => setAddForm((f) => ({ ...f, golongan: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && void submitAdd()}
                        title="Golongan (I..V)"
                        className="w-10 border border-slate-200 rounded px-1 py-1 text-center text-[12px] uppercase outline-none focus:border-blue-400"
                      />
                      <input
                        autoFocus
                        value={addForm.type}
                        placeholder="jenis kendaraan"
                        onChange={(e) => setAddForm((f) => ({ ...f, type: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && void submitAdd()}
                        className="flex-1 min-w-0 border border-slate-200 rounded px-2 py-1 text-[12px] outline-none focus:border-blue-400"
                      />
                      <button
                        onClick={() => setAddOpen(false)}
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
                      onKeyDown={(e) => e.key === 'Enter' && void submitAdd()}
                      className="w-full bg-transparent text-right text-[13px] tabular-nums outline-none"
                    />
                  </td>
                  <td className={`${BORDER} border-slate-300 px-2 py-1.5`}>
                    <input
                      value={addForm.kosong}
                      inputMode="numeric"
                      placeholder="0"
                      onChange={(e) => setAddForm((f) => ({ ...f, kosong: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && void submitAdd()}
                      className="w-full bg-transparent text-right text-[13px] tabular-nums outline-none"
                    />
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={5} className={`${BORDER} border-slate-300`}>
                    <button
                      onClick={() => setAddOpen(true)}
                      className="w-full py-1.5 text-center text-[11px] font-medium text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
                    >
                      + tambah baris
                    </button>
                  </td>
                </tr>
              )}
            </tfoot>
          }
        />
        <datalist id="tariff-golongan-options">
          {GOLONGAN_OPTIONS.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>

        {/* Panel REGION: nominal lokal per wilayah; nilai external pada
            panel ini mengacu master tarif (BADAU), bukan dikonfigurasi di
            sini — selaraskan resolver tarif backend. */}
        <GolonganSheet
          title="REGION"
          titleExtra={
            <select
              value={panelRegion?.id ?? ''}
              onChange={(e) => setPanelRegionId(e.target.value)}
              title="Pilih region untuk panel ini"
              className="max-w-[220px] truncate rounded border border-slate-200 bg-white px-1.5 py-1 text-[12px] font-semibold text-slate-600 outline-none hover:border-slate-300"
            >
              {regions.length === 0 && <option value="">—</option>}
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          }
          rows={sortedRows}
          placeholdersExternal
          getLokal={() => lokalOf(panelRegion)}
          commitLokal={(v) => commitLokalFor(panelRegion, v)}
          commitMuatan={async () => false}
          commitKosong={async () => false}
          onDelete={handleDelete}
        />
      </div>

      {/* Keterangan singkat */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-500 shadow-sm space-y-1">
        <p>
          <b className="text-slate-700">BADAU</b> — kolom <b>muatan</b> dan <b>kosong</b> adalah master tarif
          per golongan yang dipakai aplikasi menghitung tagihan trip.
        </p>
        <p>
          <b className="text-slate-700">REGION</b> — kolom <b>lokal</b> nominal flat per wilayah; placeholder
          "tarif muatan"/"tarif kosong" mengacu master tarif BADAU.
        </p>
        <p>
          <b className="text-slate-700">internal</b> terkunci Rp 0 — kendaraan internal tidak pernah ditagih.
          Konfigurasi tarif terpusat (penarifan plat, tarif eksternal flat) sudah dihapus.
        </p>
      </div>
    </div>
  )
}
