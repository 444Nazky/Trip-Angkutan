import { useRef, useState } from 'react'
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

interface RestoreMobileTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Restore data trip dari arsip ZIP hasil "Ekspor Data Trip" di aplikasi mobile.
 *
 * Yang divalidasi di sini hanya hal yang bisa diperiksa cepat di browser
 * (ekstensi .zip dan ukuran maksimal). Isi arsip — `data_trip.json`, struktur
 * skema, dan file foto — divalidasi ulang sepenuhnya di server; arsip yang
 * rusak ditolak dengan HTTP 400 dan pesannya ditampilkan apa adanya.
 */
export function RestoreMobileTab({ showToast }: RestoreMobileTabProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RestoreResult | null>(null)

  const pickFile = (candidate: File | null) => {
    setError(null)
    setResult(null)
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

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (busy) return
    const dropped = e.dataTransfer.files?.[0] ?? null
    pickFile(dropped)
  }

  const upload = async () => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append('archive', file)
      const res = await api.postMultipart<RestoreResult>('/admin/restore-mobile', form)
      if (!res.ok) {
        const message = res.error?.message ?? 'Restore gagal'
        setError(message)
        showToast(message, 'error')
        return
      }
      const data = res.data ?? {}
      setResult(data)
      setFile(null)
      showToast(`Restore selesai: ${data.trips ?? 0} trip dipulihkan`, 'success')
    } finally {
      setBusy(false)
    }
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

        <button
          type="button"
          onClick={() => void upload()}
          disabled={!file || busy}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--admin-accent)] px-4 py-3 text-[13px] font-bold text-[var(--admin-accent-contrast)] transition-colors hover:bg-[var(--admin-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ArchiveRestore size={15} />}
          {busy ? 'Memulihkan…' : 'Mulai Restore'}
        </button>

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
        </ul>
      </div>
    </div>
  )
}
