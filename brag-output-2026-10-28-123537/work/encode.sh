#!/usr/bin/env bash
# Encode frame -> mp4, pilih poster, bake poster sebagai frame 0, tulis share copy.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="$(dirname "$HERE")"
FRAMES="$HERE/frames"
AUDIO="$HERE/audio/mix.wav"
TMP="$HERE/tmp"
mkdir -p "$TMP"

FPS=30
POSTER_T=5.20
POSTER_IDX=$(awk "BEGIN{printf \"%d\", $POSTER_T*$FPS}")

echo "== encode video =="
ffmpeg -y -hide_banner -loglevel error -framerate $FPS -i "$FRAMES/f%04d.png" \
  -i "$AUDIO" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r $FPS \
  -c:a aac -b:a 192k -shortest "$TMP/video.mp4"

echo "== poster frame $POSTER_IDX (t=${POSTER_T}s) =="
cp "$FRAMES/f$(printf '%04d' $POSTER_IDX).png" "$RUN/brag.jpg"

echo "== bake poster sebagai frame 0 =="
ffmpeg -y -hide_banner -loglevel error \
  -i "$TMP/video.mp4" -i "$RUN/brag.jpg" \
  -filter_complex "[0:v]select='gte(n\,1)',setpts=N/FRAME_RATE/TB[v];[1:v]scale=1920:1080,format=yuv420p[p];[p][v]concat=n=2:v=1:a=0[o]" \
  -map "[o]" -map 0:a -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r $FPS \
  -c:a copy -movflags +faststart "$RUN/brag.mp4"

ffprobe -v error -show_entries format=duration:stream=width,height,codec_name,r_frame_rate -of default=nw=1 "$RUN/brag.mp4"
ls -la "$RUN/brag.mp4" "$RUN/brag.jpg"
