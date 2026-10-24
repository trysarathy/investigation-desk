"""Drives the payment-request journey through the real UI: all three scenarios, duplicate delivery,
refresh, a real (non-demo) request, demo reset, desktop and mobile. Records console errors."""
import json, re, sys, pathlib
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:3000"
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
log, errors = [], []
def ok(name, cond, detail=""):
    log.append({"check": name, "ok": bool(cond), "detail": detail}); print(("PASS " if cond else "FAIL ") + name, detail, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script("try{localStorage.setItem('desk.actor','Mei Tan (Finance ops)')}catch(e){}")
    page = ctx.new_page()
    page.on("dialog", lambda d: d.accept())
    for pg in [page]:
        pg.on("console", lambda m: m.type == "error" and not ("422" in m.text and "/requests/new" in pg.url) and errors.append(pg.url + " :: " + m.text[:300]))
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    shot = lambda pg, n, full=False: pg.screenshot(path=str(OUT / f"{n}.png"), full_page=full)
    def demo_click(pg, name):
        pg.bring_to_front()
        with pg.expect_response(lambda r: "/api/requests/demo" in r.url and r.request.method == "POST", timeout=8000) as resp:
            pg.get_by_role("button", name=name).click()
        if resp.value.status != 200: errors.append(f"demo action failed: {resp.value.status}")
    def state(pg):
        return pg.locator(".page-head .pill").first.inner_text()
    def wait_state(pg, want):
        try: expect(pg.locator(".page-head .pill").first).to_have_text(want, timeout=6000)
        except AssertionError: pass
        return state(pg)

    page.goto(BASE + "/requests"); page.wait_for_load_state("networkidle")
    shot(page, "01-empty")
    page.get_by_role("button", name="Load the demo day").click()
    page.wait_for_selector("text=REQ-1041"); page.wait_for_timeout(300)
    shot(page, "02-inbox-demo-day", True)
    ok("demo day loaded with 5 requests", page.locator(".req-table tbody tr").count() == 4, f"open rows={page.locator('.req-table tbody tr').count()} (REQ-1038 is completed, filtered out of Open)")
    ok("persistent demo indicator", page.locator(".demo-flag").count() >= 1)

    # ---- Scenario A: routine ----
    page.goto(BASE + "/requests/REQ-1041"); page.wait_for_load_state("networkidle")
    sender = ctx.new_page(); sender.on("console", lambda m: m.type == "error" and errors.append("sender: " + m.text[:300]))
    pub = page.locator("a:has-text('Sender page')").get_attribute("href")
    sender.goto(BASE + pub); sender.wait_for_load_state("networkidle")
    shot(sender, "03-sender-awaiting", True)
    ok("sender page: amount, token, network, address", all(t in sender.content() for t in ["1,250.00", "USDC on Ethereum", "To this address"]))
    ok("sender page: QR present", sender.locator(".pay-qr svg").count() == 1)
    ok("A: starts awaiting", state(page) == "Awaiting payment", state(page))
    demo_click(page, re.compile("Acme Logistics sends"))
    ok("A: transfer detected", wait_state(page, "Transfer detected") == "Transfer detected", state(page))
    demo_click(page, re.compile("Include in a block"))
    ok("A: confirming", wait_state(page, "Confirming") == "Confirming", state(page))
    sender.reload(); sender.wait_for_load_state("networkidle")
    shot(sender, "04-sender-confirming", True)
    ok("sender sees confirming (same record)", "Confirming" in sender.locator(".pay-state").inner_text(), sender.locator(".pay-state").inner_text())
    demo_click(page, "Add 12 confirmations")
    ok("A: matched, not completed", wait_state(page, "Matched") == "Matched", state(page))
    ok("A: engine verdict shown in evidence", "Arrived on-chain, not credited" in page.content())
    shot(page, "05-routine-matched", True)
    page.get_by_role("button", name="Acknowledge payment").click(); page.wait_for_timeout(800)
    ok("A: completed only after acknowledgement", wait_state(page, "Completed") == "Completed", state(page))
    ok("A: acknowledgement in activity with actor", "Acknowledged: the business has credited" in page.content() and "Mei Tan" in page.content())
    sender.reload(); sender.wait_for_load_state("networkidle")
    ok("sender sees Paid", sender.locator(".pay-state").inner_text() == "Paid", sender.locator(".pay-state").inner_text())
    shot(sender, "06-sender-paid", True)

    # ---- Duplicate delivery ----
    before = page.locator(".figure .v").nth(1).inner_text()
    page.goto(BASE + "/requests"); page.wait_for_load_state("networkidle")
    demo_click(page, "Deliver last event again")
    page.goto(BASE + "/requests/REQ-1041"); page.wait_for_load_state("networkidle")
    ok("duplicate event counted once", page.locator(".figure .v").nth(1).inner_text() == before and "reported again. Ignored" in page.content(), before)

    # ---- Scenario B: short payment ----
    page.goto(BASE + "/requests/REQ-1042"); page.wait_for_load_state("networkidle")
    demo_click(page, re.compile("Brightline Studio sends 3,800.00"))
    demo_click(page, re.compile("Include in a block"))
    demo_click(page, "Add 12 confirmations")
    ok("B: needs review", wait_state(page, "Needs review") == "Needs review", state(page))
    ok("B: shortfall 1,000.00 shown", "1,000.00" in page.locator(".figure .v.short").inner_text())
    ok("B: reply asks for the balance", "1,000.00 USDC less than the 4,800.00 USDC due" in page.content())
    shot(page, "07-short-needs-review", True)
    sender.goto(BASE + page.locator("a:has-text('Sender page')").get_attribute("href")); sender.wait_for_load_state("networkidle")
    ok("B: sender sees 1,000.00 still due", "1,000.00 USDC still due" in sender.locator(".pay-state").inner_text())
    shot(sender, "08-sender-short", True)
    page.get_by_label("Decision note").fill("Emailed Brightline the remaining 1,000.00 USDC.")
    page.get_by_role("button", name="Ask for the balance").click(); page.wait_for_timeout(800)
    ok("B: decision recorded, request stays unresolved (awaiting balance)", wait_state(page, "Awaiting payment") == "Awaiting payment" and "Waiting for the balance of 1,000.00 USDC" in page.content(), state(page))

    # ---- Scenario C: look-alike token ----
    page.goto(BASE + "/requests/REQ-1043"); page.wait_for_load_state("networkidle")
    demo_click(page, re.compile("Orbit Retail sends 2,000.00 look-alike"))
    demo_click(page, re.compile("Include in a block"))
    demo_click(page, "Add 12 confirmations")
    ok("C: needs review", wait_state(page, "Needs review") == "Needs review", state(page))
    ok("C: engine says fake token (D06)", "D06" in page.content() and "Fake token" in page.content())
    ok("C: nothing counted", page.locator(".figure .v").nth(1).inner_text() == "0.00")
    ok("C: simulated evidence has no explorer link", page.locator("a:has-text('Explorer')").count() == 0)
    shot(page, "09-fake-token-review", True)
    page.get_by_label("Decision note").fill("Counterfeit token from contract 0x… Customer told; invoice still unpaid.")
    page.get_by_role("button", name="Not a payment for this request").click(); page.wait_for_timeout(800)
    ok("C: decision recorded, back to awaiting, evidence kept", wait_state(page, "Awaiting payment") == "Awaiting payment" and "Marked not a payment" in page.content() and "D06" in page.content(), state(page))

    # ---- Persistence ----
    page.reload(); page.wait_for_load_state("networkidle")
    ok("state survives refresh", state(page) == "Awaiting payment" and "Marked not a payment" in page.content())

    # ---- A real (non-demo) request through the form ----
    page.goto(BASE + "/requests/new"); page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Create request").click(); page.wait_for_timeout(500)
    ok("form shows field errors when empty", page.locator(".field-err").count() >= 3)
    page.locator("#customerRef").fill("Real Customer Pte Ltd"); page.locator("#invoiceRef").fill("INV-9001")
    page.locator("#amount").fill("1,000"); page.get_by_role("button", name="Create request").click(); page.wait_for_timeout(500)
    ok("rejects comma amounts", "No commas" in page.content())
    page.locator("#amount").fill("99.5"); page.locator("#receivingAddress").fill("0x" + "ab" * 20)
    page.get_by_role("button", name="Create request").click(); page.wait_for_url(re.compile(r"/requests/REQ-\d+\?created=1")); page.wait_for_load_state("networkidle")
    real_id = page.url.split("/requests/")[1].split("?")[0]
    ok("non-demo request created with link", "Request created" in page.content() and "/pay/" in page.content(), real_id)
    ok("non-demo request has no demo flag", page.locator(".page-head .demo-flag").count() == 0)
    shot(page, "10-real-request-created", True)

    # ---- Demo reset keeps non-demo data ----
    page.goto(BASE + "/requests?view=all"); page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Reset demo").click(); page.wait_for_timeout(1000)
    page.goto(BASE + "/requests?view=all"); page.wait_for_load_state("networkidle")
    ok("reset kept the non-demo request", real_id in page.content())
    page.goto(BASE + "/requests/REQ-1041"); page.wait_for_load_state("networkidle")
    ok("reset restored scenario A to awaiting", state(page) == "Awaiting payment", state(page))

    # Put scenario C into review again for the phone check (via the same demo API the buttons use).
    for a in ['{"kind":"send","scenario":"fake"}', '{"kind":"mine"}', '{"kind":"advance","blocks":12}']:
        page.evaluate(f"fetch('/api/requests/demo', {{method:'POST', headers:{{'content-type':'application/json'}}, body:'{a}'}})"); page.wait_for_timeout(400)

    # ---- Mobile ----
    m = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    m.add_init_script("try{localStorage.setItem('desk.actor','Mei Tan (Finance ops)')}catch(e){}")
    mp = m.new_page(); mp.on("console", lambda x: x.type == "error" and errors.append("mobile: " + x.text[:300]))
    mp.goto(BASE + pub); mp.wait_for_load_state("networkidle"); shot(mp, "11-mobile-sender", True)
    sw = mp.evaluate("document.documentElement.scrollWidth")
    ok("mobile sender page: no horizontal scroll", sw <= 390, f"scrollWidth={sw}")
    mp.goto(BASE + "/requests"); mp.wait_for_load_state("networkidle"); shot(mp, "12-mobile-inbox", True)
    sw = mp.evaluate("document.documentElement.scrollWidth")
    ok("mobile inbox: no horizontal scroll", sw <= 390, f"scrollWidth={sw}")
    mp.goto(BASE + "/requests/REQ-1043"); mp.wait_for_load_state("networkidle"); shot(mp, "13-mobile-detail", True)
    ok("sender link survives a reset", mp.goto(BASE + pub).status == 200)
    mp.goto(BASE + "/requests/REQ-1043"); mp.wait_for_load_state("networkidle")
    sw = mp.evaluate("document.documentElement.scrollWidth")
    ok("mobile detail: no horizontal scroll", sw <= 390, f"scrollWidth={sw}")

    # ---- Dark mode ----
    d = b.new_context(viewport={"width": 1440, "height": 900}, color_scheme="dark"); dp = d.new_page()
    dp.goto(BASE + pub); dp.wait_for_load_state("networkidle"); shot(dp, "14-dark-sender", True)
    dp.goto(BASE + "/requests"); dp.wait_for_load_state("networkidle"); shot(dp, "15-dark-inbox", True)

    # ---- Keyboard: tab to the first actionable control on the sender page ----
    page.goto(BASE + pub); page.wait_for_load_state("networkidle")
    page.keyboard.press("Tab"); focused = page.evaluate("document.activeElement && document.activeElement.textContent")
    ok("keyboard reaches the first copy control", (focused or "").startswith("Copy"), focused)
    b.close()

ok("no console or page errors", not errors, json.dumps(errors[:5]))
json.dump({"checks": log, "errors": errors}, open(OUT / "e2e.json", "w"), indent=1)
print("FAILS:", sum(not x["ok"] for x in log), "of", len(log))
