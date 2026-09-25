import { useRef, useState } from 'react'
import { ChevronLeft, RefreshCw, Camera, AlertCircle } from 'lucide-react'
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera'
import { useApp } from '../store'
import type { MobileScreen } from '../types'

interface CameraScreenProps {
  go: (s: MobileScreen) => void
}

export default function CameraScreen({ go }: CameraScreenProps) {
  const { draft, patchDraft } = useApp()
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const fallbackInputRef = useRef<HTMLInputElement>(null)

  // Kembali ke layar yang membuka kamera (form kendaraan atau ringkasan trip)
  const returnTo: MobileScreen = draft.cameraFrom || 'vehicle-form'
  const title = returnTo === 'trip-summary' ? 'Foto Bukti Trip' : 'Foto Bukti Muatan'

  const finishCapture = (dataUrl: string) => {
    patchDraft({ photo: true, photoUrl: dataUrl })
    go(returnTo)
  }

  const handleCapture = async () => {
    setErrorMsg('')
    setLoading(true)
    try {
      const image = await CapCamera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      })

      if (image && image.dataUrl) {
        finishCapture(image.dataUrl)
        return
      }
    } catch (err: unknown) {
      console.warn('Capacitor camera failed or cancelled:', err)
      // Native camera unavailable (web/desktop) → fallback bertindak sebagai
      // kamera perangkat, tetap dengan capture="environment".
      fallbackInputRef.current?.click()
    } finally {
      setLoading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      finishCapture(reader.result as string)
    }
    reader.onerror = () => {
      setErrorMsg('Gagal membaca file foto.')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="relative bg-slate-950 flex-1 flex items-center justify-center" style={{ minHeight: 560 }}>
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-transparent to-slate-950/40" />

        {/* Header */}
        <div className="absolute top-5 left-5 right-5 flex items-center justify-between z-10">
          <button onClick={() => go(returnTo)} className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 text-white">
            <ChevronLeft size={20} />
          </button>
          <div className="bg-black/50 rounded-full px-4 py-2">
            <span className="text-white text-[12px] font-semibold">{title}</span>
          </div>
          <div className="w-10" />
        </div>

        {/* Grid overlay */}
        <div className="absolute inset-8 grid grid-cols-3 grid-rows-3 pointer-events-none">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="border border-white/10" />)}
        </div>

        {/* Viewfinder */}
        <div className="relative w-64 h-64">
          {([
            ['top-0 left-0', 'border-t-2 border-l-2 rounded-tl-2xl'],
            ['top-0 right-0', 'border-t-2 border-r-2 rounded-tr-2xl'],
            ['bottom-0 left-0', 'border-b-2 border-l-2 rounded-bl-2xl'],
            ['bottom-0 right-0', 'border-b-2 border-r-2 rounded-br-2xl'],
          ] as [string, string][]).map(([pos, border], i) => (
            <div key={i} className={`absolute ${pos} w-8 h-8 border-white ${border}`} />
          ))}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Camera size={40} className="text-white/30" />
            <span className="text-white/40 text-[11px] text-center px-8">
              {returnTo === 'trip-summary' ? 'Arahkan ke kendaraan (trip kosong)' : 'Arahkan ke selfie + muatan kendaraan'}
            </span>
            <span className="text-amber-300/80 text-[10px] font-bold text-center px-8">
              Wajib ambil foto via kamera sebelum submit trip
            </span>
            {errorMsg && (
              <div className="flex items-center gap-1.5 bg-red-500/80 text-white text-[10px] px-3 py-1 rounded-full">
                <AlertCircle size={12} /> {errorMsg}
              </div>
            )}
          </div>
        </div>

        {/* Hidden fallback file input */}
        <input
          ref={fallbackInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Controls — hanya kamera (tanpa unggah galeri) */}
      <div className="bg-slate-950 flex flex-col items-center justify-center py-8 gap-3">
        <button
          onClick={handleCapture}
          disabled={loading}
          title="Ambil foto via kamera"
          className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
        >
          <div className={`w-14 h-14 rounded-full bg-white flex items-center justify-center ${loading ? 'animate-pulse' : ''}`} />
        </button>
        <span className="text-slate-500 text-[11px] font-semibold flex items-center gap-1.5">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {loading ? 'Mengambil foto...' : 'Tap untuk memotret'}
        </span>
      </div>
    </div>
  )
}
