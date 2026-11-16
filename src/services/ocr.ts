import { createWorker, PSM, type Worker } from 'tesseract.js'
import { formatPlateNumber, sanitizePlateInput } from '../utils/plateFormatter'

/**
 * OCR plat nomor — 100% offline.
 *
 * Semua berkas mesin OCR (worker, wasm core, eng.traineddata) dibundel di
 * `src/assets/tesseract` dan dimuat dari aset lokal aplikasi. Sebelumnya
 * `createWorker('eng')` mengambil worker/core/traineddata dari CDN sehingga
 * gagal saat perangkat benar-benar offline.
 */

const PLATE_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href
}

let workerPromise: Promise<Worker> | null = null

/** Worker OCR dipakai bersama supaya model hanya dimuat sekali per sesi. */
export function getPlateWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: assetUrl('assets/tesseract/worker.min.js'),
      corePath: assetUrl('assets/tesseract/tesseract-core-simd-lstm.wasm.js'),
      langPath: assetUrl('assets/tesseract/lang'),
      // Berkas traineddata disimpan TANPA gzip: pengemasan APK Android
      // otomatis membuka berkas .gz (eng.traineddata.gz jadi eng.traineddata)
      // sehingga permintaan .gz akan 404 saat offline.
      gzip: false,
      logger: () => { /* senyap: proses berjalan di latar */ },
    })
      .then(async worker => {
        await worker.setParameters({
          tessedit_char_whitelist: PLATE_WHITELIST,
          // PSM 6 (blok teks) jauh lebih akurat untuk potongan plat daripada
          // SINGLE_LINE: baris tunggal memotong karakter saat garis tepi plat
          // ikut masuk. Diuji pada foto plat asli: PSM 6 "62A05772" vs PSM 7 "72".
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        })
        return worker
      })
      .catch(err => {
        workerPromise = null
        throw err
      })
  }
  return workerPromise
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Gambar tidak dapat dibaca'))
    img.src = src
  })
}

// ── Pra-proses ─────────────────────────────────────────────────────────────

