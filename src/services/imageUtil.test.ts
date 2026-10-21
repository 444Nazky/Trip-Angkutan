import { describe, it, expect } from 'vitest'
import { dataUrlToBlob, dataUrlByteLength, DOC_MAX_EDGE, OCR_MAX_EDGE } from './imageUtil'

// PNG 1x1 (dipakai sebagai data URL uji).
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('imageUtil', () => {
  it('dataUrlToBlob mendekode base64 ke byte yang benar', async () => {
    const blob = dataUrlToBlob(PNG_1PX)
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe('image/png')
    expect(blob!.size).toBeGreaterThan(0)
  })

  it('dataUrlToBlob menolak input rusak tanpa melempar error', () => {
    expect(dataUrlToBlob('bukan-data-url')).toBeNull()
    expect(dataUrlToBlob('')).toBeNull()
  })

  it('dataUrlByteLength mengestimasi ukuran file', () => {
    expect(dataUrlByteLength(PNG_1PX)).toBeGreaterThan(50)
    expect(dataUrlByteLength('')).toBe(0)
  })

  it('batas ukuran foto: dokumentasi 360p-ish, OCR lebih besar', () => {
    // 640px = sisi terpanjang untuk foto dokumentasi (≈360p untuk 16:9).
    expect(DOC_MAX_EDGE).toBe(640)
    // OCR butuh lebih tinggi supaya plat masih terbaca.
    expect(OCR_MAX_EDGE).toBeGreaterThan(DOC_MAX_EDGE)
  })
})
