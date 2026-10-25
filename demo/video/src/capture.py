"""Captures the real app, state by state, for the product film.

Dark theme, 1600x900 CSS pixels at 2.4x (3840x2160 images), so the edit can zoom without blur.
For each shot it saves the PNG and the boxes of the elements the film points at (image pixels).
The film labels the data "Demo data" once, so the in-app demo badges and demo-only helpers are
hidden here with CSS; everything else is the app exactly as it renders.

    python3 capture.py <out_dir>        # app on BASE (default http://localhost:3300), demo mode
"""
import json, os, pathlib, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3300")
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
SCALE = 2.4
HIDE = """.demo-badge, .workspace .badge, [data-testid=reload-demo], .mode-note, .sidebar-foot, [data-testid=demo-tools], [data-testid=demo-paste-lookalike],
          details.panel:has(summary h2:only-child) { display: none !important; }"""
boxes = {}

def demo(page, body):
    r = page.request.post(BASE + "/api/requests/demo", data=json.dumps(body), headers={"content-type": "application/json"})
    assert r.ok, r.text()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1600, "height": 900}, device_scale_factor=SCALE, color_scheme="dark")
    ctx.add_init_script("try{localStorage.setItem('desk.theme','dark')}catch(e){}")
    page = ctx.new_page()
    demo(page, {"kind": "reset"})

    def go(path):
        page.goto(BASE + path); page.wait_for_load_state("networkidle")
        page.add_style_tag(content=HIDE)
        page.evaluate("document.querySelectorAll('nextjs-portal').forEach(e=>e.remove())")
        time.sleep(0.4)

    def box(name, selector, nth=0):
        el = page.locator(selector).nth(nth)
        bb = el.bounding_box()
        assert bb, f"no box for {selector}"
        # full-page coordinates: add the scroll offset
        sy = page.evaluate("window.scrollY")
        boxes.setdefault(cur, {})[name] = [round(bb["x"] * SCALE), round((bb["y"] + sy) * SCALE), round(bb["width"] * SCALE), round(bb["height"] * SCALE)]

    def shot(name, full=True):
        global cur
        cur = name
        page.evaluate("window.scrollTo(0,0)")
        page.screenshot(path=str(OUT / f"{name}.png"), full_page=full)
        h = page.evaluate("document.documentElement.scrollHeight") if full else 900
        boxes.setdefault(name, {})["_size"] = [round(1600 * SCALE), round(h * SCALE)]

    cur = ""
    # 1. At a glance, as the demo week starts.
    go("/requests"); shot("glance")
    box("hero", ".hero"); box("kpis", ".kpis"); box("attention", "section[aria-labelledby=attn-h]"); box("arriving", "section[aria-label='Live: a routine payment']")
    # 2. Brightline: short payment.
    go("/requests/DEMO-1042"); shot("brightline")
    box("message", ".message"); box("verdict", "[data-testid=verdict]"); box("cause", "[data-testid=cause]"); box("next", "[data-testid=next-step]"); box("reply", "[data-testid=reply]")
    # 3. Orbit: counterfeit token.
    go("/requests/DEMO-1043"); shot("orbit")
    box("message", ".message"); box("verdict", "[data-testid=verdict]"); box("next", "[data-testid=next-step]"); box("locked", "[data-testid=mark-paid-blocked]"); box("reply", "[data-testid=reply]")
    # 4. Unidentified payment, before confirming.
    go("/requests"); href = page.get_attribute("[data-testid=attention-item]:has-text('Unidentified')", "href")
    go(href); shot("unidentified")
    box("verdict", "[data-testid=verdict]"); box("suggestion", "[data-testid=suggestion]"); box("score", "[data-testid=score]"); box("confirm", "[data-testid=confirm-match]"); box("note", "[aria-label='Why this match']")
    # 5. Fernhill's payment page: before and after a look-alike address is pasted.
    go("/requests"); payhref = page.get_attribute("[data-testid=fernhill-sender]", "href")
    go(payhref); shot("pay_before")
    box("card", ".pay-card"); box("address", ".addr"); box("checker", ".pay-check"); box("input", "[data-testid=check-input]"); box("check", "[data-testid=check-address]")
    # The look-alike comes from the app's own demo helper (hidden in the film): click it to paste and check.
    page.evaluate("document.querySelector('[data-testid=demo-paste-lookalike]').style.setProperty('display','inline','important')")
    page.click("[data-testid=demo-paste-lookalike]")
    page.wait_for_selector("[data-testid=check-result]"); time.sleep(0.8)
    page.evaluate("document.querySelector('[data-testid=demo-paste-lookalike]').style.setProperty('display','none','important')")
    page.add_style_tag(content=HIDE); time.sleep(0.3)
    shot("pay_after")
    box("card", ".pay-card"); box("address", ".addr"); box("checker", ".pay-check"); box("input", "[data-testid=check-input]"); box("result", "[data-testid=check-result]")
    # 6. Acme: the routine payment, state by state, through the real logic.
    go("/requests/DEMO-1041"); shot("acme_0")
    box("verdict", "[data-testid=verdict]"); box("play", "[data-testid=play-payment]"); box("head", ".page-head")
    steps = [("acme_1", {"kind": "send", "scenario": "a"}), ("acme_2", {"kind": "mine"}), ("acme_3", {"kind": "advance", "blocks": 6}), ("acme_4", {"kind": "advance", "blocks": 6})]
    for name, body in steps:
        demo(page, body); go("/requests/DEMO-1041"); shot(name); box("verdict", "[data-testid=verdict]"); box("head", ".page-head")
    # 7. Confirm the unidentified payment: the invoice it pays.
    go(href); page.fill("[aria-label='Why this match']", "Exact amount from Kite's usual wallet; Kite emailed that they paid.")
    page.click("[data-testid=confirm-match]"); page.wait_for_url("**/requests/DEMO-1045"); page.wait_for_load_state("networkidle")
    go("/requests/DEMO-1045"); shot("kite_matched"); box("verdict", "[data-testid=verdict]"); box("head", ".page-head")
    # 8. At a glance afterwards (outcome background).
    go("/requests"); shot("glance_after"); box("kpis", ".kpis"); box("attention", "section[aria-labelledby=attn-h]")
    b.close()

(OUT / "boxes.json").write_text(json.dumps(boxes, indent=1))
print("captured", len(boxes), "shots")
