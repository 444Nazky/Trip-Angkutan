/**
 * Stub services/trips.ts untuk admin build. Admin tabs mengimpor tipe dan fungsi dari module ini,
 * tapi admin build tidak butuh fungsi di TS strict mode.
 * Semua fungsi ini stub agar TypeScript tetap happy. */
export interface BackendTrip { id: string }
export interface ReportFilterOptions { label: string; value: string }[]
export interface ReportFilters { regions: string[]; vessels: string[] }
export interface ReportRecapRow { [key: string]: unknown }
export interface ReportSummary { label: string; value: unknown }
export interface ReportTrip { id: string; date: string; time: string }
export function dayKeyWib(date: Date): string {
  return date.toISOString().slice(0, 10)
}
export async function fetchTrips(): Promise<unknown[]> { return [] }
export async function fetchReportFilters(): Promise<ReportFilterOptions[]> { return [] }
export async function fetchReportSummary(): Promise<ReportSummary[]> { return [] }
export async function fetchTripReports(): Promise<unknown[]> { return [] }
export async function fetchReportRecap(): Promise<ReportRecapRow[]> { return [] }
export function formatReportDateTime(d: unknown): string { return String(d) }
