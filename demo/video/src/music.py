"""Generates the film's music bed: a calm, slow ambient pad with a soft high pulse, original and
royalty-free (synthesised here, no samples). Usage: music.py <seconds> <out.wav>"""
import sys, wave
import numpy as np

SR = 48000
dur = float(sys.argv[1]); out = sys.argv[2]
n = int(SR * dur); t = np.arange(n) / SR
rng = np.random.default_rng(7)
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)

# Fmaj9 -> Dm9 -> Bbmaj9 -> Csus2, eight seconds each, looping: warm, unresolved, unhurried.
CHORDS = [[41, 53, 57, 60, 64, 67], [38, 50, 53, 57, 60, 64], [34, 46, 50, 53, 57, 60], [36, 48, 50, 55, 62, 67]]
BAR = 8.0
pad = np.zeros(n)
for k in range(int(dur // BAR) + 2):
    chord = CHORDS[k % 4]; start = k * BAR - 1.5
    i0 = max(0, int(start * SR)); i1 = min(n, int((start + BAR + 3.0) * SR))
    if i1 <= i0: continue
    tt = t[i0:i1] - start
    env = np.clip(tt / 2.5, 0, 1) * np.clip((BAR + 3.0 - tt) / 3.0, 0, 1)   # slow swell in, long release
    for j, m in enumerate(chord):
        f = hz(m); amp = (0.5 if j == 0 else 0.22) / (1 + 0.15 * j)
        for det in (-0.12, 0.0, 0.11):                                         # gentle chorus
            ph = rng.uniform(0, 2 * np.pi)
            pad[i0:i1] += amp * env * (np.sin(2 * np.pi * f * (1 + det / 100) * tt + ph) + 0.18 * np.sin(4 * np.pi * f * tt + ph))

# A soft, sparse high pulse (felt-piano-like plucks), every 0.75 s, notes from the current chord.
pulse = np.zeros(n)
step = 0.75
for k in range(int(dur / step)):
    st = k * step; chord = CHORDS[int(st // BAR) % 4]
    m = chord[[3, 4, 5, 4][k % 4]] + 12
    i0 = int(st * SR); L = int(1.6 * SR); i1 = min(n, i0 + L)
    tt = t[i0:i1] - st
    env = (1 - np.exp(-tt * 200)) * np.exp(-tt * 3.2)
    vel = 0.55 + 0.45 * ((k % 8) == 0)
    pulse[i0:i1] += 0.10 * vel * env * (np.sin(2 * np.pi * hz(m) * tt) + 0.3 * np.sin(4 * np.pi * hz(m) * tt) * np.exp(-tt * 6))

x = pad / np.max(np.abs(pad)) * 0.55 + pulse
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
st *= np.clip(t / 3.0, 0, 1)[:, None] * np.clip((dur - t) / 4.0, 0, 1)[:, None]   # fade in from silence, fade out
st = st / np.max(np.abs(st)) * 0.7
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
print("music", out, dur, "s")
