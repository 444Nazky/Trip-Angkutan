import { useState } from 'react'
import MobileShell from './MobileShell'
import StatusBar from './StatusBar'
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
import type { MobileScreen } from '../types'

// ─── Mobile App Container ─────────────────────────────────────────────────────
export default function MobileApp() {
  const [screen, setScreen] = useState<MobileScreen>('home')

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
    home: <HomeScreen go={setScreen} />,
    'route-select': <RouteSelectScreen go={setScreen} />,
    'trip-condition': <TripConditionScreen go={setScreen} />,
    'vehicle-form': <VehicleFormScreen go={setScreen} />,
    camera: <CameraScreen go={setScreen} />,
    'trip-summary': <TripSummaryScreen go={setScreen} />,
    'trip-active': <TripActiveScreen go={setScreen} />,
    'trip-complete': <TripCompleteScreen go={setScreen} />,
    history: <HistoryScreen go={setScreen} />,
    'history-detail': <HistoryDetailScreen go={setScreen} />,
    'officer-switch': <OfficerSwitchScreen go={setScreen} />,
    'pin-verify': <PinVerifyScreen go={setScreen} />,
    profile: <ProfileScreen go={setScreen} />,
    settings: <SettingsScreen go={setScreen} />,
  }

  // Screens without bottom nav
  if (noNavScreens.includes(screen)) {
    return (
      <div
        className="w-[390px] h-[844px] bg-[#F1F5F9] rounded-[48px] overflow-hidden flex flex-col border border-slate-300/60"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.8)' }}
      >
        <StatusBar />
        <div className="flex-1 overflow-y-auto hide-scrollbar">{screenMap[screen]}</div>
      </div>
    )
  }

  return (
    <MobileShell activeNav={activeNav} onNav={setScreen}>
      {screenMap[screen]}
    </MobileShell>
  )
}
