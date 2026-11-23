/**
 * Rentang tanggal untuk query `timestamptz`, dalam zona waktu WIB.
 *
 * `created_at` / `cancelled_at` disimpan sebagai timestamptz dan container
 * database berjalan di UTC. Tanpa offset, "2026-11-23T00:00:00" dibaca
 * sebagai tengah malam UTC = 07:00 WIB, sehingga trip pagi (00:00-06:59 WIB)
 * hilang dari laporan hari itu dan muncul di hari sebelumnya.
 *
 * Offset +07:00 ditulis eksplisit supaya hasilnya tidak bergantung pada zona
 * waktu mesin server.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Batas awal & akhir hari (inklusif) untuk satu tanggal `YYYY-MM-DD`. */
export function wibDayRange(date: unknown): { start: string; end: string } | null {
  const d = String(date ?? "").trim();
  if (!DATE_RE.test(d)) return null;
  return { start: `${d}T00:00:00+07:00`, end: `${d}T23:59:59.999+07:00` };
}

/**
 * Rentang dari query string `startDate` & `endDate`. Tiap batas divalidasi
 * sendiri-sendiri; parameter yang tidak valid/kosong tidak menghasilkan batas.
 */
export function wibDateRange(url: URL): { start?: string; end?: string } {
  const out: { start?: string; end?: string } = {};
  const start = wibDayRange(url.searchParams.get("startDate"));
  const end = wibDayRange(url.searchParams.get("endDate"));
  if (start) out.start = start.start;
  if (end) out.end = end.end;
  return out;
}
