/**
 * Design tokens untuk admin dashboard.
 *
 * Semua halaman admin (kecuali tab "Pengaturan" yang tampil fullscreen dengan
 * tema terminal gelap) memakai token dari file ini supaya warnanya, radius,
 * border, dan tipografinya konsisten antar halaman:
 *
 *   - Laporan, Master Tarif, Master Plat, Master Rute, Master Region, Petugas,
 *     dan Endpoint.
 *
 * Palet (dipakai user, jangan ganti):
 *   - #1E293B (slate-800) : bidang gelap - sidebar, baris pengelompok tabel.
 *   - #2563EB (blue-600)  : aksen utama - item menu aktif, garis aksen header,
 *                           kepala tabel, tombol.
 *   - #FFFFFF             : permukaan kartu dan header halaman.
 *   - #F8FAFC (slate-50)  : latar area kerja.
 *
 * Aturan warna:
 *   - Header halaman TETAP PUTIH (lihat `PAGE_HEADER`). Warna come dari aksen
 *     biru di tepi kiri, bukan dari bidang gelap.
 *   - Only sidebar + baris pengelompok tabel yang boleh gelap.
 *
 * Turunan (tint dari palet di atas, boleh):
 *   - Garis pemisah : slate-200 (kartu) / slate-100 (isi tabel).
 *   - Teks          : slate-900 (judul) > slate-700 (isi) > slate-500 (bantu) >
 *                      slate-400 (nonaktif).
 *   - Status        : emerald (aman), amber (perhatian), red (bahaya),
 *                      slate (belum siap).
 *
 * PENTING: jangan pakai CSS variable yang belum didefinisikan (mis.
 * `var(--admin-accent)`) - aturan itu sudah pernah menyebabkan grafik tidak
 * tampil. Semua warna di sini pakai kelas Tailwind biasa.
 */

/** Wadah halaman: jarak antar blok seragam. */
export const PAGE = 'space-y-4'

/** Judul halaman. */
export const PAGE_TITLE = 'text-lg font-black text-slate-900'

/** Subjudul / keterangan di bawah judul. */
export const PAGE_SUBTITLE = 'text-[12px] text-slate-500'

/** Judul bagian/kartu. */
export const SECTION_TITLE = 'text-[13px] font-bold text-slate-800'

/** Label kecil di atas angka ringkasan (mis. "Total Trip"). */
export const STAT_LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-slate-400'

/** Nilai besar ringkasan. */
export const STAT_VALUE = 'mt-1 text-2xl font-black text-slate-900'

/** Label form. */
export const LABEL = 'text-[11px] font-semibold text-slate-500'

/** Kartu utama (permukaan putih di atas latar slate-50). */
export const CARD = 'rounded-2xl border border-slate-200 bg-white shadow-sm'

/** Header halaman: permukaan putih dengan garis aksen biru di tepi kiri. */
export const PAGE_HEADER =
  'relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm'

/** Garis aksen biru di tepi kiri header halaman. */
export const PAGE_HEADER_BAR = 'absolute inset-y-0 left-0 w-1 bg-blue-600'

/** Judul di dalam header. */
export const PAGE_HEADER_TITLE = 'text-lg font-black text-slate-900'

/** Subjudul di dalam header. */
export const PAGE_HEADER_SUB = 'mt-0.5 text-[12px] text-slate-500'

/** Panel sekunder (latar sedikit lebih gelap dari kartu). */
export const CARD_SUBTLE = 'rounded-2xl border border-slate-200 bg-slate-50'

/** Wadah tabel: kartu + overflow tersembunyi + radius seragam. */
export const TABLE_WRAP = 'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'

/** Baris kepala tabel: tint biru tipis (tint dari aksen #2563EB). */
export const TABLE_HEAD_ROW = 'bg-blue-50 text-[10px] font-semibold uppercase tracking-wide text-slate-600'

/** Baris kepala tabel tingkat kedua (mis. "Ada Muatan" / "Kosong"). */
export const TABLE_SUBHEAD_ROW = 'bg-blue-50/60 text-[10px] font-medium text-slate-500'

/** Sel kepala tabel. */
export const TABLE_HEAD_CELL = 'border-b border-slate-200 px-3 py-2'

