#!/usr/bin/env bash
# Contact sheet: 12 frame representatif untuk cek cepat hasil video.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="$(dirname "$HERE")"
OUT="$RUN/contact-sheet.jpg"
montage \
  "$HERE/frames/f0030.png" "$HERE/frames/f0090.png" \
  "$HERE/frames/f0150.png" "$HERE/frames/f0220.png" \
  "$HERE/frames/f0250.png" "$HERE/frames/f0290.png" \
  "$HERE/frames/f0330.png" "$HERE/frames/f0350.png" \
  "$HERE/frames/f0390.png" "$HERE/frames/f0420.png" \
  "$HERE/frames/f0480.png" "$HERE/frames/f0560.png" \
  -tile 4x3 -geometry 480x270+6+6 -background '#04160f' "$OUT"
identify "$OUT"
