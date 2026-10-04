/**
 * Stub services/xlsx.ts agar tab Laporan (ReportsTab.tsx) bisa dicompile.
 * Admin build tidak perlu download Excel di sisi client. */
export async function downloadXlsx(_rows: unknown[], _filename: string): Promise<void> {
  // Admin build tidak perlu implementasi download Excel client-side.
  console.warn('downloadXlsx stub called')
}
