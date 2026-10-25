"""Builds the film's timeline from the narration: where each line sits, the captions (timed from the
spoken words), and every scene's camera moves, clicks and reveals, anchored to the words they belong to.

    build_timeline.py <work_dir> <cut: full|short> <shots_dir>
      reads  <work_dir>/lines.json, vo/NN.wav, vo/words.jsonl, <shots_dir>/boxes.json
      writes <work_dir>/<cut>/timeline.json, <work_dir>/<cut>/voice.wav
"""
import json, pathlib, re, subprocess, sys, wave
import numpy as np

W = pathlib.Path(sys.argv[1]); CUT = sys.argv[2]; SHOTS = pathlib.Path(sys.argv[3])
OUT = W / CUT; OUT.mkdir(parents=True, exist_ok=True)
FPS = 30; SR = 48000
lines = json.load(open(W / "lines.json"))
words = [json.loads(l) for l in open(W / "vo/words.jsonl")]
boxes = json.load(open(SHOTS / "boxes.json"))

# What the captions show where the voice says it differently (approved: "fifty dollars" -> "50.00 USDC").
DISPLAY = {
    9: "Clearline.", 28: "Clearline.",
    18: "Brightline paid 50.00 USDC short.",
    20: "Orbit's payment calls itself USDT, but it comes from a counterfeit contract.",
}
SECTIONS = {
    "full": ["hook", "problem", "why", "solution", "glance", "acme", "brightline", "orbit", "lookalike", "unidentified", "outcome", "end"],
    "short": ["hook", "orbit", "lookalike", "end"],
}[CUT]
SKIP = {"short": {22}}.get(CUT, set())   # the 30-second cut drops the lead-in line to the look-alike case

def onset(i):
    """Where speech actually starts in line i's file (first 10 ms window above -40 dBFS); the recogniser's
    first-word time is unreliable at the very start of a clip."""
    with wave.open(str(W / f"vo/{i:02d}.wav")) as f:
        sr = f.getframerate(); x = np.frombuffer(f.readframes(f.getnframes()), np.int16).astype(np.float32) / 32768
    win = int(sr * 0.01)
    for k in range(0, len(x) - win, win):
        if np.sqrt(np.mean(x[k:k + win] ** 2)) > 0.01:
            return k / sr
    return 0.0

def dur(i):
    with wave.open(str(W / f"vo/{i:02d}.wav")) as f:
        return f.getnframes() / f.getframerate()

# ---------- place the lines ----------
LEAD, GAP_LINE, GAP_SECTION, TAIL = 0.8, 0.22, 0.62, 2.8 if CUT == "full" else 2.6
GAP_BEFORE = {"solution": 0.9, "end": 1.0, "glance": 0.8}
order = [i for s in SECTIONS for i, (sec, _) in enumerate(lines) if sec == s and i not in SKIP]
start, t, prev = {}, LEAD, None
for i in order:
    sec = lines[i][0]
    if prev is not None:
        t += GAP_LINE if sec == prev else GAP_BEFORE.get(sec, GAP_SECTION)
    start[i] = t; t += dur(i); prev = sec
TOTAL = t + TAIL
ls = lambda i: start[i]
le = lambda i: start[i] + dur(i)

def word_time(i, word, which="s"):
    """Time of the first spoken word in line i starting with `word` (case-insensitive)."""
    for w in words[i]["words"]:
        if re.sub(r"[^a-z]", "", w["w"].lower()).startswith(word):
            return ls(i) + w[which]
    raise KeyError((i, word))

