import { describe, expect, it } from 'vitest'
import {
  interpretPlateLine,
  otsuThreshold,
  plateCandidatesFromText,
  scorePlateCandidate,
} from './ocr'

describe('interpretPlateLine', () => {
  it('menerima plat yang terbaca sempurna', () => {
    expect(interpretPlateLine('B 9701 UEA')).toEqual({ plate: 'B9701UEA', corrections: 0 })
  })

  it('mengoreksi huruf yang terbaca angka pada posisi huruf', () => {
    // Tesseract sering membaca B sebagai 8/3.
    expect(interpretPlateLine('39701UEA')?.plate).toBe('B9701UEA')
    expect(interpretPlateLine('89701UEA')?.plate).toBe('B9701UEA')
  })

  it('mengoreksi angka yang terbaca huruf pada posisi angka', () => {
    expect(interpretPlateLine('B97O1UEA')?.plate).toBe('B9701UEA')
    expect(interpretPlateLine('B97OIUEA')?.plate).toBe('B9701UEA')
  })

  it('menolak teks yang bukan pola plat Indonesia', () => {
    expect(interpretPlateLine('62A05772')).toBeNull()
    expect(interpretPlateLine('HELLO')).toBeNull()
    expect(interpretPlateLine('1234567')).toBeNull()
    expect(interpretPlateLine('')).toBeNull()
  })

  it('menolak kandidat dengan koreksi berlebihan', () => {
    expect(interpretPlateLine('39OISG7A')).toBeNull()
  })

  it('mendukung plat tanpa huruf belakang', () => {
    expect(interpretPlateLine('B9701')?.plate).toBe('B9701')
  })
})

describe('plateCandidatesFromText', () => {
  it('mengambil kandidat dari teks multi-baris', () => {
    const text = 'garis tepi\nB 9701 UEA\nsisa\n'
    expect(plateCandidatesFromText(text)).toContain('B9701UEA')
  })

  it('mengabaikan baris derau', () => {
    expect(plateCandidatesFromText('S\n|\n162A05772')).toEqual([])
  })
})

describe('scorePlateCandidate', () => {
  it('memberi skor lebih tinggi untuk plat lengkap', () => {
    expect(scorePlateCandidate('B9701UEA')).toBeGreaterThan(scorePlateCandidate('B9701'))
  })

  it('memberi skor 0 untuk pola tidak valid', () => {
    expect(scorePlateCandidate('9701')).toBe(0)
    expect(scorePlateCandidate('B')).toBe(0)
  })
})

describe('otsuThreshold', () => {
  it('memisahkan gambar hitam-putih seimbang di tengah', () => {
    const gray = new Uint8ClampedArray(100)
    gray.fill(20, 0, 50)
    gray.fill(220, 50)
    const t = otsuThreshold(gray)
    // Ambang jatuh tepat di level gelap: piksel gelap <= t, terang > t.
    expect(t).toBeGreaterThanOrEqual(20)
    expect(t).toBeLessThan(220)
  })
})
