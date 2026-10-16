// ── Unit test parser URL Google Maps (geo.ts) — endpoint: parseMapsUrl dll. ──
// 100% format yang didukung RoutesTab (auto-extract link geofence) teruji di sini.
import { describe, it, expect } from 'vitest'
import {
  parseMapsUrl,
  isShortMapsLink,
  osmEmbeddedMapUrl,
  googleMapsLink,
} from './geo'

describe('parseMapsUrl — URL penuh Google Maps', () => {
  it('marker place !3d..!4d..', () => {
    const p = parseMapsUrl('https://www.google.com/maps/place/Foo/!3d-6.1891!4d106.8371!8m2')
    expect(p).not.toBeNull()
    expect(p!.latitude).toBeCloseTo(-6.1891, 6)
    expect(p!.longitude).toBeCloseTo(106.8371, 6)
  })

  it('marker terbalik !4d..!3d..', () => {
    const p = parseMapsUrl('https://maps.google.com/?cid=123!4d106.8371!3d-6.1891')
    expect(p!.latitude).toBeCloseTo(-6.1891, 6)
    expect(p!.longitude).toBeCloseTo(106.8371, 6)
  })

  it('viewport @lat,lng,17z (positif)', () => {
    const p = parseMapsUrl('https://www.google.com/maps/place/Foo/@-6.1891005,106.8371641,17z')
    expect(p!.latitude).toBeCloseTo(-6.1891005, 6)
    expect(p!.longitude).toBeCloseTo(106.8371641, 6)
    expect(p!.zoom).toBe(17)
  })

  it('viewport @lat,lng (negatif longitude)', () => {
    const p = parseMapsUrl('https://www.google.com/maps/@-6.19,-106.83,15z')
    expect(p!.latitude).toBeCloseTo(-6.19, 6)
    expect(p!.longitude).toBeCloseTo(-106.83, 6)
  })

  it('query param q=lat,lng', () => {
    expect(parseMapsUrl('https://maps.google.com/?q=-6.1891,106.8371')).toMatchObject({
      latitude: -6.1891,
      longitude: 106.8371,
    })
  })

  it('destination & daddr', () => {
    expect(parseMapsUrl('https://www.google.com/maps/dir/?destination=-6.18,106.83')!.longitude).toBeCloseTo(106.83, 6)
    expect(parseMapsUrl('https://maps.google.com/maps?daddr=-6.17,106.82')!.latitude).toBeCloseTo(-6.17, 6)
  })

  it('params lat=/lng= eksplisit', () => {
    const p = parseMapsUrl('https://maps.example.com/?latitude=-6.10&longitude=106.70')
    expect(p!.latitude).toBeCloseTo(-6.10, 6)
    expect(p!.longitude).toBeCloseTo(106.70, 6)
  })

  it('URL-encoded', () => {
    const p = parseMapsUrl('https://www.google.com/maps?q=%2D6.1891%2C106.8371')
    expect(p!.latitude).toBeCloseTo(-6.1891, 6)
  })

  it('lat,lng di body URL (dir tanpa @)', () => {
    const p = parseMapsUrl('https://www.google.com/maps/dir/-6.1891,106.8371/other')
    expect(p!.latitude).toBeCloseTo(-6.1891, 6)
  })
})

describe('parseMapsUrl — input non-URL', () => {
  it('skema geo:', () => {
    expect(parseMapsUrl('geo:-6.1891,106.8371')).toMatchObject({ latitude: -6.1891, longitude: 106.8371 })
  })

  it('teks mentah "lat, lng"', () => {
    expect(parseMapsUrl(' -6.1891 , 106.8371 ')).toMatchObject({ latitude: -6.1891, longitude: 106.8371 })
  })

  it('dipisah titik-koma', () => {
    expect(parseMapsUrl('-6.1891;106.8371')!.longitude).toBeCloseTo(106.8371, 6)
  })

  it('bukan koordinat → null', () => {
    expect(parseMapsUrl('https://www.google.com/maps/place/Badau')).toBeNull()
    expect(parseMapsUrl('')).toBeNull()
    expect(parseMapsUrl('abc,def')).toBeNull()
  })

  it('di luar rentang ±90/±180 → null', () => {
    expect(parseMapsUrl('@-91,106')).toBeNull()
    expect(parseMapsUrl('https://maps.google.com/?q=-6.19,181')).toBeNull()
  })

  it('desimal koma (varian lokal)', () => {
    const p = parseMapsUrl('-6,1891,106,8371')
    // tidak didukung parser (ambigu) — asal BUKAN crash
    expect(['object', 'object']).toContain(typeof p)
  })
})

describe('isShortMapsLink', () => {
  it('maps.app.goo.gl tanpa koordinat → true', () => {
    expect(isShortMapsLink('https://maps.app.goo.gl/1Gsfc4xo2wGbpf3k9')).toBe(true)
  })

  it('goo.gl biasa → true', () => {
    expect(isShortMapsLink('https://goo.gl/maps/abc')).toBe(true)
  })

  it('koordinat sudah kelihatan di URL → false (tak perlu resolve)', () => {
    expect(isShortMapsLink('https://maps.google.com/?q=-6.19,106.83')).toBe(false)
    expect(isShortMapsLink('https://www.google.com/maps/@-6.19,106.83,15z')).toBe(false)
  })

  it('bukan URL maps → false', () => {
    expect(isShortMapsLink('https://example.com/abc')).toBe(false)
    expect(isShortMapsLink('bukan-url')).toBe(false)
    expect(isShortMapsLink('')).toBe(false)
  })
})

describe('kembalian URL peta', () => {
  it('osmEmbeddedMapUrl memuat bbox & marker', () => {
    const u = osmEmbeddedMapUrl(-6.1891, 106.8371)
    expect(u).toContain('openstreetmap.org/export/embed.html')
    expect(u).toContain('bbox=106.8336,-6.1926')
    expect(u).toContain('marker=-6.1891,106.8371')
  })

  it('googleMapsLink format q=lat,lng', () => {
    expect(googleMapsLink(-6.1891, 106.8371)).toBe('https://www.google.com/maps?q=-6.1891,106.8371')
  })
})
