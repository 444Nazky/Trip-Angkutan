import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * Plugin native untuk menyimpan file lewat file manager Android
 * (Storage Access Framework / ACTION_CREATE_DOCUMENT).
 *
 * Isi file ditulis bertahap: begin → append → finish. Ekspor data trip bisa
 * berukuran puluhan MB karena memuat foto; mengirimnya sebagai satu string
 * membuat aplikasi kehabisan memori lalu tertutup dan menyisakan file 0 byte.
 * `base64: true` dipakai untuk arsip ZIP (byte biner), bukan teks JSON.
 */
interface SaveFilePlugin {
  begin(options: { filename: string; mimeType?: string }): Promise<{ uri: string; name: string }>
  append(options: { data: string; base64?: boolean }): Promise<{ bytes: number }>
  finish(): Promise<{ bytes: number; uri: string; name: string }>
  abort(): Promise<void>
}

const SaveFile = registerPlugin<SaveFilePlugin>('SaveFile')

export interface SaveFileResult {
  uri: string
  name: string
  bytes: number
}

export function canPickSaveLocation(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  } catch {
    return false
  }
}

/** Bagian teks yang aman dipotong tanpa memecah pasangan surrogate (emoji). */
export function splitChunk(text: string, max = 256 * 1024): string[] {
  if (text.length <= max) return [text]
  const parts: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + max, text.length)
    if (end < text.length) {
      const code = text.charCodeAt(end - 1)
      // High surrogate di akhir potongan: geser satu karakter supaya pasangan
      // surrogate tidak terbelah dan UTF-8 tetap valid.
      if (code >= 0xd800 && code <= 0xdbff) end -= 1
      if (end <= start) end = Math.min(start + max, text.length)
    }
    parts.push(text.slice(start, end))
    start = end
  }
  return parts
}

/**
 * Simpan potongan JSON ke lokasi yang dipilih petugas. Membuka pemilih file
 * dulu (`begin`), lalu menulis potongan satu per satu, dan menutup file.
 */
export async function saveChunksWithPicker(
  filename: string,
  chunks: Iterable<string> | AsyncIterable<string>,
): Promise<SaveFileResult> {
  return saveStreamWithPicker(filename, 'application/json', chunks, false)
}

/**
 * Simpan arsip biner (ZIP) ke lokasi yang dipilih petugas.
 *
 * Setiap potongan sudah berupa base64 utuh untuk satu rentang byte, jadi
 * plugin native hanya perlu men-decode per potongan lalu menulisnya. Ini
 * menghindari satu string base64 raksasa di memori WebView.
 */
export async function saveBinaryWithPicker(
  filename: string,
  mimeType: string,
  chunks: Iterable<string> | AsyncIterable<string>,
): Promise<SaveFileResult> {
  return saveStreamWithPicker(filename, mimeType, chunks, true)
}

async function saveStreamWithPicker(
  filename: string,
  mimeType: string,
  chunks: Iterable<string> | AsyncIterable<string>,
  base64: boolean,
): Promise<SaveFileResult> {
  const started = await SaveFile.begin({ filename, mimeType })
  let total = 0
  try {
    for await (const chunk of chunks) {
      if (!chunk) continue
      const res = await SaveFile.append({ data: chunk, base64 })
      if (typeof res?.bytes === 'number') total = res.bytes
    }
    const done = await SaveFile.finish()
    return {
      uri: done.uri || started.uri,
      name: done.name || started.name || filename,
      bytes: typeof done.bytes === 'number' ? done.bytes : total,
    }
  } catch (err) {
    try { await SaveFile.abort() } catch { /* stream sudah tertutup */ }
    throw err
  }
}
