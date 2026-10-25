"""Generates the film's narration, one file per line, and checks every line by transcribing it back:
a line that doesn't come back as its own words is generated again (up to 8 takes). One command
switches the voice:

    voice.py <work_dir> piper                      # free, offline (Piper "Cori", en_GB)
    ELEVENLABS_API_KEY=... voice.py <work_dir> elevenlabs [voice_id]   # default: George (warm British narrator)
    ONLY=3,5 voice.py <work_dir> piper             # redo just these lines, keep the rest

Reads <work_dir>/lines.json ([section, text] pairs); writes <work_dir>/vo/NN.wav (48 kHz mono) and
<work_dir>/vo/words.jsonl (word timings). The problem section is read a little slower, and
"Meet Clearline." with a lift, as the script asks.
"""
import json, os, pathlib, re, subprocess, sys, urllib.request
import numpy as np
from faster_whisper import WhisperModel

W = pathlib.Path(sys.argv[1]); ENGINE = sys.argv[2]
VOICE = sys.argv[3] if len(sys.argv) > 3 else "JBFqnCBsd6RMkjVDRZzb"   # ElevenLabs premade "George"
PIPER_MODEL = os.environ.get("PIPER_MODEL", str(pathlib.Path(__file__).resolve().parent / "voices/en_GB-cori-high.onnx"))
lines = json.load(open(W / "lines.json"))
(W / "vo").mkdir(exist_ok=True)
SLOW = {"pain", "wrong"}          # a slower, heavier read in the problem section
LIFT = {13}                       # "Meet Clearline."
# Piper-only respellings for words it misreads (the script, captions and checks keep the real word).
PIPER_SAY = {"ticks the invoice": "tix the invoice"}
TAKES = 8

def to_wav(src: str, dst: str):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-ac", "1", "-ar", "48000", dst], check=True)

def generate(i, sec, text, out):
    if ENGINE == "piper":
        say = text
        for k, v in PIPER_SAY.items(): say = say.replace(k, v)
        scale = "1.12" if sec in SLOW else "0.98" if i in LIFT else "1.04"
        tmp = W / f"vo/{i:02d}.raw.wav"
        subprocess.run(["python3", "-m", "piper", "-m", PIPER_MODEL, "--length-scale", scale, "--sentence-silence", "0.3", "-f", str(tmp)],
                       input=say.encode(), capture_output=True, check=True)
        to_wav(str(tmp), str(out)); tmp.unlink()
    elif ENGINE == "elevenlabs":
        key = os.environ["ELEVENLABS_API_KEY"]
        settings = {"stability": 0.55, "similarity_boost": 0.8, "style": 0.35 if i in LIFT else 0.15, "use_speaker_boost": True,
                    "speed": 0.9 if sec in SLOW else 1.0}
        body = json.dumps({"text": text, "model_id": "eleven_multilingual_v2", "voice_settings": settings}).encode()
        req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128", data=body,
                                     headers={"xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg"})
        mp3 = W / f"vo/{i:02d}.mp3"
        mp3.write_bytes(urllib.request.urlopen(req, timeout=60).read())
        to_wav(str(mp3), str(out)); mp3.unlink()
    else:
        sys.exit("engine: piper | elevenlabs")

asr = WhisperModel("small.en", device="cpu", compute_type="int8")
def transcribe(f):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True, check=True).stdout
    segs, _ = asr.transcribe(np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0, beam_size=5, word_timestamps=True, language="en")
    words = [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)} for s in segs for w in s.words]
    return {"file": str(f), "text": " ".join(x["w"] for x in words), "words": words}
# Spacing and hyphens don't change the sound ("look-alike" / "look -a -like"), so they compare equal.
# Numbers the recogniser writes as digits ("$860") are compared as the words that were spoken.
def spoken(s):
    from num2words import num2words
    def w(m):
        n = m.group(2).replace(",", "")
        return num2words(float(n) if "." in n else int(n)) + (" dollars" if m.group(1) else "")
    s = re.sub(r"(\d)\s+,(\d)", r"\1,\2", s)   # the recogniser sometimes writes "$2 ,180"
    return re.sub(r"(\$)?(\d[\d,]*(?:\.\d+)?)", w, s)
norm = lambda s: re.sub(r"[^a-z0-9]", "", spoken(s).lower().replace(" and ", " "))

ONLY = set(int(x) for x in os.environ.get("ONLY", "").split(",") if x)
old = {}
if ONLY and (W / "vo/words.jsonl").exists():
    old = {k: json.loads(l) for k, l in enumerate(open(W / "vo/words.jsonl"))}
results, bad = [], 0
for i, (sec, text) in enumerate(lines):
    out = W / f"vo/{i:02d}.wav"
    if ONLY and i not in ONLY and i in old:
        results.append(old[i]); continue
    for take in range(1, TAKES + 1):
        generate(i, sec, text, out); r = transcribe(out)
        if norm(r["text"]) == norm(text): break
        print(f"  retake {i:02d} (heard {r['text']!r})")
    else:
        bad += 1; print(f"MISMATCH {i:02d}: said {text!r} | heard {r['text']!r}")
    results.append(r); print(f"{i:02d} {sec:9s} take {take}: {text}")
(W / "vo/words.jsonl").write_text("".join(json.dumps(r) + "\n" for r in results))
print("pronunciation check:", "all lines match" if not bad else f"{bad} line(s) to fix")
sys.exit(1 if bad else 0)
