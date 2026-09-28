import { useRef, useState } from 'react'
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

// ─── Variasi transisi antar halaman ──────────────────────────────────────────
// push  → maju (geser dari kanan)     pop → kembali (geser dari kiri)
// zoom  → halaman detail              sheet → form/modal (dari bawah)
// tab   → pindah tab bawah
type AnimKind = 'push' | 'pop' | 'zoom' | 'sheet' | 'tab'

const ZOOM_SCREENS: MobileScreen[] = ['camera', 'trip-summary', 'trip-complete', 'history-detail']
const SHEET_SCREENS: MobileScreen[] = ['trip-condition', 'vehicle-form', 'settings', 'pin-verify']

// ─── Mobile App Container ─────────────────────────────────────────────────────
export default function MobileApp() {
  const [screen, setScreen] = useState<MobileScreen>('home')
  const [anim, setAnim] = useState<AnimKind>('tab')
  const [pendingDermagas, setPendingDermagas] = useState<Dermaga[] | null>(null)
  const stack = useRef<MobileScreen[]>(['home'])

  const noNavScreens: MobileScreen[] = [
    'camera',
    'officer-switch',
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
    home: <HomeScreen go={go} />,
    'route-select': <RouteSelectScreen go={go} />,
    'trip-condition': <TripConditionScreen go={go} />,
    'vehicle-form': <VehicleFormScreen go={go} />,
    camera: <CameraScreen go={go} />,
    'trip-summary': <TripSummaryScreen go={go} />,
    'trip-active': <TripActiveScreen go={go} />,
    'trip-complete': <TripCompleteScreen go={go} />,
    history: <HistoryScreen go={go} />,
    'history-detail': <HistoryDetailScreen go={go} />,
    'officer-switch': <OfficerSwitchScreen go={go} />,
    'pin-verify': <PinVerifyScreen go={go} onDermagaSelect={(d) => setPendingDermagas(d)} />,
    profile: <ProfileScreen go={go} />,
    settings: <SettingsScreen go={go} />,
  }

  /** Navigasi dengan animasi sesuai konteks (bukan fade berulang). */
  function go(next: MobileScreen) {
    if (next === screen) return
    const path = stack.current
    const at = path.lastIndexOf(next)
    let kind: AnimKind

    if (at >= 0) kind = 'pop' // kembali ke layar sebelumnya
    else if (ZOOM_SCREENS.includes(next)) kind = 'zoom'
    else if (SHEET_SCREENS.includes(next)) kind = 'sheet'
    else kind = 'push'

    stack.current = at >= 0 ? path.slice(0, at + 1) : [...path, next]

    setAnim(kind)
    setScreen(next)
  }

  /** Pindah lewat tab bawah — transisi khusus tab (bukan maju/kembali). */
  function goTab(next: MobileScreen) {
    if (next === screen) return
    const path = stack.current
    const at = path.lastIndexOf(next)
    stack.current = at >= 0 ? path.slice(0, at + 1) : [...path, next]
    setAnim('tab')
    setScreen(next)
  }

  const handleDermagaSelected = (_dermaga: Dermaga) => {
    setPendingDermagas(null)
    // Continue to profile/home after selecting dermaga
    setScreen('profile')
  }

  const handleDermagaCancel = () => {
    setPendingDermagas(null)
    setScreen('profile')
  }

  const framed = (content: React.ReactNode) => <div className="app-frame">{content}</div>

  // Show dermaga selection if needed
  if (pendingDermagas && pendingDermagas.length > 1) {
    return framed(
      <div className="flex-1 overflow-y-auto hide-scrollbar screen-scroll">
        <DermagaSelectScreen
          dermagas={pendingDermagas}
          onSelected={handleDermagaSelected}
          onCancel={handleDermagaCancel}
          go={go}
        />
      </div>,
    )
  }

  // Screens without bottom nav
  if (noNavScreens.includes(screen)) {
    return framed(
      <div className="flex-1 overflow-y-auto hide-scrollbar screen-scroll">
        <div key={screen} className={`scr-anim scr-anim-${anim} min-h-full`}>{screenMap[screen]}</div>
      </div>,
    )
  }

  return (
    <MobileShell activeNav={activeNav} onNav={goTab}>
      <div key={screen} className={`scr-anim scr-anim-${anim} min-h-full`}>{screenMap[screen]}</div>
    </MobileShell>
  )
}
