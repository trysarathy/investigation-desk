"""Checks a rendered film against its timeline and the brief. Prints a report and writes check.json + a
1-fps contact sheet.

    check_film.py <film.mp4> <timeline.json> <out_dir> [--min 100 --max 120]

Checks: duration/size/audio stream; loudness (-14 LUFS +/-1, true peak); not full level on frame 1;
silences; the final audio transcribed and compared word by word with the script; caption timing
against the spoken words; 1-fps contact sheet + OCR (text on screen every second, "Demo data" shown
once, end card text); black frames.
"""
import json, pathlib, re, subprocess, sys
import numpy as np

film, tlp, out = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3]); out.mkdir(parents=True, exist_ok=True)
args = sys.argv[4:]
MIN = float(args[args.index("--min") + 1]) if "--min" in args else 100
MAX = float(args[args.index("--max") + 1]) if "--max" in args else 120
tl = json.load(open(tlp))
rep, ok = {}, {}

def run(*a): return subprocess.run(a, capture_output=True, text=True)

# 1. Format
pr = json.loads(run("ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", film).stdout)
dur = float(pr["format"]["duration"]); v = [s for s in pr["streams"] if s["codec_type"] == "video"][0]
has_audio = any(s["codec_type"] == "audio" for s in pr["streams"])
rep["format"] = {"duration": round(dur, 2), "size": f'{v["width"]}x{v["height"]}', "audio": has_audio}
ok["format"] = MIN <= dur <= MAX and has_audio

# 2. Loudness, true peak, first frame level
eb = run("ffmpeg", "-hide_banner", "-i", film, "-af", "ebur128=peak=true", "-f", "null", "-").stderr
summ = eb[eb.rfind("Summary:"):]
I = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summ).group(1)); TP = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summ).group(1))
pcm = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", film, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], capture_output=True).stdout, np.float32)
first = float(np.sqrt(np.mean(pcm[:1600] ** 2)) + 1e-9); body = float(np.sqrt(np.mean(pcm ** 2)))
rep["loudness"] = {"integrated_LUFS": I, "true_peak_dBFS": TP, "first_frame_vs_average_dB": round(20 * np.log10(first / body), 1)}
ok["loudness"] = abs(I + 14) <= 1 and TP <= -1.0 and first < body * 0.1

# 3. Silences (anything quieter than -50 dB for over 1 s, outside the first/last second)
sd = run("ffmpeg", "-hide_banner", "-i", film, "-af", "silencedetect=noise=-50dB:d=1", "-f", "null", "-").stderr
sil = [(float(a), float(b)) for a, b in re.findall(r"silence_start: ([\d.]+).*?silence_end: ([\d.]+)", sd, re.S)]
sil = [s for s in sil if s[0] > 1.0 and s[1] < dur - 1.0]
rep["silences_over_1s"] = sil; ok["silences"] = not sil

# 4. Transcript of the final mix vs the script; caption sync
from faster_whisper import WhisperModel
m = WhisperModel("small.en", device="cpu", compute_type="int8")
audio16 = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", film, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout, np.int16).astype(np.float32) / 32768
segs, _ = m.transcribe(audio16, beam_size=5, word_timestamps=True, language="en", vad_filter=True)  # VAD: no invented words over music-only stretches
heard = [{"w": w.word.strip(), "s": w.start, "e": w.end} for s in segs for w in s.words]
def norm(s):
    s = s.lower().replace("$50", "fifty dollars").replace("u s d t", "usdt").replace("clear line", "clearline").replace("-", " ")
    return re.sub(r"[^a-z0-9' ]", "", s).split()
script = [w for l in tl["lines"] for w in norm(l["spoken"])]
hw = norm(" ".join(h["w"] for h in heard))
import difflib
sm = difflib.SequenceMatcher(a=script, b=hw, autojunk=False)
diffs = [(op, " ".join(script[a0:a1]), " ".join(hw[b0:b1])) for op, a0, a1, b0, b1 in sm.get_opcodes() if op != "equal"]
# Benign: compound-word splits the recogniser makes ("clear line", "top up", "look alike").
benign = lambda d: d[1].replace(" ", "") == d[2].replace(" ", "")
real = [d for d in diffs if not benign(d)]
rep["transcript"] = {"script_words": len(script), "heard_words": len(hw), "match_ratio": round(sm.ratio(), 4), "differences": real, "benign_spacing_differences": [d for d in diffs if benign(d)]}
(out / "transcript.txt").write_text(" ".join(h["w"] for h in heard))
ok["transcript"] = not real

# Caption sync: each caption's first word, found in the heard words near the caption's start.
flat = [(re.sub(r"[^a-z0-9]", "", h["w"].lower()), h["s"]) for h in heard]
offs = []
for c in tl["captions"]:
    first = re.sub(r"[^a-z0-9]", "", c["text"].split()[0].lower())
    if first in ("50", "usdt"): continue
    near = [s for w, s in flat if w.startswith(first[:5]) and abs(s - c["from"]) < 2.0]
    if near: offs.append((round(min(near, key=lambda s: abs(s - c["from"])) - c["from"], 3), c["text"]))
