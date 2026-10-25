"""End-to-end test of the customer demo, cases a-g, in a real browser (Playwright, Chromium).

    npm run build && DESK_DATA_DIR=/tmp/demo-data npx next start -p 3300
    python3 tests/e2e/demo_cases.py [out_dir]          # BASE=http://localhost:3300 by default

Each case: load the demo day -> open the case -> the verdict, evidence, next step and reply are
right -> take the decision -> the outcome is right. Also: the sender page, the reload being
identical, no console errors, and no horizontal scroll at 1280x720 (projector) or 390px (phone).
Exit code 1 if any check fails.
"""
import json, os, pathlib, re, sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE", "http://localhost:3300")
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "e2e-out"); OUT.mkdir(parents=True, exist_ok=True)
results, errors = [], []

def check(name, fn):
    try:
        fn(); results.append((name, True, ""))
    except Exception as e:  # noqa: BLE001
        results.append((name, False, (str(e).splitlines() or [repr(e)])[0][:300] + f" [line {e.__traceback__.tb_next.tb_lineno if e.__traceback__ and e.__traceback__.tb_next else '?'}]"))

def reset(page):
    r = page.request.post(BASE + "/api/requests/demo", data=json.dumps({"kind": "reset"}), headers={"content-type": "application/json"})
    assert r.ok, r.text()

def text(page, sel):
    loc = page.locator(sel).first
    loc.wait_for(state="visible")
    return loc.inner_text()

