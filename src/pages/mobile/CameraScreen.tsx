import { useRef, useState } from 'react'
import { ChevronLeft, RefreshCw, Camera, Upload, AlertCircle } from 'lucide-react'
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera'
import { useApp } from '../store'
import type { MobileScreen } from '../types'

interface CameraScreenProps {
  go: (s: MobileScreen) => void
}

export default function CameraScreen({ go }: CameraScreenProps) {
  const { patchDraft } = useApp()
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const fallbackInputRef = useRef<HTMLInputElement>(null)

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
        patchDraft({ photo: true, photoUrl: image.dataUrl })
        go('vehicle-form')
        return
      }
    } catch (err: unknown) {
      console.warn('Capacitor camera failed or cancelled:', err)
      // If native camera is unavailable or user denied permission on web/browser, trigger fallback input
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
      const dataUrl = reader.result as string
      patchDraft({ photo: true, photoUrl: dataUrl })
      go('vehicle-form')
    }
    reader.onerror = () => {
      setErrorMsg('Gagal membaca file foto.')
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="relative bg-slate-950 flex-1 flex items-center justify-center" style={{ minHeight: 560 }}>
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-transparent to-slate-950/40" />

        {/* Header */}
        <div className="absolute top-5 left-5 right-5 flex items-center justify-between z-10">
          <button onClick={() => go('vehicle-form')} className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 text-white">
            <ChevronLeft size={20} />
          </button>
          <div className="bg-black/50 rounded-full px-4 py-2">
            <span className="text-white text-[12px] font-semibold">Foto Bukti Muatan</span>
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
            <span className="text-white/40 text-[11px] text-center px-8">Arahkan ke selfie + muatan kendaraan</span>
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

      {/* Controls */}
      <div className="bg-slate-950 flex items-center justify-center py-8 gap-10">
        <button
          onClick={() => fallbackInputRef.current?.click()}
          title="Upload dari galeri / file"
          className="w-11 h-11 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 hover:bg-slate-700 active:scale-95 transition-all"
        >
          <Upload size={18} />
        </button>
        <button
          onClick={handleCapture}
          disabled={loading}
          className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
        >
          <div className={`w-14 h-14 rounded-full bg-white flex items-center justify-center ${loading ? 'animate-pulse' : ''}`} />
        </button>
        <button
          onClick={handleCapture}
          title="Buka ulang kamera"
          className="w-11 h-11 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 hover:bg-slate-700 active:scale-95 transition-all"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  )
}
