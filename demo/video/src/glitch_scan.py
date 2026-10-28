"""Finds one-frame glitches in a rendered JPEG sequence: a frame that differs sharply from both of its
neighbours while they agree with each other (a real cut or fade never does that), or that is much
darker than both. Prints the bad frame numbers as JSON.

    glitch_scan.py <frames_dir>
"""
import json, pathlib, re, sys
import numpy as np
from PIL import Image

files = sorted(pathlib.Path(sys.argv[1]).glob("f*.jpeg"))
if len(files) < 3: sys.exit(f"no frames in {sys.argv[1]}")
num = lambda p: int(re.search(r"(\d+)", p.stem).group(1))
def small(p):
    im = Image.open(p).convert("L"); im.draft("L", (im.width // 8, im.height // 8))
    return np.asarray(im.resize((160, 90 if im.width > im.height else 284)), np.float32)
frames = [small(p) for p in files]
bad = []
for k in range(1, len(frames) - 1):
    a, x, b = frames[k - 1], frames[k], frames[k + 1]
    neigh = np.abs(a - b).mean(); dev = np.abs(x - (a + b) / 2).mean()
    dark = x.mean() < 0.75 * min(a.mean(), b.mean()) and min(a.mean(), b.mean()) > 8
    # region check: any band of the frame suddenly blank while the neighbours agree
    rows = np.abs(x - (a + b) / 2).mean(axis=1); band = rows.max()
    # Glitches can come in neighbouring frames, so also compare with the median of a 5-frame window.
    win = frames[max(0, k - 2): k + 3]
    med = np.median(np.stack(win), axis=0); mrow = np.abs(x - med).mean(axis=1).max()
    # ...but only if this frame stands out from the window: in a camera pan every frame differs from the median.
    others = max(np.abs(w - med).mean(axis=1).max() for j, w in enumerate(win) if j != min(k, 2))
    if (dev > 3 * neigh + 6) or dark or (band > 40 and np.abs(a - b).mean(axis=1).max() < 12) or (mrow > 25 and mrow > 2.5 * others):
        bad.append(num(files[k]))
print(json.dumps(bad))
