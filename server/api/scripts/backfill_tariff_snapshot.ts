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
  // Baris tanpa penanda harga (data lama) DAN baris hasil restore lama yang
  // tercatat Rp 0. Restore sebelum perbaikan memakai nominal arsip apa adanya;
  // arsip dari HP bisa berisi tariff 0 saat cache tarif perangkat kosong,
  // sehingga dashboard menampilkan Rp 0 walau server punya tarif region.
  const { data: vehicles, error } = await db
    .from("vehicles")
    .select("id, vehicle_type, golongan, kategori, has_load, tariff_amount, tarif_source, trip_id")
    .not("trip_id", "is", null)
    .or("tarif_source.is.null,tarif_source.eq.restore");
  if (error) {
    console.error("Gagal membaca tabel vehicles:", error.message);
    Deno.exit(1);
  }

  const rows = ((vehicles ?? []) as VehicleRow[]).filter((v) => {
    const source = String(v.tarif_source ?? "").trim();
    if (!source) return true;
    // Restore dengan nominal > 0 sudah punya harga dari arsip; jangan diubah.
    return source === "restore" && (Number(v.tariff_amount ?? 0) || 0) <= 0;
  });
  console.log(`Baris kendaraan tanpa harga / restore Rp 0: ${rows.length}`);
  if (!rows.length) {
    console.log("Tidak ada yang perlu dibackfill.");
    return;
  }

  const tripIds = [...new Set(rows.map((v) => String(v.trip_id)).filter(Boolean))];
  const regionByTrip = new Map<string, string>();
  if (tripIds.length) {
    const { data: trips } = await db.from("trips").select("id, region_id").in("id", tripIds);
    for (const t of (trips ?? []) as any[]) {
      if (t?.region_id) regionByTrip.set(String(t.id), String(t.region_id));
    }
  }

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
      add(String(v.id), amount, "snapshot");
      frozen++;
      continue;
    }


    const kategori = normalizeCategory(v.kategori) ?? normalizeCategory(v.golongan);
    const resolved = await resolveTariff({
      vehicleType: v.vehicle_type ?? "",
      hasLoad: Number(v.has_load ?? 0) > 0,
      golongan: v.golongan,
      kategori,
      regionId: regionByTrip.get(String(v.trip_id)) ?? null,
    });
    if (resolved.source === "tanpa-tarif") {
      add(String(v.id), 0, "tanpa-tarif");
      stillZero++;
      continue;
    }
    // Internal (dan sumber lain yang memang Rp 0) tetap dicatat sumbernya,
    // bukan ditimpa "tanpa-tarif".
    add(String(v.id), Math.max(0, resolved.amount), resolved.source);
    if (resolved.amount > 0) filled++;
    else stillZero++;
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
