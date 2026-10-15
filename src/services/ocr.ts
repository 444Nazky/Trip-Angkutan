import { createWorker } from 'tesseract.js'




function normalizePlate(text: string): string {
  let result = text.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
  result = result.trim()
  result = result.replace(/\s+/g, ' ')
  return result
}




function toStandardFormat(text: string): string {
  const stripped = text.replace(/\s/g, '')

  const match = stripped.match(/^([A-Z]{1,2})([0-9]{1,4})([A-Z]{0,3})$/)
  if (match) {
    const [, letters, numbers, suffix] = match
    if (suffix) {
      return `${letters} ${numbers} ${suffix}`
    }
    return `${letters} ${numbers}`
  }

  return text
}




function preprocessImage(src: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

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

  let min = 255, max = 0
  for (let i = 0; i < pixels; i++) {
    const gray = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    if (gray < min) min = gray
    if (gray > max) max = gray
  }

  const range = max - min || 1

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




export async function readPlateFromImage(image: Blob | string): Promise<string> {
  const src = typeof image === 'string' ? image : await blobToDataUrl(image)

  let processedSrc = src
  try {
    processedSrc = await preprocessSrc(src)
  } catch {
    processedSrc = src
  }

  const worker = await createWorker('eng')
  try {
    const { data } = await worker.recognize(processedSrc)

    const allText = data.text + '\n' + (data.hocr || '')

    const candidates: string[] = []

    const platePattern = /([A-Z]{1,2})\s*([0-9]{1,4})\s*([A-Z]{1,3})/g
    let match
    while ((match = platePattern.exec(allText)) !== null) {
      const [, letters, numbers, suffix] = match
      const plate = `${letters}${numbers}${suffix}`
      if (plate.length >= 4 && plate.length <= 10) {
        candidates.push(plate)
      }
    }

    const lines = allText.split(/[\n\r]+/)
    for (const line of lines) {
      const cleaned = normalizePlate(line)
      if (cleaned.length >= 4) {
        const lineMatch = cleaned.match(/([A-Z]{1,2})\s*([0-9]{1,4})\s*([A-Z]{0,3})/)
        if (lineMatch) {
          const plate = (lineMatch[1] + lineMatch[2] + lineMatch[3]).replace(/\s/g, '')
          if (plate.length >= 4 && plate.length <= 10) {
            candidates.push(plate)
          }
        }
      }
    }

    const alphanumeric = allText.replace(/[^A-Z0-9]/g, '')
    const alphaMatch = alphanumeric.match(/[A-Z]{1,2}[0-9]{1,4}[A-Z]{1,3}/)
    if (alphaMatch) {
      candidates.push(alphaMatch[0])
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.length - a.length)

      for (const candidate of candidates) {
        const normalized = toStandardFormat(candidate)
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
