"""Writes script_final.md from the full film's timeline: narration and captions with timecodes.
Usage: write_script.py <timeline.json> <out.md> [voice name]"""
import json, sys

tl = json.load(open(sys.argv[1]))
tc = lambda s: f"{int(s // 60)}:{s % 60:05.2f}"
SECTION = {"hook": "1. Hook", "pain": "2. Maya's problem", "wrong": "3. What goes wrong", "turn": "4. The turn: Clearline",
           "prevent": "5. Before anyone pays (customer's view)", "auto": "6. When the payment is right (Maya's view)",
           "wrongpay": "7. When something's wrong (Maya's view)", "books": "8. In your books (Maya's view, demo books)", "outcome": "9. Outcome", "end": "10. End card"}
VOICE = sys.argv[3] if len(sys.argv) > 3 else 'Piper "Cori" (en_GB, high)'
out = [f"# Clearline product film: final script\n",
       f"Duration {tc(tl['duration'])} · 1920×1080 · 30 fps · voice: {VOICE} · music: original, generated for this film.\n",
       "One-liner: **Get paid in digital dollars without the detective work.** All companies, people and amounts are fictional (labelled \"Demo data\" once, on the first app scene). Times are from the start of the film.\n"]
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
