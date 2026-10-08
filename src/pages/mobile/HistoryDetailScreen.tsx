import { useState, useEffect } from 'react'
import { ChevronLeft, Camera, ImageOff, Wifi, WifiOff, Cloud, CloudOff, AlertTriangle, X, RefreshCcw, Pencil } from 'lucide-react'
import { unitLabel, useApp, type VehicleEntry } from '../store'
import { getSyncQueue, onSyncQueueChange } from '../../services/sync'
import type { MobileScreen } from '../types'

// ─── Connection Indicator ────────────────────────────────────────────────────────
function ConnectionIndicator() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all ${
      isOnline
        ? 'bg-emerald-50 text-emerald-600'
        : 'bg-slate-100 text-slate-500'
    }`}>
      {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
      {isOnline ? 'Online' : 'Offline'}
    </div>
  )
}

// ─── History Detail Screen ─────────────────────────────────────────────────────
interface HistoryDetailScreenProps {
  go: (s: MobileScreen) => void
}

/** Satu item dokumentasi: foto trip ATAU foto satu kendaraan. */
interface DocPhoto {
  url: string
  label: string
  kind: 'trip' | 'vehicle'
  index?: number
}

export default function HistoryDetailScreen({ go }: HistoryDetailScreenProps) {
  const { trips, detailTripId, officer, patchDraft, patchVehiclePhoto } = useApp()
  // Scope to this officer's trips — never leak another officer's trip detail
  const myTrips = trips.filter(x => x.officerId ? String(x.officerId) === String(officer.id) : x.officer === officer.name)
  const t = myTrips.find(x => x.id === detailTripId) ?? myTrips[0]
  const isSynced = t?.synced === true

  // Re-render saat isi antrean berubah (mis. foto diperbaiki → status macet lepas)
  const [, setQueueTick] = useState(0)
  useEffect(() => onSyncQueueChange(() => setQueueTick(x => x + 1)), [])

  const queue = getSyncQueue()
  const queueItem = t ? queue.find(q => q.trip.id === t.id) : undefined
  const inQueue = !!queueItem
  const photoStuck = !!queueItem?.needsAttention && /foto/i.test(queueItem.lastError ?? '')

  // Preview lightbox dokumentasi
  const [preview, setPreview] = useState<DocPhoto | null>(null)

  // Edit info kendaraan (plat/jenis/kategori) pada trip yang SUDAH terkirim.
  // Menyimpan → patchVehiclePhoto → antrean lokal → otomatis dikirim ulang
  // (backend memperbarui trip berdasarkan clientTripId, bukan membuat duplikat).
  const [editVehicle, setEditVehicle] = useState<number | null>(null)
  const [editPlate, setEditPlate] = useState('')
  const [editType, setEditType] = useState('')
  const [editCategory, setEditCategory] = useState('')

  if (!t) {
    return (
      <div className="px-4 pt-2 pb-4">
        <button onClick={() => go('history')} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
          <ChevronLeft size={16} /> Riwayat
        </button>
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 text-center">
          <p className="text-[13px] font-bold text-slate-700">Belum ada trip</p>
          <p className="text-[11px] text-slate-400 mt-1">Trip yang Anda catat akan muncul di sini</p>
        </div>
      </div>
    )
  }

  const realVehicles = t.vehicles && t.vehicles.length > 0 ? t.vehicles : undefined
  const vehicles: VehicleEntry[] = realVehicles
    ?? [{ plate: t.vehicle, type: t.type, category: t.category, tariff: t.revenueNum }]

  // ── SELURUH foto dokumentasi trip ini — 1 foto bukti trip + 1 foto PER kendaraan
  const photos: DocPhoto[] = [
    ...(t.photoUrl ? [{ url: t.photoUrl, label: 'Foto Bukti Trip', kind: 'trip' as const }] : []),
    ...vehicles.map((v, i) => ({
      url: v.photoUrl ?? '',
      label: unitLabel(vehicles, i),
      kind: 'vehicle' as const,
      index: i,
    })).filter(p => !!p.url),
  ]
  const missingVehicles = vehicles
    .map((v, i) => ({ i, label: unitLabel(vehicles, i), hasPhoto: !!v.photoUrl }))
    .filter(x => !x.hasPhoto)

  const retakePhoto = (kind: 'trip' | 'vehicle', index?: number) => {
    patchDraft({
      retakeTarget: { tripId: t.id, kind, index },
      cameraMode: 'photo',
      cameraFrom: 'vehicle-form',
    })
    go('camera')
  }

  return (
    <div className="px-4 pt-2 pb-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => go('history')} className="flex items-center gap-1.5 text-slate-500 text-[13px] hover:text-slate-700 font-medium">
          <ChevronLeft size={16} /> Riwayat
        </button>
        <ConnectionIndicator />
      </div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-mono text-[11px] text-slate-400">{t.id}</p>
          <h2 className="font-black text-slate-900 text-[18px]">{t.route}</h2>
        </div>
        <span className="text-[11px] font-bold bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-full">{t.status}</span>
      </div>

      {/* Info Card */}
      <div className="bg-[#0F172A] rounded-3xl p-5 mb-4">
        <div className="grid grid-cols-2 gap-4">
          {[{ l: 'Tanggal', v: t.date }, { l: 'Jam Mulai', v: t.time }, { l: 'Durasi', v: t.duration }, { l: 'Petugas', v: t.officer }].map(({ l, v }) => (
            <div key={l}><p className="text-slate-500 text-[10px] mb-0.5">{l}</p><p className="text-white font-semibold text-[12px]">{v}</p></div>
          ))}
        </div>
      </div>

      {/* Kendaraan + foto per unit */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-3">
        <p className="text-[11px] font-bold text-slate-500 mb-3 uppercase tracking-wide">Detail Kendaraan ({vehicles.length})</p>
        {vehicles.map((v, i) => {
          const label = unitLabel(vehicles, i)
          const canRetake = !!realVehicles?.[i]
          const editing = editVehicle === i
          return (
            <div key={`${v.plate}-${i}`} className={`${i > 0 ? 'pt-3 mt-3 border-t border-slate-100' : ''}`}>
              <div className="flex items-center gap-3">
                {v.photoUrl ? (
                  <button onClick={() => setPreview({ url: v.photoUrl!, label, kind: 'vehicle', index: i })} className="shrink-0" title={`Lihat foto ${label}`}>
                    <img src={v.photoUrl} alt={`Foto ${label}`} className="w-10 h-10 rounded-xl object-cover border border-slate-200" />
                  </button>
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-amber-50 border border-dashed border-amber-300 flex items-center justify-center shrink-0">
                    <ImageOff size={16} className="text-amber-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-black uppercase bg-slate-800 text-white px-1.5 py-0.5 rounded">{label}</span>
                    <p className="font-mono text-[12px] font-black text-slate-900">{v.plate}</p>
                  </div>
                  <p className="text-[10px] text-slate-400">{v.type} · {v.category}</p>
                </div>
                {!editing && canRetake && (
                  <div className="flex flex-col gap-1 shrink-0">
                    {!v.photoUrl && (
                      <button
                        onClick={() => retakePhoto('vehicle', i)}
                        className="flex items-center gap-1 text-[10px] font-black text-amber-700 bg-amber-100 rounded-lg px-2.5 py-1.5"
                      >
                        <Camera size={11} /> Foto
                      </button>
                    )}
                    <button
                      onClick={() => { setEditVehicle(i); setEditPlate(v.plate); setEditType(v.type); setEditCategory(v.category) }}
                      className="flex items-center gap-1 text-[10px] font-black text-slate-600 bg-slate-100 rounded-lg px-2.5 py-1.5"
                    >
                      <Pencil size={11} /> Ubah
                    </button>
                  </div>
                )}
              </div>

              {/* Form edit info kendaraan — perubahan otomatis dikirim ulang ke server */}
              {editing && (
                <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
                  <input
                    value={editPlate}
                    onChange={e => setEditPlate(e.target.value.toUpperCase())}
                    placeholder="Plat nomor"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[13px] font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={editType}
                      onChange={e => setEditType(e.target.value)}
                      placeholder="Jenis (Truk/Mobil/Motor)"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <input
                      value={editCategory}
                      onChange={e => setEditCategory(e.target.value)}
                      placeholder="Golongan"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (!t || !realVehicles?.[i] || !editPlate.trim()) return
                        patchVehiclePhoto(t.id, i, { plate: editPlate.trim(), type: editType.trim() || v.type, category: editCategory.trim() || v.category })
                        setEditVehicle(null)
                      }}
                      className="flex-1 rounded-lg bg-blue-600 text-white text-[12px] font-bold py-2 hover:bg-blue-700 active:scale-[0.98]"
                    >
                      Simpan & Kirim
                    </button>
                    <button
                      onClick={() => setEditVehicle(null)}
                      className="rounded-lg bg-white border border-slate-200 text-slate-600 text-[12px] font-bold px-4 py-2"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Galeri dokumentasi — semua foto (trip + per kendaraan) */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
            Foto Dokumentasi ({photos.length})
          </p>
          {t.photo && !t.photoUrl && (
            <button
              onClick={() => retakePhoto('trip')}
              className="flex items-center gap-1 text-[10px] font-black text-amber-700 bg-amber-100 rounded-lg px-2.5 py-1.5"
            >
              <Camera size={11} /> Ambil Foto Trip
            </button>
          )}
        </div>

        {photoStuck && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-3 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-snug">
              Foto dokumentasi belum lengkap{missingVehicles.length > 0 && (
                <>: <b>{missingVehicles.map(x => x.label).join(', ')}</b></>
              )} — ambil fotonya, antrean otomatis dikirim ulang.
            </p>
          </div>
        )}

        {photos.length === 0 ? (
          <div className="rounded-xl bg-slate-50 py-8 text-center">
            <Camera size={26} className="mx-auto text-slate-300 mb-2" />
            <p className="text-[11px] text-slate-400">Belum ada foto dokumentasi tersimpan</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {photos.map((p, i) => (
              <button
                key={`${p.kind}-${p.index ?? 'trip'}-${i}`}
                onClick={() => setPreview(p)}
                className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 text-left active:scale-[0.98] transition-transform"
              >
                <img src={p.url} alt={p.label} className="w-full h-28 object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent px-2 py-1.5">
                  <span className="block text-white text-[10px] font-black uppercase truncate">{p.label}</span>
                </span>
              </button>
            ))}
            {/* Slot kosong: kendaraan tanpa foto → ajakan ambil */}
            {missingVehicles.map(x => (
              <button
                key={`missing-${x.i}`}
                onClick={() => realVehicles?.[x.i] && retakePhoto('vehicle', x.i)}
                className="h-28 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 flex flex-col items-center justify-center gap-1.5"
              >
                <Camera size={18} className="text-amber-500" />
                <span className="text-[10px] font-black text-amber-700 uppercase">{x.label} — Belum ada foto</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox dokumentasi */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <button onClick={() => setPreview(null)} aria-label="Tutup pratinjau" className="absolute top-4 right-4 p-3 rounded-full bg-white/10 text-white">
            <X size={20} />
          </button>
          <div className="max-w-full flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
            <img src={preview.url} alt={preview.label} className="max-w-full max-h-[70vh] object-contain rounded-lg" />
            <p className="text-white text-[12px] font-black uppercase text-center">{preview.label} · {t.id}</p>
            <button
              onClick={() => { const p = preview; setPreview(null); retakePhoto(p.kind, p.index) }}
              className="flex items-center gap-1.5 text-[11px] font-black text-white bg-white/15 hover:bg-white/25 rounded-full px-4 py-2"
            >
              <RefreshCcw size={12} /> Ambil Ulang
            </button>
          </div>
        </div>
      )}

      {/* Sync Status */}
      <div className={`rounded-2xl p-4 flex items-center gap-3 border ${isSynced ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isSynced ? 'bg-emerald-100' : 'bg-amber-100'}`}>
          {isSynced
            ? <Cloud size={16} className="text-emerald-500" strokeWidth={2.5} />
            : <CloudOff size={16} className="text-amber-500" strokeWidth={2.5} />}
        </div>
        <div className="flex-1">
          <p className={`text-[12px] font-bold ${isSynced ? 'text-emerald-700' : 'text-amber-700'}`}>
            {isSynced ? 'Berhasil terkirim ke Server' : 'Masih menunggu koneksi, tersimpan di lokal'}
          </p>
          <p className={`text-[10px] ${isSynced ? 'text-emerald-600' : 'text-amber-600'}`}>
            {isSynced
              ? `Data berhasil dikirim ke server · ${t.date}`
              : photoStuck
                ? (queueItem?.lastError ?? 'Menunggu foto dokumentasi dilengkapi…')
                : inQueue
                  ? 'Menunggu koneksi untuk mengirim...'
                  : 'Data aman tersimpan di perangkat'}
          </p>
        </div>
      </div>

      {/* Connection Info */}
      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 mt-3">
        <p className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wide">Status Koneksi</p>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${navigator.onLine ? 'bg-emerald-100' : 'bg-slate-200'}`}>
            {navigator.onLine
              ? <Wifi size={14} className="text-emerald-500" />
              : <WifiOff size={14} className="text-slate-500" />}
          </div>
          <div>
            <p className={`text-[12px] font-semibold ${navigator.onLine ? 'text-emerald-700' : 'text-slate-500'}`}>
              {navigator.onLine ? 'Terhubung ke server' : 'Tidak terhubung'}
            </p>
            <p className="text-[10px] text-slate-400">
              {navigator.onLine
                ? 'Data trip akan otomatis dikirim ke admin'
                : 'Data trip tersimpan di lokal, otomatis terkirim saat online'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
