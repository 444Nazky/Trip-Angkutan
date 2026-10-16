import type { GeofenceRule } from './geofences'



export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}



export interface LocationDistance {
  meters: number

  label: string

  pointName: string

  pointLat: number
  pointLng: number
}

interface Coords {
  latitude?: number | null
  longitude?: number | null
}



export function nearestGeofence(
  coords: Coords,
  rules: GeofenceRule[],
): LocationDistance | null {
  const lat = Number(coords?.latitude)
  const lng = Number(coords?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || rules.length === 0) return null

  let best: LocationDistance | null = null
  for (const r of rules) {
    const plat = Number(r.latitude)
    const plng = Number(r.longitude)
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue
    const meters = haversineMeters(lat, lng, plat, plng)
    if (!best || meters < best.meters) {
      best = {
        meters: Math.floor(meters),
        label: r.locationName,
        pointName: r.locationName,
        pointLat: plat,
        pointLng: plng,
      }
    }
  }
  return best
}



export function locationDistanceText(
  coords: Coords,
  rules: GeofenceRule[],
): string | null {
  const nd = nearestGeofence(coords, rules)
  if (!nd) return null
  return `${nd.meters}m dari ${nd.label}`
}
