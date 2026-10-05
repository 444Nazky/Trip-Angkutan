import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, RefreshCw, Camera, AlertCircle, Loader2, MapPin, Clock } from 'lucide-react'
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'
import { Capacitor } from '@capacitor/core'
import { useApp } from '../store'
import { readPlateFromImage } from '../../services/ocr'
import type { MobileScreen } from '../types'

// ─── Camera Screen ───────────────────────────────────────────────
// Sumber FOTO SATU-SEGALANYA: kamera perangkat.
//   Android/iOS → plugin native (CameraSource.Camera)
//   Web/desktop  → getUserMedia → canvas
// TIDAK ADA pilihan galeri / penyimpanan — semua foto bukti HARUS dari kamera langsung.
// ────────────────────────────────────────────────────────────────

interface CameraScreenProps {
  go: (s: MobileScreen) => void
}

export default function CameraScreen({ go }: CameraScreenProps) {
  const { draft, patchDraft } = useApp()
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [liveState, setLiveState] = useState<'off' | 'starting' | 'ready' | 'denied'>('off')
  const [useNative] = useState(() => Capacitor.isNativePlatform())
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const isOcr = draft.cameraMode === 'ocr'
  const returnTo: MobileScreen = isOcr ? 'vehicle-form' : (draft.cameraFrom || 'vehicle-form')
  const title = isOcr ? 'Scan Plat Nomor' : (returnTo === 'trip-summary' ? 'Foto Bukti Trip' : 'Foto Bukti Muatan')

  // ── Helpers ──────────────────────────────────────────────────
  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const startStream = async () => {
    if (streamRef.current) return
    setLiveState('starting')
    setErrorMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => { /* autoplay blocked */ })
      }
      setLiveState('ready')
    } catch {
      setLiveState('denied')
      setErrorMsg('Kamera tidak tersedia')
    }
  }

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) void startStream()
    return () => stopStream()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Snapshot dari canvas ───────────────────────────────────
  const snapshotFromCanvas = (): string | null => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const cv = document.createElement('canvas')
    cv.width = v.videoWidth; cv.height = v.videoHeight
    cv.getContext('2d')?.drawImage(v, 0, 0)
    return cv.toDataURL('image/jpeg', 0.92)
  }

  // ── Watermark helper ──────────────────────────────────────
  // Ditrigger oleh deliver() sebelum patchDraft
  function addWatermark(
    dataUrl: string,
    lat: number | null,
    lon: number | null,
    timestamp: string,
  ): string {
    const img = new Image()
    img.src = dataUrl
    const w = img.width || 800, h = img.height || 600
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)

    // Shadow untuk teks
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = 4
    ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1

    // Background box di kanan-bawah
    const padX = 10, padY = 6, boxH = 46, boxW = 240
    const bx = w - boxW - padX, by = h - boxH - padY
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
    ctx.beginPath()
    ctx.roundRect(bx, by, boxW, boxH, 6)
    ctx.fill()

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 11px monospace'
    ctx.textAlign = 'left'
    ctx.fillText(timestamp, bx + 8, by + 18)

    // Koordinat GPS
    const geo = (lat != null && lon != null)
      ? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
      : 'Lokasi tidak tersedia'
    ctx.font = '10px monospace'
    ctx.fillStyle = '#93c5fd'
    ctx.fillText(geo, bx + 8, by + 32)

    return cv.toDataURL('image/jpeg', 0.92)
  }

  // ── Simpan foto ───────────────────────────────────────────
  const deliver = async (rawDataUrl: string) => {
    const capturedAt = new Date().toISOString()
    setBusy(true)

    let lat: number | null = null, lon: number | null = null
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 })
      lat = pos.coords.latitude; lon = pos.coords.longitude
    } catch { /* lokasi gagal — tetap lanjut */ }

    // Tambah watermark
    const watermarked = addWatermark(rawDataUrl, lat, lon, new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }))

    patchDraft({
      photo: true,
      photoUrl: watermarked,
      photoCapturedAt: capturedAt,
      photoLatitude: lat,
      photoLongitude: lon,
    })
    go(returnTo)
    setBusy(false)
  }

  // ── Handle capture ───────────────────────────────────────
  const handleCapture = async () => {
    if (busy) return
    setErrorMsg('')

    // ① native plugin → langsung foto dari canvas
    if (Capacitor.isNativePlatform()) {
      setBusy(true)
      try {
        const image = await CapCamera.getPhoto({
          quality: 85,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera,
        })
        if (image?.dataUrl) { await deliver(image.dataUrl); return }
      } catch (err) {
        // Batal atau gagal → fallback web
        console.warn('[camera] native failed', err)
      }
      setBusy(false)
      // Lanjut ke web preview
    }

    // ② Web: pastikan stream live
    if (liveState !== 'ready') { await startStream(); return }
    const dataUrl = snapshotFromCanvas()
    if (!dataUrl) { setErrorMsg('Kamera belum siap — coba lagi'); return }
    await deliver(dataUrl)
  }

  return (
    <div className="flex flex-col h-full bg-black">
      {/* ── Header overlay ── */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 py-4">
        <button
          onClick={() => go(returnTo)}
          className="w-10 h-10 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white active:scale-95 transition"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="bg-black/40 backdrop-blur px-4 py-1.5 rounded-full">
          <span className="text-white text-[11px] font-black tracking-wide uppercase">{title}</span>
        </div>
        <div className="w-10" />
      </div>

      {/* ── Video/Preview ── */}
      <div className="flex-1 relative overflow-hidden">
        {!Capacitor.isNativePlatform() && liveState === 'ready' && (
          <video
            ref={videoRef}
            autoPlay playsInline muted
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30 pointer-events-none" />
      </div>

      {/* ── Info bar overlay ── */}
      {Capacitor.isNativePlatform() && (
        <div className="absolute top-16 left-5 right-5 z-10 flex items-center gap-2">
          <span className="bg-black/50 backdrop-blur text-white text-[10px] px-3 py-1 rounded-full font-medium">
            Native Camera
          </span>
        </div>
      )}

      {/* ── Bottom controls ── */}
      <div className="relative z-10 bg-black/90 backdrop-blur-sm pt-6 pb-10 px-6 flex flex-col items-center gap-3">
        {/* Error */}
        {errorMsg && (
          <div className="flex items-center gap-1.5 text-red-400 text-[11px] font-medium">
            <AlertCircle size={12} /> {errorMsg}
          </div>
        )}
        {/* Tombol jepret */}
        <button
          onClick={() => void handleCapture()}
          disabled={busy}
          className="w-20 h-20 rounded-full bg-white active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
        >
          {busy
            ? <Loader2 size={28} className="animate-spin text-slate-400 mx-auto" />
            : <div className="w-16 h-16 rounded-full ring-4 ring-white/30 mx-auto" />
          }
        </button>
        <span className="text-white/60 text-[10px] font-medium uppercase tracking-widest">
          {busy ? 'Memproses…' : 'Tap untuk memotret'}
        </span>
        <span className="text-white/30 text-[9px]">Kamera saja — tanpa galeri</span>
      </div>
    </div>
  )
}
