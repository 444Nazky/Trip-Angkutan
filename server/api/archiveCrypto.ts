/**
 * Enkripsi arsip ekspor trip.
 *
 * `data_trip.json` tidak lagi berisi trip dalam bentuk terbaca. Isinya adalah
 * amplop AES-256-GCM: kerahasiaan + autentikasi. Mengubah satu byte pada
 * ciphertext, salt, IV, atau metadata amplop membuat dekripsi gagal, sehingga
 * data trip tidak bisa diedit lalu direstore diam-diam.
 *
 * Kunci diturunkan dengan PBKDF2-SHA-256 dan salt acak per arsip. Kunci ini
 * dipakai bersama aplikasi mobile dan server restore. Karena aplikasi harus
 * bisa membuat arsip saat offline, kunci tidak dapat disimpan hanya di server;
 * enkripsi ini melindungi berkas dari pengeditan langsung, bukan dari orang
 * yang membongkar APK dan sengaja mengambil kunci.
 */
export const ARCHIVE_ENCRYPTION_KIND = 'trip-angkutan-encrypted'
export const ARCHIVE_ENCRYPTION_FORMAT = 1
export const ARCHIVE_ENCRYPTION_ALG = 'AES-256-GCM'
export const ARCHIVE_ENCRYPTION_KDF = 'PBKDF2-SHA-256'
export const ARCHIVE_ENCRYPTION_ITERATIONS = 210_000
export const ARCHIVE_ENCRYPTION_KEY_ID = 'v1'

const ARCHIVE_KEY_ID = ARCHIVE_ENCRYPTION_KEY_ID
const ARCHIVE_PASSPHRASE = 'TripAngkutan::arsip-trip::v1::7f3c1b9e6a2d4f80b5c7e1a9d3f6b2c8'
const ARCHIVE_AAD = new TextEncoder().encode('trip-angkutan-archive:v1')
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16

export interface EncryptedArchiveEnvelope {
  app: 'Trip Angkutan'
  kind: typeof ARCHIVE_ENCRYPTION_KIND
  format: typeof ARCHIVE_ENCRYPTION_FORMAT
  alg: typeof ARCHIVE_ENCRYPTION_ALG
  kdf: typeof ARCHIVE_ENCRYPTION_KDF
  iterations: number
  keyId: string
  salt: string
  iv: string
  ciphertext: string
  createdAt: string
}

export type ArchiveDecryptResult =
  | { ok: true; payload: unknown; encrypted: boolean }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isEncryptedArchive(raw: unknown): raw is EncryptedArchiveEnvelope {
  return isRecord(raw) && (raw['kind'] === ARCHIVE_ENCRYPTION_KIND || raw['encrypted'] === true)
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(value: unknown): Uint8Array {
  const raw = String(value ?? '').replace(/\s/g, '')
  if (!raw) throw new Error('base64 kosong')
  const bin = atob(raw)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveArchiveKey(salt: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(ARCHIVE_PASSPHRASE) as unknown as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: ARCHIVE_ENCRYPTION_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

/** Bungkus payload ekspor menjadi amplop terenkripsi siap ditulis ke ZIP. */
export async function encryptArchivePayload(
  payload: unknown,
  now: number = Date.now(),
): Promise<EncryptedArchiveEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveArchiveKey(salt, 'encrypt')
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
      additionalData: ARCHIVE_AAD as unknown as BufferSource,
      tagLength: 128,
    },
    key,
    plaintext as unknown as BufferSource,
  ))

  return {
    app: 'Trip Angkutan',
    kind: ARCHIVE_ENCRYPTION_KIND,
    format: ARCHIVE_ENCRYPTION_FORMAT,
    alg: ARCHIVE_ENCRYPTION_ALG,
    kdf: ARCHIVE_ENCRYPTION_KDF,
    iterations: ARCHIVE_ENCRYPTION_ITERATIONS,
    keyId: ARCHIVE_KEY_ID,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    createdAt: new Date(now).toISOString(),
  }
}

/**
 * Buka amplop arsip. Payload lama yang masih JSON polos dikembalikan apa
 * adanya dengan `encrypted: false`; pemanggil yang memutuskan apakah arsip
 * lama masih boleh diterima.
 */
export async function decryptArchivePayload(raw: unknown): Promise<ArchiveDecryptResult> {
  if (!isEncryptedArchive(raw)) {
    return { ok: true, payload: raw, encrypted: false }
  }

  try {
    if (raw.format !== ARCHIVE_ENCRYPTION_FORMAT) {
      return { ok: false, error: `Format enkripsi arsip ${String(raw.format)} tidak didukung` }
    }
    if (raw.alg !== ARCHIVE_ENCRYPTION_ALG || raw.kdf !== ARCHIVE_ENCRYPTION_KDF) {
      return { ok: false, error: 'Algoritma enkripsi arsip tidak didukung' }
    }
    if (raw.keyId !== ARCHIVE_KEY_ID) {
      return { ok: false, error: 'Kunci arsip tidak dikenal. Ekspor ulang dengan aplikasi terbaru.' }
    }
    if (Number(raw.iterations) !== ARCHIVE_ENCRYPTION_ITERATIONS) {
      return { ok: false, error: 'Parameter enkripsi arsip tidak sesuai' }
    }

    const salt = base64ToBytes(raw.salt)
    const iv = base64ToBytes(raw.iv)
    const ciphertext = base64ToBytes(raw.ciphertext)
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ciphertext.length < TAG_BYTES) {
      return { ok: false, error: 'Isi arsip terenkripsi tidak lengkap' }
    }

    const key = await deriveArchiveKey(salt, 'decrypt')
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        additionalData: ARCHIVE_AAD as unknown as BufferSource,
        tagLength: 128,
      },
      key,
      ciphertext as unknown as BufferSource,
    )
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as unknown
    return { ok: true, payload, encrypted: true }
  } catch {
    return {
      ok: false,
      error: 'Arsip terenkripsi tidak dapat dibuka. Berkas mungkin diubah atau rusak; ekspor ulang dari aplikasi.',
    }
  }
}
