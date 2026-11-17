/**
 * Uji pembentukan model koreksi OCR dari sampel latih.
 *
 * Yang dijaga:
 *   - plat terkonfirmasi selalu masuk model (hasil unggahan admin dipakai),
 *   - pasangan salah-baca hanya dicatat bila polanya berulang (>= 2 kali),
 *   - sampel dengan panjang berbeda tidak menghasilkan pasangan palsu,
 *   - akurasi dihitung dari sampel yang punya prediksi.
 */
import { assertEquals } from "jsr:@std/assert@1";
import { buildModel } from "./ocr.ts";

Deno.test("buildModel menyimpan plat terkonfirmasi dan pola salah-baca berulang", () => {
  const model = buildModel(
    [
      { predicted: "B7777XTE", corrected: "B7171XYE" },
      { predicted: "B7171XTE", corrected: "B7171XYE" },
      { predicted: "B7171XYE", corrected: "B7171XYE" },
    ],
    1,
  );

  assertEquals(model.version, 1);
  assertEquals(model.samples, 3);
  assertEquals(model.plates, ["B7171XYE"]);
  // 7→1 muncul dua kali (posisi berbeda), T→Y dua kali; 0→0 & T→Y pada
  // beberapa posisi juga berulang.
  assertEquals(model.confusions.every(([, , count]) => count >= 2), true);
  assertEquals(model.accuracy, 33.3);
});

Deno.test("buildModel mengabaikan panjang berbeda dan sampel tanpa prediksi", () => {
  const model = buildModel(
    [
      { predicted: "", corrected: "B 7171 XYE" },
      { predicted: "B717XY", corrected: "B7171XYE" },
    ],
    4,
  );

  assertEquals(model.samples, 2);
  assertEquals(model.plates, ["B7171XYE"]);
  assertEquals(model.confusions.length, 0);
  assertEquals(model.accuracy, 0);
  assertEquals(model.version, 4);
});
