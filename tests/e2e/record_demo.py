"""Records the 90-second backup video of the demo (cases a, b, c, f, e) with captions.

    python3 tests/e2e/record_demo.py demo/demo-a-plus.mp4      # server on BASE (default :3300), ffmpeg installed

The captions are drawn on the page by this script only (a bar at the bottom); the app is unchanged.
"""
import json, os, pathlib, shutil, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:3300")
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "demo-a-plus.mp4")
CAP = """(t) => { let b = document.getElementById('__cap'); if (!b) { b = document.createElement('div'); b.id = '__cap';
  b.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:1060px;z-index:99999;background:rgba(20,22,28,.92);color:#fff;font:500 17px/1.45 Inter,system-ui,sans-serif;padding:10px 18px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);text-align:center';
  document.body.appendChild(b); } b.textContent = t; }"""

tmp = pathlib.Path(tempfile.mkdtemp())
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 720}, record_video_dir=str(tmp), record_video_size={"width": 1280, "height": 720})
    page = ctx.new_page()
    page.request.post(BASE + "/api/requests/demo", data=json.dumps({"kind": "reset"}), headers={"content-type": "application/json"})

    def go(path):
        page.goto(BASE + path); page.wait_for_load_state("networkidle")
    def cap(text, secs):
        page.evaluate(CAP, text); time.sleep(secs)
    def scroll_to(sel):
        page.locator(sel).first.scroll_into_view_if_needed(); time.sleep(0.4)

    go("/requests")
    cap("A fictional business that gets paid in stablecoins. All demo data.", 4)
    cap("This week: 18 requests, 11 paid with no one touching them, 5 that need a person, each already explained.", 6)
    page.click("[data-testid=play-payment]")
    cap("a. Routine: Acme pays 1,250 USDC. Watch it confirm and get marked paid automatically.", 6)
    go("/requests/DEMO-1041")
    cap("Exact amount, genuine USDC, to the invoice's own address, fully confirmed: marked paid by the rule.", 5)

    go("/requests/DEMO-1042")
    cap("b. “Why is INV-1042 still unpaid?” The answer: 50.00 USDC short.", 5)
    cap("Likely cause, labelled as an inference: fees taken by the customer's exchange.", 5)
    scroll_to("[data-testid=reply]")
    cap("A polite top-up request, drafted and ready to copy.", 4)

    go("/requests/DEMO-1043")
    cap("c. Orbit 'paid' 7,500 USDT. It's a counterfeit: same name, not Tether's contract.", 6)
    scroll_to("[data-testid=next-step]")
    cap("Blocked: it can never be marked paid. The reply explains it without accusing the customer.", 5)

    go("/requests")
    href = page.get_attribute("[data-testid=fernhill-sender]", "href")
    go(href)
    cap("f. Fernhill's payment page: what to send, which network, and the address in checkable groups.", 5)
    scroll_to("[data-testid=demo-paste-lookalike]")
    page.click("[data-testid=demo-paste-lookalike]"); time.sleep(0.8)
    cap("They paste the address from their wallet history: a look-alike. Stopped before any money moved.", 6)
    go("/requests/DEMO-1046")
    cap("Ops sees the scam attempt, with a security note for the customer drafted.", 4)

    go("/requests")
    page.click("[data-testid=attention-item]:has-text('Unidentified')"); page.wait_for_load_state("networkidle")
    cap("e. 2,180 USDC arrived with no reference. Suggested match: Kite, with the evidence. Never a guess.", 6)
    page.fill("[aria-label='Why this match']", "Exact amount from Kite's usual wallet; Kite emailed that they paid.")
    cap("A person confirms it, in their own words.", 3)
    page.click("[data-testid=confirm-match]"); page.wait_for_load_state("networkidle")
    time.sleep(1)
    go("/requests")
    cap("Most payments close themselves. Every exception comes with its cause, its evidence and a reply.", 6)
    video = page.video.path()
    ctx.close(); browser.close()

subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", "26", "-movflags", "+faststart", str(OUT)], check=True)
shutil.rmtree(tmp, ignore_errors=True)
print("wrote", OUT)
