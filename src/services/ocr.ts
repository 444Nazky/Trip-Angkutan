// ─── OCR Service ──────────────────────────────────────────────────────────────
// Baca nomor plat dari foto memakai tesseract.js (jalan di browser).

import { createWorker } from 'tesseract.js'

// ─── Plate Format ──────────────────────────────────────────────────────────────
// Plat Indonesia: 1-2 huruf, 1-4 angka, 1-3 huruf akhir
// Format standar: "B 1234 XY" atau "DK 99 A"

function normalizePlate(text: string): string {
  // Clean: uppercase, remove weird chars, normalize spaces
  let result = text.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
  // Remove leading/trailing spaces
  result = result.trim()
  // Collapse multiple spaces to single space
  result = result.replace(/\s+/g, ' ')
  return result
}

function toStandardFormat(text: string): string {
  // Convert to standard format: "B 1234 XY"
  const stripped = text.replace(/\s/g, '')

  // Match: 1-2 letters + 1-4 numbers + 0-3 letters
  const match = stripped.match(/^([A-Z]{1,2})([0-9]{1,4})([A-Z]{0,3})$/)
  if (match) {
    const [, letters, numbers, suffix] = match
    if (suffix) {
      return `${letters} ${numbers} ${suffix}`
    }
    return `${letters} ${numbers}`
  }

  // If already in good format, return as-is
  return text
}

// ─── OCR with Pre-processing ───────────────────────────────────────────────────

function preprocessImage(src: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  // Scale up for better OCR accuracy
  const scale = 2
  const w = src instanceof HTMLCanvasElement ? src.width : (src as HTMLImageElement).naturalWidth
  const h = src instanceof HTMLCanvasElement ? src.height : (src as HTMLImageElement).naturalHeight
  canvas.width = w * scale
  canvas.height = h * scale

  ctx.imageSmoothingEnabled = false
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data
  const pixels = canvas.width * canvas.height

  // Convert to grayscale and apply contrast
  let min = 255, max = 0
  for (let i = 0; i < pixels; i++) {
    const gray = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    if (gray < min) min = gray
    if (gray > max) max = gray
  }

  const range = max - min || 1

  // Apply contrast enhancement and binarization
  for (let i = 0; i < pixels; i++) {
    const idx = i * 4
    const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
    const normalized = ((gray - min) / range) * 255
    const thresholded = normalized > 140 ? 255 : 0
    data[idx] = thresholded
    data[idx + 1] = thresholded
    data[idx + 2] = thresholded
  }

  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'))
    reader.readAsDataURL(blob)
  })
}

async function preprocessSrc(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(preprocessImage(canvas))
    }
    img.onerror = reject
    img.src = src
  })
}

/**
 * OCR satu gambar → kandidat nomor plat.
 * Returns cleaned plate in standard format: "B 1234 XY"
 */
export async function readPlateFromImage(image: Blob | string): Promise<string> {
  const src = typeof image === 'string' ? image : await blobToDataUrl(image)

  // Apply preprocessing for better accuracy
  let processedSrc = src
  try {
    processedSrc = await preprocessSrc(src)
  } catch {
    processedSrc = src
  }

  const worker = await createWorker('eng')
  try {
    const { data } = await worker.recognize(processedSrc)

    // Get all text lines from OCR result
    const allText = data.text + '\n' + (data.hocr || '')

    // Extract candidate plates from OCR text
    const candidates: string[] = []

    // Method 1: Match complete plate pattern in lines
    // Format: 1-2 letters + 1-4 digits + 1-3 letters (with or without spaces)
    const platePattern = /([A-Z]{1,2})\s*([0-9]{1,4})\s*([A-Z]{1,3})/g
    let match
    while ((match = platePattern.exec(allText)) !== null) {
      const [, letters, numbers, suffix] = match
      const plate = `${letters}${numbers}${suffix}`
      if (plate.length >= 4 && plate.length <= 10) {
        candidates.push(plate)
      }
    }

    // Method 2: Extract from each line separately
    const lines = allText.split(/[\n\r]+/)
    for (const line of lines) {
      const cleaned = normalizePlate(line)
      if (cleaned.length >= 4) {
        // Try to find plate pattern in this line
        const lineMatch = cleaned.match(/([A-Z]{1,2})\s*([0-9]{1,4})\s*([A-Z]{0,3})/)
        if (lineMatch) {
          const plate = (lineMatch[1] + lineMatch[2] + lineMatch[3]).replace(/\s/g, '')
          if (plate.length >= 4 && plate.length <= 10) {
            candidates.push(plate)
          }
        }
      }
    }

    // Method 3: Find any alphanumeric sequence that looks like a plate
    const alphanumeric = allText.replace(/[^A-Z0-9]/g, '')
    const alphaMatch = alphanumeric.match(/[A-Z]{1,2}[0-9]{1,4}[A-Z]{1,3}/)
    if (alphaMatch) {
      candidates.push(alphaMatch[0])
    }

    // Return best candidate (longest valid plate)
    if (candidates.length > 0) {
      // Sort by length descending, then by how well it matches the pattern
      candidates.sort((a, b) => b.length - a.length)

      // Take the longest one that's still valid
      for (const candidate of candidates) {
        const normalized = toStandardFormat(candidate)
        // Validate: should have 1-2 letters, 1-4 numbers, optional 1-3 letters
        const stripped = normalized.replace(/\s/g, '')
        if (/^[A-Z]{1,2}[0-9]{1,4}[A-Z]{0,3}$/.test(stripped) && stripped.length >= 4) {
          return normalized
        }
      }
    }

    return ''
  } finally {
    await worker.terminate()
  }
}
