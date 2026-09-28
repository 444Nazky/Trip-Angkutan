import { X, Camera } from 'lucide-react'

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

export function PhotoViewer({ photos, onClose, baseUrl = '' }: PhotoViewerProps) {
  const getSrc = (url: string) => url.startsWith('http') ? url : `${baseUrl}${url}`

  if (photos.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4">
        {photos.map(photo => (
          <div key={photo.id} className="relative aspect-video bg-slate-100 rounded-xl overflow-hidden">
            <img
              src={getSrc(photo.url)}
              alt={photo.caption || 'Foto dokumentasi'}
              className="w-full h-full object-cover"
              onError={e => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.parentElement!.innerHTML = '<div class="flex items-center justify-center h-full text-slate-400 text-xs">Gagal memuat</div>'
              }}
            />
            {photo.caption && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                <p className="text-white text-xs font-medium truncate">{photo.caption}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
