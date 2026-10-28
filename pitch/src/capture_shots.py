"""Captures the real product for the deck: one tightly cropped element per shot, dark theme, 2x.
Needs the app running in demo mode (default http://localhost:3300).  capture_shots.py <out_dir>"""
import json, os, pathlib, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3300"); OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
HIDE = """.demo-badge, .workspace .badge, .mode-note, .sidebar-foot, [data-testid=reload-demo], [data-testid=demo-tools], [data-testid=demo-paste-lookalike] { display: none !important; }"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2, color_scheme="dark")
    ctx.add_init_script("try{localStorage.setItem('desk.theme','dark')}catch(e){}")
    pg = ctx.new_page()
    post = lambda body: pg.request.post(BASE + "/api/requests/demo", data=json.dumps(body), headers={"content-type": "application/json"})
    post({"kind": "reset"})
    def go(path):
        pg.goto(BASE + path); pg.wait_for_load_state("networkidle"); pg.add_style_tag(content=HIDE); time.sleep(0.5)
    def union(name, sels, pad=16, top=None):
        bs = [pg.locator(s).first.bounding_box() for s in sels]
        sy = pg.evaluate("window.scrollY")   # bounding boxes are in the viewport; a full-page clip is in page coordinates
        bs = [{**b, "y": b["y"] + sy} for b in bs]
        x0 = min(b["x"] for b in bs) - pad; y0 = min(b["y"] for b in bs) - (pad if top is None else top)
        x1 = max(b["x"] + b["width"] for b in bs) + pad; y1 = max(b["y"] + b["height"] for b in bs) + pad
        pg.screenshot(path=str(OUT / f"{name}.png"), clip={"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}, full_page=True)
    go("/requests")
    pay = pg.get_attribute("[data-testid=fernhill-sender]", "href")
    union("glance_attention", ["[data-testid=attention-item] >> nth=0", "[data-testid=attention-item] >> nth=4"], 8)
    # 1. The payment request: what the customer sees
    go(pay); union("request", [".pay-top", ".pay-steps"], 0)
    pg.evaluate("document.querySelector('[data-testid=demo-paste-lookalike]').style.setProperty('display','inline','important')")
    pg.click("[data-testid=demo-paste-lookalike]"); pg.wait_for_selector("[data-testid=check-result]"); time.sleep(0.6)
    pg.add_style_tag(content=HIDE); union("lookalike_stop", ["[data-testid=check-result]"], 0)
    # 2. A correct payment, ticked off by itself
    go("/requests/DEMO-1041")
    for body in [{"kind": "send", "scenario": "a"}, {"kind": "mine"}, {"kind": "advance", "blocks": 12}]: post(body)
    go("/requests/DEMO-1041"); union("auto_paid", [".page-head h1", "[data-testid=verdict]"], 12, top=6)
    # 3. Fake digital dollars, explained, with the reply drafted
    go("/requests/DEMO-1043"); union("fake_explained", ["[data-testid=verdict]", "[data-testid=mark-paid-blocked]"], 12)
    union("fake_reply", ["[data-testid=reply]"], 0)
    b.close()
print("captured", sorted(f.name for f in OUT.glob("*.png")))
