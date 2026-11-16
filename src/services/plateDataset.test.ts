import { describe, expect, it } from 'vitest'
import { buildDatasetExport, normalizePlateSample, sampleKey } from './plateDataset'

const IMG = 'data:image/jpeg;base64,AAAA'

describe('normalizePlateSample', () => {
  it('menormalkan plat prediksi & koreksi', () => {
    const s = normalizePlateSample({ predicted: 'b9701uea', corrected: 'b 9701 uef', image: IMG })
    expect(s?.predicted).toBe('B 9701 UEA')
    expect(s?.corrected).toBe('B 9701 UEF')
    expect(s?.createdAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('menolak sampel tanpa koreksi nyata', () => {
    expect(normalizePlateSample({ predicted: 'B 9701 UEA', corrected: 'B 9701 UEA', image: IMG })).toBeNull()
  })

  it('menolak gambar yang bukan data URL', () => {
    expect(normalizePlateSample({ predicted: 'B 9701 UEA', corrected: 'B 9701 UEF', image: 'file:///tmp/a.jpg' })).toBeNull()
  })

  it('menolak plat koreksi kosong', () => {
    expect(normalizePlateSample({ predicted: 'B 9701 UEA', corrected: '   ', image: IMG })).toBeNull()
  })
})

describe('sampleKey', () => {
  it('sama untuk sampel identik dan beda untuk koreksi berbeda', () => {
    const base = { predicted: 'B 9701 UEA', corrected: 'B 9701 UEF', image: IMG }
    expect(sampleKey(base)).toBe(sampleKey({ ...base }))
    expect(sampleKey(base)).not.toBe(sampleKey({ ...base, corrected: 'B 9701 UEG' }))
  })
})

describe('buildDatasetExport', () => {
  it('membuat payload JSON berisi gambar + label', () => {
    const payload = JSON.parse(
      buildDatasetExport(
        [{
          predicted: 'B 9701 UEA',
          corrected: 'B 9701 UEF',
          image: IMG,
          officer: 'Budi',
          createdAt: '2026-11-16T10:00:00.000Z',
        }],
        '2026-11-16T11:00:00.000Z',
      ),
    )
    expect(payload).toMatchObject({ version: 1, kind: 'plate-corrections', exportedAt: '2026-11-16T11:00:00.000Z', count: 1 })
    expect(payload.samples[0]).toEqual({
      image: IMG,
      predicted: 'B 9701 UEA',
      corrected: 'B 9701 UEF',
      officer: 'Budi',
      createdAt: '2026-11-16T10:00:00.000Z',
    })
  })

  it('tidak membocorkan id internal', () => {
    const payload = JSON.parse(buildDatasetExport([{ id: 7, predicted: 'B 1 A', corrected: 'B 2 A', image: IMG, createdAt: 'x' }]))
    expect(payload.samples[0].id).toBeUndefined()
  })
})
