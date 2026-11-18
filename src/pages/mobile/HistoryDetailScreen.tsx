import { useState, useEffect } from 'react'
import { ChevronLeft, Camera, ImageOff, Cloud, CloudOff, AlertTriangle, Ban, X, Info, Pencil, Plus, Send, Loader2 } from 'lucide-react'
import { fmtElapsed, unitLabel, useApp, type VehicleEntry, type Trip } from '../store'
import { validateTripEditForCurrentLocation } from '../../services/geofence'
import MobileModal from '../../components/MobileModal'
import TripAuthDialog from '../../components/TripAuthDialog'
import { classifyTripSync, onSyncQueueChange, syncTripNow, type SyncItem } from '../../services/sync'
import {
  onCancelQueueChange,
  readDeliveredCancels,
  type CancelQueueItem,
  type DeliveredCancel,
} from '../../services/tripCancel'
import type { MobileScreen } from '../types'




interface HistoryDetailScreenProps {
  go: (s: MobileScreen) => void
  /** Kembali ke layar asal (Beranda, antrean kirim, atau Riwayat). */
  onBack?: () => void
}




interface DocPhoto {
  url: string
  label: string
  kind: 'trip' | 'vehicle' | 'selfie' | 'proof'
  index?: number
}

/** Durasi mulai trip → trip dikirim, dihitung ulang untuk data lama. */
function durationText(t: Trip): string {
  const start = Date.parse(t.startedAt ?? '')
  const end = Date.parse(t.completedAt ?? '')
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return fmtElapsed(Math.floor((end - start) / 1000))
  }
  return t.duration && t.duration !== '-' ? t.duration : '-'
}




