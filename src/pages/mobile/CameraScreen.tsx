import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, RefreshCw, Camera, AlertCircle, Loader2 } from 'lucide-react'
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { useApp } from '../store'
import { readPlateFromImage } from '../../services/ocr'
import type { MobileScreen } from '../types'

// ─── Camera Screen ─────────────────────────────────────────────────────────────
// SATU-SATUNYA sumber foto dokumentasi & scan plat: kamera perangkat.
//   • Aplikasi Android/iOS → plugin kamera native (CameraSource.Camera)
//   • Web/desktop          → pratinjau langsung getUserMedia + jepretan canvas
// TIDAK ADA input type="file" / picker galeri / penyimpanan lokal — semua jalur
// impor gambar dimatikan supaya foto bukti tidak bisa dicurangi dari galeri.

interface CameraScreenProps {
  go: (s: MobileScreen) => void
}

export default function CameraScreen({ go }: CameraScreenProps) {
  const { draft, patchDraft } = useApp()
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  // 'off' = belum mulai · 'starting' · 'ready' · 'denied' = izin ditolak
  const [liveState, setLiveState] = useState<'off' | 'starting' | 'ready' | 'denied'>('off')
  // Awalnya kamera native bila berjalan di aplikasi; bisa jatuh ke pratinjau web
  // (tetap kamera!) kalau plugin native gagal.
  const [useNative, setUseNative] = useState(() => Capacitor.isNativePlatform())

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const isOcr = draft.cameraMode === 'ocr'
  const returnTo: MobileScreen = isOcr ? 'vehicle-form' : (draft.cameraFrom || 'vehicle-form')
  const title = isOcr
    ? 'Scan Plat Nomor'
    : returnTo === 'trip-summary' ? 'Foto Bukti Trip' : 'Foto Bukti Muatan'

  // ── Pratinjau kamera live (web / fallback) ─────────────────────────────────
  const stopLive = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const startLive = async () => {
    if (streamRef.current) return
    setLiveState('starting')
    setErrorMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => { /* autoplay */ })
      }
      setLiveState('ready')
    } catch {
      setLiveState('denied')
      setErrorMsg('Izinkan akses kamera untuk memotret')
    }
  }

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) void startLive()
    return () => stopLive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const snapshot = (): string | null => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')?.drawImage(v, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.85)
  }

  // Serahkan hasil jepretan: foto dokumentasi → draft trip; mode OCR → baca plat
  const deliver = async (dataUrl: string) => {
    if (isOcr) {
      setBusy(true)
      try {
        const text = await readPlateFromImage(dataUrl)
        patchDraft(text
          ? { ocrResult: text, ocrError: undefined }
          : { ocrResult: undefined, ocrError: 'Plat tidak terbaca — silakan ketik manual' })
      } catch {
        patchDraft({ ocrResult: undefined, ocrError: 'OCR gagal (unduhan data OCR butuh internet) — ketik manual' })
      } finally {
        setBusy(false)
        go('vehicle-form')
      }
      return
    }
    patchDraft({ photo: true, photoUrl: dataUrl })
    go(returnTo)
  }

  const handleCapture = async () => {
    if (busy) return
    setErrorMsg('')

    // 1) Kamera native aplikasi (Android/iOS)
    if (useNative) {
      setBusy(true)
      try {
        const image = await CapCamera.getPhoto({
          quality: 80,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera, // HANYA kamera — tanpa opsi galeri
        })
        if (image?.dataUrl) {
          setBusy(false)
          await deliver(image.dataUrl)
          return
        }
        setBusy(false) // dibatalkan pengguna → diam, tidak ada jalur impor
        return
      } catch (err) {
        setBusy(false)
        if (/cancel/i.test(String((err as Error)?.message ?? err))) return // batal → biarkan
        // Plugin bermasalah → jatuh ke pratinjau kamera web (tetap kamera!)
        setUseNative(false)
        setErrorMsg('Kamera aplikasi tidak tersedia — pakai pratinjau kamera')
        await startLive()
        return
      }
    }

    // 2) Pratinjau kamera web (getUserMedia) → jepret dari canvas
    if (liveState !== 'ready') {
      await startLive()
      return
    }
    const dataUrl = snapshot()
    if (!dataUrl) {
      setErrorMsg('Kamera belum siap — coba lagi')
      return
    }
    await deliver(dataUrl)
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="relative bg-slate-950 flex-1 flex items-center justify-center" style={{ minHeight: 560 }}>
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-transparent to-slate-950/40" />

        {/* Pratinjau kamera live — sumber satu-satunya di web/desktop */}
        {!useNative && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

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
            {!useNative && liveState === 'ready' ? null : (
              <Camera size={40} className="text-white/30" />
            )}
            <span className="text-white/70 text-[11px] text-center px-8">
              {isOcr
                ? 'Arahkan kamera ke nomor plat kendaraan'
                : returnTo === 'trip-summary' ? 'Arahkan ke kendaraan (trip kosong)' : 'Arahkan ke selfie + muatan kendaraan'}
            </span>
            <span className="text-amber-300/80 text-[10px] font-bold text-center px-8">
              {isOcr ? 'Foto plat diambil langsung dari kamera' : 'Wajib ambil foto via kamera sebelum submit trip'}
            </span>
            {liveState === 'starting' && (
              <span className="text-white/60 text-[10px] flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Menyalakan kamera...
              </span>
            )}
            {errorMsg && (
              <div className="flex items-center gap-1.5 bg-red-500/80 text-white text-[10px] px-3 py-1 rounded-full">
                <AlertCircle size={12} /> {errorMsg}
              </div>
            )}
            {liveState === 'denied' && (
              <button
                onClick={() => void startLive()}
                className="text-[10px] font-black text-slate-900 bg-white rounded-full px-3 py-1.5"
              >
                Coba Lagi
              </button>
            )}
          </div>
        </div>
        {/* NB: tidak ada <input type="file"> — impor galeri/penyimpanan dimatikan */}
      </div>

      {/* Controls — hanya tombol jepret */}
      <div className="bg-slate-950 flex flex-col items-center justify-center py-8 gap-3">
        <button
          onClick={() => void handleCapture()}
          disabled={busy || liveState === 'starting'}
          title={isOcr ? 'Jepret plat nomor' : 'Ambil foto via kamera'}
          className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
        >
          <div className={`w-14 h-14 rounded-full bg-white flex items-center justify-center ${busy ? 'animate-pulse' : ''}`}>
            {busy && <Loader2 size={20} className="animate-spin text-slate-900" />}
          </div>
        </button>
        <span className="text-slate-500 text-[11px] font-semibold flex items-center gap-1.5">
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
          {busy ? (isOcr ? 'Membaca plat...' : 'Mengambil foto...') : 'Tap untuk memotret'}
        </span>
        <span className="text-slate-600/70 text-[9px] font-bold uppercase tracking-widest">
          Kamera saja — tanpa galeri
        </span>
      </div>
    </div>
  )
}
