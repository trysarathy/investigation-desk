"""Writes script_final.md from the full film's timeline: narration and captions with timecodes.
Usage: write_script.py <timeline.json> <out.md>"""
import json, sys

tl = json.load(open(sys.argv[1]))
tc = lambda s: f"{int(s // 60)}:{s % 60:05.2f}"
SECTION = {"hook": "Hook", "problem": "The problem", "why": "Why it matters", "solution": "The solution", "glance": "a. At a glance",
           "acme": "b. Routine payment (Acme)", "brightline": "c. Short payment (Brightline)", "orbit": "d. Counterfeit token (Orbit)",
           "lookalike": "e. Look-alike address (Fernhill)", "unidentified": "f. Unidentified payment (Kite)", "outcome": "Outcome", "end": "End card"}
out = [f"# Clearline product film: final script\n",
       f"Duration {tc(tl['duration'])} · 1920×1080 · 30 fps · voice: Piper \"Cori\" (en_GB, high) · music: original, generated for this film.\n",
       "Times are from the start of the film. The voice says \"fifty dollars\" and \"U S D T\"; the captions show \"50.00 USDC\" and \"USDT\".\n"]
sec = None
for l in tl["lines"]:
    if l["section"] != sec:
        sec = l["section"]; out.append(f"\n## {SECTION.get(sec, sec)}\n\n| Time | Narration |\n|---|---|")
    out.append(f"| {tc(l['from'])}–{tc(l['to'])} | {l['spoken']} |")
out.append("\n## Captions (as shown on screen)\n\n| From | To | Caption |\n|---|---|---|")
for c in tl["captions"]:
    out.append(f"| {tc(c['from'])} | {tc(c['to'])} | {c['text']} |")
open(sys.argv[2], "w").write("\n".join(out) + "\n")
print("wrote", sys.argv[2])
