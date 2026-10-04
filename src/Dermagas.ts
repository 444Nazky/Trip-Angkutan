/**
 * Stub pages/Dermagas.tsx agar RoutesTab bisa di-import di admin build.
 * path admin. Tidak dipakai di admin.
 */
export async function fetchDermagas(): Promise<unknown[]> { return [] }
export async function createDermaga(_data: unknown): Promise<string | null> { return null }
export async function updateDermaga(_id: string, _data: unknown): Promise<void> {}
export async function deleteDermaga(_id: string): Promise<void> {}
