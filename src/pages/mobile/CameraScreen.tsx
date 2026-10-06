import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Loader2, AlertCircle, MapPin, Clock } from 'lucide-react'
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'
import { Capacitor } from '@capacitor/core'
import { useApp } from '../store'
import { readPlateFromImage } from '../../services/ocr'
import type { MobileScreen } from '../types'

// ─── Camera Screen ───────────────────────────────────────────────────────────
// Preview kamera full-screen (murni), tanpa kotak panduan / teks bantu.
//   Android/iOS → plugin native (CameraSource.Camera) untuk jepretan
//   Web         → getUserMedia → canvas
// Setiap foto otomatis diberi watermark: koordinat GPS/wilayah + stempel waktu.
// ─────────────────────────────────────────────────────────────────────────────

interface CameraScreenProps {
  go: (s: MobileScreen) => void
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('gambar gagal dimuat'))
    img.src = src
  })
}

export default function CameraScreen({ go }: CameraScreenProps) {
  const { draft, patchDraft, officer } = useApp()
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [liveState, setLiveState] = useState<'off' | 'starting' | 'ready' | 'denied'>('off')
  const [, setTick] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  /** Cegah kamera native terbuka dua kali (mis. StrictMode / ketuk ganda). */
  const launchedRef = useRef(false)
  const busyRef = useRef(false)

  const isOcr = draft.cameraMode === 'ocr'
  const returnTo: MobileScreen = isOcr ? 'vehicle-form' : (draft.cameraFrom || 'vehicle-form')
  const title = isOcr ? 'Scan Plat Nomor' : (returnTo === 'trip-summary' ? 'Foto Bukti Trip' : 'Foto Bukti Muatan')
  const regionLabel = officer?.region || ''

  // Jam berjalan untuk pratinjau watermark (timestamp real-time)
  useEffect(() => {
    const id = window.setInterval(() => setTick(v => v + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────
  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const startStream = async () => {
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
        await videoRef.current.play().catch(() => { /* autoplay blocked */ })
      }
      setLiveState('ready')
    } catch {
      setLiveState('denied')
      // Di native, jepretan tetap lewat plugin kamera bawaan → jangan tampil error
      if (!Capacitor.isNativePlatform()) setErrorMsg('Kamera tidak tersedia')
    }
  }

  useEffect(() => {
    if (launchedRef.current) return
    launchedRef.current = true
    if (Capacitor.isNativePlatform()) {
      // Native → langsung buka kamera bawaan. TANPA layar preview perantara.
      void openNativeCamera()
    } else {
      void startStream()
    }
    return () => stopStream()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pasang stream ke <video> begitu elemennya dimount (render kondisional)
  useEffect(() => {
    const v = videoRef.current
    if (liveState === 'ready' && v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current
      void v.play().catch(() => { /* autoplay blocked */ })
    }
  }, [liveState])

  // ── Snapshot dari canvas (web) ─────────────────────────────────────────────
  const snapshotFromCanvas = (): string | null => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const cv = document.createElement('canvas')
    cv.width = v.videoWidth; cv.height = v.videoHeight
    cv.getContext('2d')?.drawImage(v, 0, 0)
    return cv.toDataURL('image/jpeg', 0.92)
  }

  // ── Watermark: GPS/wilayah + timestamp ─────────────────────────────────────
  // Dijalankan sebelum patchDraft. Gagal watermark tidak memblokir penyimpanan.
  async function addWatermark(
    dataUrl: string,
    lat: number | null,
    lon: number | null,
    region: string,
    capturedAt: Date,
  ): Promise<string> {
    try {
      const img = await loadImage(dataUrl)
      const w = img.naturalWidth || img.width || 800
      const h = img.naturalHeight || img.height || 600
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = h
      const ctx = cv.getContext('2d')
      if (!ctx) return dataUrl
      ctx.drawImage(img, 0, 0, w, h)

      const lines: Array<{ text: string; color: string; font: string }> = [
        {
          text: capturedAt.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' }),
          color: '#ffffff',
          font: 'bold 13px monospace',
        },
        {
          text: (lat != null && lon != null)
            ? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
            : 'Lokasi tidak tersedia',
          color: '#93c5fd',
          font: '12px monospace',
        },
      ]
      if (region) lines.push({ text: region.toUpperCase(), color: '#fde68a', font: '11px monospace' })

      const padX = 12, padY = 8, lineH = 17
      ctx.font = 'bold 13px monospace'
      const textW = Math.max(...lines.map(l => {
        ctx.font = l.font
        return ctx.measureText(l.text).width
      }), 0)
      const boxW = Math.min(w - 2 * padX, textW + padX * 2)
      const boxH = lines.length * lineH + padY * 2
      const bx = w - boxW - padX
      const by = h - boxH - padY

      // Latar semi-transparan agar teks terbaca di kondisi apapun
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, boxW, boxH, 8)
      else ctx.rect(bx, by, boxW, boxH)
      ctx.fill()
      ctx.restore()

      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      let ty = by + padY + lineH / 2
      for (const l of lines) {
        ctx.font = l.font
        ctx.shadowColor = 'rgba(0,0,0,0.6)'
        ctx.shadowBlur = 3
        ctx.shadowOffsetX = 1
        ctx.shadowOffsetY = 1
        ctx.fillStyle = l.color
        ctx.fillText(l.text, bx + padX, ty)
        ty += lineH
      }
      return cv.toDataURL('image/jpeg', 0.92)
    } catch {
      return dataUrl // fallback: foto tetap tersimpan tanpa watermark
    }
  }

  // ── Simpan foto ────────────────────────────────────────────────────────────
  const deliver = async (rawDataUrl: string) => {
    const capturedAt = new Date()
    setBusy(true)

    let lat: number | null = null
    let lon: number | null = null
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true, timeout: 5000, maximumAge: 30000,
      })
      lat = pos.coords.latitude
      lon = pos.coords.longitude
    } catch { /* lokasi gagal — tetap lanjut */ }

    const watermarked = await addWatermark(rawDataUrl, lat, lon, regionLabel, capturedAt)

    if (isOcr) {
      // OCR plat: pakai gambar mentah (tanpa watermark) agar akurasi terjaga
      try {
        const plate = await readPlateFromImage(rawDataUrl)
        if (plate) patchDraft({ ocrResult: plate })
      } catch { /* OCR gagal — biarkan petugas isi manual */ }
      setBusy(false)
      go('vehicle-form')
      return
    }

    patchDraft({
      photo: true,
      photoUrl: watermarked,
      photoCapturedAt: capturedAt.toISOString(),
      photoLatitude: lat,
      photoLongitude: lon,
    })
    setBusy(false)
    go(returnTo)
  }

  // ── Kamera native (langsung dari tombol "Ambil Dokumentasi") ──────────
  async function openNativeCamera() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setErrorMsg('')
    try {
      const image = await CapCamera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      })
      if (image?.dataUrl) {
        busyRef.current = false
        await deliver(image.dataUrl)
        return
      }
      // Tanpa gambar → dianggap batal
      busyRef.current = false
      setBusy(false)
      go(returnTo)
    } catch (err) {
      busyRef.current = false
      setBusy(false)
      const msg = String((err as Error)?.message ?? err)
      if (/cancel|batal/i.test(msg)) {
        // Pengguna menutup kamera → kembali ke layar sebelumnya
        go(returnTo)
        return
      }
      // Izin ditolak / kamera gagal → fallback preview web, tombol tetap jalan
      console.warn('[camera] native gagal', err)
      await startStream()
      setErrorMsg('Kamera tidak terbuka — ketuk tombol untuk mencoba lagi')
    }
  }

  // ── Handle capture ─────────────────────────────────────────────────────────
  const handleCapture = async () => {
    if (busy) return
    setErrorMsg('')

    // ① native plugin → kamera layar penuh bawaan Android/iOS
    if (Capacitor.isNativePlatform()) {
      await openNativeCamera()
      return
    }

    // ② Web: pastikan stream live lalu jepret dari canvas
    if (!streamRef.current) await startStream()
    const dataUrl = snapshotFromCanvas()
    if (!dataUrl) {
      setErrorMsg('Kamera belum siap — coba lagi')
      return
    }
    await deliver(dataUrl)
  }

  const now = new Date()

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black overflow-hidden">
      {/* ── Preview kamera layar penuh (hanya saat stream benar-benar siap) ── */}
      {liveState === 'ready' && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover bg-black"
        />
      )}

      {/* ── Header overlay ── */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-5 pt-5 pb-8 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
        <button
          onClick={() => go(returnTo)}
          className="pointer-events-auto w-10 h-10 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white active:scale-95 transition"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-white text-[11px] font-black tracking-wide uppercase drop-shadow">
          {title}
        </span>
        <div className="w-10" />
      </div>

      {/* ── Pratinjau watermark (GPS + waktu berjalan) ── */}
      <div className="absolute right-4 bottom-32 z-20 flex flex-col items-end gap-1 text-right pointer-events-none">
        <div className="flex items-center gap-1.5 rounded-lg bg-black/55 px-2.5 py-1.5 backdrop-blur">
          <Clock size={11} className="text-white/80" />
          <span className="text-white text-[10px] font-mono tabular-nums">
            {now.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' })}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-black/55 px-2.5 py-1.5 backdrop-blur">
          <MapPin size={11} className="text-blue-300" />
          <span className="text-blue-200 text-[10px] font-mono">
            {regionLabel ? `${regionLabel} · ` : ''}GPS aktif saat jepret
          </span>
        </div>
      </div>

      {/* ── Kontrol bawah ── */}
      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent pt-10 pb-9 px-6 flex flex-col items-center gap-3">
        {errorMsg && (
          <div className="flex items-center gap-1.5 text-red-400 text-[11px] font-medium">
            <AlertCircle size={12} /> {errorMsg}
          </div>
        )}
        <button
          onClick={() => void handleCapture()}
          disabled={busy}
          aria-label="Ambil foto"
          className="w-[74px] h-[74px] rounded-full bg-white/95 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-transform flex items-center justify-center shadow-[0_0_0_4px_rgba(255,255,255,0.25)]"
        >
          {busy
            ? <Loader2 size={28} className="animate-spin text-slate-500" />
            : <span className="w-14 h-14 rounded-full ring-4 ring-black/10" />
          }
        </button>
        <span className="text-white/70 text-[10px] font-semibold uppercase tracking-[0.2em]">
          {busy ? 'Memproses…' : 'Tap untuk memotret'}
        </span>
      </div>
    </div>
  )
}
