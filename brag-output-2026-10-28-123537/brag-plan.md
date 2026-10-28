# Brag Plan — Trip Angkutan

**Output dir:** `brag-output-2026-10-28-123537/`
**Format:** landscape 1920×1080 @ 30fps
**Duration:** 20.02s (cut on the beat grid, final hit on a strong cue)
**Tone:** `default` — punchy, playful, clean. Cinematic dark opener, bright product UI in the middle, deadpan close.
**Music:** `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3` (120.19 BPM, CC BY 4.0 — Sascha Ende / ende.app), trimmed to 20.02s.

## The angle

**"Tanpa sinyal, tetap jalan."**

The absurdity this project actually has: plantation field officers work in dead zones, so the app is built to *record first and sync later* — a trip without a photo is rejected outright, and a trip with no signal waits in a queue on the device instead of vanishing. The video opens on that plain fact in one breath — **TANPA SINYAL, TETAP JALAN.** — and then proves it.

*(Hook ini pernah memakai "TOS PAT TI" — jargon operator yang tidak dimengerti orang luar; diganti ke bahasa yang langsung terbaca.)*

Not "streamline your workflow". Not a startup. A logging app for trucks in a rubber plantation that refuses to lose data.

## Answering the questions

- **What is it?** Trip Angkutan — a field-officer app + admin dashboard + self-hosted API that records plantation transport trips and bills them per-region tariffs.
- **Who?** Trip petugas lapangan (mobile, Android) and supervisor admin (web dashboard).
- **What sets it apart?** Offline is the default, not a fallback: trips queue locally, sync when a link appears, and the *same* API code runs as a cloud endpoint or as an office-LAN server. A trip cannot be submitted without photographic evidence, and the plate is OCR'd on-device to decide how it's billed.
- **Most impressive claim?** The API runs *inside the office LAN* — the office can lose the internet entirely and still bill trips.
- **Visual hook?** `TANPA SINYAL,` / `TETAP JALAN.` — dua baris, langsung terbaca, tanpa jargon. Tandai stabilo amber menyapu di belakang baris kedua.
- **Real UI to show:** the trip-complete card (`Tersimpan di perangkat. Data akan dikirim saat koneksi tersedia.`), the Master Tarif grid with the new **Semua Region** bulk write, and the reports dashboard (128 trip / 59 muatan / 46% bermuatan).
- **One-line caption:** *"Offline bukan cadangan."*

## Privacy note

The live admin dashboard on this machine contains real operational data (plates, officer accounts, revenue). None of it is captured. Every screen in the video is reconstructed from the project's own source markup with the project's own design tokens, using the real aggregate counters that carry no personal data.

## Storyboard

Beat grid from the music cue preset: `0.02, 0.52, 1.02, …` (0.5s period). Every cut below lands on it; the last scene resolves on the strong cue at **20.02s**.

### S1 — HOOK · 0.00 → 2.52 (5.0s)
- Deep forest gradient (`#04160F → #0A3D26`) with a slow emerald glow pulse.
- Top-left: Karyamas mark in a white tile + `TRIP ANGKUTAN` wordmark, tracked out.
- Centre-left: **TANPA SINYAL,** (120px, weight 800, white) lalu **TETAP JALAN.** di bawahnya. Baris 1 masuk 0.08s, baris 2 masuk 0.34s.
- Behind baris 2: stabilo amber transparan menyapu kiri→kanan 0.78–1.24s.
- Under it: `Sinyal habis. Trip tetap tercatat.` (30px, slate-300).
- Right: phone mockup (dark `#0F172A` device) rises in from below, 0.2→1.1s. Status bar memakai ikon sinyal dicoret (bukan singkatan). On screen: `Trip Tercatat!`, `TRP20261028A1B2 tersimpan di perangkat`, and the real status card **Menunggu Sinkronisasi** — `Tersimpan di perangkat. Data akan dikirim saat koneksi tersedia.`
- SFX: dua klik interface (baris 1 dan baris 2 masuk) + satu impact lembut saat stabilo menyapu.
- Gate: the hook must be readable by 2.0s.

