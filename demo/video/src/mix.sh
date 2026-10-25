#!/usr/bin/env bash
# Mix the narration over the music bed (ducked under the voice), fade in from silence and out at the
# end, and normalise to -14 LUFS (true peak -1.5 dBTP) in two passes. Usage: mix.sh voice.wav music.wav duration out.wav
set -euo pipefail
V=$1; M=$2; D=$3; OUT=$4
FADE_OUT=$(python3 -c "print(max(0, $D - 1.6))")
PRE=$(mktemp --suffix .wav)
ffmpeg -v error -y -i "$V" -i "$M" -filter_complex \
 "[0:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=70,acompressor=threshold=0.12:ratio=2.5:attack=8:release=120,volume=1.0,asplit=2[v][sc];\
  [1:a]atrim=0:$D,volume=0.20[m];\
  [m][sc]sidechaincompress=threshold=0.015:ratio=10:attack=25:release=450:makeup=1[md];\
  [v][md]amix=inputs=2:normalize=0,afade=t=in:st=0:d=0.25,afade=t=out:st=$FADE_OUT:d=1.6" \
 -ar 48000 -c:a pcm_s16le "$PRE"
J=$(ffmpeg -hide_banner -i "$PRE" -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
mi=$(echo "$J" | python3 -c "import sys,json;j=json.load(sys.stdin);print(j['input_i'],j['input_tp'],j['input_lra'],j['input_thresh'],j['target_offset'])")
read I TP LRA TH OFF <<< "$mi"
ffmpeg -v error -y -i "$PRE" -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:offset=$OFF:linear=true,aresample=48000" -ar 48000 -c:a pcm_s16le "$OUT"
rm -f "$PRE"
echo "mixed $OUT"
