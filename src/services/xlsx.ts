// ─── XLSX Writer (zero dependency) ────────────────────────────────────────────
// Menulis berkas .xlsx yang valid tanpa pustaka eksternal.
// Sebuah .xlsx pada dasarnya adalah arsip ZIP berisi XML SpreadsheetML, jadi
// kita tulis ZIP metode "store" (tanpa kompresi) + CRC32 sendiri.

export interface XlsxSheet {
  /** Maksimal 31 karakter, tanpa karakter terlarang : * ? / \ [ ] */
  name: string
  /** Baris data; sel kosong = null/undefined. Angka ditulis sebagai numerik. */
  rows: (string | number | null | undefined)[][]
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const encoder = new TextEncoder()

// DOS time/date tetap (25 Sep 2026 12:00) — deterministik agar CRC stabil
const DOS_TIME = (12 << 11) | (0 << 5) | 0
const DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 25

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

function localHeader(nameLen: number, crc: number, size: number): Uint8Array {
  const b = new Uint8Array(30)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0x04034b50, true)
  v.setUint16(4, 20, true)   // version needed
  v.setUint16(6, 0, true)    // flags
  v.setUint16(8, 0, true)    // method: 0 = stored
  v.setUint16(10, DOS_TIME, true)
  v.setUint16(12, DOS_DATE, true)
  v.setUint32(14, crc, true)
  v.setUint32(18, size, true)
  v.setUint32(22, size, true)
  v.setUint16(26, nameLen, true)
  v.setUint16(28, 0, true)   // extra length
  return b
}

function centralHeader(nameLen: number, crc: number, size: number, offset: number): Uint8Array {
  const b = new Uint8Array(46)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0x02014b50, true)
  v.setUint16(4, 20, true)   // version made by
  v.setUint16(6, 20, true)   // version needed
  v.setUint16(8, 0, true)    // flags
  v.setUint16(10, 0, true)   // method: stored
  v.setUint16(12, DOS_TIME, true)
  v.setUint16(14, DOS_DATE, true)
  v.setUint32(16, crc, true)
  v.setUint32(20, size, true)
  v.setUint32(24, size, true)
  v.setUint16(28, nameLen, true)
  v.setUint16(30, 0, true)   // extra
  v.setUint16(32, 0, true)   // comment
  v.setUint16(34, 0, true)   // disk start
  v.setUint16(36, 0, true)   // internal attrs
  v.setUint32(38, 0, true)   // external attrs
  v.setUint32(42, offset, true)
  return b
}

function endOfCentralDirectory(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const b = new Uint8Array(22)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0x06054b50, true)
  v.setUint16(4, 0, true)
  v.setUint16(6, 0, true)
  v.setUint16(8, count, true)
  v.setUint16(10, count, true)
  v.setUint32(12, cdSize, true)
  v.setUint32(16, cdOffset, true)
  v.setUint16(20, 0, true)
  return b
}

/** Buat arsip ZIP (metode store) dari daftar berkas. */
function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const nameBytes = encoder.encode(f.name)
    const crc = crc32(f.data)
    const header = localHeader(nameBytes.length, crc, f.data.length)

    localChunks.push(header, nameBytes, f.data)

    centralChunks.push(centralHeader(nameBytes.length, crc, f.data.length, offset), nameBytes)
    offset += header.length + nameBytes.length + f.data.length
  }

  const central = concat(centralChunks)
  const eocd = endOfCentralDirectory(files.length, central.length, offset)
  return concat([...localChunks, central, eocd])
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Karakter yang tidak valid di XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/** 0 → A, 25 → Z, 26 → AA */
function colRef(index: number): string {
  let n = index
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

function safeSheetName(name: string, fallback: string): string {
  const cleaned = (name || fallback).replace(/[:*?/\\[\]]/g, ' ').trim().slice(0, 31)
  return cleaned || fallback
}

function sheetXml(rows: XlsxSheet['rows']): string {
  const body = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${colRef(c)}${r + 1}`
      if (value === null || value === undefined || value === '') return ''
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${cells}</row>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${body}</sheetData></worksheet>`
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>`
  + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
  + `<borders count="1"><border/></borders>`
  + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
  + `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>`
  + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
  + `</styleSheet>`

/** Susun berkas .xlsx dari beberapa sheet. */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const normalized = sheets.length > 0 ? sheets : [{ name: 'Sheet1', rows: [] }]

  const sheetNames = normalized.map((s, i) => safeSheetName(s.name, `Sheet${i + 1}`))

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + sheetNames.map((_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ).join('')
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + `</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
    + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets>`
    + sheetNames.map((n, i) =>
      `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    ).join('')
    + `</sheets></workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + sheetNames.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    ).join('')
    + `<Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `</Relationships>`

  const files: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
    { name: 'xl/styles.xml', data: encoder.encode(STYLES_XML) },
    ...normalized.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: encoder.encode(sheetXml(s.rows)),
    })),
  ]

  return buildZip(files)
}

/** Unduh berkas .xlsx ke perangkat pengguna. */
export function downloadXlsx(filename: string, sheets: XlsxSheet[]): void {
  const bytes = buildXlsx(sheets)
  // Salinan ke ArrayBuffer baru agar tipe BlobPart sesuai (Uint8Array<ArrayBufferLike>)
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
