import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_ENCRYPTION_KIND,
  decryptArchivePayload,
  encryptArchivePayload,
} from '../../server/api/archiveCrypto'

const payload = {
  app: 'Trip Angkutan',
  kind: 'synced-trips',
  format: 3,
  officer: { id: 'o-1', name: 'Petugas Satu' },
  trips: [{ id: 'TRP20261119134826', routeFrom: 'Badau', routeTo: 'Ponteh' }],
}

describe('archiveCrypto', () => {
  it('membungkus payload dan bisa dibuka kembali tanpa mengubah data', async () => {
    const envelope = await encryptArchivePayload(payload, Date.parse('2026-11-19T12:00:00Z'))

    expect(envelope.kind).toBe(ARCHIVE_ENCRYPTION_KIND)
    expect(envelope.ciphertext).not.toContain('TRP20261119134826')
    const result = await decryptArchivePayload(envelope)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.encrypted).toBe(true)
    expect(result.payload).toEqual(payload)
  })

  it('menolak ciphertext yang diubah', async () => {
    const envelope = await encryptArchivePayload(payload)
    const ciphertext = envelope.ciphertext
    const last = ciphertext.at(-1)!
    envelope.ciphertext = `${ciphertext.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`

    const result = await decryptArchivePayload(envelope)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('tidak dapat dibuka')
  })

  it('menolak amplop yang salt/IV-nya diganti', async () => {
    const first = await encryptArchivePayload(payload)
    const second = await encryptArchivePayload(payload)
    const swapped = { ...first, salt: second.salt, iv: second.iv }

    const result = await decryptArchivePayload(swapped)

    expect(result.ok).toBe(false)
  })

  it('mengembalikan JSON lama sebagai tidak terenkripsi', async () => {
    const result = await decryptArchivePayload(payload)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.encrypted).toBe(false)
    expect(result.payload).toEqual(payload)
  })

  it('menolak amplop dengan format atau kunci yang tidak dikenal', async () => {
    const envelope = await encryptArchivePayload(payload)

    expect((await decryptArchivePayload({ ...envelope, format: 99 })).ok).toBe(false)
    expect((await decryptArchivePayload({ ...envelope, keyId: 'v-lain' })).ok).toBe(false)
  })
})
