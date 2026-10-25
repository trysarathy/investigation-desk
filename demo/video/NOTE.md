# Clearline film: delivery note

1. **What's here:** a 1:58 story film (Maya, a fictional finance manager), a 34 s cut, a vertical version, a thumbnail and the final script. Every check passes on all three renders (results below).
2. **Voice:** Piper "Cori" (British, female, calm). The ElevenLabs key wasn't reachable: `~/investigation-desk` on the Mac had only `.env.example`, no `.env`. To swap, run `set -a; . ./.env; set +a; bash demo/video/src/make_film.sh <work_dir> elevenlabs` where the key is. Default voice is George (warm British narrator). Everything downstream re-times itself to the new voice.
3. **Claims kept accurate:** Clearline *warns* before the money moves; it can't block a wallet. "Correct payments need no one." All data is fictional, labelled "Demo data" once (0:59–1:04). No real customers or QRE.
4. **Honest limits:** in the vertical version the app screenshots are about 2% of frame height, because phone width limits how far they can zoom. Captions and story text there still meet 3%. Piper is clear but synthetic; ElevenLabs will sound more premium. "Clearline" still needs an IPOS/USPTO trademark search before any public use.
5. **The 9 feedback points:** all fixed, as listed below.

| # | Feedback | Fix |
|---|---|---|
| 1 | Context first | Opens on Maya and her problem (0:00–0:50). The product appears only at 0:51. |
| 2 | No tiny, dense text; zoom on ONE element | One app element on screen at a time, scaled until its smallest text is at least 3% of frame height (checked: smallest 35 px of 1080). |
| 3 | No jargon | Plain words throughout: "digital dollars", "account number", "fake digital dollars". No "wallet address", "token", "chain" or "USDT" in the narration. |
| 4 | Captions on a fixed dark band, never over UI | A fixed 172 px band at the bottom. The UI sits above it and never under it. Captions are at most 8 words and cut cleanly. |
| 5 | No overlaps or ghosting | Scenes dip through black (0.3 s out, then 0.3 s in), never two at once. No text on top of other text (FAKE stamp fixed). |
| 6 | Bridge Maya's view ↔ Customer's view | A "Maya's view" or "Customer's view" label on every app shot, and the voice says whose screen it is. |
| 7 | Reveal Clearline before the demo | "What if every payment explained itself?" then "Meet Clearline." at 0:51, before any app screen. |
| 8 | Large end card | "Clearline" at 150 px plus logo, tagline 54 px (5%), name 52 px, contacts 36 px (3.3%). |
| 9 | Keep Seconds→Hours and the red Stop warning (≥4 s) | The hook opens the film. The red warning is on screen from 1:09 to 1:16 (about 7 s). |

**Layman check:** can someone with no crypto knowledge answer these after one viewing?
- *What's the problem?* Getting paid in digital dollars means detective work: codes, spreadsheets and email chains (0:09–0:50).
- *What is Clearline?* A tool that makes every payment explain itself (0:47–0:56).
- *What does it do for me?* It warns customers before they pay a scam account, ticks off correct payments by itself, and flags fake money with the reply already written (0:57–1:39).
