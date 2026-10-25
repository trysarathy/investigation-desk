"""Builds the Maya film's timeline from the narration: where each line sits (with pauses for impact),
the captions (timed from the spoken words, at most 8 words, held across short pauses), and each
scene's beats, anchored to the words they belong with.

    build_story.py <work_dir> <cut: full|short> <elements_dir>
      reads  <work_dir>/lines.json, vo/NN.wav, vo/words.jsonl, <elements_dir>/elements.json
      writes <work_dir>/<cut>/timeline.json, <work_dir>/<cut>/voice.wav
"""
import json, pathlib, re, subprocess, sys, wave
import numpy as np

W = pathlib.Path(sys.argv[1]); CUT = sys.argv[2]; EL = pathlib.Path(sys.argv[3])
OUT = W / CUT; OUT.mkdir(parents=True, exist_ok=True)
SR = 48000
lines = json.load(open(W / "lines.json"))
words = [json.loads(l) for l in open(W / "vo/words.jsonl")]
el = json.load(open(EL / "elements.json"))

# The 30-second cut: hook -> Maya's pain -> reveal -> the scam warning -> the invoice ticking itself off -> end card.
ORDER = {"full": list(range(len(lines))), "short": [0, 1, 3, 13, 14, 17, 19, 28]}[CUT]

def dur(i):
    with wave.open(str(W / f"vo/{i:02d}.wav")) as f: return f.getnframes() / f.getframerate()
def onset(i):
    with wave.open(str(W / f"vo/{i:02d}.wav")) as f:
        sr = f.getframerate(); x = np.frombuffer(f.readframes(f.getnframes()), np.int16).astype(np.float32) / 32768
    win = int(sr * 0.01)
    for k in range(0, len(x) - win, win):
        if np.sqrt(np.mean(x[k:k + win] ** 2)) > 0.01: return k / sr
    return 0.0

# Pauses: a breath between lines, longer between sections, a held beat before the reveal and before each case.
PAUSE_BEFORE = {2: 0.7, 3: 0.4, 5: 0.5, 6: 0.4, 7: 0.8, 12: 1.0, 13: 0.8, 14: 0.4, 15: 0.9, 16: 0.3, 17: 0.5, 18: 0.7,
                19: 1.1, 21: 1.1, 23: 0.5, 24: 1.1, 28: 1.0}
if CUT == "short":
    PAUSE_BEFORE = {3: 0.5, 13: 0.7, 14: 0.3, 17: 0.6, 19: 0.8, 28: 0.8}
LEAD, GAP, TAIL = 0.5, 0.28, 3.0 if CUT == "full" else 2.6
start, t = {}, LEAD
for k, i in enumerate(ORDER):
    if k: t += PAUSE_BEFORE.get(i, GAP)
    start[i] = t; t += dur(i)
    if i == 18 or (CUT == "short" and i == 17): t += 1.0 if CUT == "full" else 0.6   # hold the red warning a little longer
TOTAL = t + TAIL
ls = lambda i: start[i]
le = lambda i: start[i] + dur(i)
def wt(i, w):
    for x in words[i]["words"]:
        if re.sub(r"[^a-z]", "", x["w"].lower()).startswith(w): return ls(i) + x["s"]
    raise KeyError((i, w))

