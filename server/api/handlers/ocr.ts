// Handler pelatihan OCR plat nomor (dashboard admin `/ocr`).
//
// Alur:
//   1. Admin mengunggah foto plat + plat yang benar (label ground truth).
//      Berkas disimpan di `data/storage/ocr-samples`, metadata di `ocr_samples`.
//   2. `POST /ocr/train` membaca semua sampel lalu membangun model koreksi:
//      daftar plat valid hasil pengamatan manusia + tabel karakter yang paling
//      sering salah dibaca. Model ditulis ke `data/storage/ocr/plate-model.json`.
//   3. Aplikasi petugas mengambil model itu (`GET /ocr/model`, tanpa token,
//      karena dipakai di HP) dan memakainya untuk membetulkan hasil OCR:
//      plat yang hampir sama dengan plat terdaftar langsung "dikunci" ke versi
//      yang benar. Model kecil (beberapa KB) jadi tidak memperlambat OCR.
//
// Semua sampel juga bisa diunduh sebagai dataset JSON berisi gambar + label,
// untuk melatih ulang model Tesseract di luar server (format siap tesstrain).
import { db, errorText, json, requireAdmin } from "../_shared.ts";

const STORAGE_DIR = Deno.env.get("STORAGE_DIR") || "/data/storage";
const SAMPLE_BUCKET = "ocr-samples";
const MODEL_DIR = `${STORAGE_DIR}/ocr`;
const MODEL_FILE = `${MODEL_DIR}/plate-model.json`;

/** Batas jumlah sampel yang dipakai melatih: cukup untuk statistik stabil. */
const MAX_TRAIN_SAMPLES = 5000;
/** Batas ukuran satu gambar (setelah dikompres di browser admin). */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

type SampleRow = {
  id: string;
  image_path: string;
  predicted: string | null;
  corrected: string;
  source: string | null;
  created_at: string;
};

export type PlateModel = {
  version: number;
  samples: number;
  /** Plat benar yang pernah dikonfirmasi admin (tanpa spasi). */
  plates: string[];
  /** Pasangan karakter salah-baca: [dibaca, seharusnya, jumlah]. */
  confusions: [string, string, number][];
  trainedAt: string;
  /** Persentase sampel yang sudah benar tanpa koreksi model. */
  accuracy: number;
};

function emptyModel(): PlateModel {
  return { version: 0, samples: 0, plates: [], confusions: [], trainedAt: "", accuracy: 0 };
}

/** Normalisasi plat: huruf besar, hanya A-Z0-9, maksimum 9 karakter. */
function normalizePlate(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 9);
}

function decodeImage(dataUrl: string): Uint8Array | null {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const binary = atob(match[2]);
  if (binary.length > MAX_IMAGE_BYTES) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sampleFileExists(name: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(`${STORAGE_DIR}/${SAMPLE_BUCKET}/${name}`);
    return stat.isFile;
  } catch {
    return false;
  }
}

// ── Sampel ──────────────────────────────────────────────────────────────────

/** GET /ocr/samples — daftar sampel (terbaru dulu, tanpa memuat gambar). */
export async function listSamples(req: Request, url: URL): Promise<Response> {
  const ctx = await requireAdmin(req);
  if (!ctx) return json({ error: "Akses ditolak. Token admin dibutuhkan." }, 403);

  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200));
  const { data, error } = await db
    .from<SampleRow>("ocr_samples")
    .select("id, image_path, predicted, corrected, source, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return json({ error: "DB_ERROR", message: errorText(error) }, 500);
  }
  const rows = ((data ?? []) as SampleRow[]).map((row: SampleRow) => ({
    ...row,
    imageUrl: `/files/${SAMPLE_BUCKET}/${row.image_path}`,
  }));
  return json({ samples: rows, count: rows.length });
}

