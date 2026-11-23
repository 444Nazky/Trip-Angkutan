/**
 * Aturan tombol Muatan / Kosong pada form input kendaraan.
 *
 * Kondisi kendaraan hanya ditanyakan untuk kendaraan EKSTERNAL yang jenisnya
 * termasuk kendaraan angkutan barang:
 *   Truk Besar, Trado, Tanki Besar, Truk 7 Ton, Pickup, LV.
 * Di luar kombinasi itu tombolnya tidak ditampilkan: kendaraan Internal tidak
 * ditagih (Rp 0) dan tarif Lokal tidak membedakan muatan, sehingga pilihan
 * tersebut tidak mengubah tarif apa pun.
 *
 * Pencocokan jenis memakai kunci normalisasi yang sama dengan master jenis
 * kendaraan di server (`vehicleTypeKey`): huruf kecil, "truck" -> "truk",
 * tanpa spasi/tanda baca. Jadi "Truk 7 Ton" == "truk7ton" dan
 * "Tank Besar" tetap dibedakan dari "Tanki Besar".
 */

/** Kunci jenis kendaraan yang memakai pilihan muatan. */
const LOAD_CHOICE_KEYS = new Set([
  'trukbesar',
  'trado',
  'tankibesar',
  'truk7ton',
  'pickup',
  'lv',
])

export function loadChoiceApplies(category: string, vehicleType: string): boolean {
  if (category.trim().toLowerCase() !== 'eksternal') return false
  const key = String(vehicleType ?? '')
    .trim()
    .toLowerCase()
    .replace(/truck/g, 'truk')
    .replace(/[^a-z0-9]/g, '')
  if (!key) return false
  return LOAD_CHOICE_KEYS.has(key)
}
