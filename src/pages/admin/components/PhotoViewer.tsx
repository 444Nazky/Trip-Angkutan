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

      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
        <div>
          <p className="font-bold text-slate-800">Foto Dokumentasi</p>
          <p className="text-xs text-slate-500">{photos.length} foto</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-200 text-slate-500 transition-colors">
          <X size={20} />
        </button>
      </div>


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


      {lightboxPhoto && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-6 animate-fadeIn"
          onClick={() => setLightboxPhoto(null)}
        >

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxPhoto(null) }}
            className="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all duration-200 hover:scale-110"
          >
            <X size={22} />
          </button>


          <div
            className="max-w-[90vw] max-h-[85vh] flex flex-col items-center animate-scaleIn"
            onClick={e => e.stopPropagation()}
          >
            <img
              src={getSrc(lightboxPhoto.url)}
              alt={lightboxPhoto.caption || 'Foto'}
              className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
            />
            {lightboxPhoto.caption && (
              <p className="text-white/90 text-sm text-center mt-4 max-w-[90vw]">{lightboxPhoto.caption}</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