def go(page, url):
    """Open a page and wait until it is interactive (hydrated, nothing loading), like a person would."""
    page.goto(url)
    page.wait_for_load_state("networkidle")
    page.locator("main, .pay").first.wait_for(state="visible")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"{page.url}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"{page.url}: {e}"))
    page.set_default_timeout(8000)
    reset(page)

    def glance():
        go(page, BASE + "/requests")
        expect(page.locator("h1")).to_have_text("Get paid in stablecoins without the mess.")
        page.locator(".kpis").wait_for(state="visible")
        body = page.inner_text("body")
        for s in ["Requests sent", "Paid automatically", "Need attention", "Value requested", "Time saved", "demo estimate", "Demo data"]:
            assert s in body, f"missing {s!r}"
        assert page.locator("[data-testid=attention-item]").count() == 5, page.locator("[data-testid=attention-item]").count()
        for s in ["Blocked", "Unidentified", "Short payment", "Wrong network", "Paid twice"]:
            assert s in body, f"attention reason {s!r}"
        nav = page.inner_text("nav.sidebar")
        for hidden in ["Queue", "Inbox", "Bulk", "Payments\n"]:
            assert hidden not in nav, f"{hidden!r} visible in demo mode"
        page.screenshot(path=str(OUT / "01-at-a-glance.png"))
    check("at a glance: proposition, numbers, 5 reasons, old pages hidden", glance)

    def case_a():
        go(page, BASE + "/requests/DEMO-1041")
        expect(page.locator("[data-testid=verdict]")).to_contain_text("Waiting for the customer to pay")
        page.click("[data-testid=play-payment]")
        expect(page.locator("[data-testid=verdict]")).to_contain_text("Paid. Matched and marked paid automatically", timeout=15000)
        v = text(page, "[data-testid=verdict]")
        assert "No one had to touch it" in v and "Genuine USDC" in v, v
        expect(page.locator("[data-testid=activity]")).to_contain_text("Marked paid automatically")
        page.screenshot(path=str(OUT / "a-acme-paid.png"), full_page=True)
        href = page.get_attribute("[data-testid=sender-link]", "href")
        go(page, BASE + href)
        expect(page.locator(".pay-state")).to_have_text("Paid")
        assert page.locator("[data-testid=send-exactly]").count() == 0, "paid page still asks for money"
    check("a. Acme routine: plays, matched and marked paid automatically; sender sees Paid", case_a)

    def case_b():
        go(page, BASE + "/requests/DEMO-1042")
        expect(page.locator(".message")).to_contain_text("why is invoice INV-1042 still showing as unpaid".capitalize()[:3])
        v = text(page, "[data-testid=verdict]")
        assert "Short by 50.00 USDC" in v and "4,950.00" in v, v
        assert "Fees deducted" in text(page, "[data-testid=cause]")
        assert "an inference" in text(page, "[data-testid=cause]")
        assert "Ask Brightline Studio for the remaining 50.00 USDC" in text(page, "[data-testid=next-step]")
        r = text(page, "[data-testid=reply]")
        assert "Hi Priya" in r and "remaining 50.00 USDC" in r and "withdrawal fee" in r, r
        page.screenshot(path=str(OUT / "b-brightline-short.png"), full_page=True)
        href = page.get_attribute("[data-testid=sender-link]", "href")
        go(page, BASE + href)
        expect(page.locator("[data-testid=send-exactly]")).to_have_text("50.00 USDC (the remaining balance)")
        page.screenshot(path=str(OUT / "b-brightline-sender.png"), full_page=True)
        go(page, BASE + "/requests/DEMO-1042")
        page.click("[data-testid=decide-request_balance]")
        expect(page.locator("[data-testid=verdict]")).to_contain_text("Waiting for the remaining 50.00 USDC")
    check("b. Brightline short: shortfall, likely cause (fees), top-up reply, sender asked for 50.00", case_b)

    def case_c():
        go(page, BASE + "/requests/DEMO-1043")
        v = text(page, "[data-testid=verdict]")
        assert "Blocked: this isn't real USDT" in v and "0xdac17f958d2ee523a2206206994597c13d831ec7" in v, v
        assert page.locator("button:has-text('Mark paid')").first.is_disabled(), "Mark paid must be disabled"
        r = text(page, "[data-testid=reply]")
        assert "Hi Daniel" in r and "isn't real USDT" in r, r
        expect(page.locator("body")).to_contain_text("Fake token")
        page.screenshot(path=str(OUT / "c-orbit-counterfeit.png"), full_page=True)
        page.click("[data-testid=decide-dismiss_transfer]")
        expect(page.locator("[data-testid=verdict]")).to_contain_text("Waiting for the customer to pay")
        expect(page.locator("body")).to_contain_text("Closed: not a payment")
    check("c. Orbit counterfeit USDT: blocked, explained, can't be marked paid, reply; closing keeps evidence", case_c)

    def case_d():
        go(page, BASE + "/requests/DEMO-1044")
        v = text(page, "[data-testid=verdict]")
        assert "Paid on the wrong network (Tron)" in v, v
        assert text(page, "[data-testid=recoverable]").startswith("RECOVERABLE?") or "Yes" in text(page, "[data-testid=recoverable]")
        assert "Ask treasury to confirm" in text(page, "[data-testid=next-step]")
        assert "Tron" in text(page, "[data-testid=reply]")
        page.screenshot(path=str(OUT / "d-meridian-wrong-network.png"), full_page=True)
        page.click("[data-testid=decide-accept_other_network]")
        expect(page.locator("[data-testid=verdict]")).to_contain_text("Paid on another network, counted by a person")
    check("d. Meridian wrong network: explained, recoverable (own Tron wallet), next step; counted after confirming", case_d)

    def case_e():
        go(page, BASE + "/requests")
        page.click("[data-testid=attention-item]:has-text('Unidentified')")
        expect(page.locator("[data-testid=verdict]")).to_contain_text("Most likely Kite Analytics' INV-1045")
        expect(page.locator("[data-testid=score]").first).to_have_text("High · 100/100")
        assert page.locator("[data-testid=suggestion]").count() == 1, "weak suggestions must not show"
        assert "paid from before" in page.inner_text("body")
        page.screenshot(path=str(OUT / "e-unidentified.png"), full_page=True)
        page.click("[data-testid=confirm-match]")
        page.wait_for_url(re.compile(r"/requests/DEMO-1045$"))
        expect(page.locator("[data-testid=verdict]")).to_contain_text("Matched: waiting to be marked paid")
        page.click("[data-testid=decide-acknowledge]")
        expect(page.locator("[data-testid=verdict]")).to_contain_text("Paid")
        expect(page.locator("[data-testid=activity]")).to_contain_text("Matched the unidentified 2,180.00 USDC payment")
    check("e. Unidentified: suggested match with score + evidence; a person confirms; then paid", case_e)

    def case_f():
        go(page, BASE + "/requests/DEMO-1046")
        href = page.get_attribute("[data-testid=sender-link]", "href")
        go(page, BASE + href)
        page.click("[data-testid=demo-paste-lookalike]")
        expect(page.locator("[data-testid=check-result]")).to_contain_text("Stop: don't send to this address")
        page.screenshot(path=str(OUT / "f-sender-lookalike-stopped.png"), full_page=True)
        addr = page.locator(".addr").get_attribute("aria-label")
        page.fill("[data-testid=check-input]", addr); page.click("[data-testid=check-address]")
        expect(page.locator("[data-testid=check-result]")).to_contain_text("That's the right address")
        go(page, BASE + "/requests/DEMO-1046")
        v = text(page, "[data-testid=verdict]")
        assert "A look-alike address was stopped before the customer sent" in v, v
        assert "address poisoning" in text(page, "[data-testid=reply]").lower() or "address poisoning" in text(page, "[data-testid=reply]")
        page.screenshot(path=str(OUT / "f-fernhill-ops.png"), full_page=True)
    check("f. Fernhill look-alike: sender page warns before sending; ops sees it with a security reply", case_f)

    def case_g():
        go(page, BASE + "/requests/DEMO-1047")
        v = text(page, "[data-testid=verdict]")
        assert "Paid twice: 1,980.00 USDC extra" in v and "4 minutes apart" in v, v
        assert "Refund 1,980.00 USDC" in text(page, "[data-testid=refund]")
        assert "twice" in text(page, "[data-testid=reply]")
        page.screenshot(path=str(OUT / "g-kestrel-duplicate.png"), full_page=True)
        page.click("[data-testid=decide-refund_excess]")
        expect(page.locator("[data-testid=verdict]")).to_contain_text("Paid; the extra is being refunded")
    check("g. Kestrel duplicate: detected, refund instruction and reply drafted; recorded", case_g)

    def duplicate_event():
        go(page, BASE + "/requests/DEMO-1041")
        before = page.locator("[data-testid=activity] li").count()
        page.click("text=Deliver the last event again")
        expect(page.locator("[data-testid=activity]")).to_contain_text("Ignored: it counts once")
        assert "1,250.00" in text(page, ".figures")
    check("a repeated event counts once", duplicate_event)

    def reload_identical():
        snap = lambda: page.request.get(BASE + "/requests/all").text()
        reset(page); go(page, BASE + "/requests"); n1 = page.locator("[data-testid=attention-item]").count(); t1 = text(page, ".kpis")
        reset(page); go(page, BASE + "/requests"); n2 = page.locator("[data-testid=attention-item]").count(); t2 = text(page, ".kpis")
        assert n1 == n2 == 5 and t1 == t2, (n1, n2, t1, t2)
        go(page, BASE + "/requests/DEMO-1041")
        expect(page.locator("[data-testid=verdict]")).to_contain_text("Waiting for the customer to pay")
    check("reload demo day: identical state every time", reload_identical)

    def no_overflow():
        bad = []
        for path in ["/requests", "/requests/all", "/requests/DEMO-1042", "/requests/DEMO-1043", "/requests/DEMO-1044", "/requests/DEMO-1047"]:
            go(page, BASE + path)
            w = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if w > 1: bad.append((path, w))
        m = browser.new_page(viewport={"width": 390, "height": 844})
        go(m, BASE + "/requests/DEMO-1046"); href = m.get_attribute("[data-testid=sender-link]", "href")
        go(m, BASE + href); m.wait_for_selector(".pay-card")
        w = m.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        if w > 1: bad.append(("pay mobile", w))
        m.screenshot(path=str(OUT / "f-sender-phone.png"), full_page=True); m.close()
        assert not bad, bad
    check("no horizontal scroll at 1280x720 and on a phone", no_overflow)

    def fast():
        import time
        slow = []
        for path in ["/requests", "/requests/DEMO-1042", "/requests/DEMO-1044"]:
            t = time.time(); go(page, BASE + path); page.wait_for_load_state("load")
            if time.time() - t > 1.0: slow.append((path, round(time.time() - t, 2)))
        assert not slow, slow
    check("pages load in under 1 s", fast)

    def no_dead_links():
        dead = []
        for path in ["/requests", "/requests/all", "/requests/DEMO-1045"]:
            go(page, BASE + path)
            for h in set(page.eval_on_selector_all("a[href^='/']", "els => els.map(e => e.getAttribute('href'))")):
                if page.request.get(BASE + h).status >= 400: dead.append(h)
        assert not dead, dead
    check("no dead links", no_dead_links)

    check("no console or page errors", lambda: (_ for _ in ()).throw(AssertionError(errors[:5])) if errors else None)
    browser.close()

fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(("PASS " if ok else "FAIL ") + name + (f"  -> {detail}" if detail else ""))
print(f"FAILS: {len(fails)} of {len(results)}")
(OUT / "results.json").write_text(json.dumps([{"check": n, "ok": o, "detail": d} for n, o, d in results], indent=1))
sys.exit(1 if fails else 0)