# ---------- captions ----------
DISPLAY = {28: "Clearline."}
captions = []
for i in ORDER:
    toks = DISPLAY.get(i, lines[i][1]).split(); sp = words[i]["words"]
    n = -(-len(toks) // 8); cuts, prev = [], 0
    for c in range(1, n):
        ideal = round(c * len(toks) / n); best = ideal
        for d in (0, 1, -1, 2, -2):
            k = ideal + d
            if prev + 3 <= k <= len(toks) - 3 and k - prev <= 8 and re.search(r"[,.:;?]$", toks[k - 1]): best = k; break
        cuts.append(best); prev = best
    b = [0] + cuts + [len(toks)]
    chunks = [list(range(b[j], b[j + 1])) for j in range(len(b) - 1)]
    while any(len(c) > 8 for c in chunks):   # hard limit: never more than 8 words on screen
        k = next(j for j, c in enumerate(chunks) if len(c) > 8); c = chunks[k]; h = len(c) // 2
        chunks[k:k + 1] = [c[:h], c[h:]]
    # Map each script word to the recogniser's word (in order), so a mid-line caption starts on its own word.
    import difflib
    nz = lambda w: re.sub(r"[^a-z0-9]", "", w.lower())
    sm_ = difflib.SequenceMatcher(a=[nz(x) for x in toks], b=[nz(x["w"]) for x in sp], autojunk=False)
    amap = {}
    for blk in sm_.get_matching_blocks():
        for d in range(blk.size): amap[blk.a + d] = blk.b + d
    def t_at(k):
        if k in amap: return ls(i) + sp[amap[k]]["s"]
        return ls(i) + sp[min(len(sp) - 1, round(k * len(sp) / max(1, len(toks))))]["s"]
    for ci, c in enumerate(chunks):
        s = ls(i) + onset(i) if ci == 0 else t_at(c[0])
        e = t_at(chunks[ci + 1][0]) if ci + 1 < len(chunks) else le(i) + 0.3
        captions.append({"from": round(s, 3), "to": round(e, 3), "text": " ".join(toks[k] for k in c)})
for a, c in zip(captions, captions[1:]):
    a["to"] = c["from"] if c["from"] - a["to"] <= 2.0 else min(a["to"], c["from"])

# ---------- elements: shown at the scale that makes their smallest text >= 3% of 1080 ----------
MIN_TEXT = 34.0
def E(name):
    f = el[name]
    return {"src": f"el/{name}.png", "css": f["css"], "px": f["px"], "scale": round(MIN_TEXT / f["minFont"] * 1.04, 3) if f["minFont"] else 1}

# Pre-blurred page backgrounds (Story.tsx shows them dimmed behind the element in focus).
from PIL import Image, ImageEnhance, ImageFilter
for n, f in el.items():
    if isinstance(f, dict) and f.get("background"):
        im = Image.open(EL / f"{n}.png").convert("RGB").resize((960, 540), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5))
        ImageEnhance.Color(im).enhance(0.6).save(EL / f"{n}_soft.jpg", quality=90)

scenes = []
def scene(kind, first, last, **kw):
    scenes.append({"kind": kind, "from": round(ls(first) - 0.45, 3), "lastLine": last, **kw})
has = lambda *ids: all(i in start for i in ids)

if has(0): scene("hook", 0, 1, beats=[ls(0), wt(1, "so") if has(1) else le(0) + 0.3])
if has(2): scene("maya", 2, 2, at=ls(2))
if has(3): scene("inbox", 3, 3, at=ls(3), msgs=[
    {"from": "Priya · Brightline Studio", "text": "We paid yesterday. Why is our invoice still unpaid?"},
    {"from": "Daniel · Orbit Retail", "text": "Payment sent in full. Please close the invoice."},
    {"from": "Aisha · Meridian Travel", "text": "Can you confirm you received our payment?"}])
if has(4): scene("dig", 4, 4, beats=[wt(4, "codes"), wt(4, "spreadsheets"), wt(4, "email"), wt(4, "find")])
if has(5): scene("cashier", 5, 6, tags=[wt(5, "real"), wt(5, "short"), wt(5, "meant")], every=ls(6) if has(6) else None)
if has(7): scene("wrong", 7, 11, title=ls(7), items=[ls(8), ls(9), ls(10), ls(11)])
if has(12): scene("turn", 12, 14, question=ls(12) if has(12) else None, name=ls(13), tagline=ls(14))
elif has(13): scene("turn", 13, 14, question=None, name=ls(13), tagline=ls(14))
if has(15): scene("start", 15, 15, at=ls(15))
if has(16):
    scene("focus", 16, 16, view="Maya's view", bg="el/m_bg.png", items=[
        {"at": ls(16), "el": E("m_head"), "note": "Payment request sent"},
        {"at": wt(16, "her") - 0.15, "el": E("c_top"), "view": "Customer's view", "bg": "el/c_bg.png", "note": "Exactly how much"},
        {"at": wt(16, "where") - 0.1, "el": E("c_addr"), "view": "Customer's view", "bg": "el/c_bg.png", "note": "And exactly where"}])
