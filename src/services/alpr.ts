import * as ort from 'onnxruntime-web/wasm'
import { preloadPlateOcr, readPlateFromImage, readPlateTextFromCanvas } from './ocr'
import { formatPlateNumber, sanitizePlateInput } from '../utils/plateFormatter'

/**
 * ALPR on-device (offline-first).
 *
 * Model: YOLOv8/11 license-plate detector (ONNX, agnostik merek) hasil
 * fine-tune publik "yolov11-license-plate-detection" (MIT). Arsitektur ini
 * sama dengan rujukan Intel/license-plate-recognition (YOLO detector +
 * PP-OCR recognizer) — versi aslinya OpenVINO IR untuk CPU/GPU/NPU x86
 * sehingga tidak bisa dijalankan di WebView Android, jadi detektornya dipakai
 * dalam format ONNX di dalam aplikasi dan teks plat dibaca OCR lokal.
 *
 * Semua berkas (model, wasm, traineddata) dibundel di APK: tidak ada
 * permintaan jaringan sama sekali.
 */

const MODEL_URL = 'assets/models/plate-yolo11n.onnx'
const INPUT_SIZE = 640
const SCORE_THRESHOLD = 0.25
// Ambang lebih longgar untuk potongan gambar: plat yang jauh/terlalu miring
// sering hanya berskor 0,2-0,4, dan kita masih menyaringnya lewat pola plat.
const TILE_SCORE_THRESHOLD = 0.18
const IOU_THRESHOLD = 0.45
// Kotak plat yang terlalu kecil (plat sangat jauh) tidak cukup piksel untuk
// dibaca pasti. Lebih baik dibiarkan kosong + peringatan daripada mengisi
// formulir dengan plat yang salah baca.
// Diuji pada foto 1600 px yang diperkecil ke 1280: kotak setinggi ~23 px masih
// terbaca benar, ~20 px sudah salah huruf terakhir (UEA → UES).
const MIN_BOX_HEIGHT = 21

export interface PlateBox {
  x1: number
  y1: number
  x2: number
  y2: number
  score: number
}

export interface LetterboxParams {
  scale: number
  dx: number
  dy: number
}

export interface AlprResult {
  plate: string
  confidence: number
  box: PlateBox
  /** Potongan gambar plat (data URL JPEG) untuk data latih koreksi. */
  cropDataUrl?: string
  /** Waktu pemindaian (deteksi + OCR) dalam milidetik. */
  elapsedMs?: number
}

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href
}

// ── Post-processing (fungsi murni, diuji di alpr.test.ts) ──────────────────

/** Decode keluaran YOLO [1, 4+nc, N] atau [1, N, 4+nc] jadi kotak + skor. */
export function decodeYoloOutput(
  data: Float32Array | number[],
  dims: readonly number[],
  scoreThreshold = SCORE_THRESHOLD,
): PlateBox[] {
  if (dims.length !== 3) return []
  const [, d1, d2] = dims
  // channels-first (4+nc baris, format Ultralytics) atau channels-last?
  // Jumlah kanal selalu kecil (4 + jumlah kelas), sedangkan jumlah anchor
  // besar (8400 untuk input 640), jadi sumbu kecil = kanal.
  const channelsFirst = d1 <= 64
  const channels = channelsFirst ? d1 : d2
  const count = channelsFirst ? d2 : d1
  if (channels < 5) return []

  const boxes: PlateBox[] = []
  for (let i = 0; i < count; i++) {
    const at = (c: number) => (channelsFirst ? data[c * count + i] : data[i * channels + c])
    let score = 0
    for (let c = 4; c < channels; c++) score = Math.max(score, at(c))
    if (score < scoreThreshold) continue
    const cx = at(0)
    const cy = at(1)
    const w = at(2)
    const h = at(3)
    if (!(w > 0) || !(h > 0)) continue
    boxes.push({
      x1: cx - w / 2,
      y1: cy - h / 2,
      x2: cx + w / 2,
      y2: cy + h / 2,
      score,
    })
  }
  return boxes
}

export function iou(a: PlateBox, b: PlateBox): number {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  if (!inter) return 0
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / (areaA + areaB - inter)
}

export function nonMaxSuppression(boxes: PlateBox[], iouThreshold = IOU_THRESHOLD): PlateBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score)
  const kept: PlateBox[] = []
  for (const box of sorted) {
    if (kept.some(k => iou(k, box) > iouThreshold)) continue
    kept.push(box)
  }
  return kept
}

export function letterboxParams(width: number, height: number, size = INPUT_SIZE): LetterboxParams {
  const scale = Math.min(size / width, size / height)
  return {
    scale,
    dx: Math.floor((size - Math.round(width * scale)) / 2),
    dy: Math.floor((size - Math.round(height * scale)) / 2),
  }
}

