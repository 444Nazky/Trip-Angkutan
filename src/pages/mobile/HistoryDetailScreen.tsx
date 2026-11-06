import { useState, useEffect } from 'react'
import { ChevronLeft, Camera, ImageOff, Cloud, CloudOff, AlertTriangle, Ban, X, Info } from 'lucide-react'
import { unitLabel, useApp, type VehicleEntry } from '../store'
import { classifyTripSync, onSyncQueueChange, type SyncItem } from '../../services/sync'
import {
  onCancelQueueChange,
  readDeliveredCancels,
  type CancelQueueItem,
  type DeliveredCancel,
} from '../../services/tripCancel'
import type { MobileScreen } from '../types'




interface HistoryDetailScreenProps {
  go: (s: MobileScreen) => void
}




interface DocPhoto {
  url: string
  label: string
  kind: 'trip' | 'vehicle' | 'selfie'
  index?: number
}




export default function HistoryDetailScreen({ go }: HistoryDetailScreenProps) {
  const { trips, detailTripId, officer } = useApp()
  const myTrips = trips.filter(x => x.officerId ? String(x.officerId) === String(officer.id) : x.officer === officer.name)
  const t = myTrips.find(x => x.id === detailTripId) ?? myTrips[0]

  const [queue, setQueue] = useState<SyncItem[]>([])
  useEffect(() => onSyncQueueChange((_n, q) => setQueue(q)), [])

  // Dokumen pembatalan punya antrean SENDIRI dan tidak pernah mengubah
  // `trip.synced`. Status pembatalan karena itu dibaca dari antrean
  // pembatalan + bukti kirim dari server, bukan dari status trip.
  const [cancelQueue, setCancelQueue] = useState<CancelQueueItem[]>([])
  useEffect(() => onCancelQueueChange(setCancelQueue), [])
  const [deliveredCancels, setDeliveredCancels] = useState<Record<string, DeliveredCancel>>({})
  useEffect(() => {
    let alive = true
    void readDeliveredCancels().then(map => { if (alive) setDeliveredCancels(map) })
    return () => { alive = false }
  }, [cancelQueue])

  // Status jujur: 'failed' = server menolak (merah), bukan sekadar "menunggu".
  const syncStatus = t ? classifyTripSync(t.id, t.synced, queue) : undefined
  const isSynced = syncStatus?.state === 'synced'
  const sendFailed = syncStatus?.state === 'failed'
  const queueItem = syncStatus?.item
  const inQueue = !!queueItem
  const photoStuck = !!queueItem?.needsAttention && /foto/i.test(queueItem.lastError ?? '')

  const [preview, setPreview] = useState<DocPhoto | null>(null)

  // Foto yang gagal dimuat (data URL rusak / gambar tidak bisa didekode WebView).
  // Diperlakukan sama seperti foto yang belum ada: placeholder + tombol ambil
  // ulang, bukan thumbnail rusak atau hitungan foto yang menipu.
  const [broken, setBroken] = useState<Record<string, true>>({})
  const usableUrl = (url?: string): string | undefined => (url && !broken[url] ? url : undefined)
  const markBroken = (url: string) => setBroken(b => (b[url] ? b : { ...b, [url]: true }))

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
  const isEmptyTrip = !realVehicles

  const vehicles: VehicleEntry[] = realVehicles
    ?? [{ plate: t.vehicle, type: t.type, category: t.category, tariff: t.revenueNum }]

  const tripPhotoUrl = usableUrl(t.photoUrl)
  const selfieUrl = usableUrl(t.selfieUrl)

  const photos: DocPhoto[] = isEmptyTrip
    ? [
        ...(tripPhotoUrl ? [{ url: tripPhotoUrl, label: 'Foto Bukti Kapal Kosong', kind: 'trip' as const }] : []),
        ...(selfieUrl ? [{ url: selfieUrl, label: 'Swafoto Petugas', kind: 'selfie' as const }] : []),
      ]
    : [
        ...(tripPhotoUrl ? [{ url: tripPhotoUrl, label: 'Foto Bukti Trip', kind: 'trip' as const }] : []),
        ...vehicles.map((v, i) => ({
          url: usableUrl(v.photoUrl) ?? '',
          label: unitLabel(vehicles, i),
          kind: 'vehicle' as const,
          index: i,
        })).filter(p => !!p.url),
        ...(selfieUrl ? [{ url: selfieUrl, label: 'Swafoto Petugas', kind: 'selfie' as const }] : []),
      ]

  const missingVehicles = isEmptyTrip
    ? []
    : vehicles
        .map((v, i) => ({ i, label: unitLabel(vehicles, i), hasPhoto: !!usableUrl(v.photoUrl) }))
        .filter(x => !x.hasPhoto)

  const brokenCount = Object.keys(broken).length


  const cancelItem = t.cancelId ? cancelQueue.find(i => i.cancelId === t.cancelId) : undefined
  const cancelDelivered = t.cancelId ? deliveredCancels[t.cancelId] : undefined
  const cancelState: 'sent' | 'failed' | 'pending' = cancelItem
    ? (cancelItem.lastErrorCode ? 'failed' : 'pending')
    : cancelDelivered
      ? 'sent'
      : 'pending'


  return (
    <div className="px-4 pt-2 pb-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => go('history')} className="flex items-center gap-1.5 text-slate-500 text-[13px] hover:text-slate-700 font-medium">
          <ChevronLeft size={16} /> Riwayat
        </button>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-mono text-[11px] text-slate-400">{t.id}</p>
          <h2 className="font-black text-slate-900 text-[18px]">{t.route}</h2>
        </div>
        <span className={`text-[11px] font-bold px-3 py-1.5 rounded-full ${
          isEmptyTrip ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-700'
        }`}>
          {isEmptyTrip ? 'Kosong' : 'Ada Muatan'}
        </span>
      </div>

      {t.canceled && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2">
            <Ban size={15} className="text-red-500" />
            <p className="text-[12px] font-bold text-red-700">Trip Dibatalkan</p>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-red-700/90">
            alasan = {t.cancelReason || '-'}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-red-600/80">
            {cancelState === 'sent'
              ? 'Dokumen pembatalan sudah diterima server kantor sebagai bukti pembatalan trip ini.'
              : cancelState === 'failed'
                ? 'Dokumen pembatalan BELUM diterima server kantor — lihat status di bawah.'
                : 'Dokumen pembatalan akan dikirim otomatis begitu tersambung ke server kantor.'}
          </p>
        </div>
      )}

      {/* Info Card */}
      <div className="bg-[#0F172A] rounded-3xl p-5 mb-4">
        <div className="grid grid-cols-2 gap-4">
          {[{ l: 'Tanggal', v: t.date }, { l: 'Jam Mulai', v: t.time }, { l: 'Durasi', v: t.duration }, { l: 'Petugas', v: t.officer }].map(({ l, v }) => (
            <div key={l}><p className="text-slate-500 text-[10px] mb-0.5">{l}</p><p className="text-white font-semibold text-[12px]">{v}</p></div>
          ))}
        </div>
      </div>

      {/* ── Detail Kendaraan (HANYA untuk Trip Muatan) ── */}
      {!isEmptyTrip && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-3">
          <p className="text-[11px] font-bold text-slate-500 mb-3 uppercase tracking-wide">Detail Kendaraan ({vehicles.length})</p>
          {vehicles.map((v, i) => {
            const label = unitLabel(vehicles, i)
            const photoUrl = usableUrl(v.photoUrl)
            return (
              <div key={`${v.plate}-${i}`} className={`${i > 0 ? 'pt-3 mt-3 border-t border-slate-100' : ''}`}>
                <div className="flex items-center gap-3">
                  {photoUrl ? (
                    <button onClick={() => setPreview({ url: photoUrl, label, kind: 'vehicle', index: i })} className="shrink-0" title={`Lihat foto ${label}`}>
                      <img src={photoUrl} alt={`Foto ${label}`} loading="lazy" decoding="async" onError={() => markBroken(v.photoUrl!)} className="w-10 h-10 rounded-xl object-cover border border-slate-200" />
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
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Galeri Foto Dokumentasi (HANYA tampilkan yang valid) ── */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
            {isEmptyTrip ? 'Foto Bukti Kondisi Kapal' : `Foto Dokumentasi (${photos.length})`}
          </p>
        </div>

        {(missingVehicles.length > 0 || (t.photo && !tripPhotoUrl)) && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-3 flex items-start gap-2">
            <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-600 leading-snug">
              Foto dokumentasi tidak dapat ditambah lagi — trip yang sudah selesai bersifat final,
              {' '}{isSynced ? 'dan datanya sudah tersimpan di server.' : 'meskipun datanya belum sempat terkirim.'}
            </p>
          </div>
        )}

        {photoStuck && !isEmptyTrip && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-3 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-snug">
              Foto dokumentasi belum lengkap{missingVehicles.length > 0 && (
                <>: <b>{missingVehicles.map(x => x.label).join(', ')}</b></>
              )} — trip sudah selesai dan tidak bisa diedit lagi, jadi data ini belum bisa
              dikirim ke server. Hubungi admin kantor.
            </p>
          </div>
        )}

        {brokenCount > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-3 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-snug">
              {brokenCount} foto tidak dapat dimuat dari penyimpanan perangkat — ambil ulang
              fotonya supaya trip terkirim lengkap ke server.
            </p>
          </div>
        )}

        {photos.length === 0 ? (
          <div className="rounded-xl bg-slate-50 py-8 text-center">
            <Camera size={26} className="mx-auto text-slate-300 mb-2" />
            <p className="text-[11px] text-slate-400">
              {brokenCount > 0 ? 'Foto tidak dapat dimuat dari perangkat' : 'Belum ada foto dokumentasi tersimpan'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {photos.map((p, i) => (
              <button
                key={`${p.kind}-${p.index ?? 'trip'}-${i}`}
                onClick={() => setPreview(p)}
                className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 text-left active:scale-[0.98] transition-transform"
              >
                <img src={p.url} alt={p.label} loading="lazy" decoding="async" onError={() => markBroken(p.url)} className="w-full h-28 object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent px-2 py-1.5">
                  <span className="block text-white text-[10px] font-black uppercase truncate">{p.label}</span>
                </span>
              </button>
            ))}
            {/* Slot kosong untuk kendaraan tanpa foto (HANYA untuk trip muatan) */}
            {!isEmptyTrip && missingVehicles.map(x => (
              <div
                key={`missing-${x.i}`}
                className="h-28 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-1.5"
              >
                <Camera size={18} className="text-slate-300" />
                <span className="text-[10px] font-black text-slate-400 uppercase">{x.label} — Tanpa foto</span>
              </div>
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
            <img src={preview.url} alt={preview.label} onError={() => { markBroken(preview.url); setPreview(null) }} className="max-w-full max-h-[70vh] object-contain rounded-lg" />
            <p className="text-white text-[12px] font-black uppercase text-center">{preview.label} - {t.id}</p>
          </div>
        </div>
      )}

      {/* Status: trip yang dibatalkan tidak lagi memakai status antrean trip —
          yang dikirim ke server adalah dokumen pembatalan. */}
      {t.canceled ? (
        <div className={`rounded-2xl p-4 flex items-center gap-3 border ${
          cancelState === 'failed'
            ? 'bg-red-50 border-red-200'
            : cancelState === 'sent'
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-amber-50 border-amber-200'
        }`}>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
            cancelState === 'failed' ? 'bg-red-100' : cancelState === 'sent' ? 'bg-emerald-100' : 'bg-amber-100'
          }`}>
            {cancelState === 'failed'
              ? <AlertTriangle size={16} className="text-red-500" strokeWidth={2.5} />
              : cancelState === 'sent'
                ? <Cloud size={16} className="text-emerald-500" strokeWidth={2.5} />
                : <CloudOff size={16} className="text-amber-500" strokeWidth={2.5} />}
          </div>
          <div className="flex-1">
            <p className={`text-[12px] font-bold ${
              cancelState === 'failed' ? 'text-red-700' : cancelState === 'sent' ? 'text-emerald-700' : 'text-amber-700'
            }`}>
              {cancelState === 'failed'
                ? 'Dokumen pembatalan ditolak server'
                : cancelState === 'sent'
                  ? 'Pembatalan trip berhasil terkirim'
                  : 'Pembatalan trip menunggu koneksi, tersimpan di lokal'}
            </p>
            <p className={`text-[10px] ${
              cancelState === 'failed' ? 'text-red-600' : cancelState === 'sent' ? 'text-emerald-600' : 'text-amber-600'
            }`}>
              {cancelState === 'failed'
                ? `${cancelItem?.lastError ?? 'Server menolak dokumen pembatalan'}${cancelItem?.attempts ? ` · percobaan ${cancelItem.attempts}` : ''} — belum masuk dashboard admin`
                : cancelState === 'sent'
                  ? `Dokumen pembatalan diterima server kantor${cancelDelivered?.noCancel ? ` · ${cancelDelivered.noCancel}` : ''} · ${t.date}`
                  : cancelItem?.lastError
                    ? `${cancelItem.lastError} — otomatis dicoba lagi saat koneksi pulih`
                    : 'Dokumen pembatalan aman tersimpan di perangkat dan dikirim otomatis'}
            </p>
          </div>
        </div>
      ) : (
      <div className={`rounded-2xl p-4 flex items-center gap-3 border ${
        sendFailed
          ? 'bg-red-50 border-red-200'
          : isSynced
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'
      }`}>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
          sendFailed ? 'bg-red-100' : isSynced ? 'bg-emerald-100' : 'bg-amber-100'
        }`}>
          {sendFailed
            ? <AlertTriangle size={16} className="text-red-500" strokeWidth={2.5} />
            : isSynced
              ? <Cloud size={16} className="text-emerald-500" strokeWidth={2.5} />
              : <CloudOff size={16} className="text-amber-500" strokeWidth={2.5} />}
        </div>
        <div className="flex-1">
          <p className={`text-[12px] font-bold ${
            sendFailed ? 'text-red-700' : isSynced ? 'text-emerald-700' : 'text-amber-700'
          }`}>
            {sendFailed
              ? 'Gagal terkirim ke server'
              : isSynced
                ? 'Data trip berhasil terkirim'
                : 'Masih menunggu koneksi, tersimpan di lokal'}
          </p>
          <p className={`text-[10px] ${
            sendFailed ? 'text-red-600' : isSynced ? 'text-emerald-600' : 'text-amber-600'
          }`}>
            {sendFailed
              ? `${syncStatus?.error ?? 'Server menolak data trip'}${syncStatus?.attempts ? ` · percobaan ${syncStatus.attempts}` : ''} — data BELUM masuk dashboard admin`
              : isSynced
                ? `Data berhasil dikirim ke ${t.syncedTarget ?? 'server'} · ${t.date}`
                : photoStuck
                  ? (queueItem?.lastError ?? 'Menunggu foto dokumentasi dilengkapi…')
                  : inQueue
                    ? 'Menunggu koneksi untuk mengirim...'
                    : 'Data aman tersimpan di perangkat'}
          </p>
        </div>
      </div>
      )}
    </div>
  )
}
