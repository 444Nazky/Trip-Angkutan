import { Geolocation } from '@capacitor/geolocation'



export interface PermissionStatus {
  granted: boolean
  denied: boolean
  prompt: boolean
  restricted: boolean
  unknown: boolean
}



export async function checkLocationPermission(): Promise<PermissionStatus> {
  try {
    const status = await Geolocation.checkPermissions()
    const loc = status.location as string
    return {
      granted: loc === 'granted',
      denied: loc === 'denied',
      prompt: loc === 'prompt' || loc === 'prompt-with-rationale',
      restricted: loc === 'restricted',
      unknown: loc === 'unknown',
    }
  } catch {
    return {
      granted: false,
      denied: false,
      prompt: true,
      restricted: false,
      unknown: true,
    }
  }
}



export async function requestLocationPermission(): Promise<PermissionStatus> {
  try {
    const result = await Geolocation.requestPermissions()
    const loc = result.location as string
    return {
      granted: loc === 'granted',
      denied: loc === 'denied',
      prompt: loc === 'prompt' || loc === 'prompt-with-rationale',
      restricted: loc === 'restricted',
      unknown: loc === 'unknown',
    }
  } catch {
    return {
      granted: false,
      denied: false,
      prompt: true,
      restricted: false,
      unknown: true,
    }
  }
}



export const LOCATION_PERMISSION_KEY = 'trip.permission.location.requested'



export function markLocationPermissionRequested(): void {
  try {
    localStorage.setItem(LOCATION_PERMISSION_KEY, String(Date.now()))
  } catch {}
}



export function wasLocationPermissionRequested(): boolean {
  try {
    return localStorage.getItem(LOCATION_PERMISSION_KEY) !== null
  } catch {
    return false
  }
}



export async function checkAndRequestLocationOnStartup(): Promise<{
  shouldShowPrompt: boolean
  permissionGranted: boolean
}> {
  const current = await checkLocationPermission()

  if (current.granted) {
    return { shouldShowPrompt: false, permissionGranted: true }
  }

  if (current.denied || current.restricted) {
    return { shouldShowPrompt: false, permissionGranted: false }
  }

  const requested = wasLocationPermissionRequested()
  if (requested) {
    return { shouldShowPrompt: false, permissionGranted: false }
  }

  markLocationPermissionRequested()
  const result = await requestLocationPermission()

  return {
    shouldShowPrompt: true,
    permissionGranted: result.granted,
  }
}
