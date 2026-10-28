#!/usr/bin/env bash
# Builds the live demo video end to end: narration -> real walkthrough recording -> edit -> mix -> render -> checks.
#
#   bash demo/live/make_demo.sh <work_dir> [piper | elevenlabs [voice_id]]
#
# Needs the app running in demo mode on :3300 (DESK_DATA_DIR=<dir> npx next start -p 3300) and
# <work_dir>/lines.json (copy demo/live/lines.json). Swap the voice exactly as for the film:
#   set -a; . ./.env; set +a; bash demo/live/make_demo.sh <work_dir> elevenlabs
set -euo pipefail
W=$(cd "$1" && pwd); ENGINE=${2:-piper}; VOICE_ID=${3:-}
HERE=$(cd "$(dirname "$0")" && pwd); V="$HERE/../video"; REM="$V/remotion"
export CHROME=${CHROME:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}
export NODE_PATH=${NODE_PATH:-$(npm root -g)}
FONTS=${FONTS:-$(ls -d "$REM"/node_modules/@fontsource/inter/files 2>/dev/null || true)}

[ "${SKIP_VOICE:-}" = 1 ] || python3 "$V/src/voice.py" "$W" "$ENGINE" $VOICE_ID
mkdir -p "$W/public/full" "$W/public/short" "$W/out"
for PLAN in ${PLANS:-full short}; do
  [ "${SKIP_RECORD:-}" = 1 ] || { node "$HERE/record.cjs" "$W" "$PLAN"; python3 "$HERE/frames_to_video.py" "$W/$PLAN"; }
  python3 "$HERE/build_demo.py" "$W" "$PLAN"
  D=$(python3 -c "import json;print(json.load(open('$W/$PLAN/timeline.json'))['duration'])")
  python3 "$V/src/music.py" "$D" "$W/$PLAN/music.wav" >/dev/null
  bash "$V/src/mix.sh" "$W/$PLAN/voice.wav" "$W/$PLAN/music.wav" "$D" "$W/$PLAN/mix.wav"
  ln -f "$W/$PLAN/rec.mp4" "$W/public/$PLAN/rec.mp4"
  python3 -c "import json; json.dump({'timeline': json.load(open('$W/$PLAN/timeline.json'))}, open('$W/$PLAN/props.json','w'))"
  (cd "$REM" && node render.mjs LiveDemo "$W/$PLAN/props.json" "$W/public" "$W/frames_$PLAN")
  OUT=$([ "$PLAN" = full ] && echo demo_live_full.mp4 || echo demo_live_60s.mp4)
  ffmpeg -v error -y -framerate 30 -i "$W/frames_$PLAN/f%05d.jpeg" -i "$W/$PLAN/mix.wav" -map 0:v -map 1:a \
    -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart "$W/out/$OUT"
  MIN=$([ "$PLAN" = full ] && echo 110 || echo 55); MAX=$([ "$PLAN" = full ] && echo 180 || echo 66)
  python3 "$V/src/check_film.py" "$W/out/$OUT" "$W/$PLAN/timeline.json" "$W/out/check_$PLAN" --min $MIN --max $MAX
done
echo "done: $W/out"
