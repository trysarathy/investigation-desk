"""Generates the film's music bed, original and royalty-free (synthesised here, no samples).
Three moods follow the story: a dark, low pulse under the problem ("tension"), a swell and a brighter
key at "Meet Clearline." ("reveal"), and a calm, resolved close ("resolve").

    music.py <seconds> <out.wav> [timeline.json]     # without a timeline: the calm bed throughout
"""
import json, sys, wave
import numpy as np

SR = 48000
dur = float(sys.argv[1]); out = sys.argv[2]
cues = json.load(open(sys.argv[3])).get("music", {}) if len(sys.argv) > 3 else {}
n = int(SR * dur); t = np.arange(n) / SR
rng = np.random.default_rng(7)
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)

# Calm/bright: Fmaj9 -> Dm9 -> Bbmaj9 -> Csus2. Tension: Dm(add9) -> Bb -> Gm -> Asus, lower and thinner.
CALM = [[41, 53, 57, 60, 64, 67], [38, 50, 53, 57, 60, 64], [34, 46, 50, 53, 57, 60], [36, 48, 50, 55, 62, 67]]
DARK = [[38, 50, 53, 57, 64], [34, 46, 50, 53, 57], [31, 43, 46, 50, 57], [33, 45, 50, 52, 57]]
RESOLVE = [[41, 53, 57, 60, 64, 67, 72]]
T_TENSION = cues.get("tension", 1e9); T_REVEAL = cues.get("reveal", 1e9); T_RESOLVE = cues.get("resolve", 1e9)
BAR = 8.0
def mood(t0):
    if t0 >= T_RESOLVE: return "resolve"
    if t0 >= T_REVEAL: return "calm"
    if t0 >= T_TENSION: return "dark"
    return "calm"
def chord_at(t0, k):
    m = mood(t0)
    return RESOLVE[0] if m == "resolve" else (DARK if m == "dark" else CALM)[k % 4]
# Bars restart at each cue so a change of mood lands on the word, not mid-bar.
starts, t0 = [], 0.0
bounds = sorted(c for c in (T_TENSION, T_REVEAL, T_RESOLVE) if c < dur) + [dur + BAR]
for b in bounds:
    while t0 < b - 0.5: starts.append(t0); t0 += min(BAR, b - t0) if b - t0 > 2.0 else BAR
    t0 = max(t0, b) if b <= dur else t0
starts = sorted(set(round(x, 3) for x in starts if x < dur))
pad = np.zeros(n)
for k, st0 in enumerate(starts):
    nxt = starts[k + 1] if k + 1 < len(starts) else dur + 2
    L = nxt - st0
    chord = chord_at(st0, k); start = st0 - 1.5
    i0 = max(0, int(start * SR)); i1 = min(n, int((start + L + 3.0) * SR))
    if i1 <= i0: continue
    tt = t[i0:i1] - start
    env = np.clip(tt / 2.5, 0, 1) * np.clip((L + 3.0 - tt) / 3.0, 0, 1)   # slow swell in, long release
    gain = {"dark": 0.85, "calm": 1.0, "resolve": 1.05}[mood(st0)]
    for j, m in enumerate(chord):
        f = hz(m); amp = gain * (0.5 if j == 0 else 0.22) / (1 + 0.15 * j)
        for det in (-0.12, 0.0, 0.11):                                         # gentle chorus
            ph = rng.uniform(0, 2 * np.pi)
            pad[i0:i1] += amp * env * (np.sin(2 * np.pi * f * (1 + det / 100) * tt + ph) + 0.18 * np.sin(4 * np.pi * f * tt + ph))

# A soft, sparse high pulse (felt-piano-like plucks), every 0.75 s, notes from the current chord.
pulse = np.zeros(n)
step = 0.75
import bisect
for k in range(int(dur / step)):
    st = k * step; md = mood(st)
    if md == "dark" and k % 2: continue                  # sparser, heavier pulse under the problem
    bi = max(0, bisect.bisect_right(starts, st) - 1); chord = chord_at(starts[bi], bi)
    if md == "dark": m = chord[[1, 2, 1, 3][k // 2 % 4]]
    else: m = chord[[3, 4, 5, 4][k % 4] % len(chord)] + 12
    i0 = int(st * SR); L = int(1.6 * SR); i1 = min(n, i0 + L)
    tt = t[i0:i1] - st
    env = (1 - np.exp(-tt * 200)) * np.exp(-tt * 3.2)
    vel = 0.55 + 0.45 * ((k % 8) == 0)
    pulse[i0:i1] += 0.10 * vel * env * (np.sin(2 * np.pi * hz(m) * tt) + 0.3 * np.sin(4 * np.pi * hz(m) * tt) * np.exp(-tt * 6))

# The lift: a soft rising swell (filtered noise + rising tone) into "Meet Clearline."
swell = np.zeros(n)
if T_REVEAL < dur:
    i0 = max(0, int((T_REVEAL - 2.2) * SR)); i1 = min(n, int((T_REVEAL + 0.6) * SR)); tt = t[i0:i1] - (T_REVEAL - 2.2)
    env = np.clip(tt / 2.2, 0, 1) ** 2 * np.clip((2.8 - tt) / 0.6, 0, 1)
    f = 220 * 2 ** (tt / 2.2)
    swell[i0:i1] = 0.08 * env * (np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.5 * np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR))
    # a low "boom" exactly on the reveal
    j0 = int(T_REVEAL * SR); j1 = min(n, j0 + int(2.5 * SR)); tb = t[j0:j1] - T_REVEAL
    swell[j0:j1] += 0.25 * np.exp(-tb * 2.0) * np.sin(2 * np.pi * 43.65 * tb)
x = pad / np.max(np.abs(pad)) * 0.55 + pulse + swell
# Low-pass the pad a little (one-pole), then a long, soft reverb (exponential noise tail).
a = np.exp(-2 * np.pi * 3500 / SR); y = np.empty_like(x); acc = 0.0
for i in range(0, n, 1):
    acc = (1 - a) * x[i] + a * acc; y[i] = acc
ir_len = int(3.2 * SR); ir = rng.standard_normal(ir_len) * np.exp(-np.arange(ir_len) / SR * 2.2); ir /= np.sqrt(np.sum(ir ** 2))
N = 1 << int(np.ceil(np.log2(n + ir_len)))
wet = np.fft.irfft(np.fft.rfft(y, N) * np.fft.rfft(ir, N), N)[:n]
mix = 0.65 * y + 0.35 * wet / np.max(np.abs(wet)) * np.max(np.abs(y))
# Stereo width: a tiny delay on the right channel.
d = int(0.012 * SR); right = np.concatenate([np.zeros(d), mix[:-d]])
st = np.stack([mix, 0.9 * right + 0.1 * mix], axis=1)
st *= np.clip(t / 0.25, 0, 1)[:, None] * np.clip((dur - t) / 4.0, 0, 1)[:, None]   # from silence within 0.25 s, fade out
st = st / np.max(np.abs(st)) * 0.7
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
print("music", out, dur, "s")
