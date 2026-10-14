/**
 * Indonesian Vehicle Plate Number Formatting Utilities
 *
 * Format: [1-2 Letter Prefix] [1-4 Digit Number] [1-3 Letter Suffix]
 * Examples: B 7171 CEF, KT 719 CEB, AB 1234 CD
 */

// Regex for validation: 1-2 letters + 1-4 digits + 1-3 letters
export const PLATE_REGEX = /^[A-Z]{1,2}\s?[0-9]{1,4}\s?[A-Z]{1,3}$/

// More strict regex requiring proper spacing
export const PLATE_REGEX_STRICT = /^[A-Z]{1,2}\s[0-9]{1,4}\s[A-Z]{1,3}$/

/**
 * Check if a character is a letter (A-Z)
 */
export function isLetter(char: string): boolean {
  return /^[A-Z]$/i.test(char)
}

/**
 * Check if a character is a digit (0-9)
 */
export function isDigit(char: string): boolean {
  return /^[0-9]$/.test(char)
}

/**
 * Sanitize input: keep only alphanumeric and spaces, uppercase
 */
export function sanitizePlateInput(input: string): string {
  return input.replace(/[^A-Za-z0-9\s]/g, '').toUpperCase()
}

/**
 * Format a raw plate input with smart auto-spacing
 * Handles the transition from letters -> digits -> letters
 *
 * @param input - Raw user input (already sanitized)
 * @returns Formatted plate with proper spacing
 */
export function formatPlateNumber(input: string): string {
  if (!input || input.length === 0) return ''

  // Remove any existing spaces for processing
  const raw = input.replace(/\s+/g, '').toUpperCase()
  if (!raw) return ''

  // Parse into segments
  let prefix = ''      // 1-2 letters (kode wilayah)
  let number = ''       // 1-4 digits
  let suffix = ''       // 1-3 letters (seri belakang)
  let currentSegment: 'prefix' | 'number' | 'suffix' = 'prefix'

  for (const char of raw) {
    if (currentSegment === 'prefix') {
      if (isLetter(char)) {
        if (prefix.length < 2) {
          prefix += char
        } else {
          // Prefix is full, move to number
          currentSegment = 'number'
          if (isDigit(char)) {
            number += char
          } else if (isLetter(char)) {
            // Edge case: extra letter goes to suffix
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
        // If already 4 digits, ignore additional digits
      } else if (isLetter(char)) {
        currentSegment = 'suffix'
        suffix += char
      }
    } else if (currentSegment === 'suffix') {
      if (isLetter(char)) {
        if (suffix.length < 3) {
          suffix += char
        }
        // If already 3 letters, ignore additional letters
      }
      // Ignore any digits after suffix starts
    }
  }

  // Build formatted string with spaces
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

/**
 * Get plate validation status and error message
 */
export function validatePlate(plate: string): { valid: boolean; error?: string } {
  const trimmed = plate.trim()

  if (!trimmed) {
    return { valid: false, error: 'Nomor plat tidak boleh kosong' }
  }

  // Check if too short
  const raw = trimmed.replace(/\s+/g, '')
  if (raw.length < 3) {
    return { valid: false, error: 'Nomor plat terlalu pendek' }
  }

  // Check for valid format with proper spacing
  if (!PLATE_REGEX_STRICT.test(trimmed)) {
    // Try without spaces
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

/**
 * Get plate segments for analysis
 */
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

/**
 * Check if plate segment is at max length
 */
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
