#!/usr/bin/env bash
# Builds every version of the Clearline film end to end, then runs all checks.
#
#   bash demo/video/src/make_film.sh <work_dir> [piper | elevenlabs [voice_id]]
#
# Swap the voice to ElevenLabs (one command, run where the key is; it is read from the environment, never stored):
#   set -a; . ./.env; set +a; bash demo/video/src/make_film.sh <work_dir> elevenlabs
#
# <work_dir> must hold lines.json (the approved script) and el/ (app captures from capture_elements.py,
# which needs the app running in demo mode). Outputs land in <work_dir>/out/.
set -euo pipefail
W=$(cd "$1" && pwd); ENGINE=${2:-piper}; VOICE_ID=${3:-}
HERE=$(cd "$(dirname "$0")" && pwd); REM="$HERE/../remotion"
export CHROME=${CHROME:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}
OUT="$W/out"; mkdir -p "$OUT" "$W/public"
[ -e "$W/public/el" ] || ln -s "$W/el" "$W/public/el"

python3 "$HERE/voice.py" "$W" "$ENGINE" $VOICE_ID                      # narration + pronunciation check
for CUT in full short; do
  python3 "$HERE/build_story.py" "$W" "$CUT" "$W/el"                   # timeline, captions, voice track
  D=$(python3 -c "import json;print(json.load(open('$W/$CUT/timeline.json'))['duration'])")
  python3 "$HERE/music.py" "$D" "$W/$CUT/music.wav" "$W/$CUT/timeline.json"
  bash "$HERE/mix.sh" "$W/$CUT/voice.wav" "$W/$CUT/music.wav" "$D" "$W/$CUT/mix.wav"
done
bash "$HERE/render.sh" "$W" full  Story         "$OUT/product_film_full.mp4"
bash "$HERE/render.sh" "$W" short Story         "$OUT/product_film_30s.mp4"
bash "$HERE/render.sh" "$W" full  StoryVertical "$OUT/product_film_vertical.mp4"
(cd "$REM" && npx remotion still src/index.ts StoryThumb "$OUT/thumbnail.png" --public-dir="$W/public" \
   --browser-executable="$CHROME" --chrome-mode=chrome-for-testing)

VN=$([ "$ENGINE" = piper ] && echo 'Piper "Cori" (en_GB, high)' || echo "ElevenLabs ${VOICE_ID:-George}")
python3 "$HERE/write_script.py" "$W/full/timeline.json" "$OUT/script_final.md" "$VN"
python3 "$HERE/check_text.py" "$REM/src/Story.tsx" "$W/el/elements.json" "$W/full/timeline.json" > "$OUT/check_text.json"
python3 "$HERE/check_film.py" "$OUT/product_film_full.mp4"     "$W/full/timeline.json"  "$OUT/check_full"     --min 100 --max 125
python3 "$HERE/check_film.py" "$OUT/product_film_30s.mp4"      "$W/short/timeline.json" "$OUT/check_30s"      --min 28  --max 40
python3 "$HERE/check_film.py" "$OUT/product_film_vertical.mp4" "$W/full/timeline.json"  "$OUT/check_vertical" --min 100 --max 125
echo "done: $OUT"
