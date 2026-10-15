export const PLATE_REGEX = /^[A-Z]{1,2}\s?[0-9]{1,4}\s?[A-Z]{1,3}$/




export const PLATE_REGEX_STRICT = /^[A-Z]{1,2}\s[0-9]{1,4}\s[A-Z]{1,3}$/




export function isLetter(char: string): boolean {
  return /^[A-Z]$/i.test(char)
}




export function isDigit(char: string): boolean {
  return /^[0-9]$/.test(char)
}




export function sanitizePlateInput(input: string): string {
  return input.replace(/[^A-Za-z0-9\s]/g, '').toUpperCase()
}




export function formatPlateNumber(input: string): string {
  if (!input || input.length === 0) return ''

  const raw = input.replace(/\s+/g, '').toUpperCase()
  if (!raw) return ''

  let prefix = ''
  let number = ''
  let suffix = ''
  let currentSegment: 'prefix' | 'number' | 'suffix' = 'prefix'

  for (const char of raw) {
    if (currentSegment === 'prefix') {
      if (isLetter(char)) {
        if (prefix.length < 2) {
          prefix += char
        } else {
          currentSegment = 'number'
          if (isDigit(char)) {
            number += char
          } else if (isLetter(char)) {
            currentSegment = 'suffix'
            suffix += char
          }
        }
      } else if (isDigit(char)) {
        currentSegment = 'number'
        number += char
      }
    } else if (currentSegment === 'number') {
      if (isDigit(char)) {
        if (number.length < 4) {
          number += char
        }
      } else if (isLetter(char)) {
        currentSegment = 'suffix'
        suffix += char
      }
    } else if (currentSegment === 'suffix') {
      if (isLetter(char)) {
        if (suffix.length < 3) {
          suffix += char
        }
      }
    }
  }

  let result = prefix
  if (number) {
    if (result) result += ' '
    result += number
  }
  if (suffix) {
    if (result) result += ' '
    result += suffix
  }

  return result
}




export function validatePlate(plate: string): { valid: boolean; error?: string } {
  const trimmed = plate.trim()

  if (!trimmed) {
    return { valid: false, error: 'Nomor plat tidak boleh kosong' }
  }

  const raw = trimmed.replace(/\s+/g, '')
  if (raw.length < 3) {
    return { valid: false, error: 'Nomor plat terlalu pendek' }
  }

  if (!PLATE_REGEX_STRICT.test(trimmed)) {
    const match = trimmed.match(/^([A-Z]{1,2})\s*([0-9]{1,4})\s*([A-Z]{1,3})$/)
    if (!match) {
      return {
        valid: false,
        error: 'Format plat tidak valid. Contoh: B 1010 ABC atau KT 719 CEB'
      }
    }
  }

  return { valid: true }
}




export function getPlateSegments(plate: string): {
  prefix: string
  number: string
  suffix: string
} {
  const parts = plate.trim().split(/\s+/)
  return {
    prefix: parts[0] || '',
    number: parts[1] || '',
    suffix: parts[2] || ''
  }
}




export function isSegmentFull(plate: string, segment: 'prefix' | 'number' | 'suffix'): boolean {
  const { prefix, number, suffix } = getPlateSegments(plate)

  switch (segment) {
    case 'prefix':
      return prefix.length >= 2
    case 'number':
      return number.length >= 4
    case 'suffix':
      return suffix.length >= 3
  }
}
