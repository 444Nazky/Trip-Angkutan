// Helper murni untuk mengelompokkan relasi officer (regions + dermagas).

export type OfficerExtras = { regions: any[]; dermagas: any[] };

// Mengelompokkan baris relasi hasil query bulk ke per-officer.
export function groupOfficerExtras(
  officerIds: string[],
  regionRows: { officer_id: unknown; regions?: any }[] | null | undefined,
  dermagaRows: { officer_id: unknown; dermagas?: any }[] | null | undefined,
): Record<string, OfficerExtras> {
  const map: Record<string, OfficerExtras> = {};
  for (const id of officerIds) map[String(id)] = { regions: [], dermagas: [] };

  for (const row of regionRows ?? []) {
    const bucket = map[String(row.officer_id)];
    if (bucket && row.regions) bucket.regions.push(row.regions);
  }
  for (const row of dermagaRows ?? []) {
    const bucket = map[String(row.officer_id)];
    if (bucket && row.dermagas) bucket.dermagas.push(row.dermagas);
  }
  return map;
}
