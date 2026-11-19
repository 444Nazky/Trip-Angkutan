import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArchiveRestore, CheckCircle2, FileArchive, Loader2, UploadCloud, X } from 'lucide-react'
import { api } from '../../../services/api'

/** Batas ukuran arsip — harus sama dengan batas di server. */
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024

interface RestoreResult {
  success?: boolean
  trips?: number
  created?: number
  updated?: number
  vehicles?: number
  photos?: number
}

interface PreviewTrip {
  clientTripId: string
  tripCode: string
  officer: string
  completedAt: string
  routeFrom: string
  routeTo: string
  statusMuatan: 'muatan' | 'kosong'
  vehicleCount: number
  photoCount: number
  tariffTotal: number
  exists: boolean
}

interface PreviewResult {
  success?: boolean
  trips?: PreviewTrip[]
  totals?: {
    trips?: number
    vehicles?: number
    photos?: number
    tariffTotal?: number
    existing?: number
  }
}

interface RestoreMobileTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRupiah(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString('id-ID')}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Restore data trip dari arsip ZIP hasil "Ekspor Data Trip" di aplikasi mobile.
 *
 * Setelah file dipilih, arsip langsung dipratinjau oleh server: seluruh trip
 * ditampilkan lengkap dengan tarif hasil resolver server, lalu operator bisa
 * memulihkan satu trip saja atau semuanya. Tidak ada data yang ditulis saat
 * pratinjau — validasi dan penulisan tetap terjadi di endpoint restore.
 */