/** Baris isi tabel. */
export const TABLE_ROW = 'border-b border-slate-100 text-[12.5px] text-slate-700'

/** Sel isi tabel. */
export const TABLE_CELL = 'px-3 py-2'

/** Sel isi tabel dengan garis bawah (tabel bergaya "grid" pada sheet laporan). */
export const TABLE_CELL_GRID = 'border border-slate-200 px-3 py-2'

/** Sel kepala tabel bergaya "grid". */
export const TABLE_HEAD_CELL_GRID = 'border border-slate-200 px-3 py-2.5'

/** Baris pengelompok (mis. per tanggal / per golongan): latar gelap. */
export const GROUP_ROW = 'bg-slate-800 text-white'

/** Sel pada baris pengelompok. */
export const GROUP_ROW_CELL = 'border border-slate-700 px-3 py-2.5'

/** Baris total (footer tabel). */
export const FOOT_ROW = 'bg-slate-100 font-bold text-slate-700'

/** Sel pada baris total. */
export const FOOT_CELL = 'border border-slate-300 px-3 py-3'

/** Label kecil sebaris (mis. golongan kendaraan, status muatan). */
export const PILL = 'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold'

/** Label netral (tanpa status khusus). */
export const PILL_NEUTRAL = 'border-slate-200 bg-white text-slate-600'

/** Label positif (hijau). */
export const PILL_OK = 'border-emerald-200 bg-emerald-50 text-emerald-700'

/** Halaman penuh (sheet laporan & rekap): latar terang. */
export const SHEET_BODY = 'min-h-screen bg-slate-50 text-slate-800'

/** Header lengket di sheet laporan & rekap. */
export const SHEET_HEADER = 'sticky top-0 z-30 border-b border-slate-200 bg-white text-slate-800'

/** Keadaan kosong di dalam tabel. */
export const EMPTY_STATE = 'p-8 text-center text-slate-400'

/** Tautan aksi di dalam tabel (mis. "Edit", "Hapus"). */
export const LINK_PRIMARY = 'text-[12px] font-bold text-blue-600 transition hover:text-blue-700'

/** Tautan aksi berbahaya (mis. "Hapus"). */
export const LINK_DANGER = 'text-[12px] font-bold text-red-500 transition hover:text-red-600'

/** Tombol utama (aksen biru). */
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40'

/** Tombol sekunder (outline). */
export const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[12px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'

/** Tombol ringan (tanpa border, untuk aksi sekunder di header). */
export const BTN_GHOST =
  'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40'

/** Tombol ikon (hapus dsb). */
export const BTN_ICON =
  'inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40'

/** Tombol ringkas (header sheet laporan & rekap). */
export const BTN_COMPACT =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'

/** Tombol ringkas beraksen biru (aksi utama di header sheet). */
export const BTN_COMPACT_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40'

/** Kolom input / select / textarea. */
export const INPUT =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400'

/** Label status (lingkaran status server). */
export const BADGE =
  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold'

/** Warna label status: server tersambung. */
export const BADGE_OK = 'bg-emerald-50 text-emerald-600'

/** Warna label status: offline / perlu perhatian. */
export const BADGE_WARN = 'bg-amber-50 text-amber-600'

/** Warna label status: gagal / ditolak. */
export const BADGE_ERROR = 'bg-red-50 text-red-600'

/** Warna label status: belum siap / netral. */
export const BADGE_MUTED = 'bg-slate-100 text-slate-500'

/** Titik status (lingkaran kecil di dalam label). */
export const DOT_OK = 'bg-emerald-500'
export const DOT_WARN = 'bg-amber-500'
export const DOT_ERROR = 'bg-red-500'
export const DOT_MUTED = 'bg-slate-400 animate-pulse'

/** Pita peringatan (koneksi gagal). */
export const ALERT_ERROR =
  'rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700'

/** Notifikasi mengambang (toast) - sukses. */
export const TOAST =
  'fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 px-4 py-3 text-[13px] font-semibold text-white shadow-lg'

/** Notifikasi mengambang (toast) - gagal. */
export const TOAST_ERROR =
  'fixed bottom-6 right-6 z-50 rounded-xl bg-red-600 px-4 py-3 text-[13px] font-semibold text-white shadow-lg'
