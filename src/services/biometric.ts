/**
 * Verifikasi sidik jari / passkey perangkat.
 *
 * Di APK Android dipakai plugin native `NativeBiometric` (BiometricPrompt),
 * karena WebView belum tentu mendukung WebAuthn. Di browser tetap memakai
 * WebAuthn dengan authenticator platform.
 *
 * Verifikasi hanya memakai sidik jari/passkey yang terdaftar di HP petugas.
 * Tidak ada cadangan PIN: kalau sensor tidak tersedia atau verifikasi ditolak,
 * petugas harus mencoba lagi di perangkat tersebut.
 */

import { Capacitor, registerPlugin } from '@capacitor/core'

const CREDENTIAL_PREFIX = 'trip.biometric.credential.v1.'
const NATIVE_PREFIX = 'trip.biometric.native.v1.'

interface NativeBiometricPlugin {
  isAvailable(): Promise<{ available: boolean; reason?: unknown }>
  verify(options?: {
    title?: string
    subtitle?: string
    description?: string
    negativeButtonText?: string
  }): Promise<{ verified: boolean }>
}

const NativeBiometric = registerPlugin<NativeBiometricPlugin>('NativeBiometric')

function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export type BiometricOutcome = 'ok' | 'unavailable' | 'cancelled' | 'failed'

function keyFor(officerId: string): string {
  return `${CREDENTIAL_PREFIX}${officerId}`
}

function randomChallenge(): Uint8Array {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytes
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (const b of view) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function storedCredentialId(officerId: string): string | null {
  try {
    return localStorage.getItem(keyFor(officerId))
  } catch {
    return null
  }
}

function nativeCredentialMissing(officerId: string): boolean {
  try {
    return localStorage.getItem(`${NATIVE_PREFIX}${officerId}`) !== '1'
  } catch {
    return true
  }
}

export function hasBiometricCredential(officerId: string): boolean {
  if (isNativeAndroid()) return !nativeCredentialMissing(String(officerId))
  return !!storedCredentialId(officerId)
}

/** Apakah perangkat punya authenticator platform yang bisa dipakai. */
export async function biometricAvailable(): Promise<boolean> {
  if (isNativeAndroid()) {
    try {
      const result = await NativeBiometric.isAvailable()
      return !!result.available
    } catch {
      return false
    }
  }
  try {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false
    if (typeof navigator === 'undefined' || !navigator.credentials) return false
    const fn = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
    if (typeof fn !== 'function') return false
    return await fn.call(PublicKeyCredential)
  } catch {
    return false
  }
}

async function verifyNativeBiometric(officerId: string): Promise<BiometricOutcome> {
  try {
    await NativeBiometric.verify({
      title: 'Verifikasi Sidik Jari',
      subtitle: 'Sebelum data trip dikirim ke server',
      description: 'Sentuh sensor sidik jari untuk melanjutkan.',
      negativeButtonText: 'Batal',
    })
    localStorage.setItem(`${NATIVE_PREFIX}${officerId}`, '1')
    return 'ok'
  } catch (err) {
    const code = String((err as { code?: string })?.code ?? '')
    if (code === 'CANCELLED') return 'cancelled'
    if (code === 'UNAVAILABLE') return 'unavailable'
    return 'failed'
  }
}

/**
 * Daftarkan sidik jari petugas di perangkat ini.
 * Mengembalikan 'ok' bila kredensial tersimpan.
 */
export async function enrollBiometric(officer: { id: string; name: string; username?: string }): Promise<BiometricOutcome> {
  if (!(await biometricAvailable())) return 'unavailable'
  if (isNativeAndroid()) return verifyNativeBiometric(String(officer.id))
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge() as unknown as BufferSource,
        rp: { name: 'Trip Angkutan', id: window.location.hostname },
        user: {
          id: new TextEncoder().encode(String(officer.id)) as unknown as BufferSource,
          name: officer.username || officer.name || 'petugas',
          displayName: officer.name || 'Petugas',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    }) as PublicKeyCredential | null
    if (!credential) return 'cancelled'
    localStorage.setItem(keyFor(String(officer.id)), toBase64(credential.rawId))
    return 'ok'
  } catch (err) {
    const name = (err as { name?: string })?.name ?? ''
    if (name === 'NotAllowedError') return 'cancelled'
    if (name === 'NotSupportedError' || name === 'SecurityError') return 'unavailable'
    return 'failed'
  }
}

/**
 * Minta verifikasi sidik jari. Kalau belum terdaftar, daftarkan dulu.
 * 'unavailable' = perangkat tidak punya sidik jari terdaftar; aksi ditolak.
 */
export async function verifyBiometric(officer: { id: string; name: string; username?: string }): Promise<BiometricOutcome> {
  if (!(await biometricAvailable())) return 'unavailable'
  if (isNativeAndroid()) return verifyNativeBiometric(String(officer.id))
  const stored = storedCredentialId(String(officer.id))
  if (!stored) {
    const enrolled = await enrollBiometric(officer)
    if (enrolled !== 'ok') return enrolled
  }
  const credentialId = storedCredentialId(String(officer.id))
  if (!credentialId) return 'unavailable'
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge() as unknown as BufferSource,
        allowCredentials: [{
          type: 'public-key',
          id: fromBase64(credentialId) as unknown as BufferSource,
          transports: ['internal'],
        }],
        userVerification: 'required',
        timeout: 60_000,
        rpId: window.location.hostname,
      },
    })
    return assertion ? 'ok' : 'cancelled'
  } catch (err) {
    const name = (err as { name?: string })?.name ?? ''
    if (name === 'NotAllowedError') return 'cancelled'
    if (name === 'NotSupportedError' || name === 'SecurityError') return 'unavailable'
    return 'failed'
  }
}
