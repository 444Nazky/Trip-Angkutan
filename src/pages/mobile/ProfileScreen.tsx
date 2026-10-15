import { useEffect, useState } from 'react'
import { AlertCircle, ArrowLeftRight, CheckCircle, ChevronRight, Lock, MapPin, RefreshCw, Server, Wifi, WifiOff } from 'lucide-react'
import { hardReloadToNewBundle } from '../../services/otaReload'
import { applyUpdate, checkForUpdate, getCurrentVersion, semverLabel, type UpdateState } from '../../services/ota'
import { resolveApiBaseUrl } from '../../services/api'
import { getNativeVersion } from '../../services/updateService'
import ServerSettingsModal from '../../components/ServerSettingsModal'
import { useApp } from '../store'
import type { MobileScreen } from '../types'




interface ProfileScreenProps {
  go: (s: MobileScreen) => void
}




export default function ProfileScreen({ go }: ProfileScreenProps) {
  const { officer, trips, refreshOfficers } = useApp()
  const [currentVersion, setCurrentVersion] = useState('—')
  const [appVersion, setAppVersion] = useState('—')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : false)
  const [showServer, setShowServer] = useState(false)

  useEffect(() => {
    void refreshOfficers()
    void getCurrentVersion().then(version => { if (version) setCurrentVersion(version) })
    void getNativeVersion().then(version => { if (version) setAppVersion(version) })
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refreshOfficers])

  const checkForAppUpdate = async () => {
    setCheckingUpdate(true)
    setNote(null)
    try {
      const local = currentVersion === '—' ? await getCurrentVersion() : currentVersion
      let last: UpdateState = { status: 'idle' }
      const result = await checkForUpdate(local, state => { last = state }, true)
      if (result.available) {
        setUpdateVersion(result.version ?? null)
        setNote(`Update ${semverLabel(result.version ?? '')} tersedia`)
      } else if (last.status === 'error') {
        setNote(last.error ?? 'Gagal memeriksa pembaruan')
      } else if (last.status === 'offline') {
        setNote('Tidak ada koneksi')
      } else {
        setNote('Aplikasi sudah versi terbaru')
      }
    } finally {
      setCheckingUpdate(false)
    }
  }

  const applyNow = async () => {
    setNote('Menerapkan pembaruan modul…')
    if (await applyUpdate()) {
      const modul = (await getCurrentVersion()) ?? ''
      // OTA hanya mengganti MODUL web (bundle), bukan versi APK. Dulu pesannya
      // "berhasil update" sehingga petugas mengira versi aplikasi naik padahal
      // versi native (dan pengecekan versi dari server) tetap yang lama.
      setNote(`Modul ${semverLabel(modul)} diterapkan. Versi APK tetap ${appVersion} — pembaruan APK lewat notifikasi di beranda.`)
      setUpdateVersion(null)
      await hardReloadToNewBundle(modul || undefined)
    } else {
      setUpdateVersion(null)
      setNote('Gagal menerapkan pembaruan modul')
    }
  }

  const myTrips = trips.filter(t => t.officerId ? String(t.officerId) === String(officer.id) : t.officer === officer.name)

  const units = new Set(
    myTrips
      .flatMap(t => (t.vehicles && t.vehicles.length ? t.vehicles.map(v => v.plate) : [t.vehicle]))
      .filter(p => p && p !== '-'),
  )
  return (
    <div className="min-h-full bg-slate-50 px-4 pb-8 pt-4 space-y-4">
      <div>
        <h2 className="mt-1 text-xl font-bold text-slate-900">Profil Petugas</h2>
      </div>

      <section className="bg-[#0F172A] rounded-3xl p-5 mb-4">
        <div className="flex items-center gap-4 mb-4">
          <img src="/assets/guest-profile.jpeg" alt={officer.name} className="w-16 h-16 rounded-2xl object-cover" />
          <div className="min-w-0">
            <p className="text-white font-bold text-[16px] leading-tight">{officer.name}</p>
            <p className="text-blue-400 text-[12px] mt-0.5">@{officer.username || officer.name.toLowerCase().replace(/\s+/g, '')}</p>
            <div className="flex items-center gap-1.5 mt-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-emerald-400 text-[11px] font-bold">REGION : {officer.region}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
          {[{ v: String(myTrips.length), l: 'Trip' }, { v: String(units.size), l: 'Kendaraan' }].map((stat, index) => (
            <div key={stat.l} className={`text-center ${index > 0 ? 'border-l border-white/10 pl-4' : ''}`}>
              <p className="text-white font-black text-[18px] leading-tight">{stat.v}</p>
              <p className="text-slate-400 text-[11px] mt-1">{stat.l}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/10">
          <Lock size={12} className="text-slate-500" />
          <span className="text-[11px] text-slate-500">Region Locked</span>
          <span className="ml-auto text-[11px] font-black text-emerald-400 tracking-widest">{officer.region}</span>
          <span className="text-[10px] text-slate-600">{officer.lastActive}</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="px-4 pb-2 pt-3">
          <h3 className="text-xs font-semibold text-slate-800">Koneksi</h3>
          <p className="mt-0.5 text-[10px] text-slate-400">Status jaringan perangkat</p>
        </div>
        <div className="divide-y divide-slate-100">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${isOnline ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
              {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-800">Jaringan internet</p>
              <p className="text-[10px] text-slate-400">{isOnline ? 'Perangkat terhubung ke internet' : 'Perangkat sedang offline'}</p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <button
          onClick={() => setShowServer(true)}
          className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Server size={16} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-800">Server / Endpoint</p>
            <p className="mt-0.5 text-[10px] text-slate-400 truncate">{resolveApiBaseUrl()}</p>
          </div>
          <ChevronRight size={16} className="text-slate-400" />
        </button>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><CheckCircle size={16} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-800">Pembaruan modul (OTA)</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{note ?? `Versi APK ${appVersion} · modul ${currentVersion !== '—' ? semverLabel(currentVersion) : '—'}`}</p>
          </div>
          <button
            onClick={() => void (updateVersion ? applyNow() : checkForAppUpdate())}
            disabled={checkingUpdate}
            className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-[10px] font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            {checkingUpdate ? <RefreshCw size={12} className="animate-spin" /> : updateVersion ? 'Pasang' : 'Periksa'}
          </button>
        </div>
        {updateVersion && !checkingUpdate && (
          <div className="flex items-center gap-2 border-t border-emerald-100 bg-emerald-50 px-4 py-2.5 text-[10px] text-emerald-800">
            <AlertCircle size={13} /> Modul {semverLabel(updateVersion)} siap dipasang (versi APK tidak berubah).
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <button
          onClick={() => go('geofence-config')}
          className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><MapPin size={16} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-800">Titik wilayah validasi</p>
            <p className="mt-0.5 text-[10px] text-slate-400">Konfigurasi area geofence</p>
          </div>
          <ChevronRight size={16} className="text-slate-400" />
        </button>
      </section>

      <button
        onClick={() => go('officer-switch')}
        className="w-full flex items-center justify-center gap-2 py-3.5 text-red-500 font-bold text-[13px] rounded-2xl border border-red-200 hover:bg-red-50 active:bg-red-100 transition-colors"
      >
        <ArrowLeftRight size={15} /> Ganti Petugas
      </button>

      <p className="pb-2 text-center text-[10px] text-slate-400">TripAngkutan · Offline-first · {officer.lastActive}</p>

      {showServer && <ServerSettingsModal onClose={() => setShowServer(false)} />}
    </div>
  )
}
