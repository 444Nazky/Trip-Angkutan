// ─── OCR Service ──────────────────────────────────────────────────────────────
// Baca nomor plat dari foto memakai tesseract.js (jalan di browser).
// Include pre-processing & character correction untuk plat Indonesia.

import { createWorker } from 'tesseract.js'

// ─── Pre-processing ─────────────────────────────────────────────────────────────

function preprocessCanvas(src: HTMLCanvasElement | HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  // Scale up 2x for better OCR accuracy
  const scale = 2
  canvas.width = src instanceof HTMLCanvasElement ? src.width * scale : (src as HTMLImageElement).naturalWidth * scale
  canvas.height = src instanceof HTMLCanvasElement ? src.height * scale : (src as HTMLImageElement).naturalHeight * scale

  ctx.imageSmoothingEnabled = false
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data

  // Convert to grayscale and apply contrast enhancement
  const pixels = canvas.width * canvas.height
  let min = 255, max = 0

  // Pass 1: find min/max for normalization
  for (let i = 0; i < pixels; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    // Luminance
    const gray = 0.299 * r + 0.587 * g + 0.114 * b
    if (gray < min) min = gray
    if (gray > max) max = gray
  }

  const range = max - min || 1

  // Pass 2: normalize contrast + threshold
  for (let i = 0; i < pixels; i++) {
    const idx = i * 4
    const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
    // Normalize to 0-255
    const normalized = ((gray - min) / range) * 255
    // High contrast threshold (black or white)
    const thresholded = normalized > 140 ? 255 : 0
    data[idx] = thresholded
    data[idx + 1] = thresholded
    data[idx + 2] = thresholded
  }

  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

// ─── Character Correction ───────────────────────────────────────────────────────

// Common OCR mistakes for Indonesian plates (character → corrected)
// Based on visual similarity in standard OCR fonts
const CHAR_CORRECTIONS: [RegExp, string][] = [
  // Numbers commonly mistaken as letters
  [/8/g, 'B'],   // 8 → B
  [/0/g, 'O'],   // 0 → O
  [/1/g, 'I'],   // 1 → I
  [/2/g, 'Z'],   // 2 → Z (in some fonts)
  [/5/g, 'S'],   // 5 → S
  [/6/g, 'G'],   // 6 → G
  // Letters commonly mistaken as numbers
  [/O(?=[0-9])|(?<=[0-9])O/g, '0'], // O between numbers → 0
  [/I(?=[0-9])|(?<=[0-9])I(?=[0-9])/g, '1'], // I between numbers → 1
  [/Z(?=[0-9])|(?<=[0-9])Z/g, '2'], // Z between numbers → 2
  [/S(?=[0-9])|(?<=[0-9])S/g, '5'], // S between numbers → 5
  [/B(?=[0-9])|(?<=[0-9])B(?=[0-9])/g, '8'], // B between numbers → 8
]

function correctChars(text: string): string {
  // First apply position-aware corrections
  let result = text

  // Context-aware: letter between numbers → likely number
  result = result.replace(/([0-9])([B-Z])([0-9])/gi, (_, a, b, c) => {
    if (b === 'O') return a + '0' + c
    if (b === 'I') return a + '1' + c
    if (b === 'Z') return a + '2' + c
    if (b === 'S') return a + '5' + c
    if (b === 'B') return a + '8' + c
    return a + b + c
  })

  // Context-aware: number between letters → likely letter
  result = result.replace(/([A-Z])([0-9])([A-Z])/gi, (_, a, b, c) => {
    if (b === '0' && a !== '0' && c !== '0') return a + 'O' + c
    if (b === '1' && a !== '1' && c !== '1') return a + 'I' + c
    if (b === '2' && a !== '2' && c !== '2') return a + 'Z' + c
    if (b === '5' && a !== '5' && c !== '5') return a + 'S' + c
    if (b === '8' && a !== '8' && c !== '8') return a + 'B' + c
    return a + b + c
  })

  // End-of-plate corrections (usually letters)
  result = result.replace(/([A-Z][0-9])$/g, (match, context) => {
    const last = match.slice(-1)
    if (last === 'O') return context + 'O'
    if (last === 'I') return context + 'I'
    return match
  })

  // Beginning corrections (usually letters)
  result = result.replace(/^([0-9][A-Z])/g, (match, rest) => {
    const first = match[0]
    if (first === '0') return 'O' + rest
    if (first === '1') return 'I' + rest
    if (first === '2') return 'Z' + rest
    return match
  })

  return result
}

// ─── Plate Extraction ────────────────────────────────────────────────────────────

// Plat Indonesia: 1-2 huruf daerah, 1-4 angka, 1-3 huruf akhir
// Examples: "B 1234 XY", "DK 99 A", "B 1 ZZZ"
const PLATE_RE = /^[A-Z]{1,2}\s*[0-9]{1,4}\s*[A-Z]{1,3}$/

function cleanLine(line: string): string {
  let result = line.toUpperCase()
  // Remove non-alphanumeric except spaces
  result = result.replace(/[^A-Z0-9 ]/g, ' ')
  // Remove leading/trailing spaces and collapse internal spaces
  result = result.trim().replace(/\s+/g, ' ')
  // Apply character corrections
  result = correctChars(result)
  return result
}

function isValidPlate(text: string): boolean {
  // Test both with and without spaces for flexibility
  const normalized = text.replace(/\s+/g, '').toUpperCase()
  return PLATE_RE.test(normalized) && normalized.length >= 4 && normalized.length <= 10
}

function normalizePlate(text: string): string {
  // Ensure proper format: letters, space(s), numbers, space(s), letters (optional)
  const normalized = text.replace(/\s+/g, ' ').trim().toUpperCase()
  // If already has valid format, return as-is
  if (isValidPlate(normalized)) return normalized
  // Otherwise try to reconstruct from stripped version
  const stripped = normalized.replace(/\s/g, '')
  if (/^[A-Z]{1,2}[0-9]{1,4}[A-Z]{1,3}$/.test(stripped)) {
    // Insert space after letters, after numbers
    const letters1 = stripped.match(/^[A-Z]{1,2}/)?.[0] || ''
    const numbers = stripped.match(/[0-9]{1,4}/)?.[0] || ''
    const letters2 = stripped.match(/[A-Z]{1,3}$/)?.[0] || ''
    return [letters1, numbers, letters2].filter(Boolean).join(' ')
  }
  return normalized
}

/** Extract the best plate candidate from OCR text. */
export function extractPlate(rawText: string): string {
  const lines = rawText.split(/\n/).map(cleanLine).filter(l => l.length >= 4)

  // Priority 1: Full lines that match pattern
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, '')
    if (isValidPlate(normalized)) {
      return normalizePlate(normalized)
    }
  }

  // Priority 2: Combine adjacent words to form valid plate
  // This handles OCR splitting "B 1234 XY" or "B 1234" across multiple words
  const allText = lines.join(' ')
  const words = allText.split(/\s+/).filter(w => /^[A-Z0-9]+$/.test(w))

  for (let i = 0; i < words.length; i++) {
    // Try combinations of 2-4 words
    for (let n = 2; n <= 4 && i + n <= words.length; n++) {
      const combo = words.slice(i, i + n).join('')
      if (isValidPlate(combo)) {
        return normalizePlate(combo)
      }
    }
  }

  // Priority 3: Find any text that looks like a plate pattern and normalize it
  for (const line of lines) {
    const stripped = line.replace(/\s+/g, '')
    // Match: 1-2 letters, 1-4 numbers, 1-3 letters (optional)
    const match = stripped.match(/([A-Z]{1,2})([0-9]{1,4})([A-Z]{1,3})/)
    if (match) {
      return normalizePlate(stripped)
    }
    // Match: 1-2 letters, 1-4 numbers only (incomplete but valid start)
    const match2 = stripped.match(/([A-Z]{1,2})([0-9]{1,4})/)
    if (match2 && stripped.length >= 4) {
      return normalizePlate(stripped)
    }
  }

  // Priority 4: Last resort - extract any alphanumeric combo with letters and numbers
  const alphanumeric = allText.replace(/[^A-Z0-9]/g, '')
  if (/^[A-Z]{1,2}[0-9]{1,4}[A-Z]{1,3}$/.test(alphanumeric)) {
    return normalizePlate(alphanumeric)
  }

  return ''
}

// ─── OCR with Pre-processing ───────────────────────────────────────────────────

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'))
    reader.readAsDataURL(blob)
  })
}

async function applyPreprocessing(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(preprocessCanvas(canvas))
    }
    img.onerror = reject
    img.src = src
  })
}

/**
 * OCR satu gambar → kandidat nomor plat.
 * Includes pre-processing & character correction for Indonesian plates.
 */
export async function readPlateFromImage(image: Blob | string): Promise<string> {
  const src = typeof image === 'string' ? image : await blobToDataUrl(image)

  // Apply preprocessing for better accuracy
  let processedSrc = src
  try {
    processedSrc = await applyPreprocessing(src)
  } catch {
    // Fallback to original if preprocessing fails
    processedSrc = src
  }

  const worker = await createWorker('eng')
  try {
    const { data } = await worker.recognize(processedSrc)
    return extractPlate(data.text)
  } finally {
    await worker.terminate()
  }
}
