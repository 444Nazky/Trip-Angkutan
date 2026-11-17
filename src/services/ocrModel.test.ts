import { describe, expect, it } from 'vitest'
import { setPlateModelForTest, snapToKnownPlate, type PlateCorrectionModel } from './ocrModel'
import { formatPlateNumber } from '../utils/plateFormatter'

function model(plates: string[]): PlateCorrectionModel {
  return {
    version: 1,
    samples: plates.length,
    plates,
    confusions: [],
    trainedAt: '2026-11-17T00:00:00.000Z',
    accuracy: 0,
  }
}

describe('snapToKnownPlate', () => {
  it('tidak mengubah apa pun bila model belum ada', () => {
    setPlateModelForTest(null)
    expect(snapToKnownPlate('B 7777 XTE')).toBe('B 7777 XTE')
  })

  it('mengunci plat yang persis terdaftar', () => {
    setPlateModelForTest(model(['B7171XYE']))
    expect(snapToKnownPlate('B 7171 XYE')).toBe('B 7171 XYE')
  })

  it('membetulkan satu karakter yang salah ke plat terdaftar', () => {
    setPlateModelForTest(model(['B7171XYE']))
    // Hasil OCR salah satu karakter: XTE vs XYE.
    expect(snapToKnownPlate(formatPlateNumber('B7777XTE'))).toBe(formatPlateNumber('B7777XTE'))
    expect(snapToKnownPlate(formatPlateNumber('B7171XTE'))).toBe(formatPlateNumber('B7171XYE'))
  })

  it('tidak menebak bila kandidat lebih dari satu (ambigu)', () => {
    setPlateModelForTest(model(['B7171XYE', 'B7171XYT']))
    expect(snapToKnownPlate(formatPlateNumber('B7171XYA'))).toBe(formatPlateNumber('B7171XYA'))
  })

  it('tidak mengubah plat dengan panjang berbeda', () => {
    setPlateModelForTest(model(['B7171XYE']))
    expect(snapToKnownPlate(formatPlateNumber('B717XYE'))).toBe(formatPlateNumber('B717XYE'))
  })
})
