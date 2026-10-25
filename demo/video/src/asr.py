"""Transcribe audio files with faster-whisper (word timestamps). Usage: asr.py file... -> JSON lines."""
import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
def load(f):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", f, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
m = WhisperModel(sys.argv[1] if sys.argv[1] in ("small.en", "medium.en", "base.en") else "small.en", device="cpu", compute_type="int8")
for f in [a for a in sys.argv[1:] if a.endswith((".wav", ".mp3", ".m4a", ".mp4"))]:
    segs, _ = m.transcribe(load(f), beam_size=5, word_timestamps=True, language="en")
    words = [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)} for s in segs for w in s.words]
    print(json.dumps({"file": f, "text": " ".join(x["w"] for x in words), "words": words}))