### S2 — REVEAL · 2.52 → 6.02 (3.5s)
- Card rises: white rounded panel, Karyamas mark, **Trip Angkutan** wordmark, and the product's own meta line: `Sistem pencatatan angkutan dan tarif untuk trip plantation`.
- Three capability chips animate in staggered (0.15s apart): **Aplikasi petugas lapangan** (phone icon) · **Dashboard admin** (monitor icon) · **API kantor — LAN** (server icon).
- The forest glow brightens behind the card.
- SFX: three soft `ui/switch` ticks, one per chip.
- Poster source frame: t ≈ 5.10s (everything settled).

### S3 — HIGHLIGHT A · 6.02 → 9.52 (3.5s) — *the field officer*
- Headline: `Bukti foto, bukan cerita.` + sub `Tidak ada foto, tidak ada trip.`
- Right: phone mockup of the vehicle/trip form — `Nomor Plat` input `B 1234 XY`, segmented control **Muatan / Kosong**, `Jenis Kendaraan` = `Truck Kecil`, camera tile `Ambil foto dari kamera`.
- 7.4s: photo thumbnail appears → green `Foto tersimpan` state; the **Kirim Trip** button enables (slate → emerald).
- 8.6s: OCR overlay box snaps around `B 1234 XY` in a viewfinder strip, caption `OCR plat di perangkat`.
- SFX: interface click on shutter, `select_008` on OCR lock, a soft `drop` on the green state.

### S4 — HIGHLIGHT B · 9.52 → 13.02 (3.5s) — *the new Master Tarif*
- Headline: `Tarif benar, sampai region paling remote.`
- White admin card: the Master Tarif grid — header row `Jenis Kendaraan | Internal | Lokal | Ada Muatan | Kosong | Aksi`, spreadsheet borders, region header `Badau`, rows `Motor / Mobil / Truck Kecil / Truck Sedang / Truck Besar`, an edit and a **delete** button per row.
- 10.3s: a custom dropdown opens under `Region`; options `Semua Region (12)`, `Badau`, `Belitung`, … cursor travels, clicks **Semua Region (12)** at 11.2s.
- 11.5s: the toast slides up: `Tarif Truck Kecil tersimpan di 12 region`, and the region column sweeps an emerald highlight.
- SFX: dropdown `click`, `select_008` on the pick, a soft `interface/switch` on the toast.

### S5 — HIGHLIGHT C · 13.02 → 16.52 (3.5s) — *the office*
- Headline: `128 trip. Satu layar.`
- Admin card with the real dashboard counters counting up: `TOTAL TRIP 128`, `MUATAN 59`, `UNIT 82`, `PENDAPATAN Rp ••••••` (the app's own privacy mask, with the `Show Nominal` pill beside it).
- **Trip per Hari** sparkline draws left→right (real SVG curve, `puncak 20 trip/hari`).
- **Komposisi Muatan** donut sweeps to `46% trip bermuatan`, `Ada Muatan 59` / `Tanpa Muatan 69`.
- SFX: soft ticks on the counters, a `switch` on the donut.

### S6 — PUNCHLINE / OUTRO · 16.52 → 20.02 (3.5s)
- Forest darkens; headline in: `Kantor tanpa internet?` → `API tetap jalan.`
- A Profile-style card slides up: `Server / Endpoint` · badge **Intranet** · `Status jaringan perangkat` → `Perangkat sedang offline`.
- 18.1s: brand lockup lands — Karyamas mark, **Trip Angkutan**, and the app's own footer string `TripAngkutan · Offline-first`.
- Final line (18.6s): `Offline bukan cadangan.` in amber, tracking out.
- SFX: impactBell_heavy on the lockup land; music resolves on the 20.02 strong cue.

## Music cue guidance
- Tempo 120.19 BPM, beat grid `x.02 / x.52`. Cuts on `2.52 / 6.02 / 9.52 / 13.02 / 16.52`, end at the strong cue `20.02`.
- Music sits at −9 dB; SFX at −17 dB and never on top of the beat grid's transient.
- Strong cues in window used for the two reveals (17.02 → the lockup build, 20.02 → the final line).

## Anti-goals
- No revenue figures, no officer names, no plates, no internal IPs or hostnames.
- No invented numbers — every counter is the app's own aggregate.
- No "streamline", no "empower", no fake testimonial.
