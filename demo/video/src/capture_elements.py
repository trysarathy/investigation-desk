"""Captures the real app for the Maya film, one element at a time, so the film can show a single
thing large instead of a dense screen. Dark theme, 1600x900 CSS px at 3x.

For each element it saves a PNG and its facts: CSS size and the smallest font size inside it, so
the edit can scale it until every word is at least 3% of the frame height.

    python3 capture_elements.py <out_dir>        # app on BASE (default http://localhost:3300), demo mode
"""
import json, os, pathlib, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3300")
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
SCALE = 3
HIDE = """.demo-badge, .workspace .badge, [data-testid=reload-demo], .mode-note, .sidebar-foot, [data-testid=demo-tools],
          [data-testid=demo-paste-lookalike] { display: none !important; }"""
MINFONT = """(el) => { let m = 99; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim()) continue; const p = n.parentElement;
    const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = p.getBoundingClientRect(); if (r.width === 0) continue; m = Math.min(m, parseFloat(cs.fontSize)); } return m; }"""
facts = {}

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1600, "height": 900}, device_scale_factor=SCALE, color_scheme="dark")
    ctx.add_init_script("try{localStorage.setItem('desk.theme','dark')}catch(e){}")
    page = ctx.new_page()
    page.request.post(BASE + "/api/requests/demo", data=json.dumps({"kind": "reset"}), headers={"content-type": "application/json"})

    def go(path):
        page.goto(BASE + path); page.wait_for_load_state("networkidle")
        page.add_style_tag(content=HIDE); time.sleep(0.4)

    def el(name, loc, style=None):
        if style: loc.evaluate(f"(e) => e.setAttribute('style', (e.getAttribute('style') || '') + ';{style}')")
        loc.scroll_into_view_if_needed(); time.sleep(0.15)
        loc.screenshot(path=str(OUT / f"{name}.png"))
        bb = loc.bounding_box()
        facts[name] = {"css": [round(bb["width"]), round(bb["height"])], "px": [round(bb["width"] * SCALE), round(bb["height"] * SCALE)],
                       "minFont": loc.evaluate(MINFONT)}

    def full(name):
        page.evaluate("window.scrollTo(0,0)"); time.sleep(0.2)
        page.screenshot(path=str(OUT / f"{name}.png"))
        facts[name] = {"css": [1600, 900], "px": [1600 * SCALE, 900 * SCALE], "minFont": None, "background": True}

    # Maya's view: the request she sent (Fernhill, about to pay).
    go("/requests/DEMO-1046"); full("m_bg")
    el("m_head", page.locator(".page-head h1").locator(".."))
    pay = page.get_attribute("[data-testid=sender-link]", "href")
    # Customer's view: the payment page.
    go(pay); full("c_bg")
    el("c_top", page.locator(".pay-top"))
    el("c_send", page.locator(".pay-steps > li").nth(0))
    el("c_addr", page.locator(".pay-steps > li").nth(2))
    real_addr = page.get_attribute(".addr", "aria-label")
    page.evaluate("document.querySelector('[data-testid=demo-paste-lookalike]').style.setProperty('display','inline','important')")
    page.click("[data-testid=demo-paste-lookalike]"); page.wait_for_selector("[data-testid=check-result]"); time.sleep(0.8)
    page.add_style_tag(content=HIDE)
    fake_addr = page.input_value("[data-testid=check-input]")
    el("c_stop", page.locator("[data-testid=check-result]"))
    el("c_check", page.locator(".pay-check"))
    # Automatic: Acme's invoice, before and after a correct payment (through the real logic).
    go("/requests/DEMO-1041"); full("a_bg")
    el("a_head_before", page.locator(".page-head h1").locator(".."))
    for body in [{"kind": "send", "scenario": "a"}, {"kind": "mine"}, {"kind": "advance", "blocks": 12}]:
        page.request.post(BASE + "/api/requests/demo", data=json.dumps(body), headers={"content-type": "application/json"})
    go("/requests/DEMO-1041")
    el("a_head_after", page.locator(".page-head h1").locator(".."))
    el("a_verdict_title", page.locator("[data-testid=verdict] h2"), "display:inline-block;align-self:flex-start;width:max-content")
    # Something's wrong: Orbit's fake digital dollars.
    go("/requests/DEMO-1043"); full("o_bg")
    el("o_title", page.locator("[data-testid=verdict] h2"), "display:inline-block;align-self:flex-start;width:max-content")
    el("o_blocked", page.locator("[data-testid=mark-paid-blocked]"))
    el("o_reply", page.locator("[data-testid=reply] .reply"), "width:560px;height:178px;overflow:hidden;box-sizing:border-box")
    b.close()

facts["_accounts"] = {"real": real_addr, "lookalike": fake_addr}
(OUT / "elements.json").write_text(json.dumps(facts, indent=1))
print(json.dumps({k: v for k, v in facts.items()}, indent=0)[:1500])