/** Kembalikan koordinat kotak dari ruang letterbox ke piksel gambar asli. */
export function boxToSource(box: PlateBox, params: LetterboxParams, width: number, height: number): PlateBox {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))
  return {
    x1: clamp((box.x1 - params.dx) / params.scale, width),
    y1: clamp((box.y1 - params.dy) / params.scale, height),
    x2: clamp((box.x2 - params.dx) / params.scale, width),
    y2: clamp((box.y2 - params.dy) / params.scale, height),
    score: box.score,
  }
}

// ── Sesi model (lazy, sekali per aplikasi) ─────────────────────────────────

let sessionPromise: Promise<ort.InferenceSession> | null = null

function loadSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    ort.env.wasm.wasmPaths = assetUrl('assets/ort/')
    // 1 thread: WebView tidak punya SharedArrayBuffer (butuh COOP/COEP).
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
    sessionPromise = (async () => {
      const res = await fetch(assetUrl(MODEL_URL))
      if (!res.ok) throw new Error(`Model ALPR tidak dapat dimuat (${res.status})`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      return ort.InferenceSession.create(bytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
    })().catch(err => {
      sessionPromise = null
      throw err
    })
  }
  return sessionPromise
}

/**
 * Siapkan pipeline lebih awal (model ONNX + worker OCR) supaya pemindaian
 * pertama setelah jepret tidak menanggung waktu muat model 10 MB dan wasm OCR.
 * Aman dipanggil berkali-kali.
 */
let warmedUp = false
export function warmUpAlpr(): void {
  if (warmedUp) return
  warmedUp = true
  preloadPlateOcr()
  void loadSession().catch(() => { warmedUp = false })
}

// ── Pipeline gambar ────────────────────────────────────────────────────────

function canvasFromSource(src: HTMLCanvasElement | HTMLImageElement, maxEdge: number): HTMLCanvasElement {
  const w = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth
  const h = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(w * scale))
  out.height = Math.max(1, Math.round(h * scale))
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Canvas tidak tersedia')
  ctx.drawImage(src, 0, 0, out.width, out.height)
  return out
}

function toInputTensor(canvas: HTMLCanvasElement): { data: Float32Array; params: LetterboxParams } {
  const params = letterboxParams(canvas.width, canvas.height)
  const size = INPUT_SIZE
  const work = document.createElement('canvas')
  work.width = size
  work.height = size
  const ctx = work.getContext('2d')
  if (!ctx) throw new Error('Canvas tidak tersedia')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, size, size)
  const w = Math.round(canvas.width * params.scale)
  const h = Math.round(canvas.height * params.scale)
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, params.dx, params.dy, w, h)

  const { data } = ctx.getImageData(0, 0, size, size)
  const plane = size * size
  const out = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    out[i] = data[i * 4] / 255
    out[plane + i] = data[i * 4 + 1] / 255
    out[2 * plane + i] = data[i * 4 + 2] / 255
  }
  return { data: out, params }
}

export async function detectPlateBoxes(
  src: HTMLCanvasElement | HTMLImageElement,
  maxEdge = 1280,
  scoreThreshold = SCORE_THRESHOLD,
): Promise<{ boxes: PlateBox[]; canvas: HTMLCanvasElement }> {
  const session = await loadSession()
  const canvas = canvasFromSource(src, maxEdge)
  const boxes = await inferBoxes(session, canvas, scoreThreshold)
  return { boxes, canvas }
}

/** Jalankan model pada satu canvas (tanpa letterbox tambahan di luar input). */
async function inferBoxes(
  session: ort.InferenceSession,
  canvas: HTMLCanvasElement,
  scoreThreshold: number,
): Promise<PlateBox[]> {
  const { data, params } = toInputTensor(canvas)
  const tensor = new ort.Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE])
  const output = await session.run({ [session.inputNames[0]]: tensor })
  const out = output[session.outputNames[0]]
  const raw = decodeYoloOutput(out.data as Float32Array, out.dims as number[], scoreThreshold)
  return nonMaxSuppression(raw).map(b => boxToSource(b, params, canvas.width, canvas.height))
}

/**
 * Deteksi bertingkat untuk foto kendaraan dari depan: plat sering hanya
 * menempati sebagian kecil bingkai, sehingga setelah gambar utuh diperkecil
 * ke 640 px platnya tinggal beberapa puluh piksel dan terlewat.
 *
 * Gambar dipotong jadi kisi 2 kolom x 3 baris yang saling tumpang-tindih,
 * tiap potongan diperbesar tersendiri, lalu kotak digabung kembali ke
 * koordinat gambar asli (NMS lintas potongan).
 */
