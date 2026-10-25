#!/usr/bin/env bash
# Renders one version of the film, glitch-free, and joins it with the mixed audio.
#   render.sh <work_dir> <cut: full|short> <Composition: Story|StoryVertical> <out.mp4>
# Needs <work_dir>/public (fonts + el/ screenshots) and <work_dir>/<cut>/{timeline.json,mix.wav}.
set -euo pipefail
W=$1; CUT=$2; COMP=$3; OUT=$4
HERE=$(cd "$(dirname "$0")" && pwd)
python3 -c "import json,sys; json.dump({'timeline': json.load(open('$W/$CUT/timeline.json'))}, open('$W/$CUT/props.json','w'))"
FR="$W/frames_${CUT}_${COMP}"
(cd "$HERE/../remotion" && node render.mjs "$COMP" "$W/$CUT/props.json" "$W/public" "$FR")
ffmpeg -v error -y -framerate 30 -i "$FR/f%05d.jpeg" -i "$W/$CUT/mix.wav" -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"
echo "rendered $OUT"