/** Ambang Otsu: batas hitam/putih yang menyesuaikan kontras gambar plat. */
export function otsuThreshold(gray: Uint8ClampedArray): number {
  const hist = new Array(256).fill(0)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

interface Variant {
  canvas: HTMLCanvasElement
  invert: boolean
}

/** Perbesar potongan plat: Tesseract akurat saat tinggi teks ~40-80 px. */
function upscale(crop: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  if (factor <= 1) return crop
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(crop.width * factor)
  canvas.height = Math.round(crop.height * factor)
  const ctx = canvas.getContext('2d')
  if (!ctx) return crop
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(crop, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Buat beberapa varian gambar dari potongan plat (asli + biner terang/gelap). */
function buildVariants(rawCrop: HTMLCanvasElement): Variant[] {
  // JANGAN memperbesar potongan yang sudah cukup tinggi: diuji pada foto plat
  // di bingkai lebar, upscale 120→240 px justru mengaburkan tepi huruf dan
  // membuat "B 9701 UEA" terbaca "39701UEF". Potongan setinggi ~120 px
  // (hasil cropPlate) dibaca apa adanya; hanya potongan sangat kecil (plat
  // jauh) yang diperbesar, maksimal 3x.
  const factor = rawCrop.height < 80 ? Math.max(1, Math.min(3, 120 / Math.max(1, rawCrop.height))) : 1
  const crop = upscale(rawCrop, factor)
  const ctx = crop.getContext('2d')
  if (!ctx) return []
  const { width, height } = crop
  const src = ctx.getImageData(0, 0, width, height)
  const gray = new Uint8ClampedArray(width * height)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * src.data[i * 4] + 0.587 * src.data[i * 4 + 1] + 0.114 * src.data[i * 4 + 2]
  }
  const threshold = otsuThreshold(gray)

  const make = (invert: boolean): Variant => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const c = canvas.getContext('2d')
    if (c) {
      const out = c.createImageData(width, height)
      for (let i = 0; i < gray.length; i++) {
        const dark = gray[i] <= threshold
        const value = (invert ? !dark : dark) ? 0 : 255
        out.data[i * 4] = value
        out.data[i * 4 + 1] = value
        out.data[i * 4 + 2] = value
        out.data[i * 4 + 3] = 255
      }
      c.putImageData(out, 0, 0)
    }
    return { canvas, invert }
  }

  const plain = document.createElement('canvas')
  plain.width = width
  plain.height = height
  plain.getContext('2d')?.drawImage(crop, 0, 0)

  return [{ canvas: plain, invert: false }, make(false), make(true)]
}

// ── Pembersihan teks ───────────────────────────────────────────────────────

/**
 * Skor kandidat teks plat: makin mirip pola Indonesia (AA 1234 BBB) makin tinggi.
 * Dipakai untuk memilih hasil OCR terbaik dari beberapa varian gambar.
 */
export function scorePlateCandidate(text: string): number {
  const raw = String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (raw.length < 4 || raw.length > 9) return 0
  if (!/^[A-Z]{1,2}[0-9]{1,4}[A-Z]{0,3}$/.test(raw)) return 0
  const digits = (raw.match(/[0-9]/g) || []).length
  if (!digits) return 0
  // Utamakan yang punya 1-2 huruf depan dan 1-4 angka, lalu yang lebih panjang.
  return 100 + digits * 4 + (raw.length >= 5 ? 6 : 0) + raw.length
}

// Tabel koreksi salah-baca OCR yang umum pada plat: huruf terbaca angka dan
// sebaliknya. Dipakai HANYA pada posisi yang memang harusnya huruf/angka.
const DIGIT_TO_LETTER: Record<string, string> = {
  '0': 'O', '1': 'I', '2': 'Z', '3': 'B', '4': 'A', '5': 'S', '6': 'G', '7': 'T', '8': 'B', '9': 'P',
}
const LETTER_TO_DIGIT: Record<string, string> = {
  O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', A: '4', S: '5', G: '6', T: '7', B: '8', P: '9',
}

interface PlateCandidate {
  plate: string
  corrections: number
}

function toLetters(segment: string): { value: string; corrections: number } {
  let corrections = 0
  let value = ''
  for (const ch of segment) {
    if (/[A-Z]/.test(ch)) value += ch
    else {
      value += DIGIT_TO_LETTER[ch] ?? ch
      corrections++
    }
  }
  return { value, corrections }
}

function toDigits(segment: string): { value: string; corrections: number } {
  let corrections = 0
  let value = ''
  for (const ch of segment) {
    if (/[0-9]/.test(ch)) value += ch
    else {
      const mapped = LETTER_TO_DIGIT[ch]
      if (!mapped) return { value: '', corrections: Number.POSITIVE_INFINITY }
      value += mapped
      corrections++
    }
  }
  return { value, corrections }
}

/**
 * Ubah satu baris teks OCR jadi kandidat plat Indonesia.
 * Menerima pembacaan yang sudah benar maupun yang perlu 1-3 koreksi
 * (mis. "39701UEA" → "B 9701 UEA"), karena Tesseract sering menukar B/8,
 * O/0, S/5 pada foto plat. Kandidat dengan koreksi terbanyak dibuang.
 */
export function interpretPlateLine(line: string): PlateCandidate | null {
  const cleaned = String(line ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (cleaned.length < 4 || cleaned.length > 9) return null
  // Harus ada huruf di baris aslinya: deretan angka murni bukan plat.
  if (!/[A-Z]/.test(cleaned)) return null

  let best: PlateCandidate | null = null
  for (const prefixLen of [2, 1]) {
    if (cleaned.length <= prefixLen) continue
    const head = toLetters(cleaned.slice(0, prefixLen))
    const rest = cleaned.slice(prefixLen)
    const m = rest.match(/^([A-Z0-9]{1,4})([A-Z0-9]{0,3})$/)
    if (!m) continue
    // Segmen tengah wajib angka; segmen belakang wajib huruf (bila ada).
    if (!m[1].length) continue
    // Derau seperti "HELLO" tidak boleh lolos: sebagian besar segmen tengah
    // harus benar-benar terbaca sebagai angka, bukan dikoreksi semua.
    const naturalDigits = (m[1].match(/[0-9]/g) || []).length
    if (naturalDigits < 2) continue
    const body = toDigits(m[1])
    if (body.corrections > 2) continue
    const tail = m[2] ? toLetters(m[2]) : { value: '', corrections: 0 }
    const corrections = head.corrections + body.corrections + tail.corrections
    if (!Number.isFinite(corrections) || corrections > 3) continue
    if (!/^[A-Z]{1,2}$/.test(head.value) || !/^[0-9]{1,4}$/.test(body.value)) continue
    if (body.value.length < 1) continue
    const plate = `${head.value}${body.value}${tail.value}`
    if (!/^[A-Z]{1,2}[0-9]{1,4}[A-Z]{0,3}$/.test(plate)) continue
    if (!best || corrections < best.corrections) best = { plate, corrections }
  }
  return best
}

/** Ambil kandidat plat (pola Indonesia) dari teks OCR multi-baris. */
export function plateCandidatesFromText(text: string): string[] {
  const out: string[] = []
  for (const line of String(text ?? '').split(/[\n\r]+/)) {
    const candidate = interpretPlateLine(line)
    if (candidate) out.push(candidate.plate)
  }
  return out
}

/** Kandidat plat terbaik (beserta jumlah koreksi) dari beberapa teks OCR. */
function bestCandidateWithCorrections(texts: string[]): PlateCandidate | null {
  let best: PlateCandidate | null = null
  let bestScore = 0
  for (const text of texts) {
    for (const line of String(text ?? '').split(/[\n\r]+/)) {
      const candidate = interpretPlateLine(line)
      if (!candidate) continue
      const score = scorePlateCandidate(candidate.plate) - candidate.corrections * 10
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
  }
  return best
}

function bestCandidate(texts: string[]): string {
  const best = bestCandidateWithCorrections(texts)
  if (!best) return ''
  return formatPlateNumber(sanitizePlateInput(best.plate))
}

// ── API publik ─────────────────────────────────────────────────────────────

/** Teks mentah dari semua varian pra-proses (dipakai untuk pemilihan terbaik). */
export async function recognizeCropTexts(crop: HTMLCanvasElement): Promise<string[]> {
  const worker = await getPlateWorker()
  const texts: string[] = []
  for (const variant of buildVariants(crop)) {
    try {
      const { data } = await worker.recognize(variant.canvas)
      if (data?.text) texts.push(data.text)
    } catch { /* varian gagal, lanjut varian lain */ }
  }
  return texts
}

/** Muat worker + model OCR lebih awal (mis. saat formulir kendaraan dibuka). */
export function preloadPlateOcr(): void {
  void getPlateWorker().catch(() => { /* diabaikan: dicoba lagi saat dipakai */ })
}

/**
 * Baca teks plat dari potongan gambar plat (hasil deteksi YOLO).
 *
 * Varian diproses berurutan dan BERHENTI begitu satu varian sudah memberi
 * plat yang wajar tanpa koreksi. Sebelumnya ketiga varian selalu dijalankan,
 * jadi jalur cepat (foto jelas) tetap membayar 3x waktu OCR.
 */
export async function readPlateTextFromCanvas(crop: HTMLCanvasElement): Promise<string> {
  let worker: Worker
  try {
    worker = await getPlateWorker()
  } catch (err) {
    console.warn('[ocr] gagal membaca plat', err)
    return ''
  }

  const texts: string[] = []
  for (const variant of buildVariants(crop)) {
    try {
      const { data } = await worker.recognize(variant.canvas)
      const text = data?.text
      if (!text) continue
      texts.push(text)
      const candidate = bestCandidateWithCorrections(texts)
      if (candidate && candidate.corrections === 0) {
        return formatPlateNumber(sanitizePlateInput(candidate.plate))
      }
    } catch { /* varian gagal, lanjut varian lain */ }
  }
  return bestCandidate(texts)
}

/** Baca plat dari gambar utuh (dipakai setelah gambar diperkecil/di-crop). */
export async function readPlateFromImage(image: Blob | string): Promise<string> {
  const src = typeof image === 'string' ? image : await blobToDataUrl(image)
  const img = await loadImage(src)
  const canvas = document.createElement('canvas')
  const maxEdge = 1280
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
  return readPlateTextFromCanvas(canvas)
}
