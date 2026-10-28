"""Turns the recorder's timestamped screencast frames into a constant 30 fps video (each frame held
until the next one arrived), at the recording's full 2x resolution so the edit can zoom in sharply.

    frames_to_video.py <plan_dir>      # reads rec.json + frames/, writes rec.mp4
"""
import json, pathlib, subprocess, sys

D = pathlib.Path(sys.argv[1]); rec = json.load(open(D / "rec.json"))
# Frames can arrive slightly out of order: place them by the time they were drawn, not by arrival.
fr = sorted((f for f in rec["frames"] if f["t"] >= 0), key=lambda f: f["t"])
lines = ["ffconcat version 1.0"]
for a, b in zip(fr, fr[1:] + [{"t": rec["duration"]}]):
    lines += [f"file 'frames/{a['f']}'", f"duration {max(0.001, b['t'] - a['t']):.4f}"]
lines.append(f"file 'frames/{fr[-1]['f']}'")
# the page was blank before the first frame: start the video at t=0 with the first frame
lines.insert(1, f"file 'frames/{fr[0]['f']}'"); lines.insert(2, f"duration {max(0.001, fr[0]['t']):.4f}")
(D / "frames.ffconcat").write_text("\n".join(lines) + "\n")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(D / "frames.ffconcat"),
                "-vf", "fps=30,scale=2880:1620:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14",
                "-t", f"{rec['duration']:.3f}", str(D / "rec.mp4")], check=True)
print("wrote", D / "rec.mp4")
