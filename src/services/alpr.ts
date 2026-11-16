import * as ort from 'onnxruntime-web/wasm'
import { readPlateFromImage, readPlateTextFromCanvas } from './ocr'
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
const IOU_THRESHOLD = 0.45

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
): Promise<{ boxes: PlateBox[]; canvas: HTMLCanvasElement }> {
  const session = await loadSession()
  const canvas = canvasFromSource(src, maxEdge)
  const { data, params } = toInputTensor(canvas)
  const tensor = new ort.Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE])
  const output = await session.run({ [session.inputNames[0]]: tensor })
  const out = output[session.outputNames[0]]
  const raw = decodeYoloOutput(out.data as Float32Array, out.dims as number[])
  const boxes = nonMaxSuppression(raw).map(b => boxToSource(b, params, canvas.width, canvas.height))
  return { boxes, canvas }
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
export async function readPlateFromPhoto(
  src: HTMLCanvasElement | HTMLImageElement,
): Promise<AlprResult | null> {
  try {
    const { boxes, canvas } = await detectPlateBoxes(src)
    if (!boxes.length) return null

    for (const box of boxes.slice(0, 3)) {
      const crop = cropPlate(canvas, box)
      const text = await readPlateTextFromCanvas(crop)
      if (!text) continue
      const plate = formatPlateNumber(sanitizePlateInput(text))
      if (!plate) continue
      return { plate, confidence: box.score, box }
    }
    return null
  } catch (err) {
    console.warn('[alpr] gagal membaca plat', err)
    return null
  }
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