export default function HistoryDetailScreen({ go, onBack }: HistoryDetailScreenProps) {
  const { trips, detailTripId, officer, editTrip, patchDraft } = useApp()
  const back = onBack ?? (() => go('history'))
  const myTrips = trips.filter(x => x.officerId ? String(x.officerId) === String(officer.id) : x.officer === officer.name)
  const t = myTrips.find(x => x.id === detailTripId) ?? myTrips[0]
  const [editState, setEditState] = useState<'checking' | 'allowed' | 'blocked'>('checking')
  const [authAction, setAuthAction] = useState<'edit' | 'add-vehicle' | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // Edit hanya boleh dari titik awal trip. Di titik tujuan tombol edit tidak
  // ditampilkan sama sekali (bukan sekadar dinonaktifkan). Diperiksa berkala
  // supaya tombol hilang begitu petugas tiba di titik tujuan.
  useEffect(() => {
    let alive = true
    if (!t || t.canceled || !t.routeCode || !(t.vehicles && t.vehicles.length > 0)) {
      setEditState('blocked')
      return
    }
    const check = () => {
      void validateTripEditForCurrentLocation(t.routeCode!).then(result => {
        if (alive) setEditState(result.valid ? 'allowed' : 'blocked')
      }).catch(() => { if (alive) setEditState('blocked') })
    }
    setEditState('checking')
    check()
    const timer = window.setInterval(check, 20_000)
    window.addEventListener('focus', check)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [t?.id, t?.routeCode, t?.canceled])

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

  const sendNow = async () => {
    if (!t || sending) return
    setSending(true)
    setSendError(null)
    try {
      const result = await syncTripNow(t)
      if (!result.ok) setSendError(result.error ?? 'Trip belum diterima server.')
    } catch {
      setSendError('Pengiriman gagal. Periksa koneksi lalu coba lagi.')
    } finally {
      setSending(false)
    }
  }

  const startEdit = () => {
    if (!t || isSynced) return
    editTrip(t)
    go('trip-summary')
  }

  const startAddVehicle = () => {
    if (!t || isSynced) return
    editTrip(t)
    patchDraft({
      vehicleForm: { plate: '', type: '', category: '', load: 'loaded' },
      editVehicleIndex: null,
      vPhoto: false,
      vPhotoUrl: undefined,
      vPhotoCapturedAt: undefined,
      vPhotoLatitude: undefined,
      vPhotoLongitude: undefined,
      cameraFrom: 'vehicle-form',
      cameraMode: 'photo',
      cameraReturn: 'vehicle-form',
    })
    go('vehicle-form')
  }

  const confirmAuth = () => {
    const action = authAction
    if (action === 'edit') startEdit()
    else if (action === 'add-vehicle') startAddVehicle()
    setAuthAction(null)
  }

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
        <button onClick={back} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
          <ChevronLeft size={16} /> Kembali
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
  const proofUrl = usableUrl(t.proofUrl)

  const photos: DocPhoto[] = isEmptyTrip
    ? [
        ...(tripPhotoUrl ? [{ url: tripPhotoUrl, label: 'Foto Bukti Ponton Kosong', kind: 'trip' as const }] : []),
        ...(selfieUrl ? [{ url: selfieUrl, label: 'Swafoto Petugas', kind: 'selfie' as const }] : []),
        ...(proofUrl ? [{ url: proofUrl, label: 'Foto Bukti Ponton Kosong', kind: 'proof' as const }] : []),
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
        ...(proofUrl ? [{ url: proofUrl, label: 'Foto Bukti Muatan', kind: 'proof' as const }] : []),
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
        <button onClick={back} className="flex items-center gap-1.5 text-slate-500 text-[13px] hover:text-slate-700 font-medium">
          <ChevronLeft size={16} /> Kembali
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
          {isEmptyTrip ? 'Ponton tanpa muatan' : 'Ponton dengan muatan'}
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
              ? 'Bukti pembatalan sudah diterima server.'
              : cancelState === 'failed'
                ? 'Bukti pembatalan belum terkirim.'
                : 'Bukti pembatalan menunggu sinkron manual di Beranda.'}
          </p>
        </div>
      )}

      {editState === 'allowed' && !t.canceled && !isEmptyTrip && !isSynced && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            onClick={() => setAuthAction('edit')}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white py-2.5 text-[12px] font-bold text-slate-700"
          >
            <Pencil size={14} /> Edit Trip
          </button>
          <button
            onClick={() => setAuthAction('add-vehicle')}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-[#0F172A] py-2.5 text-[12px] font-bold text-white"
          >
            <Plus size={14} /> Tambah Kendaraan
          </button>
        </div>
      )}

      {!isSynced && !t.canceled && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
          <CloudOff size={17} className="shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold text-amber-800">Trip belum terkirim ke server</p>
            <p className="text-[10px] leading-relaxed text-amber-700">
              {sendError ?? 'Kirim sekarang agar data masuk ke dashboard admin.'}
            </p>
          </div>
          <button
            onClick={() => { void sendNow() }}
            disabled={sending}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-amber-600 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {sending ? 'Kirim…' : 'Kirim'}
          </button>
        </div>
      )}

      {/* Info Card */}
      <div className="bg-[#0F172A] rounded-3xl p-5 mb-4">
        <div className="grid grid-cols-2 gap-4">
          {[{ l: 'Tanggal', v: t.date }, { l: 'Jam Mulai', v: t.time }, { l: 'Durasi', v: durationText(t) }, { l: 'Petugas', v: t.officer }].map(({ l, v }) => (
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
                      <img src={photoUrl} alt={`Foto ${label}`} loading="lazy" decoding="async" onError={() => markBroken(v.photoUrl!)} className="h-16 w-16 rounded-xl object-cover border border-slate-200" />
                    </button>
                  ) : (
                    <div className="h-16 w-16 rounded-xl bg-amber-50 border border-dashed border-amber-300 flex items-center justify-center shrink-0">
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

      {/* ── Galeri Foto Kendaraan (HANYA tampilkan yang valid) ── */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
            {isEmptyTrip ? 'Foto Bukti Ponton Kosong' : `Foto Kendaraan (${photos.length})`}
          </p>
        </div>

        {(missingVehicles.length > 0 || (t.photo && !tripPhotoUrl)) && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-3 flex items-start gap-2">
            <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-600 leading-snug">
              Foto tidak bisa ditambah — trip sudah final.
              {' '}{isSynced ? 'Data tersimpan di server.' : 'Data belum terkirim.'}
            </p>
          </div>
        )}

        {photoStuck && !isEmptyTrip && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-3 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-snug">
              Foto belum lengkap{missingVehicles.length > 0 && (
                <>: <b>{missingVehicles.map(x => x.label).join(', ')}</b></>
              )} — trip sudah selesai. Data belum terkirim, hubungi admin.
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
              {brokenCount > 0 ? 'Foto tidak dapat dimuat dari perangkat' : 'Belum ada foto kendaraan tersimpan'}
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
                <img src={p.url} alt={p.label} loading="lazy" decoding="async" onError={() => markBroken(p.url)} className="w-full h-44 object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent px-2 py-1.5">
                  <span className="block text-white text-[10px] font-black uppercase truncate">{p.label}</span>
                </span>
              </button>
            ))}
            {/* Slot kosong untuk kendaraan tanpa foto (HANYA untuk trip muatan) */}
            {!isEmptyTrip && missingVehicles.map(x => (
              <div
                key={`missing-${x.i}`}
                className="h-44 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-1.5"
              >
                <Camera size={18} className="text-slate-300" />
                <span className="text-[10px] font-black text-slate-400 uppercase">{x.label} — Tanpa foto</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <TripAuthDialog
        open={authAction !== null}
        onClose={() => setAuthAction(null)}
        onVerified={confirmAuth}
        title={authAction === 'add-vehicle' ? 'Verifikasi Tambah Kendaraan' : 'Verifikasi Edit Trip'}
        subtitle="Sidik jari petugas yang terdaftar di HP ini wajib"
      />

      {/* Lightbox dokumentasi */}
      <MobileModal
        open={!!preview}
        onClose={() => setPreview(null)}
        overlayClassName="bg-black/90"
        panelClassName="max-w-4xl bg-transparent p-0 shadow-none"
      >
        {preview && (
          <div className="relative flex flex-col items-center gap-3 p-4">
            <button onClick={() => setPreview(null)} aria-label="Tutup pratinjau" className="absolute right-0 top-0 p-3 rounded-full bg-white/10 text-white">
              <X size={20} />
            </button>
            <img src={preview.url} alt={preview.label} onError={() => { markBroken(preview.url); setPreview(null) }} className="mt-12 max-h-[70dvh] max-w-full rounded-lg object-contain" />
            <p className="text-center text-[12px] font-black uppercase text-white">{preview.label} - {t.id}</p>
          </div>
        )}
      </MobileModal>

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
                    ? `${cancelItem.lastError} — coba lagi lewat tombol sinkron di Beranda`
                    : 'Dokumen pembatalan aman tersimpan di perangkat dan menunggu sinkron manual'}
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
                  ? (queueItem?.lastError ?? 'Menunggu foto kendaraan dilengkapi…')
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