if has(17):
    acc = el["_accounts"]
    scene("compare", 17, 17, real=acc["real"], fake=acc["lookalike"], at=ls(17), warn=wt(17, "warns") - 0.2, stop=E("c_stop"))
if has(18):
    scene("focus", 18, 18, view="Customer's view", bg="el/c_bg.png", hold=True, items=[{"at": ls(18) - 0.45, "el": E("c_stop"), "note": None, "red": True}])
if has(19):
    scene("focus", 19, 20, view="Maya's view", bg="el/a_bg.png", chapter=["02", "When the payment is right"], items=[
        {"at": ls(19), "el": E("a_head_before"), "note": "Payment arriving"},
        {"at": wt(19, "ticks") - 0.1, "el": E("a_head_after"), "note": "Ticked off by itself", "tick": True},
        *([{"at": ls(20), "el": E("a_verdict_title"), "note": None}] if has(20) else [])])
if has(21):
    scene("focus", 21, 23, view="Maya's view", bg="el/o_bg.png", chapter=["03", "When something's wrong"], items=[
        {"at": ls(21), "el": E("o_title"), "note": "Fake digital dollars", "red": True},
        {"at": wt(22, "refuses") - 0.1, "el": E("o_blocked"), "note": "Refused: it can't be counted", "red": True},
        {"at": wt(22, "reply") - 0.1, "el": E("o_reply"), "note": "The reply, already written"}])
if has(24): scene("outcome", 24, 27, laptop=ls(24), lines=[{"at": ls(i), "text": lines[i][1]} for i in (25, 26, 27)])
if has(28): scene("end", 28, 28, at=ls(28))

for a, b in zip(scenes, scenes[1:]): a["to"] = b["from"]
scenes[-1]["to"] = round(TOTAL, 3)
for s in scenes: s.pop("lastLine", None)
# "Demo data" once: on the first scene that shows the app.
first_app = next(s for s in scenes if s["kind"] in ("focus", "compare"))
first_app["demoLabel"] = [round(first_app["from"] + 0.6, 3), round(first_app["from"] + 5.0, 3)]

# ---------- voice track ----------
voice = np.zeros(int((TOTAL + 1) * SR), np.float32)
for i in ORDER:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(W / f"vo/{i:02d}.wav"), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32); k = int(ls(i) * SR); voice[k:k + len(x)] += x
with wave.open(str(OUT / "voice.wav"), "wb") as f:
    f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
    f.writeframes((np.clip(voice[: int(TOTAL * SR)], -1, 1) * 32767).astype(np.int16).tobytes())

# Music cues: tension through the problem, a lift at the reveal, calm for the demo, resolve at the end.
cues = {"tension": ls(2) if has(2) else ls(3), "reveal": ls(13) - 0.3, "resolve": ls(24) - 0.3 if has(24) else ls(28) - 0.5}
tl = {"fps": 30, "duration": round(TOTAL, 3), "frames": int(round(TOTAL * 30)), "cut": CUT, "scenes": scenes, "captions": captions, "music": cues,
      "lines": [{"i": i, "section": lines[i][0], "from": round(ls(i), 3), "to": round(le(i), 3), "spoken": lines[i][1], "display": DISPLAY.get(i, lines[i][1])} for i in ORDER]}
(OUT / "timeline.json").write_text(json.dumps(tl, indent=1))
print(CUT, "duration", round(TOTAL, 1), "s;", len(scenes), "scenes;", len(captions), "captions")
