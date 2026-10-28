# Clearline pitch kit

| File | What |
|---|---|
| `Clearline_Pitch_Deck.pptx` / `.pdf` | 14 slides + 3 appendix slides (risks, 10 hard questions). Speaker notes on every slide: what to say + sources + labels. Slide 5 embeds the 60-second demo. |
| `slides_contact_sheet.png`, `slides/` | Every slide rendered, for a quick look |
| `demo_live_full.mp4` | The live demo, 2:03, a real walkthrough of the app in demo mode |
| `demo_live_60s.mp4` | The 60-second version (embedded in slide 5) |
| `HOW_TO_PRESENT.md` | One page: the 10-minute talk track and when to play the demo |
| `NOTE.md` | What's verified, what's assumption, what to check |
| `checks/` | Demo-video check results and contact sheets; the deck's honesty review |

## Rebuild

```bash
# the app in demo mode on :3300
DESK_DATA_DIR=/tmp/desk npx next start -p 3300 &
# deck: fresh screenshots, icons, then the deck (pass the 60 s video to embed it)
python3 pitch/src/capture_shots.py pitch/assets/shots
NODE_PATH=$(npm root -g) node pitch/src/icons.cjs pitch/assets/icons
python3 pitch/src/build_deck.py pitch/Clearline_Pitch_Deck.pptx pitch/demo_live_60s.mp4
# live demo: narration -> scripted walkthrough recording -> edit -> mix -> render -> checks
mkdir -p $W && cp demo/live/lines.json $W/
bash demo/live/make_demo.sh $W piper          # or, where the ElevenLabs key is: ... elevenlabs
```

The demo pipeline lives in `demo/live/` (`record.cjs` drives the real app with Playwright, `build_demo.py`
times captions and the camera, `make_demo.sh` runs it all) and reuses the film's voice, music, mix,
glitch-repair and check scripts in `demo/video/`.
