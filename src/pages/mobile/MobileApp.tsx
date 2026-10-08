import { useEffect, useRef, useState } from 'react'
import MobileShell from './MobileShell'
import HomeScreen from './HomeScreen'
import RouteSelectScreen from './RouteSelectScreen'
import TripConditionScreen from './TripConditionScreen'
import VehicleFormScreen from './VehicleFormScreen'
import CameraScreen from './CameraScreen'
import TripSummaryScreen from './TripSummaryScreen'
import TripActiveScreen from './TripActiveScreen'
import TripCompleteScreen from './TripCompleteScreen'
import HistoryScreen from './HistoryScreen'
import HistoryDetailScreen from './HistoryDetailScreen'
import OfficerSwitchScreen from './OfficerSwitchScreen'
import PinVerifyScreen from './PinVerifyScreen'
import ProfileScreen from './ProfileScreen'
import SettingsScreen from './SettingsScreen'
import DermagaSelectScreen from './DermagaSelectScreen'
import type { MobileScreen } from '../types'
import type { Dermaga } from '../../services/auth'
import { useApp } from '../store'

// Variasi transisi antar halaman
// push → maju (geser dari kanan)  pop → kembali (geser dari kiri)
// zoom → halaman detail              sheet → form/modal (dari bawah)
// tab  → pindah tab bawah
type AnimKind = 'push' | 'pop' | 'zoom' | 'sheet' | 'tab'

const ZOOM_SCREENS: MobileScreen[] = ['camera', 'trip-summary', 'trip-complete', 'history-detail']
const SHEET_SCREENS: MobileScreen[] = ['trip-condition', 'vehicle-form', 'settings', 'pin-verify']

export default function MobileApp() {
  const { officer, setActiveDermaga } = useApp()
  const [screen, setScreen] = useState<MobileScreen>('home')
  const [anim, setAnim] = useState<AnimKind>('tab')
  // pendingDermagas = popup pilihan dermaga (saat Mulai Trip dual-access).
  const [pendingDermagas, setPendingDermagas] = useState<Dermaga[] | null>(null)
  // selectedDockId = dermaga yang dipilih petugas di popup Mulai Trip.
  // Dipakai RouteSelectScreen untuk filter rute.
  const [selectedDockId, setSelectedDockId] = useState<string | null>(null)
  const stack = useRef<MobileScreen[]>(['home'])

  // Ganti petugas → batalkan popup pilih dermaga yang tersisa
  useEffect(() => { setPendingDermagas(null) }, [officer?.id])

  // Fullscreen screens: no bottom nav, instant rendering
  const fullscreenScreens: MobileScreen[] = [
    'camera',
    'officer-switch', // Daftar Petugas - fullscreen view, no nav overlap
    'pin-verify',
    'trip-active',
    'trip-complete',
  ]

  const activeNav = ['history', 'history-detail'].includes(screen)
    ? 'history'
    : ['profile', 'settings'].includes(screen)
    ? 'profile'
    : 'home'

  const screenMap: Record<MobileScreen, React.ReactNode> = {
    home: <HomeScreen go={go} onStartTrip={handleStartTrip} />,
    'route-select': <RouteSelectScreen go={go} selectedDockId={selectedDockId} />,
    'trip-condition': <TripConditionScreen go={go} />,
    'vehicle-form': <VehicleFormScreen go={go} />,
    camera: <CameraScreen go={go} />,
    'trip-summary': <TripSummaryScreen go={go} />,
    'trip-active': <TripActiveScreen go={go} />,
    'trip-complete': <TripCompleteScreen go={go} />,
    history: <HistoryScreen go={go} />,
    'history-detail': <HistoryDetailScreen go={go} />,
    'officer-switch': <OfficerSwitchScreen go={go} />,
    // PinVerifyScreen tanpa onDermagaSelect — popup dermaga TIDAK muncul di login/switch
    'pin-verify': <PinVerifyScreen go={go} />,
    profile: <ProfileScreen go={go} />,
    settings: <SettingsScreen go={go} />,
  }

  /** Navigasi dengan animasi sesuai konteks. */
  function go(next: MobileScreen) {
    if (next === screen) return
    const path = stack.current
    const at = path.lastIndexOf(next)
    let kind: AnimKind
    if (at >= 0) kind = 'pop'
    else if (ZOOM_SCREENS.includes(next)) kind = 'zoom'
    else if (SHEET_SCREENS.includes(next)) kind = 'sheet'
    else kind = 'push'
    stack.current = at >= 0 ? path.slice(0, at + 1) : [...path, next]
    setAnim(kind)
    setScreen(next)
  }
 /* */

  function handleStartTrip() {
    const accesses = officer.dermagaAccess || []
    if (accesses.length > 1) {
      setSelectedDockId(null) // belum pilih dock, popup tanggung jawab
      setPendingDermagas(accesses as Dermaga[])
      return
    }
    if (accesses.length === 0) {
      // Tanpa akses dermaga: HomeScreen sudah menampilkan pesan "Hubungi Admin"
      // (sengaja TIDAK memakai console.warn — pesan dev tidak berguna bagi petugas).
      return
    }
    setPendingDermagas(null)
    setSelectedDockId(accesses[0]?.id ?? null)
    setActiveDermaga(accesses[0]?.id ?? null)
    go('trip-condition')
  }

  function goTab(next: MobileScreen) {
    if (next === screen) return
    const path = stack.current
    const at = path.lastIndexOf(next)
    stack.current = at >= 0 ? path.slice(0, at + 1) : [...path, next]
    setAnim('tab')
    setScreen(next)
  }

  const handleDermagaSelected = (dermaga: Dermaga) => {
    setPendingDermagas(null)
    setSelectedDockId(dermaga.id)
    setActiveDermaga(dermaga.id)
    go('trip-condition')
  }

  const handleDermagaCancel = () => {
    setPendingDermagas(null)
    setSelectedDockId(null)
    go('home')
  }

  const framed = (content: React.ReactNode) => <div className="app-frame">{content}</div>

  // Popup pilih dermaga HANYA muncul saat Mulai Trip (bukan login/ganti petugas)
  if (pendingDermagas && pendingDermagas.length > 1) {
    return framed(
      <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar screen-scroll">
        <DermagaSelectScreen
          dermagas={pendingDermagas}
          onSelected={handleDermagaSelected}
          onCancel={handleDermagaCancel}
          go={go}
        />
      </div>,
    )
  }

  if (fullscreenScreens.includes(screen)) {
    return framed(
      <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar screen-scroll">
        {screenMap[screen]}
      </div>,
    )
  }

  return (
    <MobileShell activeNav={activeNav} onNav={goTab}>
      <div key={screen} className={`scr-anim scr-anim-${anim} min-h-full`}>{screenMap[screen]}</div>
    </MobileShell>
  )
}