export async function detectPlateBoxesTiled(
  canvas: HTMLCanvasElement,
  scoreThreshold = TILE_SCORE_THRESHOLD,
): Promise<PlateBox[]> {
  const session = await loadSession()
  // 2x2 potongan (bukan 3x3): setiap potongan 70% x 60% dengan tumpang-tindih
  // 30-40%, cukup untuk menangkap plat di mana pun tanpa 9 kali inferensi.
  // Pada HP kelas menengah, 4 inferensi memotong waktu deteksi ~55%.
  const tileW = Math.round(canvas.width * 0.7)
  const tileH = Math.round(canvas.height * 0.6)
  if (tileW < 80 || tileH < 40) return []
  const xs = [0, canvas.width - tileW]
  const ys = [0, canvas.height - tileH]

  const found: PlateBox[] = []
  for (const y of ys) {
    for (const x of xs) {
      const tile = document.createElement('canvas')
      tile.width = tileW
      tile.height = tileH
      const ctx = tile.getContext('2d')
      if (!ctx) continue
      ctx.drawImage(canvas, x, y, tileW, tileH, 0, 0, tileW, tileH)
      const boxes = await inferBoxes(session, tile, scoreThreshold)
      for (const b of boxes) {
        found.push({ x1: b.x1 + x, y1: b.y1 + y, x2: b.x2 + x, y2: b.y2 + y, score: b.score })
      }
    }
  }
  return nonMaxSuppression(found, IOU_THRESHOLD)
}

export function cropPlate(canvas: HTMLCanvasElement, box: PlateBox, padRatio = 0.08): HTMLCanvasElement {
  const padX = (box.x2 - box.x1) * padRatio
  const padY = (box.y2 - box.y1) * padRatio
  const x = Math.max(0, Math.floor(box.x1 - padX))
  const y = Math.max(0, Math.floor(box.y1 - padY))
  const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(box.x2 - box.x1 + padX * 2)))
  const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(box.y2 - box.y1 + padY * 2)))
  // Perbesar agar tinggi ~120 px: OCR butuh teks cukup besar.
  const scale = Math.max(1, Math.min(4, 120 / h))
  const out = document.createElement('canvas')
  out.width = Math.round(w * scale)
  out.height = Math.round(h * scale)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Canvas tidak tersedia')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height)
  return out
}

/**
 * Baca plat dari foto apa adanya: deteksi kotak plat (YOLO) lalu OCR kotak itu.
 * Mengembalikan null jika tidak ada plat yang terbaca.
 */
export interface PlateScanOptions {
  /** Sisi terpanjang gambar kerja. Lebih kecil = lebih cepat. */
  maxEdge?: number
  /** Deteksi per potongan bila gambar penuh tidak menemukan plat. */
  tiles?: boolean
}

export async function readPlateFromPhoto(
  src: HTMLCanvasElement | HTMLImageElement,
  options: PlateScanOptions = {},
): Promise<AlprResult | null> {
  const started = Date.now()
  try {
    // 1024 px cukup: plat yang lebih kecil dari itu tetap terdeteksi lewat
    // potongan, sedangkan 1280 hanya menambah ~40% waktu inferensi.
    const { boxes, canvas } = await detectPlateBoxes(src, options.maxEdge ?? 1024)
    const fromFull = await readFromBoxes(canvas, boxes)
    if (fromFull) return { ...fromFull, elapsedMs: Date.now() - started }

    // Foto dari depan kendaraan: plat kecil di bingkai lebar. Coba lagi dengan
    // deteksi per potongan sebelum menyerah.
    if (options.tiles !== false && canvas.width >= 240 && canvas.height >= 160) {
      const tiled = await detectPlateBoxesTiled(canvas)
      const fromTiles = await readFromBoxes(canvas, tiled)
      if (fromTiles) return { ...fromTiles, elapsedMs: Date.now() - started }
    }
    return null
  } catch (err) {
    console.warn('[alpr] gagal membaca plat', err)
    return null
  }
}

/** OCR kotak-kotak plat (urut skor) sampai ada yang cocok pola plat Indonesia. */
async function readFromBoxes(canvas: HTMLCanvasElement, boxes: PlateBox[]): Promise<AlprResult | null> {
  for (const box of boxes.slice(0, 4)) {
    if (box.y2 - box.y1 < MIN_BOX_HEIGHT) continue
    const crop = cropPlate(canvas, box)
    const text = await readPlateTextFromCanvas(crop)
    if (!text) continue
    const plate = formatPlateNumber(sanitizePlateInput(text))
    if (!plate) continue
    return { plate, confidence: box.score, box, cropDataUrl: crop.toDataURL('image/jpeg', 0.85) }
  }
  return null
}

/** Untuk mode kamera "Scan Plat Nomor": deteksi YOLO lalu OCR.
 *  Jika tidak ada kotak plat yang terdeteksi, OCR seluruh gambar sebagai
 *  cadangan (mis. plat sudah memenuhi layar). */
export async function readPlateWithDetector(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl)
  const result = await readPlateFromPhoto(img)
  if (result?.plate) return result.plate
  try {
    return await readPlateFromImage(dataUrl)
  } catch {
    return ''
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Gambar tidak dapat dibaca'))
    img.src = src
  })
}
