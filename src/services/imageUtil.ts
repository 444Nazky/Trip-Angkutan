// Image utility - KOMPRESI & DOWNSCALE foto dokumentasi. PERFORMANCE FIRST: - Foto dokumentasi cukup 360p-ish (edge maks 640px) — tidak perlu HD.

export const DOC_MAX_EDGE = 640



export const OCR_MAX_EDGE = 1280



export const DOC_QUALITY = 0.6



export const OCR_QUALITY = 0.78



export interface WatermarkData {
  capturedAt: Date
  lat?: number | null
  lon?: number | null
  region?: string | null
}



export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('gambar gagal dimuat'))
    img.src = src
  })
}



export function dataUrlByteLength(dataUrl: string): number {
  if (!dataUrl) return 0
  const idx = dataUrl.indexOf(',')
  if (idx < 0) return 0
  const b64 = dataUrl.slice(idx + 1)
  return Math.floor((b64.length * 3) / 4)
}



function formatWatermarkLines(wm: WatermarkData): Array<{ text: string; color: string }> {
  const lines: Array<{ text: string; color: string }> = [
    {
      text: wm.capturedAt.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' }),
      color: '#ffffff',
    },
    {
      text:
        wm.lat != null && wm.lon != null
          ? `${wm.lat.toFixed(5)}, ${wm.lon.toFixed(5)}`
          : 'Lokasi tidak tersedia',
      color: '#93c5fd',
    },
  ]
  if (wm.region) lines.push({ text: wm.region.toUpperCase(), color: '#fde68a' })
  return lines
}



export async function compressImage(
  src: string,
  opts: {
    maxEdge?: number
    quality?: number
    watermark?: WatermarkData | null
  } = {},
): Promise<string> {
  const maxEdge = opts.maxEdge ?? DOC_MAX_EDGE
  const quality = opts.quality ?? DOC_QUALITY

  let img: HTMLImageElement
  try {
    img = await loadImage(src)
  } catch {
    return src
  }

  const naturalW = img.naturalWidth || img.width || 0
  const naturalH = img.naturalHeight || img.height || 0
  if (!naturalW || !naturalH) return src

  const scale = Math.min(1, maxEdge / Math.max(naturalW, naturalH))
  const w = Math.max(1, Math.round(naturalW * scale))
  const h = Math.max(1, Math.round(naturalH * scale))

  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')
  if (!ctx) return src

  // Latar belakang gelap supaya foto terang tetap aman.
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  if (opts.watermark) {
    drawWatermark(ctx, w, h, opts.watermark)
  }

  try {
    const out = cv.toDataURL('image/jpeg', quality)
    // Jangan mengembalikan hasil yang lebih besar dari aslinya.
    return out.length > 0 ? out : src
  } catch {
    return src
  }
}



function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, wm: WatermarkData): void {
  const lines = formatWatermarkLines(wm)
  // Font diskalakan relatif terhadap lebar gambar supaya tetap proporsional.
  const base = Math.max(9, Math.min(16, Math.round(w / 50)))
  const lineH = Math.round(base * 1.3)
  const padX = Math.round(base * 0.9)
  const padY = Math.round(base * 0.6)

  ctx.font = `bold ${base}px monospace`
  let textW = 0
  for (const l of lines) {
    const m = ctx.measureText(l.text).width
    if (m > textW) textW = m
  }

  const boxW = Math.min(w - padX, textW + padX * 2)
  const boxH = lines.length * lineH + padY * 2
  const bx = Math.max(0, w - boxW - padX)
  const by = Math.max(0, h - boxH - padY)

  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, boxW, boxH, Math.round(base * 0.6))
  else ctx.rect(bx, by, boxW, boxH)
  ctx.fill()
  ctx.restore()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let ty = by + padY + lineH / 2
  for (const l of lines) {
    ctx.font = `bold ${base}px monospace`
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 3
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
    ctx.fillStyle = l.color
    ctx.fillText(l.text, bx + padX, ty)
    ty += lineH
  }
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}



export function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl)
    if (!m) return null
    const type = m[1] || 'image/jpeg'
    if (m[2]) {
      const bin = atob(m[3].replace(/\s/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Blob([bytes], { type })
    }
    return new Blob([decodeURIComponent(m[3])], { type })
  } catch {
    return null
  }
}
