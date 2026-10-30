import { X, Camera } from 'lucide-react'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Photo {
  id: string
  url: string
  caption?: string
  uploaded_at?: string
}

interface PhotoViewerProps {
  photos: Photo[]
  onClose: () => void
  baseUrl?: string
}

export function resolvePhotoUrl(url: string, baseUrl = ''): string {
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  try {
    const backendOrigin = baseUrl ? new URL(baseUrl).origin : window.location.origin
    return new URL(url, `${backendOrigin}/`).toString()
  } catch {
    return `${baseUrl.replace(/\/api\/?$/, '')}${url}`
  }
}

export function PhotoViewer({ photos, onClose, baseUrl = '' }: PhotoViewerProps) {
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(() => photos.length === 1 ? photos[0] : null)
  const getSrc = (url: string) => resolvePhotoUrl(url, baseUrl)

  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxPhoto) setLightboxPhoto(null)
        else onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [lightboxPhoto, onClose])

  // Lock body scroll when lightbox open
  useEffect(() => {
    if (lightboxPhoto) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [lightboxPhoto])

  if (photos.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center shadow-sm">
        <Camera size={48} className="mx-auto text-slate-300 mb-3" />
        <p className="text-slate-500 font-semibold">Tidak ada foto dokumentasi</p>
        <p className="text-slate-400 text-sm mt-1">Foto dari mobile tampil di sini</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
        <div>
          <p className="font-bold text-slate-800">Foto Dokumentasi</p>
          <p className="text-xs text-slate-500">{photos.length} foto</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-200 text-slate-500 transition-colors">
          <X size={20} />
        </button>
      </div>

      {/* Photo Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 max-h-[70vh] overflow-y-auto">
        {photos.map(photo => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setLightboxPhoto(photo)}
            className="relative aspect-video bg-slate-100 rounded-xl overflow-hidden text-left focus:outline-none focus:ring-2 focus:ring-blue-500 transition-opacity duration-200 hover:opacity-80"
          >
            <img
              src={getSrc(photo.url)}
              alt={photo.caption || 'Foto dokumentasi'}
              className="w-full h-full object-cover"
              onError={e => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.parentElement!.classList.add('bg-slate-200')
              }}
            />
            {photo.caption && (
              <span className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
                <span className="block text-white text-xs font-medium truncate">{photo.caption}</span>
              </span>
            )}
          </button>
        ))}
      </div>

      {/*
        Lightbox dokumentasi.

        Dirender lewat portal ke <body> dan memakai z-index paling tinggi di
        aplikasi. Ini penting: panel foto (ReportsTab) juga sebuah layer fixed
        sendiri, jadi kalau lightbox memakai z-index yang sama, kartu putih
        panel bisa ikut terangkat dan menutupi foto yang sedang diperbesar.
        Portal juga memastikan lightbox tidak terperangkap di dalam kartu yang
        punya overflow-hidden / transform.
      */}
      {lightboxPhoto && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightboxPhoto.caption || 'Pratinjau foto dokumentasi'}
          className="fixed inset-0 z-[10000] overflow-y-auto bg-black/90 p-4 sm:p-6"
          onClick={() => setLightboxPhoto(null)}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxPhoto(null) }}
            aria-label="Tutup pratinjau foto"
            className="fixed top-4 right-4 sm:top-6 sm:right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all duration-200 hover:scale-110"
          >
            <X size={22} />
          </button>

          {/*
            Image container: flex center. `min-h-full` membuat gambar tetap di
            tengah layar saat muat, tapi tetap bisa di-scroll (tidak terpotong)
            ketika caption panjang / layar pendek.
          */}
          <div className="flex min-h-full w-full flex-col items-center justify-center gap-4">
            <img
              src={getSrc(lightboxPhoto.url)}
              alt={lightboxPhoto.caption || 'Foto'}
              onClick={e => e.stopPropagation()}
              className="block h-auto w-auto max-w-full max-h-[80vh] rounded-xl object-contain shadow-2xl"
            />
            {lightboxPhoto.caption && (
              <p
                onClick={e => e.stopPropagation()}
                className="max-w-[90vw] text-center text-sm text-white/90"
              >
                {lightboxPhoto.caption}
              </p>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
