"""Text size check (feedback: no tiny text). Every piece of text in the 16:9 film must be at least 3% of
the frame height (32.4 px of 1080). Checked from the source, because OCR can't measure font size:
  * every font size the film sets (CSS px at 1920x1080), with the SVG illustrations at their drawn scale;
  * every real app screenshot: its smallest font x the scale it is shown at (same rule as Story.tsx).
    check_text.py <Story.tsx> <elements.json> <timeline.json>
"""
import json, re, sys
src = open(sys.argv[1]).read(); el = json.load(open(sys.argv[2])); tl = json.load(open(sys.argv[3]))
MIN = 0.03 * 1080
rep = {"css_font_sizes": [], "svg_text": [], "elements": [], "fails": []}
# 1. CSS font sizes (for "a ? b : c", the 16:9 value is c)
for m in re.finditer(r"fontSize: (vertical \? \d+ : )?(\d+)", src):
    v = int(m.group(2)); rep["css_font_sizes"].append(v)
    if v < MIN: rep["fails"].append(f"css fontSize {v}px at char {m.start()}")
# 2. SVG text inside the illustrations: drawn sizes (viewBox 400 wide note at 820 px or 300*0.92 px icons; 300-wide icons at 0.92)
svg = {"note_big": 820 / 400, "note_icon": 300 / 400 * 0.92, "icon": 0.92}
for m in re.finditer(r'<text[^>]*fontSize="(\d+)"[^>]*>([^<]*)<', src):
    size = int(m.group(1)); txt = m.group(2)
    ctx = src[max(0, m.start() - 600): m.start()]
    if "const Note" in src[:m.start()] and m.start() < src.index("const Cashier"):
        guarded = "w >= 600" in src[m.start() - 30: m.start()]
        drawn = [size * svg["note_big"]] + ([] if guarded else [size * svg["note_icon"]])
    else:
        drawn = [size * svg["icon"]]
    rep["svg_text"].append({"text": txt, "drawn_px": [round(d, 1) for d in drawn]})
    if min(drawn) < MIN: rep["fails"].append(f"svg text {txt!r} drawn at {min(drawn):.1f}px")
# 3. App screenshots, at the scale Story.tsx shows them (stage 1700x648 on 16:9)
used = set()
def walk(o):
    if isinstance(o, dict):
        if "src" in o and "scale" in o and "css" in o: used.add(o["src"].split("/")[-1][:-4])
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(tl["scenes"])
for n in sorted(used):
    f = el[n]; sc = 34 / f["minFont"] * 1.04; fit = min(1700 / f["css"][0], 648 / f["css"][1])
    s = max(min(sc, fit), min(3.0, fit)); px = round(s * f["minFont"], 1)
    rep["elements"].append({"element": n, "smallest_font_css": f["minFont"], "shown_scale": round(s, 2), "smallest_text_px": px})
    if px < MIN: rep["fails"].append(f"element {n}: smallest text {px}px")
rep["min_px_required"] = MIN; rep["ok"] = not rep["fails"]
print(json.dumps(rep, indent=1))
