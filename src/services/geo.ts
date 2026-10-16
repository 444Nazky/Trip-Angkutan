import { api } from './api'



export interface ParsedGeo {
  latitude: number
  longitude: number

  zoom?: number
}



export function isShortMapsLink(raw: string): boolean {
  const s = (raw || '').trim()
  if (!/^https?:\/\//i.test(s)) return false
  if (!/goo\.gl|maps\.app|g\.co\/maps|google\.com\/maps\/\?/i.test(s)) return false

  return !/@-?\d|!3d-?\d|[?&](q|ll|center|destination|daddr|lat)=/i.test(s)
}



export function parseMapsUrl(raw: string): ParsedGeo | null {
  if (!raw) return null
  let url = raw.trim()

  try {
    const decoded = decodeURIComponent(url)
    if (decoded !== url) url = decoded
  } catch {}

  const marker = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (marker) return build(marker[1], marker[2])

  const markerRev = url.match(/!4d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/)
  if (markerRev) return build(markerRev[2], markerRev[1])

  const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/)
  if (at) return build(at[1], at[2], at[3])

  const q = url.match(/[?&](?:q|query|destination|daddr|ll|center|sll|near)=([^&#]+)/i)
  if (q) {
    const value = decodeURIComponent(q[1].replace(/\+/g, ' '))
    const loc = value.match(/^loc:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i)
    if (loc) return build(loc[1], loc[2])
    const pair = value.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
    if (pair) return build(pair[1], pair[2])
  }

  const lat = url.match(/[?&]lat(?:itude)?=(-?\d+(?:\.\d+)?)/i)
  const lng = url.match(/[?&](?:lng|lon|long|longitude)=(-?\d+(?:\.\d+)?)/i)
  if (lat && lng) return build(lat[1], lng[1])

  const body = url.match(/(?:^|\/)(-?\d+\.\d+),(-?\d+\.\d+)(?:[/?#]|$)/)
  if (body) return build(body[1], body[2])

  const geo = url.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i)
  if (geo) return build(geo[1], geo[2])
  const bare = url.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/)
  if (bare) return build(bare[1], bare[2])

  return null
}



function build(latStr: string, lngStr: string, zoomStr?: string): ParsedGeo | null {
  const latitude = parseFloat(latStr)
  const longitude = parseFloat(lngStr)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return {
    latitude,
    longitude,
    zoom: zoomStr ? parseFloat(zoomStr) : undefined,
  }
}



export async function resolveMapsShortLink(raw: string): Promise<string | null> {
  const url = (raw || '').trim()
  if (!url) return null

  const res = await api.get<{ url?: string; latitude?: number; longitude?: number }>(
    `/geofences/resolve-link?url=${encodeURIComponent(url)}`,
  )
  if (res.ok && res.data) {
    const data = res.data

    if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
      return `https://www.google.com/maps?q=${data.latitude},${data.longitude}`
    }
    if (typeof data.url === 'string' && data.url) return data.url
  }

  try {
    const res = await fetch(url, { redirect: 'follow', mode: 'cors' })
    if (res.ok) return res.url || null
  } catch {}

  return null
}



export function osmEmbeddedMapUrl(latitude: number, longitude: number): string {
  const delta = 0.0035
  const minLng = longitude - delta
  const maxLng = longitude + delta
  const minLat = latitude - delta
  const maxLat = latitude + delta
  return [
    'https://www.openstreetmap.org/export/embed.html',
    `bbox=${minLng},${minLat},${maxLng},${maxLat}`,
    'layer=mapnik',
    `marker=${latitude},${longitude}`,
  ].join('&')
}



export function googleMapsLink(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`
}