# A caption that starts a line is checked against the voice track's measured onset instead: the
# recogniser's first-word times lag by up to ~0.4 s right after a pause, the waveform doesn't.
vpath = pathlib.Path(tlp).with_name("voice.wav")
if vpath.exists():
    import wave as _w
    with _w.open(str(vpath)) as f:
        vsr = f.getframerate(); vx = np.frombuffer(f.readframes(f.getnframes()), np.int16).astype(np.float32) / 32768
    def v_onset(t0):
        k0 = int(max(0, t0 - 0.3) * vsr); win = int(vsr * 0.01)
        for k in range(k0, min(len(vx) - win, k0 + int(vsr * 1.5)), win):
            if np.sqrt(np.mean(vx[k:k + win] ** 2)) > 0.01: return k / vsr
        return None
    line_starts = {round(l["from"], 2) for l in tl["lines"]}
    by_text = {o[1]: o for o in offs}
    for c in tl["captions"]:
        if any(abs(c["from"] - ls_) < 0.6 for ls_ in line_starts):
            on = v_onset(c["from"])
            if on is not None:
                by_text[c["text"]] = (round(on - c["from"], 3), c["text"])
    offs = list(by_text.values())
worst = max(offs, key=lambda x: abs(x[0])) if offs else (None, None)
rep["caption_sync"] = {"captions_checked": len(offs), "of": len(tl["captions"]), "max_offset_s": worst[0], "worst_caption": worst[1],
                       "over_0_3s": [o for o in offs if abs(o[0]) > 0.3]}
ok["caption_sync"] = bool(offs) and all(abs(o[0]) <= 0.3 for o in offs)

# 5. 1-fps frames: contact sheet + OCR
fr = out / "frames"; fr.mkdir(exist_ok=True)
for f in fr.glob("*.png"): f.unlink()
run("ffmpeg", "-v", "error", "-i", film, "-vf", "fps=1", str(fr / "f%04d.png"))
frames = sorted(fr.glob("*.png"))
ocr = []
for f in frames:
    txt = run("tesseract", str(f), "-", "--psm", "11").stdout
    ocr.append(re.sub(r"\s+", " ", txt).strip())
no_text = [i for i, t in enumerate(ocr) if i > 0 and len(re.findall(r"[A-Za-z]{3,}", t)) < 2]   # second 0 is the fade from black
demo_secs = [i for i, t in enumerate(ocr) if re.search(r"demo\s*data", t, re.I)]
appearances = sum(1 for k, s in enumerate(demo_secs) if k == 0 or s - demo_secs[k - 1] > 5)   # OCR can miss a second inside one appearance
end_txt = " ".join(ocr[-4:])
end_ok = all(x.lower() in end_txt.lower() for x in ["Clearline", "Working demo", "Aashmiin Kaur"])
rep["ocr"] = {"seconds": len(frames), "seconds_without_text": no_text, "demo_data_appearances": appearances, "demo_data_seconds": demo_secs, "end_card_ok": end_ok}
ok["text_every_second"] = not no_text
ok["demo_data_once"] = appearances == 1 if tl["cut"] == "full" else appearances <= 1
ok["end_card"] = end_ok
(out / "ocr.json").write_text(json.dumps(ocr, indent=1))
# contact sheet: 6 columns, 320px wide thumbnails
from PIL import Image, ImageDraw
th = [Image.open(f).resize((320, 180)) for f in frames]
cols = 6; rows = -(-len(th) // cols)
sheet = Image.new("RGB", (cols * 320, rows * 196), (10, 12, 17))
d = ImageDraw.Draw(sheet)
for k, im in enumerate(th):
    x, y = (k % cols) * 320, (k // cols) * 196
    sheet.paste(im, (x, y)); d.text((x + 6, y + 181), f"{k}s", fill=(160, 166, 178))
sheet.save(out / "contact_sheet.png")

# 6. Black frames
bd = run("ffmpeg", "-hide_banner", "-i", film, "-vf", "blackdetect=d=0.2:pix_th=0.05", "-an", "-f", "null", "-").stderr
blacks = [(float(a), float(b)) for a, b in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", bd)]
blacks = [b for b in blacks if b[0] > 0.9 and b[1] < dur - 1.3]   # the fade from/to black at the ends is intended
rep["black_frames"] = blacks; ok["no_black_frames"] = not blacks

# 7. Glitch frames: a single frame much darker (or emptier) than both neighbours = a render hiccup.
gr = subprocess.run(["ffmpeg", "-v", "error", "-i", film, "-vf", "scale=64:36,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
lum = np.frombuffer(gr, np.uint8).reshape(-1, 36 * 64).astype(float)
mean = lum.mean(1)
glitch = [i for i in range(1, len(mean) - 1) if min(mean[i - 1], mean[i + 1]) > 8 and
          (mean[i] < 0.75 * min(mean[i - 1], mean[i + 1]) or np.abs(lum[i] - (lum[i - 1] + lum[i + 1]) / 2).mean() > 3 * max(1.0, np.abs(lum[i - 1] - lum[i + 1]).mean()) + 4)]
rep["glitch_frames"] = [round(i / 30, 2) for i in glitch]; ok["no_glitch_frames"] = not glitch

rep["ok"] = ok; rep["all_ok"] = all(ok.values())
(out / "check.json").write_text(json.dumps(rep, indent=1))
print(json.dumps(rep, indent=1))
