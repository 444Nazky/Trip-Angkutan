/**
 * Verifikasi sidik jari / passkey perangkat.
 *
 * Memakai WebAuthn dengan authenticator platform (fingerprint, Face ID, atau
 * PIN layar kunci). Kredensial didaftarkan sekali per petugas di perangkat ini,
 * lalu setiap pengiriman trip meminta verifikasi biometrik.
 *
 * Kalau perangkat/WebView tidak mendukung WebAuthn, pemanggil memakai PIN
 * petugas sebagai cadangan — jadi petugas tidak pernah terkunci.
 */

const CREDENTIAL_PREFIX = 'trip.biometric.credential.v1.'

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

export function hasBiometricCredential(officerId: string): boolean {
  return !!storedCredentialId(officerId)
}

/** Apakah perangkat punya authenticator platform yang bisa dipakai. */
export async function biometricAvailable(): Promise<boolean> {
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

/**
 * Daftarkan sidik jari petugas di perangkat ini.
 * Mengembalikan 'ok' bila kredensial tersimpan.
 */
export async function enrollBiometric(officer: { id: string; name: string; username?: string }): Promise<BiometricOutcome> {
  if (!(await biometricAvailable())) return 'unavailable'
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
 * 'unavailable' = perangkat tidak mendukung; pemanggil memakai PIN.
 */
export async function verifyBiometric(officer: { id: string; name: string; username?: string }): Promise<BiometricOutcome> {
  if (!(await biometricAvailable())) return 'unavailable'
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
