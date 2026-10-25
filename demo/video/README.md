# Clearline product film

A ~2-minute story film for private sharing with mentors: Maya, a finance manager at a fictional
company, stops "playing detective" with digital-dollar payments. Every company, person and amount
is fictional (labelled "Demo data" once). The app shots are real captures of this repo's demo mode.

## Deliverables (in `out/` of the work dir, copied to the PR)

| File | What |
|---|---|
| `product_film_full.mp4` | 16:9, 1920×1080, ~2:00 |
| `product_film_30s.mp4` | 16:9 cut: hook → pain → reveal → scam warning → auto-tick → end card |
| `product_film_vertical.mp4` | 1080×1920, same story, re-laid out for phones |
| `thumbnail.png` | 1920×1080 |
| `script_final.md` | narration + captions with timecodes |

## Build everything (one command)

```bash
# 0. the approved narration
mkdir -p $W && cp demo/video/lines.json $W/
# 1. app in demo mode on :3300, then capture the UI elements once
DESK_DATA_DIR=$W/data npx next start -p 3300 &
python3 demo/video/src/capture_elements.py $W/el
# 2. voice → timeline → music → mix → render (glitch-repaired) → thumbnail → script → checks
bash demo/video/src/make_film.sh $W piper
```

**Swap the voice to ElevenLabs:** run the same command with `elevenlabs` where the key lives. The key
is read from the environment only and never written anywhere:

```bash
set -a; . ./.env; set +a; bash demo/video/src/make_film.sh $W elevenlabs   # default voice: George
```

## Pipeline (`src/`)

| Step | Script |
|---|---|
| Narration, one file per line; every line transcribed back to catch mispronunciations | `voice.py` (Piper or ElevenLabs), `asr.py` |
| App captures, one element at a time, with each element's smallest font size | `capture_elements.py` |
| Timeline: line placement, pauses, captions (≤8 words, from spoken word timings), scene beats | `build_story.py` |
| Original music: tension under the problem, swell at "Meet Clearline.", resolve at the end | `music.py` |
| Mix: ducked under the voice, fade from silence in 0.25 s, −14 LUFS / −1.5 dBTP (two-pass) | `mix.sh` |
| Render as a frame sequence, re-render any one-frame glitch, join with audio | `render.sh`, `../remotion/render.mjs`, `glitch_scan.py` |
| The film itself | `../remotion/src/Story.tsx` |
| Checks: loudness, fade-in, transcript vs script, caption sync, OCR + contact sheet, "Demo data" once, end card, black/glitch frames | `check_film.py` |
| Text ≥ 3% of frame height (from source + element scales) | `check_text.py` |
| Final script | `write_script.py` |

Needs: Python 3 (numpy, Pillow, playwright, faster-whisper, piper-tts), ffmpeg, tesseract, Node 18+.