/** POST /ocr/samples — unggah satu sampel (JSON: image data URL + label). */
export async function createSample(req: Request): Promise<Response> {
  const ctx = await requireAdmin(req);
  if (!ctx) return json({ error: "Akses ditolak. Token admin dibutuhkan." }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "INVALID_JSON", message: "Body harus JSON." }, 400);
  }

  const corrected = normalizePlate(body.corrected);
  if (corrected.length < 4) {
    return json({ error: "INVALID_PLATE", message: "Plat yang benar minimal 4 karakter (mis. B7171XYE)." }, 400);
  }
  const image = decodeImage(String(body.image ?? ""));
  if (!image) {
    return json(
      { error: "INVALID_IMAGE", message: "Gambar harus data URL JPEG/PNG/WebP dan maksimal 2 MB." },
      400,
    );
  }

  const id = crypto.randomUUID();
  const fileName = `${id}.jpg`;
  try {
    await Deno.mkdir(`${STORAGE_DIR}/${SAMPLE_BUCKET}`, { recursive: true });
    await Deno.writeFile(`${STORAGE_DIR}/${SAMPLE_BUCKET}/${fileName}`, image);
  } catch (err) {
    return json({ error: "STORAGE_ERROR", message: errorText(err) }, 500);
  }

  const { error } = await db.from("ocr_samples").insert({
    id,
    image_path: fileName,
    predicted: normalizePlate(body.predicted),
    corrected,
    source: String(body.source ?? ctx.username ?? "admin").slice(0, 80),
  });
  if (error) {
    // Jangan tinggalkan berkas yatim kalau baris database gagal ditulis.
    await Deno.remove(`${STORAGE_DIR}/${SAMPLE_BUCKET}/${fileName}`).catch(() => {});
    return json({ error: "DB_ERROR", message: errorText(error) }, 500);
  }

  return json({
    success: true,
    sample: { id, image_path: fileName, corrected, imageUrl: `/files/${SAMPLE_BUCKET}/${fileName}` },
  });
}

/** DELETE /ocr/samples/:id — hapus sampel (berkas + baris). */
export async function deleteSample(req: Request, id: string): Promise<Response> {
  const ctx = await requireAdmin(req);
  if (!ctx) return json({ error: "Akses ditolak. Token admin dibutuhkan." }, 403);

  const { data, error } = await db
    .from<SampleRow>("ocr_samples")
    .select("id, image_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return json({ error: "DB_ERROR", message: errorText(error) }, 500);
  if (!data) return json({ error: "NOT_FOUND", message: "Sampel tidak ada." }, 404);

  const { error: delErr } = await db.from("ocr_samples").delete().eq("id", id);
  if (delErr) return json({ error: "DB_ERROR", message: errorText(delErr) }, 500);
  await Deno.remove(`${STORAGE_DIR}/${SAMPLE_BUCKET}/${data.image_path}`).catch(() => {});
  return json({ success: true, id });
}

// ── Status & model ──────────────────────────────────────────────────────────

async function readModel(): Promise<PlateModel> {
  try {
    const text = await Deno.readTextFile(MODEL_FILE);
    const parsed = JSON.parse(text) as PlateModel;
    if (!parsed || typeof parsed.version !== "number") return emptyModel();
    return {
      version: parsed.version,
      samples: Number(parsed.samples) || 0,
      plates: Array.isArray(parsed.plates) ? parsed.plates : [],
      confusions: Array.isArray(parsed.confusions) ? parsed.confusions : [],
      trainedAt: String(parsed.trainedAt ?? ""),
      accuracy: Number(parsed.accuracy) || 0,
    };
  } catch {
    return emptyModel();
  }
}

/** GET /ocr — ringkasan: jumlah sampel, jumlah plat unik, model aktif. */
export async function status(req: Request): Promise<Response> {
  const ctx = await requireAdmin(req);
  if (!ctx) return json({ error: "Akses ditolak. Token admin dibutuhkan." }, 403);

  const [{ count, error }, model] = await Promise.all([
    db.from("ocr_samples").select("id", { count: "exact", head: true }),
    readModel(),
  ]);
  if (error) return json({ error: "DB_ERROR", message: errorText(error) }, 500);

  const { data: last } = await db
    .from("ocr_models")
    .select("version, samples, plates, accuracy, created_at")
    .order("version", { ascending: false })
    .limit(1);

  return json({
    ok: true,
    sampleCount: count ?? 0,
    model: {
      version: model.version,
      samples: model.samples,
      plates: model.plates.length,
      confusions: model.confusions.length,
      accuracy: model.accuracy,
      trainedAt: model.trainedAt,
      history: last?.[0] ?? null,
    },
  });
}

/**
 * GET /ocr/model — model aktif untuk aplikasi petugas.
 *
 * Tidak memakai token: HP petugas tidak login sebagai admin, dan isinya hanya
 * daftar plat yang memang sudah tampil di formulir (bukan data pribadi).
 */
export async function getModel(_req: Request): Promise<Response> {
  const model = await readModel();
  return json(model, 200);
}

// ── Pelatihan ───────────────────────────────────────────────────────────────

/**
 * Bangun model dari sampel: plat terkonfirmasi + tabel salah-baca karakter.
 *
 * Sengaja statistik ringan (bukan gradient descent) supaya bisa berjalan di
 * server intranet tanpa GPU dan modelnya cukup beberapa KB untuk diunduh HP.
 */
export function buildModel(samples: { predicted?: string | null; corrected: string }[], version: number): PlateModel {
  const plates = new Set<string>();
  const confusion = new Map<string, number>();
  let exact = 0;
  let usable = 0;

  for (const sample of samples) {
    const corrected = normalizePlate(sample.corrected);
    if (!corrected) continue;
    usable++;
    plates.add(corrected);

    const predicted = normalizePlate(sample.predicted);
    if (!predicted) continue;
    if (predicted === corrected) {
      exact++;
      continue;
    }
    // Hanya bandingkan posisi yang sejajar (panjang sama); pergeseran panjang
    // biasanya berarti deteksi huruf hilang, bukan salah baca karakter.
    if (predicted.length !== corrected.length) continue;
    for (let i = 0; i < corrected.length; i++) {
      if (predicted[i] === corrected[i]) continue;
      const key = `${predicted[i]}→${corrected[i]}`;
      confusion.set(key, (confusion.get(key) ?? 0) + 1);
    }
  }

  const confusions = [...confusion.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split("→");
      return [from, to, count] as [string, string, number];
    })
    // Buang pasangan sekali muncul (bisa jadi salah ketik admin, bukan pola).
    .filter(([, , count]) => count >= 2)
    .sort((a, b) => b[2] - a[2])
    .slice(0, 200);

  return {
    version,
    samples: usable,
    plates: [...plates].sort(),
    confusions,
    trainedAt: new Date().toISOString(),
    accuracy: usable ? Math.round((exact / usable) * 1000) / 10 : 0,
  };
}