# ---------- captions: <= 8 words, broken at punctuation, timed from the spoken words ----------
captions = []
for i in order:
    text = DISPLAY.get(i, lines[i][1])
    toks = text.split()
    sp = words[i]["words"]
    def t_at(k):  # time of display token k, mapped onto the spoken words by position
        if not sp: return ls(i)
        j = min(len(sp) - 1, round(k * len(sp) / max(1, len(toks))))
        return ls(i) + sp[j]["s"]
    # Balanced chunks of at most 8 words; split where punctuation falls near the ideal point; never a 1-2 word scrap.
    n_chunks = -(-len(toks) // 8)
    cuts, prev_cut = [], 0
    for c in range(1, n_chunks):
        ideal = round(c * len(toks) / n_chunks)
        best = ideal
        for d in (0, 1, -1, 2, -2):
            k = ideal + d
            if prev_cut + 3 <= k <= len(toks) - 3 and k - prev_cut <= 8 and re.search(r"[,.:;]$", toks[k - 1]):
                best = k; break
        cuts.append(best); prev_cut = best
    bounds = [0] + cuts + [len(toks)]
    chunks = [list(range(bounds[j], bounds[j + 1])) for j in range(len(bounds) - 1)]
    for c_i, c in enumerate(chunks):
        s = t_at(c[0]) if c_i else ls(i) + onset(i)   # the first chunk starts when the voice does
        e = t_at(chunks[c_i + 1][0]) if c_i + 1 < len(chunks) else le(i) + 0.35
        captions.append({"from": round(s, 3), "to": round(e, 3), "text": " ".join(toks[k] for k in c)})
# no caption overlaps the next one; across a short pause the caption stays up (text on screen every second)
for a, b in zip(captions, captions[1:]):
    a["to"] = b["from"] if b["from"] - a["to"] <= 1.6 else min(a["to"], b["from"])

# ---------- camera helpers (image pixels) ----------
def size(shot): return boxes[shot]["_size"]
def bx(shot, *names, pad=60):
    xs = [boxes[shot][n] for n in names]
    x0 = min(b[0] for b in xs) - pad; y0 = min(b[1] for b in xs) - pad
    x1 = max(b[0] + b[2] for b in xs) + pad; y1 = max(b[1] + b[3] for b in xs) + pad
    return [x0, y0, x1 - x0, y1 - y0]
def full(shot): return [0, 0, 3840, 2160]
def part(shot, name, fw, fh, pad=40):
    """The left/top fraction of a box: zooms in on where a panel's text actually is."""
    b = boxes[shot][name]; return [b[0] - pad, b[1] - pad, b[2] * fw + 2 * pad, b[3] * fh + 2 * pad]
def center(shot, name):
    b = boxes[shot][name]; return [b[0] + b[2] / 2, b[1] + b[3] / 2]

scenes = []
def add(kind, sec_lines, **kw):
    s = ls(sec_lines[0]) - (0.6 if not scenes else 0.45)
    scenes.append({"kind": kind, "from": max(0.0, round(s, 3)), **kw})

for sec in SECTIONS:
    L = [i for i in order if lines[i][0] == sec]
    if sec == "hook":
        add("hook", L, beats=[{"at": ls(L[0]), "word": "Seconds", "tone": "fast"}, {"at": ls(L[1]) + 0.6, "word": "Hours", "tone": "stall"}])
    elif sec == "problem":
        add("problem", L, msgs=[
            {"at": ls(3), "who": "Priya, Brightline Studio", "text": "We paid yesterday. Why is INV-1042 still unpaid?", "tag": "Paid a little short"},
            {"at": ls(4), "who": "Aisha, Meridian Travel", "text": "Payment made yesterday, 3,200 USDT. Can you confirm?", "tag": "Wrong network"},
            {"at": ls(5), "who": "Daniel, Orbit Retail", "text": "Sent 7,500 USDT in full. Please close the invoice.", "tag": "Fake token"},
            {"at": ls(6), "who": "Accounts payable, Kite Analytics", "text": "We paid INV-1045. Please confirm receipt.", "tag": "No reference"},
        ], intro=ls(2), dig=ls(7), digWords=[word_time(7, "blockchain"), word_time(7, "spreadsheets"), word_time(7, "email"), word_time(7, "while")])
    elif sec == "why":
        add("why", L, words=[{"at": word_time(8, "delay"), "text": "Delay"}, {"at": word_time(8, "unhappy"), "text": "Unhappy customers"},
                             {"at": word_time(8, "unchecked"), "text": "Unchecked risk"}, {"at": word_time(8, "hours"), "text": "Lost hours"}])
    elif sec == "solution":
        add("solution", L, name=ls(9), promise=[{"at": ls(10), "text": "Every request tells the sender exactly what to send, where, and on which network."},
                                               {"at": ls(11), "text": "Every payment that arrives is matched, checked and explained."}])
    elif sec == "glance":
        sh = "glance"
        add("shot", L, label={"text": "Demo data · a fictional company", "from": ls(12), "to": ls(12) + 4.0},
            images=[{"src": f"shots/{sh}.png", "at": 0, "size": size(sh)}],
            cam=[{"at": ls(12) - 0.4, "rect": full(sh)}, {"at": ls(12) + 1.4, "rect": full(sh)},
                 {"at": ls(13) + 0.2, "rect": bx(sh, "kpis", pad=80)}, {"at": ls(14) + 0.3, "rect": bx(sh, "attention", pad=70)}],
            ring=[{"from": ls(13) + 0.6, "to": le(13) + 0.2, "rect": [boxes[sh]["kpis"][0] + boxes[sh]["kpis"][2] * 0.2, boxes[sh]["kpis"][1], boxes[sh]["kpis"][2] * 0.4, boxes[sh]["kpis"][3]]}])
    elif sec == "acme":
        click = ls(15) + 0.9
        focus = bx("acme_0", "head", "verdict", "play", pad=70)
        add("shot", L, images=[{"src": "shots/acme_0.png", "at": 0, "size": size("acme_0")}] + [
                {"src": f"shots/acme_{k}.png", "at": click + 0.35 + 0.55 * (k - 1), "size": size(f"acme_{k}")} for k in range(1, 5)],
            cam=[{"at": ls(15) - 0.4, "rect": focus}, {"at": ls(17), "rect": focus}, {"at": le(17), "rect": bx("acme_4", "head", "verdict", pad=50)}],
            cursor=[{"at": ls(15) - 0.2, "pos": [focus[0] + focus[2] * 0.85, focus[1] + focus[3] * 0.95]}, {"at": click, "pos": center("acme_0", "play"), "click": True},
                    {"at": click + 0.9, "pos": [center("acme_0", "play")[0] + 900, center("acme_0", "play")[1] + 250]}])
    elif sec == "brightline":
        sh = "brightline"
        add("shot", L, images=[{"src": f"shots/{sh}.png", "at": 0, "size": size(sh)}],
            cam=[{"at": ls(18) - 0.4, "rect": bx(sh, "message", "verdict", pad=60)}, {"at": word_time(19, "likely") - 0.2, "rect": bx(sh, "cause", pad=140)},
                 {"at": word_time(19, "polite") - 0.3, "rect": part(sh, "reply", 0.85, 0.75, pad=40)}],
            ring=[{"from": word_time(19, "likely"), "to": word_time(19, "polite") - 0.4, "rect": boxes[sh]["cause"]}])
    elif sec == "orbit":
        sh = "orbit"
        add("shot", L, images=[{"src": f"shots/{sh}.png", "at": 0, "size": size(sh)}],
            cam=[{"at": ls(20) - 0.4, "rect": bx(sh, "message", "verdict", pad=60)}, {"at": word_time(20, "counterfeit") - 0.6, "rect": part(sh, "verdict", 0.80, 1.0, pad=40)},
                 {"at": word_time(21, "blocked") - 0.5, "rect": part(sh, "next", 0.62, 1.0, pad=50)}],
            ring=[{"from": word_time(21, "blocked"), "to": le(21) + 0.4, "rect": boxes[sh]["locked"]}])
    elif sec == "lookalike":
        a, b = "pay_before", "pay_after"
        click = word_time(23, "look") - 0.2
        add("shot", L, images=[{"src": f"shots/{a}.png", "at": 0, "size": size(a)}, {"src": f"shots/{b}.png", "at": click + 0.45, "size": size(b)}],
            cam=[{"at": ls(L[0]) - 0.4, "rect": [boxes[a]["card"][0] - 40, boxes[a]["card"][1] - 40, boxes[a]["card"][2] + 80, boxes[a]["card"][2] * 0.62]}, {"at": ls(23) - 0.2, "rect": bx(a, "address", "checker", pad=60)},
                 {"at": word_time(23, "caught") - 0.2, "rect": bx(b, "checker", pad=50)}],
            cursor=[{"at": ls(23), "pos": [center(a, "input")[0] + 500, center(a, "input")[1] + 420]}, {"at": click, "pos": center(a, "input"), "click": True},
                    {"at": click + 0.8, "pos": [center(a, "input")[0] + 300, center(a, "input")[1] - 160]}],
            ring=[{"from": word_time(23, "caught"), "to": le(23) + 0.4, "rect": boxes[b]["result"]}])
    elif sec == "unidentified":
        a = "unidentified"
        click = word_time(24, "confirms") - 0.25
        add("shot", L, images=[{"src": f"shots/{a}.png", "at": 0, "size": size(a)}, {"src": "shots/kite_matched.png", "at": click + 0.55, "size": size("kite_matched")}],
            cam=[{"at": ls(24) - 0.4, "rect": bx(a, "verdict", "score", pad=60)}, {"at": word_time(24, "evidence") - 0.3, "rect": part(a, "suggestion", 0.75, 1.0, pad=40)},
                 {"at": click + 0.5, "rect": bx("kite_matched", "head", "verdict", pad=60)}],
            cursor=[{"at": word_time(24, "evidence"), "pos": [center(a, "confirm")[0] + 700, center(a, "confirm")[1] + 300]}, {"at": click, "pos": center(a, "confirm"), "click": True}],
            ring=[{"from": word_time(24, "most"), "to": word_time(24, "evidence") - 0.2, "rect": boxes[a]["score"]}])
    elif sec == "outcome":
        add("outcome", L, bg="shots/glance_after.png", bgSize=size("glance_after"), lines=[{"at": ls(i), "text": DISPLAY.get(i, lines[i][1])} for i in L])
    elif sec == "end":
        add("end", L, at=ls(L[0]))

# "Demo data" is shown once: on the first product shot of the cut.
if not any("label" in sc for sc in scenes):
    first = next(sc for sc in scenes if sc["kind"] == "shot")
    first["label"] = {"text": "Demo data · a fictional company", "from": first["from"] + 0.5, "to": first["from"] + 4.5}

for a, b in zip(scenes, scenes[1:]):
    a["to"] = round(b["from"] + 0.5, 3)          # overlap: crossfade into the next scene
scenes[-1]["to"] = round(TOTAL, 3)

# ---------- voice track ----------
total_n = int(TOTAL * SR) + SR
voice = np.zeros(total_n, np.float32)
for i in order:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(W / f"vo/{i:02d}.wav"), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    k = int(ls(i) * SR); voice[k:k + len(x)] += x
with wave.open(str(OUT / "voice.wav"), "wb") as f:
    f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
    f.writeframes((np.clip(voice[: int(TOTAL * SR)], -1, 1) * 32767).astype(np.int16).tobytes())

tl = {"fps": FPS, "duration": round(TOTAL, 3), "frames": int(round(TOTAL * FPS)), "cut": CUT, "scenes": scenes, "captions": captions,
      "lines": [{"i": i, "section": lines[i][0], "from": round(ls(i), 3), "to": round(le(i), 3), "spoken": lines[i][1], "display": DISPLAY.get(i, lines[i][1])} for i in order]}
(OUT / "timeline.json").write_text(json.dumps(tl, indent=1))
print(CUT, "duration", round(TOTAL, 2), "s,", len(scenes), "scenes,", len(captions), "captions")
