import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, Camera, Download, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react'
import { api } from '../../../services/api'
import { formatPlateNumber, sanitizePlateInput } from '../../../utils/plateFormatter'

/**
 * Halaman "Latih OCR" (`/ocr`).
 *
 * Admin mengunggah foto plat beserta plat yang benar. Setiap unggahan menjadi
 * satu sampel latih di server; tombol "Latih model" membangun ulang model
 * koreksi (daftar plat terkonfirmasi + pola salah-baca karakter) yang dipakai
 * aplikasi petugas saat memindai plat.
 *
 * Tidak ada data contoh: daftar kosong sampai admin benar-benar mengunggah.
 */

interface OcrSample {
  id: string
  image_path: string
  imageUrl: string
  predicted: string
  corrected: string
  source: string | null
  created_at: string
}

interface OcrStatus {
  ok: boolean
  sampleCount: number
  model: {
    version: number
    samples: number
    plates: number
    confusions: number
    accuracy: number
    trainedAt: string
  }
}

/** Kecilkan foto sebelum dikirim: unggahan tetap tajam, jaringan tetap ringan. */
const MAX_EDGE = 900
const JPEG_QUALITY = 0.85

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar tidak dapat dibaca')) }
    img.src = url
  })
}

async function fileToDataUrl(file: File): Promise<string> {
  const img = await loadImage(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas tidak tersedia')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

export function OcrTab({ showToast }: { showToast: (msg: string, type?: 'success' | 'error') => void }) {
  const [status, setStatus] = useState<OcrStatus | null>(null)
  const [samples, setSamples] = useState<OcrSample[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [training, setTraining] = useState(false)
  const [corrected, setCorrected] = useState('')
  const [predicted, setPredicted] = useState('')
  const [previews, setPreviews] = useState<{ name: string; dataUrl: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const [st, list] = await Promise.all([
      api.get<OcrStatus>('/ocr'),
      api.get<{ samples: OcrSample[] }>('/ocr/samples?limit=200'),
    ])
    if (st.ok && st.data) setStatus(st.data)
    if (list.ok) setSamples(list.data?.samples ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void reload() }, [reload])

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const out: { name: string; dataUrl: string }[] = []
    for (const file of Array.from(files).slice(0, 9)) {
      try {
        out.push({ name: file.name, dataUrl: await fileToDataUrl(file) })
      } catch {
        showToast(`${file.name} tidak bisa dibaca`, 'error')
      }
    }
    setPreviews(out)
  }

  const upload = async () => {
    const plate = formatPlateNumber(sanitizePlateInput(corrected))
    if (!previews.length) {
      showToast('Pilih foto plat terlebih dahulu', 'error')
      return
    }
    if (plate.replace(/\s/g, '').length < 4) {
      showToast('Isi plat yang benar (minimal 4 karakter)', 'error')
      return
    }
    setUploading(true)
    let ok = 0
    for (const preview of previews) {
      const res = await api.post('/ocr/samples', {
        image: preview.dataUrl,
        corrected: plate,
        predicted: formatPlateNumber(sanitizePlateInput(predicted)),
      }, 30000)
      if (res.ok) ok++
      else showToast(res.error?.message ?? 'Gagal mengunggah sampel', 'error')
    }
    setUploading(false)
    if (ok) {
      showToast(`${ok} sampel tersimpan`)
      setPreviews([])
      setCorrected('')
      setPredicted('')
      if (fileRef.current) fileRef.current.value = ''
      await reload()
    }
  }

  const train = async () => {
    setTraining(true)
    const res = await api.post<{ success?: boolean; model?: { version: number; plates: string[]; accuracy: number }; message?: string }>(
      '/ocr/train',
      {},
      60000,
    )
    setTraining(false)
    if (!res.ok) {
      showToast(res.error?.message ?? 'Pelatihan gagal', 'error')
      return
    }
    const model = res.data?.model
    showToast(
      model
        ? `Model v${model.version} selesai · ${model.plates.length} plat · akurasi ${model.accuracy}%`
        : 'Model diperbarui',
    )
    await reload()
  }

  const remove = async (id: string) => {
    const res = await api.delete(`/ocr/samples/${id}`)
    if (!res.ok) {
      showToast(res.error?.message ?? 'Gagal menghapus sampel', 'error')
      return
    }
    setSamples(prev => prev.filter(s => s.id !== id))
    await reload()
  }

  const downloadDataset = () => {
    const base = api.baseUrl.replace(/\/$/, '')
    // Token dikirim lewat query tidak didukung; buka di tab baru tanpa token
    // akan 403, jadi pakai fetch lalu unduh sebagai blob.
    void (async () => {
      const token = api.token
      const res = await fetch(`${base}/ocr/dataset`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        showToast('Gagal mengunduh dataset', 'error')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dataset-ocr-plat-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    })()
  }

  const model = status?.model

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Brain size={18} className="text-blue-600" /> Latih Model OCR Plat
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
          Unggah foto plat nomor beserta plat yang benar. Setiap foto menjadi data latih untuk
          aplikasi petugas: model belajar plat yang terkonfirmasi dan pola salah-baca karakter
          (mis. <span className="font-mono">8 → B</span>). Setelah menekan <b>Latih model</b>,
          HP petugas memakai model baru pada pemindaian berikutnya — tanpa perlu pasang ulang APK.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Sampel" value={String(status?.sampleCount ?? 0)} />
          <Stat label="Model" value={model?.version ? `v${model.version}` : 'belum ada'} />
          <Stat label="Plat dikenal" value={String(model?.plates ?? 0)} />
          <Stat label="Akurasi latih" value={model ? `${model.accuracy}%` : '-'} />
        </div>
        {model?.trainedAt && (
          <p className="mt-2 text-[11px] text-slate-400">
            Terakhir dilatih {new Date(model.trainedAt).toLocaleString('id-ID')} · {model.samples} sampel
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Unggah */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-bold text-slate-800">1. Unggah foto plat</h3>
          <p className="mt-1 text-[12px] text-slate-500">
            Boleh beberapa foto sekaligus bila platnya sama (sudut/cahaya berbeda).
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={e => void pickFiles(e.target.files)}
            className="mt-3 block w-full cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-[12px] text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-white"
          />

          {previews.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {previews.map(p => (
                <img
                  key={p.name}
                  src={p.dataUrl}
                  alt={p.name}
                  className="h-16 w-24 rounded-lg border border-slate-200 object-cover"
                />
              ))}
            </div>
          )}

          <label className="mt-4 block text-[12px] font-semibold text-slate-600">
            Plat yang benar <span className="text-red-500">*</span>
          </label>
          <input
            value={corrected}
            onChange={e => setCorrected(formatPlateNumber(sanitizePlateInput(e.target.value)))}
            placeholder="B 7171 XYE"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm font-bold tracking-wider text-slate-900 focus:border-blue-500 focus:outline-none"
          />

          <label className="mt-3 block text-[12px] font-semibold text-slate-600">
            Bacaan OCR sebelumnya <span className="font-normal text-slate-400">(opsional)</span>
          </label>
          <input
            value={predicted}
            onChange={e => setPredicted(formatPlateNumber(sanitizePlateInput(e.target.value)))}
            placeholder="B 7777 XTE"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm tracking-wider text-slate-700 focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Isi bila foto ini hasil scan yang salah baca. Model memakai selisihnya untuk mempelajari
            karakter yang sering tertukar.
          </p>

          <button
            onClick={() => void upload()}
            disabled={uploading || !previews.length}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
          >
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {uploading ? 'Mengunggah…' : 'Simpan sebagai data latih'}
          </button>
        </div>

        {/* Latih */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-bold text-slate-800">2. Latih model</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
            Pelatihan memakai seluruh sampel yang tersimpan. Model lama diganti model baru
            (versi naik satu); riwayat versi tetap tercatat.
          </p>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-600">
            {loading ? 'Memuat…' : status ? (
              <>
                <div className="flex justify-between"><span>Sampel siap latih</span><span className="font-mono font-bold">{status.sampleCount}</span></div>
                <div className="mt-1 flex justify-between"><span>Plat unik</span><span className="font-mono font-bold">{model?.plates ?? 0}</span></div>
                <div className="mt-1 flex justify-between"><span>Pasangan salah-baca</span><span className="font-mono font-bold">{model?.confusions ?? 0}</span></div>
              </>
            ) : 'Status tidak tersedia'}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={() => void train()}
              disabled={training || (status?.sampleCount ?? 0) === 0}
              className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {training ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {training ? 'Melatih…' : 'Latih model sekarang'}
            </button>
            <button
              onClick={downloadDataset}
              disabled={(status?.sampleCount ?? 0) === 0}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:text-slate-300"
            >
              <Download size={15} /> Unduh dataset (JSON)
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Dataset JSON berisi gambar (data URL) + label, siap diubah menjadi pasangan
            <span className="font-mono"> *.jpg</span> dan <span className="font-mono">*.gt.txt</span> untuk
            melatih ulang Tesseract (tesstrain).
          </p>
        </div>
      </div>

      {/* Daftar sampel */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Camera size={15} /> Sampel tersimpan
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
              {samples.length}
            </span>
          </h3>
          <button onClick={() => void reload()} className="text-[11px] font-semibold text-blue-600 hover:text-blue-700">
            Muat ulang
          </button>
        </div>

        {samples.length === 0 ? (
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-6 text-center text-[12px] text-slate-500">
            Belum ada sampel. Unggah foto plat pertama di atas.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {samples.map(s => (
              <div key={s.id} className="overflow-hidden rounded-xl border border-slate-200">
                <img
                  src={`${api.baseUrl.replace(/\/api\/?$/, '')}${s.imageUrl}`}
                  alt={`Plat ${s.corrected}`}
                  loading="lazy"
                  className="h-28 w-full bg-slate-100 object-cover"
                />
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] font-bold text-slate-800">{s.corrected}</p>
                    {s.predicted && s.predicted !== s.corrected && (
                      <p className="truncate font-mono text-[10px] text-amber-600 line-through">{s.predicted}</p>
                    )}
                  </div>
                  <button
                    onClick={() => void remove(s.id)}
                    title="Hapus sampel"
                    className="shrink-0 rounded-lg bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-bold text-slate-800">{value}</p>
    </div>
  )
}
