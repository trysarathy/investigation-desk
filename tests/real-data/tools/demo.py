"""Click-through demo of five real cases: screenshots per step plus a screen recording."""
import json, os, sys, pathlib, shutil
from playwright.sync_api import sync_playwright
BASE = os.environ.get("BASE", "http://localhost:3210")
OUT = pathlib.Path("../demo"); SHOTS = OUT / "screenshots"
VID = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("video")
cases = {c["id"]: c for c in json.load(open("../tests/real_cases.json"))["cases"]}
ORDER = [("POISON-1", "poisoned-address"), ("FRZ-TD1", "frozen-sender"), ("FAIL-T1", "failed-transfer"), ("FAKE-HG", "fake-token"), ("TRN-01", "normal-cleared")]
log = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, record_video_dir=str(VID), record_video_size={"width": 1440, "height": 900})
    ctx.add_init_script("try{localStorage.setItem('desk.actor','Demo')}catch(e){}")
    page = ctx.new_page()
    page.goto(BASE + "/settings?tab=data"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(1500)
    page.screenshot(path=str(SHOTS / "00-sample-company-data-loaded.png"))
    for i, (cid, slug) in enumerate(ORDER, 1):
        c = cases[cid]
        page.goto(BASE + "/"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(600)
        page.get_by_label("Transaction hash, address or customer reference").type(c["tx_hash"], delay=8)
        if c.get("customer_id"): page.get_by_label("Reporting customer (optional)").type(c["customer_id"], delay=30)
        page.screenshot(path=str(SHOTS / f"{i:02d}a-{slug}-paste.png"))
        page.get_by_role("button", name="New case").click()
        page.wait_for_selector(".verdict-bar .verdict-code, .verdict-bar.paused", timeout=90000); page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2500)
        page.screenshot(path=str(SHOTS / f"{i:02d}b-{slug}-verdict.png"))
        code = page.locator(".verdict-bar .verdict-code").first.inner_text() if page.locator(".verdict-bar .verdict-code").count() else "PAUSED"
        tl = page.locator("ol.timeline").first
        if tl.count(): tl.scroll_into_view_if_needed(); page.wait_for_timeout(2000)
        page.screenshot(path=str(SHOTS / f"{i:02d}c-{slug}-evidence.png"))
        page.screenshot(path=str(SHOTS / f"{i:02d}d-{slug}-full.png"), full_page=True)
        log.append({"case": cid, "expected": c["expected"], "shown": code}); print(cid, c["expected"], code, flush=True)
        page.mouse.wheel(0, -5000); page.wait_for_timeout(800)
    ctx.close(); b.close()
vids = sorted(VID.glob("*.webm"), key=lambda f: f.stat().st_mtime)
shutil.copy(vids[-1], OUT / "demo-raw.webm")
json.dump(log, open(OUT / "demo-run.json", "w"), indent=1)
