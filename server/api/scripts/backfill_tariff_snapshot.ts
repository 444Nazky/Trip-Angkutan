/**
 * Backfill snapshot tarif untuk trip yang sudah tercatat SEBELUM kolom
 * `vehicles.tarif_source` ada.
 *
 * Kenapa perlu:
 *   Laporan memakai harga yang tersimpan (snapshot) supaya perubahan tarif di
 *   admin tidak mengubah trip lama. Baris yang sudah punya `tariff_amount`
 *   > 0 aman: nilainya sudah jadi harga saat trip dikirim.
 *
 *   Yang bermasalah adalah baris lawas:
 *     - tariff_amount > 0 tapi tarif_source NULL  -> ditandai "snapshot"
 *       supaya tidak pernah dihitung ulang dengan tarif yang lebih baru.
 *     - tariff_amount = 0 / NULL                 -> belum ada harga sama sekali.
 *       Di sini harga yang berlaku SAAT INI dibekukan satu kali, lalu ditandai
 *       sebagai snapshot. Tanpa ini, baris ini akan ikut berubah setiap kali
 *       admin mengedit tarif.
 *
 * Script ini IDEMPOTEN: baris yang sudah punya tarif_source tidak disentuh.
 *
 * CARA JALAN (di PC kantor, lewat container API):
 *   docker compose exec api-intranet deno run --allow-env --allow-net \
 *     --node-modules-dir=none api/scripts/backfill_tariff_snapshot.ts
 *
 * Opsi:
 *   --dry-run=1   hanya menampilkan rencana, tidak menulis ke database.
 */

import { db } from "../_shared.ts";
import { resolveTariff, normalizeCategory } from "../handlers/tariffRules.ts";

const dryRun = Deno.args.includes("--dry-run=1") || Deno.args.includes("--dry-run");

interface VehicleRow {
  id: string;
  vehicle_type: string | null;
  golongan: string | null;
  kategori: string | null;
  has_load: number | null;
  tariff_amount: number | null;
  tarif_source: string | null;
  trip_id: string | null;
}

async function main() {
  const { data: vehicles, error } = await db
    .from("vehicles")
    .select("id, vehicle_type, golongan, kategori, has_load, tariff_amount, tarif_source, trip_id")
    .not("trip_id", "is", null)
    .is("tarif_source", null);
  if (error) {
    console.error("Gagal membaca tabel vehicles:", error.message);
    Deno.exit(1);
  }

  const rows = (vehicles ?? []) as VehicleRow[];
  console.log(`Baris kendaraan tanpa tarif_source: ${rows.length}`);
  if (!rows.length) {
    console.log("Tidak ada yang perlu dibackfill.");
    return;
  }

  // Region per trip (dipakai resolver tarif per region).
  const tripIds = [...new Set(rows.map((v) => String(v.trip_id)).filter(Boolean))];
  const regionByTrip = new Map<string, string>();
  if (tripIds.length) {
    const { data: trips } = await db.from("trips").select("id, region_id").in("id", tripIds);
    for (const t of (trips ?? []) as any[]) {
      if (t?.region_id) regionByTrip.set(String(t.id), String(t.region_id));
    }
  }

  // Kelompokkan per nilai akhir supaya ditulis per batch, bukan per baris.
  const groups = new Map<string, { ids: string[]; amount: number; source: string }>();
  const add = (id: string, amount: number, source: string) => {
    const key = `${amount}|${source}`;
    const g = groups.get(key);
    if (g) g.ids.push(id);
    else groups.set(key, { ids: [id], amount, source });
  };

  let frozen = 0;
  let filled = 0;
  let stillZero = 0;

  for (const v of rows) {
    const amount = Number(v.tariff_amount ?? 0) || 0;
    if (amount > 0) {
      // Sudah punya harga -> bekukan sebagai snapshot.
      add(String(v.id), amount, "snapshot");
      frozen++;
      continue;
    }
    // Kategori: kolom kategori dulu, lalu nilai lawas di golongan.
    const kategori = normalizeCategory(v.kategori) ?? normalizeCategory(v.golongan);
    const resolved = await resolveTariff({
      vehicleType: v.vehicle_type ?? "",
      hasLoad: Number(v.has_load ?? 0) > 0,
      golongan: v.golongan,
      kategori,
      regionId: regionByTrip.get(String(v.trip_id)) ?? null,
    });
    if (resolved.source === "tanpa-tarif" || resolved.amount <= 0) {
      add(String(v.id), 0, "tanpa-tarif");
      stillZero++;
      continue;
    }
    add(String(v.id), resolved.amount, resolved.source);
    filled++;
  }

  for (const [key, group] of groups) {
    const ids = group.ids;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      if (dryRun) {
        console.log(`[dry-run] ${chunk.length} baris -> amount=${group.amount} source=${group.source}`);
        continue;
      }
      const { error: upErr } = await db
        .from("vehicles")
        .update({ tariff_amount: group.amount, tarif_source: group.source })
        .in("id", chunk);
      if (upErr) {
        console.error(`Gagal menulis batch (${key}):`, upErr.message);
        Deno.exit(1);
      }
    }
    console.log(`  ${group.ids.length} baris -> amount=${group.amount} source=${group.source}`);
  }

  console.log(
    `Selesai${dryRun ? " (dry-run, tidak ada yang ditulis)" : ""}: ` +
    `dipertahankan=${frozen}, diisi=${filled}, tetap tanpa harga=${stillZero}`,
  );
}

await main();
