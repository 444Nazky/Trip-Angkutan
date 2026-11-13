/**
 * Aturan tombol Muatan / Kosong pada form input kendaraan.
 *
 * Kondisi kendaraan hanya ditanyakan untuk kendaraan EKSTERNAL yang jenisnya
 * truk kecil, truk sedang, truk besar, atau jenis apa pun yang menyebut
 * "trip". Di luar kombinasi itu tombolnya tidak ditampilkan: kendaraan
 * Internal tidak ditagih (Rp 0) dan tarif Lokal tidak membedakan muatan,
 * sehingga pilihan tersebut tidak mengubah tarif apa pun.
 *
 * Pencocokan jenis tidak peduli huruf besar/kecil dan ejaan "truk"/"truck",
 * karena nama jenis berasal dari master yang diisi admin.
 */
export function loadChoiceApplies(category: string, vehicleType: string): boolean {
  if (category.trim().toLowerCase() !== 'eksternal') return false
  const type = vehicleType.trim().toLowerCase()
  if (!type) return false
  if (type.includes('trip')) return true
  return /tru[ck]k?/.test(type) && /(kecil|sedang|besar)/.test(type)
}
