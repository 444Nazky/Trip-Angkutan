import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Loader2, AlertCircle, MapPin, Clock } from 'lucide-react'
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'
import { Capacitor } from '@capacitor/core'
import { useApp } from '../store'
import { readPlateFromImage } from '../../services/ocr'
import { compressImage, DOC_MAX_EDGE, DOC_QUALITY, OCR_MAX_EDGE, OCR_QUALITY } from '../../services/imageUtil'
import { getCurrentPosition } from '../../services/geofence'
import type { MobileScreen } from '../types'



interface CameraScreenProps {
  go: (s: MobileScreen) => void
}



async function getPhotoPosition(): Promise<{ lat: number | null; lon: number | null }> {
  try {
    const cached = await Promise.race([
      getCurrentPosition(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 1500)),
    ])
    if (cached) return { lat: cached.lat, lon: cached.lng }
  } catch { /* lanjut ke fallback */ }

  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 2500,
      maximumAge: 30000,
    })
    return { lat: pos.coords.latitude, lon: pos.coords.longitude }
  } catch {
    return { lat: null, lon: null }
  }
}



export default function CameraScreen({ go }: CameraScreenProps) {
  const { draft, patchDraft, officer, patchTripPhoto, patchVehiclePhoto } = useApp()
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [liveState, setLiveState] = useState<'off' | 'starting' | 'ready' | 'denied'>('off')
  const [, setTick] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const launchedRef = useRef(false)
  const busyRef = useRef(false)



  const isOcr = draft.cameraMode === 'ocr'
  const isSelfie = draft.cameraMode === 'selfie'
  const retake = draft.retakeTarget
  const returnTo: MobileScreen = isSelfie
    ? (draft.cameraReturn ?? 'trip-summary')
    : retake
      ? 'history-detail'
      : draft.cameraReturn ?? (isOcr ? 'vehicle-form' : (draft.cameraFrom || 'vehicle-form'))
  const title = isOcr
    ? 'Scan Plat Nomor'
    : isSelfie
      ? 'Swafoto Petugas'
      : retake
        ? (retake.kind === 'trip' ? 'Ulangi Foto Bukti Trip' : 'Ulangi Foto Kendaraan')
        : (returnTo === 'trip-summary' || returnTo === 'route-select'
          ? (draft.condition === 'kosong' ? 'Foto Bukti Kapal Kosong' : 'Foto Bukti Trip')
          : 'Foto Bukti Muatan')
  const regionLabel = officer?.region || ''



  useEffect(() => {
    const id = window.setInterval(() => setTick(v => v + 1), 1000)
    return () => window.clearInterval(id)
  }, [])



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
        video: { facingMode: { ideal: isSelfie ? 'user' : 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {  })
      }
      setLiveState('ready')
    } catch {
      setLiveState('denied')
      if (isSelfie) {
        setErrorMsg('Kamera depan tidak tersedia — pastikan izin kamera diberikan')
      } else if (!Capacitor.isNativePlatform()) {
        setErrorMsg('Kamera tidak tersedia')
      }
    }
  }



  useEffect(() => {
    if (launchedRef.current) return
    launchedRef.current = true
    if (Capacitor.isNativePlatform() && !isSelfie) {
      void openNativeCamera()
    } else {
      void startStream()
    }
    return () => stopStream()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])



  useEffect(() => {
    const v = videoRef.current
    if (liveState === 'ready' && v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current
      void v.play().catch(() => {  })
    }
  }, [liveState])



  const snapshotFromCanvas = (): string | null => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const cv = document.createElement('canvas')
    cv.width = v.videoWidth; cv.height = v.videoHeight
    cv.getContext('2d')?.drawImage(v, 0, 0)
    return cv.toDataURL('image/jpeg', 0.7)
  }



  // ponytail: watermark + resize + kompresi sekarang SATU canvas pass (lihat services/imageUtil.ts).
  const processPhoto = (
    dataUrl: string,
    lat: number | null,
    lon: number | null,
    capturedAt: Date,
  ): Promise<string> =>
    compressImage(dataUrl, {
      maxEdge: DOC_MAX_EDGE,
      quality: DOC_QUALITY,
      watermark: { capturedAt, lat, lon, region: regionLabel },
    })



  const deliver = async (rawDataUrl: string) => {
    const capturedAt = new Date()
    setBusy(true)

    // GPS: pakai fix cache kalau ada (hampir instan), fallback request singkat. Tidak pernah menahan proses lebih dari ~2.5 detik.
    const { lat, lon } = await getPhotoPosition()

    if (isOcr) {
      // OCR butuh resolusi lebih tinggi — downscale ke 1280 (bukan 640).
      const ocrSource = await compressImage(rawDataUrl, {
        maxEdge: OCR_MAX_EDGE,
        quality: OCR_QUALITY,
      })
      try {
        const plate = await readPlateFromImage(ocrSource)
        if (plate) patchDraft({ ocrResult: plate })
      } catch { /* OCR gagal — biarkan petugas isi manual */ }
      setBusy(false)
      patchDraft({ cameraReturn: undefined })
      go('vehicle-form')
      return
    }

    const watermarked = await processPhoto(rawDataUrl, lat, lon, capturedAt)



    const capturedIso = capturedAt.toISOString()

    if (retake) {
      if (retake.kind === 'vehicle') {
        patchVehiclePhoto(retake.tripId, retake.index ?? 0, {
          photoUrl: watermarked,
          photoCapturedAt: capturedIso,
          photoLatitude: lat,
          photoLongitude: lon,
        })
      } else {
        patchTripPhoto(retake.tripId, {
          photo: true,
          photoUrl: watermarked,
          photoCapturedAt: capturedIso,
          photoLatitude: lat,
          photoLongitude: lon,
        })
      }



      patchDraft({ retakeTarget: undefined })
      setBusy(false)
      go('history-detail')
      return
    }



    if (isSelfie) {
      patchDraft({
        selfieUrl: watermarked,
        selfieCapturedAt: capturedIso,
        cameraReturn: undefined,
      })
      setBusy(false)
      go(returnTo)
      return
    }



    if (draft.cameraFrom === 'vehicle-form') {
      patchDraft({
        vPhoto: true,
        vPhotoUrl: watermarked,
        vPhotoCapturedAt: capturedIso,
        vPhotoLatitude: lat,
        vPhotoLongitude: lon,
        cameraReturn: undefined,
      })
    } else {
      patchDraft({
        photo: true,
        photoUrl: watermarked,
        photoCapturedAt: capturedIso,
        photoLatitude: lat,
        photoLongitude: lon,
        cameraReturn: undefined,
      })
    }
    setBusy(false)
    go(returnTo)
  }



  async function openNativeCamera() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setErrorMsg('')
    try {
      const image = await CapCamera.getPhoto({
        // ponytail: kualitas kamera TIDAK perlu HD untuk foto dokumentasi.
        quality: isOcr ? 60 : 30,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      })



      if (image?.dataUrl) {
        busyRef.current = false
        await deliver(image.dataUrl)
        return
      }



      busyRef.current = false
      setBusy(false)
      go(returnTo)
    } catch (err) {
      busyRef.current = false
      setBusy(false)
      const msg = String((err as Error)?.message ?? err)
      if (/cancel|batal/i.test(msg)) {
        go(returnTo)
        return
      }



      console.warn('[camera] native gagal', err)
      await startStream()
      setErrorMsg('Kamera tidak terbuka — ketuk tombol untuk mencoba lagi')
    }
  }



  const handleCapture = async () => {
    if (busy) return
    setErrorMsg('')

    if (Capacitor.isNativePlatform() && !isSelfie) {
      await openNativeCamera()
      return
    }



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
