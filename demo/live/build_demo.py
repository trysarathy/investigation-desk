"""Builds the live demo's edit timeline from the recording log: where each narration line sits, the
captions (timed from the spoken words, at most 8 words), the camera's focus points, the cursor, the
scene cuts, and the voice track.

    build_demo.py <work_dir> <plan: full|short>
      reads  <work_dir>/lines.json, vo/NN.wav, vo/words.jsonl, <plan>/rec.json
      writes <work_dir>/<plan>/timeline.json, <work_dir>/<plan>/voice.wav
"""
import difflib, json, pathlib, re, subprocess, sys, wave
import numpy as np

W = pathlib.Path(sys.argv[1]); PLAN = sys.argv[2]; D = W / PLAN
lines = json.load(open(W / "lines.json")); words = [json.loads(l) for l in open(W / "vo/words.jsonl")]
rec = json.load(open(D / "rec.json"))
SR = 48000; TOTAL = rec["duration"]

def onset(i):
    with wave.open(str(W / f"vo/{i:02d}.wav")) as f:
        sr = f.getframerate(); x = np.frombuffer(f.readframes(f.getnframes()), np.int16).astype(np.float32) / 32768
    win = int(sr * 0.01)
    for k in range(0, len(x) - win, win):
        if np.sqrt(np.mean(x[k:k + win] ** 2)) > 0.01: return k / sr
    return 0.0

# ---------- captions: at most 8 words, split at punctuation, timed from the recogniser's words ----------
captions = []
for L in rec["lines"]:
    i, t0, d = L["i"], L["t"], L["d"]
    toks = lines[i][1].split(); sp = words[i]["words"]
    nz = lambda w: re.sub(r"[^a-z0-9]", "", w.lower())
    sm = difflib.SequenceMatcher(a=[nz(x) for x in toks], b=[nz(x["w"]) for x in sp], autojunk=False)
    amap = {blk.a + k: blk.b + k for blk in sm.get_matching_blocks() for k in range(blk.size)}
    t_at = lambda k: t0 + sp[amap[k] if k in amap else min(len(sp) - 1, round(k * len(sp) / len(toks)))]["s"]
    n = -(-len(toks) // 8); cuts, prev = [], 0
    for c in range(1, n):
        ideal = round(c * len(toks) / n); best = ideal
        for dd in (0, 1, -1, 2, -2):
            k = ideal + dd
            if prev + 3 <= k <= len(toks) - 3 and k - prev <= 8 and re.search(r"[,.:;?]$", toks[k - 1]): best = k; break
        cuts.append(best); prev = best
    b = [0] + cuts + [len(toks)]
    chunks = [list(range(b[j], b[j + 1])) for j in range(len(b) - 1)]
    while any(len(c) > 8 for c in chunks):
        k = next(j for j, c in enumerate(chunks) if len(c) > 8); c = chunks[k]; h = len(c) // 2; chunks[k:k + 1] = [c[:h], c[h:]]
    for ci, c in enumerate(chunks):
        s = t0 + onset(i) if ci == 0 else t_at(c[0])
        e = t_at(chunks[ci + 1][0]) if ci + 1 < len(chunks) else t0 + d + 0.3
        captions.append({"from": round(s, 3), "to": round(e, 3), "text": " ".join(toks[k] for k in c)})
for a, c in zip(captions, captions[1:]):
    a["to"] = c["from"] if c["from"] - a["to"] <= 1.5 else min(a["to"], c["from"])

# ---------- voice track ----------
voice = np.zeros(int((TOTAL + 1) * SR), np.float32)
for L in rec["lines"]:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(W / f"vo/{L['i']:02d}.wav"), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32); k = int(L["t"] * SR); voice[k:k + len(x)] += x
with wave.open(str(D / "voice.wav"), "wb") as f:
    f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
    f.writeframes((np.clip(voice[: int(TOTAL * SR)], -1, 1) * 32767).astype(np.int16).tobytes())

first_view = rec["views"][0]["t"] if rec["views"] else 1.0
tl = {"fps": 30, "duration": round(TOTAL, 3), "frames": int(round(TOTAL * 30)), "cut": PLAN, "video": f"{PLAN}/rec.mp4", "src": [2880, 1620],
      "cam": rec["focus"], "cursor": rec["cursor"], "dips": rec["dips"], "views": rec["views"], "end": rec["end"],
      "badge": [round(first_view + 0.3, 3), round(first_view + 4.8, 3)], "captions": captions,
      "lines": [{"i": L["i"], "section": lines[L["i"]][0], "from": round(L["t"], 3), "to": round(L["t"] + L["d"], 3), "spoken": lines[L["i"]][1]} for L in rec["lines"]]}
(D / "timeline.json").write_text(json.dumps(tl, indent=1))
print(PLAN, "duration", round(TOTAL, 1), "s;", len(captions), "captions;", len(rec["focus"]), "focus points")
