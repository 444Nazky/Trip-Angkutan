#!/usr/bin/env bash
# Mix musik + SFX untuk video brag. Semua timing dihitung dari frame 0
# (beat grid musik: 0.02 + 0.50*k, tempo 120.19 BPM).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL=/home/nazky/.claude/skills/brag/assets
OUT="$HERE/audio"
mkdir -p "$OUT"

MUSIC="$SKILL/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3"
DUR=20.02

# (waktu_detik, file_sfx, level_db, label)
SFX=(
  "0.10|interface/click_003.ogg|-20|baris 1 masuk"
  "0.42|interface/click_003.ogg|-20|baris 2 masuk"
  "0.88|impact/impactSoft_medium_001.ogg|-19|stabilo amber menyapu"
  "3.25|interface/click_003.ogg|-20|chip 1"
  "3.40|interface/click_003.ogg|-20|chip 2"
  "3.55|interface/click_003.ogg|-20|chip 3"
  "7.40|interface/click_002.ogg|-18|shutter kamera"
  "7.80|interface/click_005.ogg|-19|foto tersimpan"
  "8.55|interface/click_001.ogg|-19|OCR lock"
  "10.35|interface/click_002.ogg|-19|dropdown terbuka"
  "11.20|interface/click_005.ogg|-18|pilih Semua Region"
  "11.55|interface/switch_002.ogg|-19|toast muncul"
  "14.00|interface/click_003.ogg|-21|garis sparkline mulai"
  "14.50|interface/switch_007.ogg|-20|donut berputar"
  "18.05|impact/impactBell_heavy_000.ogg|-15|lockup brand"
  "18.60|impact/impactSoft_medium_004.ogg|-19|kalimat akhir"
)

INPUTS=(-i "$MUSIC")
FILTERS=("[0:a]atrim=0:$DUR,asetpts=N/SR/TB,volume=-8dB[m]")
for entry in "${SFX[@]}"; do
  IFS='|' read -r t f lvl _ <<< "$entry"
  INPUTS+=(-i "$SKILL/sfx/$f")
done

i=1
LABELS=()
for entry in "${SFX[@]}"; do
  IFS='|' read -r t f lvl _ <<< "$entry"
  ms=$(awk "BEGIN{printf \"%d\", $t*1000}")
  FILTERS+=("[$i:a]adelay=$ms|$ms,volume=${lvl}dB[s$i]")
  LABELS+=("[s$i]")
  i=$((i+1))
done

mixin="[m]$(IFS=; echo "${LABELS[*]}")"
FILTERS+=("${mixin}amix=inputs=$((i)):duration=first:normalize=0,volume=9dB,alimiter=limit=0.94:attack=5:release=60,afade=t=out:st=19.80:d=0.22[a]")

ffmpeg -y -hide_banner -loglevel error "${INPUTS[@]}" \
  -filter_complex "$(IFS=';'; echo "${FILTERS[*]}")" \
  -map "[a]" -c:a pcm_s16le "$OUT/mix.wav"

ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/mix.wav"