export function RestoreMobileTab({ showToast }: RestoreMobileTabProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [restoredIds, setRestoredIds] = useState<Set<string>>(() => new Set())
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RestoreResult | null>(null)

  const busy = busyAction !== null

  const pickFile = (candidate: File | null) => {
    setError(null)
    setResult(null)
    setPreview(null)
    setPreviewError(null)
    setRestoredIds(new Set())
    if (!candidate) { setFile(null); return }
    if (!candidate.name.toLowerCase().endsWith('.zip')) {
      setFile(null)
      setError('Format file harus .zip')
      return
    }
    if (candidate.size > MAX_ARCHIVE_BYTES) {
      setFile(null)
      setError(`Ukuran arsip maksimal ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MB (file ini ${formatBytes(candidate.size)})`)
      return
    }
    setFile(candidate)
  }

  // Pratinjau otomatis setiap kali file berubah.
  useEffect(() => {
    if (!file) {
      setPreview(null)
      setPreviewError(null)
      setPreviewing(false)
      return
    }
    let alive = true
    setPreview(null)
    setPreviewError(null)
    setPreviewing(true)
    const form = new FormData()
    form.append('archive', file)
    void api.postMultipart<PreviewResult>('/admin/preview-mobile', form)
      .then(res => {
        if (!alive) return
        if (!res.ok) {
          setPreviewError(res.error?.message ?? 'Gagal membaca arsip')
          return
        }
        setPreview(res.data ?? { trips: [] })
      })
      .catch((err: unknown) => {
        if (alive) setPreviewError(err instanceof Error ? err.message : 'Gagal membaca arsip')
      })
      .finally(() => {
        if (alive) setPreviewing(false)
      })
    return () => { alive = false }
  }, [file])

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (busy) return
    const dropped = e.dataTransfer.files?.[0] ?? null
    pickFile(dropped)
  }

  const restore = async (clientTripId?: string) => {
    if (!file || busy) return
    // Restore Semua hanya memulihkan trip yang masih ada di daftar. Trip yang
    // baru saja direstore tidak dikirim ulang, jadi daftar dan hasilnya tetap
    // sama-sama bersih.
    const targets = clientTripId
      ? [clientTripId]
      : (preview?.trips ?? [])
          .filter(trip => !restoredIds.has(trip.clientTripId))
          .map(trip => trip.clientTripId)
    if (!targets.length) return

    setBusyAction(clientTripId ?? 'all')
    setError(null)
    try {
      const form = new FormData()
      form.append('archive', file)
      for (const id of targets) form.append('clientTripIds', id)
      const res = await api.postMultipart<RestoreResult>('/admin/restore-mobile', form)
      if (!res.ok) {
        const message = res.error?.message ?? 'Restore gagal'
        setError(message)
        showToast(message, 'error')
        return
      }
      const data = res.data ?? {}
      setResult(data)
      // Trip yang sudah dipulihkan langsung keluar dari daftar agar operator
      // tidak mengulanginya tanpa sengaja.
      setRestoredIds(prev => {
        const next = new Set(prev)
        for (const id of targets) next.add(id)
        return next
      })
      showToast(
        clientTripId
          ? '1 trip berhasil dipulihkan'
          : `Restore selesai: ${data.trips ?? 0} trip dipulihkan`,
        'success',
      )
    } finally {
      setBusyAction(null)
    }
  }

  const trips = (preview?.trips ?? []).filter(trip => !restoredIds.has(trip.clientTripId))
  // Ringkasan mengikuti daftar yang masih tampil, bukan total arsip awal.
  const totals = {
    trips: trips.length,
    vehicles: trips.reduce((sum, trip) => sum + trip.vehicleCount, 0),
    photos: trips.reduce((sum, trip) => sum + trip.photoCount, 0),
    tariffTotal: trips.reduce((sum, trip) => sum + trip.tariffTotal, 0),
    existing: trips.filter(trip => trip.exists).length,
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-black text-[var(--admin-text)]">Restore Data Mobile</h1>
        <p className="mt-0.5 text-[12px] text-[var(--admin-text-muted)]">
          Pulihkan data trip dari arsip <span className="font-semibold">export_trip_*.zip</span> yang dibuat
          lewat menu Profil → Ekspor Data Trip di aplikasi mobile.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 sm:p-5">
        <div
          onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => { if (!busy) inputRef.current?.click() }}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
          aria-label="Pilih atau letakkan file ZIP restore"
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
            dragging
              ? 'border-[var(--admin-accent)] bg-[var(--admin-surface-hover)]'
              : 'border-[var(--admin-border)] hover:bg-[var(--admin-surface-hover)]'
          } ${busy ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--admin-surface-sunken)] text-[var(--admin-accent-text)]">
            <UploadCloud size={22} />
          </span>
          <p className="text-[13px] font-bold text-[var(--admin-text)]">
            Letakkan file .zip di sini
          </p>
          <p className="text-[11px] text-[var(--admin-text-muted)]">
            atau klik untuk memilih file · maksimal {MAX_ARCHIVE_BYTES / (1024 * 1024)} MB
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            disabled={busy}
            onChange={e => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {file && (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-sunken)] px-3 py-2.5">
            <FileArchive size={18} className="shrink-0 text-[var(--admin-text-muted)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-[var(--admin-text)]">{file.name}</p>
              <p className="text-[10px] text-[var(--admin-text-faint)]">{formatBytes(file.size)}</p>
            </div>
            {!busy && (
              <button
                type="button"
                onClick={() => pickFile(null)}
                aria-label="Batalkan file yang dipilih"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {previewing && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-sunken)] px-3 py-2.5 text-[12px] text-[var(--admin-text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            Membaca arsip dan menghitung tarif…
          </div>
        )}

        {previewError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{previewError}</span>
          </div>
        )}

        {preview && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--admin-border)]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--admin-border)] bg-[var(--admin-surface-sunken)] px-3 py-3 sm:px-4">
              <div>
                <p className="text-[13px] font-bold text-[var(--admin-text)]">Pratinjau isi arsip</p>
                <p className="mt-0.5 text-[11px] text-[var(--admin-text-muted)]">
                  {totals.trips ?? trips.length} trip · {totals.vehicles ?? 0} kendaraan · {totals.photos ?? 0} foto
                  {(totals.existing ?? 0) > 0 ? ` · ${totals.existing} sudah ada` : ''}
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-[10px] font-semibold uppercase text-[var(--admin-text-faint)]">Total tarif</p>
                <p className="text-[15px] font-black tabular-nums text-[var(--admin-text)]">
                  {formatRupiah(totals.tariffTotal ?? 0)}
                </p>
              </div>
            </div>

            {trips.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-[var(--admin-text-muted)]">
                Semua trip di arsip sudah direstore dan keluar dari daftar.
              </div>
            ) : (
            <div className="divide-y divide-[var(--admin-border)]">
              {trips.map(trip => (
                <div key={trip.clientTripId} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:px-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-mono text-[12px] font-bold text-[var(--admin-text)]">{trip.tripCode || trip.clientTripId}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${
                        trip.exists
                          ? 'border-[var(--admin-border)] bg-[var(--admin-surface-sunken)] text-[var(--admin-text-muted)]'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}>
                        {trip.exists ? 'Sudah ada' : 'Baru'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--admin-text-muted)]">
                      {formatDate(trip.completedAt)} · {trip.officer}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--admin-text-muted)]">
                      {trip.routeFrom} → {trip.routeTo} · {trip.statusMuatan === 'muatan' ? 'Dengan muatan' : 'Tanpa muatan'}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[var(--admin-text-faint)]">
                      {trip.vehicleCount} kendaraan · {trip.photoCount} foto
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                    <p className="text-[12px] font-bold tabular-nums text-[var(--admin-text)]">
                      {formatRupiah(trip.tariffTotal)}
                    </p>
                    <button
                      type="button"
                      onClick={() => void restore(trip.clientTripId)}
                      disabled={busy}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--admin-border-strong)] px-3 py-1.5 text-[11px] font-bold text-[var(--admin-text-soft)] transition-colors hover:bg-[var(--admin-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyAction === trip.clientTripId
                        ? <Loader2 size={12} className="animate-spin" />
                        : <ArchiveRestore size={12} />}
                      {busyAction === trip.clientTripId ? 'Memulihkan…' : 'Restore trip ini'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            )}

            <div className="flex flex-col gap-3 border-t border-[var(--admin-border)] bg-[var(--admin-surface-sunken)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <p className="text-[11px] text-[var(--admin-text-muted)]">
                Pilih satu trip di atas, atau pulihkan seluruh isi arsip sekaligus.
              </p>
              <button
                type="button"
                onClick={() => void restore()}
                disabled={busy || trips.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--admin-accent)] px-4 py-2.5 text-[12px] font-bold text-[var(--admin-accent-contrast)] transition-colors hover:bg-[var(--admin-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {busyAction === 'all' ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />}
                {busyAction === 'all' ? 'Memulihkan semua…' : `Restore Semua (${trips.length})`}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {result && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-[12px] text-emerald-800">
            <p className="flex items-center gap-2 font-bold">
              <CheckCircle2 size={15} /> Restore berhasil
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
              <li>Trip: <span className="font-bold">{result.trips ?? 0}</span></li>
              <li>Baru: <span className="font-bold">{result.created ?? 0}</span></li>
              <li>Diperbarui: <span className="font-bold">{result.updated ?? 0}</span></li>
              <li>Kendaraan: <span className="font-bold">{result.vehicles ?? 0}</span></li>
              <li>Foto: <span className="font-bold">{result.photos ?? 0}</span></li>
            </ul>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 text-[11px] text-[var(--admin-text-muted)]">
        <p className="font-bold text-[var(--admin-text)]">Yang harus ada di dalam arsip</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li><span className="font-mono">data_trip.json</span> di root arsip, berisi array <span className="font-mono">trips</span>.</li>
          <li>Folder <span className="font-mono">images/</span> dengan seluruh foto yang direferensikan JSON.</li>
          <li>Trip yang sudah ada dikenali lewat <span className="font-mono">clientTripId</span>, jadi data tidak dobel.</li>
          <li>Tarif dihitung ulang oleh server saat pratinjau dan restore, bukan dari angka arsip.</li>
        </ul>
      </div>
    </div>
  )
}