/** POST /ocr/train — latih model dari seluruh sampel yang tersimpan. */
export async function train(req: Request): Promise<Response> {
  const ctx = await requireAdmin(req);
  if (!ctx) return json({ error: "Akses ditolak. Token admin dibutuhkan." }, 403);

  const { data, error } = await db
    .from<SampleRow>("ocr_samples")
    .select("predicted, corrected")
    .order("created_at", { ascending: false })
    .limit(MAX_TRAIN_SAMPLES);
  if (error) return json({ error: "DB_ERROR", message: errorText(error) }, 500);

  const samples = data ?? [];
  if (samples.length === 0) {
    return json(
      { error: "NO_SAMPLES", message: "Belum ada sampel. Unggah foto plat terlebih dahulu." },
      400,
    );
  }

  const previous = await readModel();
  const model = buildModel(samples, previous.version + 1);

  try {
    await Deno.mkdir(MODEL_DIR, { recursive: true });
    await Deno.writeTextFile(MODEL_FILE, JSON.stringify(model));
  } catch (err) {
    return json({ error: "STORAGE_ERROR", message: errorText(err) }, 500);
  }

  const { error: insErr } = await db.from("ocr_models").insert({
    version: model.version,
    samples: model.samples,
    plates: model.plates.length,
    accuracy: model.accuracy,
    model_path: "/files/ocr/plate-model.json",
  });
  if (insErr) {
    // Model sudah tersimpan di disk; kegagalan mencatat riwayat tidak
    // membatalkan pelatihan, tetapi harus terlihat di respons.
    return json(
      { success: true, warning: `Riwayat model gagal dicatat: ${errorText(insErr)}`, model },
      200,
    );
  }

  return json({ success: true, model });
}

/**
 * GET /ocr/dataset — ekspor semua sampel (gambar + label) sebagai JSON.
 *
 * Format sengaja sederhana supaya bisa langsung diubah menjadi pasangan
 * `*.jpg` + `*.gt.txt` untuk tesstrain/Tesseract di luar server.
 */
export async function dataset(req: Request): Promise<Response> {
  const ctx = await requireAdmin(req);
  if (!ctx) return json({ error: "Akses ditolak. Token admin dibutuhkan." }, 403);

  const { data, error } = await db
    .from<SampleRow>("ocr_samples")
    .select("id, image_path, predicted, corrected, created_at")
    .order("created_at", { ascending: true })
    .limit(MAX_TRAIN_SAMPLES);
  if (error) return json({ error: "DB_ERROR", message: errorText(error) }, 500);

  const samples = [];
  for (const row of data ?? []) {
    if (!(await sampleFileExists(row.image_path))) continue;
    try {
      const bytes = await Deno.readFile(`${STORAGE_DIR}/${SAMPLE_BUCKET}/${row.image_path}`);
      samples.push({
        id: row.id,
        predicted: row.predicted ?? "",
        corrected: normalizePlate(row.corrected),
        createdAt: row.created_at,
        image: `data:image/jpeg;base64,${base64(bytes)}`,
      });
    } catch {
      // Berkas hilang -> lewati, jangan gagalkan seluruh ekspor.
    }
  }

  return json({
    version: 1,
    kind: "plate-corrections",
    exportedAt: new Date().toISOString(),
    count: samples.length,
    samples,
  });
}

/** Base64 tanpa memanggil btoa per karakter (gambar bisa ratusan KB). */
function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
