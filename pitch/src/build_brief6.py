"""Builds the 6-slide Clearline mentor brief: a complete layman should understand it in 3 minutes, unpresented.
Answers, in order: what's the problem, why it hurts, what's the gap, what I built, how good it is, what I'd
like advice on. Same design as the decks (deck_style.py). Markers: ◦ = estimate, † = my belief, not yet proven.

    build_brief6.py <out.pptx> <demo_60s.mp4>
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from deck_style import *

OUT = sys.argv[1]; VIDEO = sys.argv[2] if len(sys.argv) > 2 else ""
IL = A / "illus"
KEY = "◦ estimate   † my belief, not yet proven"
mk = lambda m: (m, {"color": ACC2, "bold": True, "size": 26})

def head(s, runs):
    text(s, M, 0.62, W - 2 * M, 0.9, [runs] if isinstance(runs, list) else runs, size=34, bold=True, name="Title")

def topline(s):
    text(s, M, 0.25, W - 2 * M, 0.35, "Clearline · a project I'm exploring · Aashmiin Kaur, SMU", size=12, color=FAINT, name="Topline")

def foot(s, t, key=True):
    text(s, M, H - 0.62, W - 2 * M, 0.5, [[(t, {})]] + ([[(KEY, {"color": MUTED})]] if key else []), size=10, color=FAINT, name="Sources")

# 1 ---------------------------------------------------------------- THE PROBLEM
s = new("""
Real businesses are starting to pay each other in stablecoins (digital dollars: tokens designed to stay worth one US dollar). It's still small next to all the trading, but real payments roughly doubled in 2025 and most are between businesses. The pain: some payments arrive wrong (too little, on the wrong network, a fake token, no invoice number), and someone in finance has to match each one to its invoice and type it into the accounting system by hand.
SOURCES / LABELS:
- ~$400B of real-world stablecoin payments in 2025, ~60% B2B [VERIFIED; the 60% is Bessemer's estimate ◦]: Bessemer Venture Partners, "Stablecoins: from DeFi primitive to global financial infrastructure", 22 Apr 2026. bvp.com/atlas/stablecoins-from-defi-primitive-to-global-financial-infrastructure
- Only ~$350–550B of the $28–62T in stablecoin transfers in 2025 were real-economy payments; the rest is trading and moving funds between wallets and exchanges [VERIFIED]: Reap, "Stablecoin Statistics & Data 2026", 14 Aug 2026, citing BIS, BCG × Allium, McKinsey. reap.global/blog/stablecoin-statistics-2026
- The four ways a payment arrives wrong are real [VERIFIED]: my tests on real transactions include counterfeit-USDT and wrong-network transfers (demo/REPORT.md).
- "Matched and posted by hand" [BELIEF †]: how much time this takes, and how often, is not yet measured.
""")
topline(s)
head(s, "Real stablecoin payments are growing, and most are between businesses")
stats = [("$400B", [("real-world stablecoin payments in 2025, about 60% between businesses", {}), mk("◦")]),
         ("$350–550B", [("of the $28–62T moved in stablecoins in 2025 was real payments; the rest is mostly trading", {})])]
cw = (W - 2 * M - 0.4) / 2
for k, (big, line) in enumerate(stats):
    x = M + k * (cw + 0.4)
    box(s, x, 2.0, cw, 2.2)
    text(s, x + 0.35, 2.12, cw - 0.7, 0.75, big, size=40, bold=True, color=ACC2)
    text(s, x + 0.35, 2.92, cw - 0.7, 1.2, [line], size=20, color=MUTED)
box(s, M, 4.45, W - 2 * M, 1.85, fill=CARD, line=ACC)
text(s, M + 0.4, 4.45, W - 2 * M - 0.8, 1.85,
     [[("The pain: ", {"bold": True, "color": ACC2}), ("some payments arrive wrong: too little, the wrong network, a fake token, or no invoice number.", {})],
      [("Someone has to match each one to its invoice and get it into the books by hand.", {"bold": True}), mk("†")]],
     size=22, anchor=MSO_ANCHOR.MIDDLE, spacing=8)
foot(s, "$400B, ~60% B2B (60% is Bessemer's estimate): Bessemer Venture Partners, Apr 2026.  $350–550B of $28–62T: Reap, Aug 2026, citing BIS, BCG × Allium and McKinsey.")

# 2 ---------------------------------------------------------------- WHY IT HURTS
s = new("""
When a payment doesn't match, it's usually one of these four, and each one needs someone to investigate by hand: look up the transfer, find the invoice, work out what went wrong, and write to the customer. While that happens the customer waits, and if nobody checks carefully, a business can accept fake digital dollars as if they were real.
SOURCES / LABELS:
- The four problems are real [VERIFIED]: my tests on real transactions include 13 counterfeit-USDT and 6 wrong-network transfers (demo/REPORT.md); short payments and missing references are standard cases.
- "Hours lost" [ESTIMATE ◦]: untested. My guess is 15–30 minutes per odd payment, and the demo's 20-minute figure is a demo estimate, not a measurement. How often each problem happens is unknown.
- Fake digital dollars [VERIFIED]: anyone can create a token with the same name; only the real issuer's contract counts (ERC-20 standard).
""")
topline(s)
head(s, "Every odd payment means detective work")
items = [("short", "Paid a little too little"), ("road", "Sent the wrong way"), ("fake", "Fake digital dollars"), ("nolabel", "No invoice number")]
cw = (W - 2 * M - 3 * 0.35) / 4
for k, (ic, lab) in enumerate(items):
    x = M + k * (cw + 0.35)
    box(s, x, 1.75, cw, 3.3)
    img(s, A / f"icons/{ic}.png", x + (cw - 1.8) / 2, 1.95, w=1.8)
    text(s, x + 0.2, 3.95, cw - 0.4, 0.9, lab, size=22, bold=True, align=PP_ALIGN.CENTER)
box(s, M, 5.4, W - 2 * M, 0.9, fill=CARD, line=ACC)
text(s, M + 0.35, 5.4, W - 2 * M - 0.7, 0.9, [[("The cost: hours lost", {}), mk("◦"), (", customers waiting, and the risk of accepting fake money.", {})]], size=20, anchor=MSO_ANCHOR.MIDDLE)
foot(s, "All four appear in my tests on real transactions (e.g. 13 fake-USDT, 6 wrong-network). How often they happen, and how long each takes, are not yet measured.")

# 3 ---------------------------------------------------------------- THE GAP
s = new("""
I'm not the first to connect stablecoins to accounting. The big platforms are becoming one-stop shops, and crypto accounting tools like Bitwave and Request Finance already sync payments to Xero, QuickBooks and NetSuite. What I think is still manual is narrower: a small business that is paid straight into its own wallet, when a payment arrives wrong, and getting that payment into the books correctly. That is a hypothesis I'm testing in customer calls, not something I've proven.
SOURCES / LABELS:
- Big platforms vertically integrating [VERIFIED]: Bessemer Venture Partners, 22 Apr 2026: "Large companies like Stripe, Circle, and Coinbase are leveraging their distribution to become one-stop shops." Bessemer also writes that promising early-stage startups "will navigate outside the paths of Stripe, Circle, and Coinbase".
- Bitwave [VERIFIED, checked 28 Oct 2026]: supports stablecoin invoices and accounts receivable and syncs payments with ERPs "(NetSuite, Xero, QuickBooks, Sage, and more)". bitwave.io/request-a-demo-stablecoin-b2b-payments
- Request Finance [VERIFIED, checked 28 Oct 2026]: syncs bills (crypto and fiat) to QuickBooks Online, Xero and NetSuite. help.request.finance/en/articles/13038304-accounting-integrations-overview
- The wedge (small businesses paid directly into their own wallet; the wrong payments and posting them correctly) [ASSUMPTION †]: to test in customer calls.
""")
topline(s)
head(s, "What already exists, and what still looks manual")
rows = [("Big platforms", "Stripe, Circle, Coinbase", "Becoming one-stop shops", MUTED, LINE, WHITE),
        ("Crypto accounting tools", "e.g. Bitwave, Request Finance", "Already sync to Xero, QuickBooks and NetSuite  ✓", MUTED, LINE, WHITE),
        ("A small business paid straight into its own wallet", "", "Wrong payments, and posting them correctly: still by hand  †", ACC2, ACC, RED)]
for k, (lab, eg, res, col, line, rc) in enumerate(rows):
    y = 1.75 + k * 1.35
    box(s, M, y, W - 2 * M, 1.18, line=line)
    text(s, M + 0.35, y, 6.2, 1.18, [[(lab, {"color": WHITE})]] + ([[(eg, {"color": MUTED, "size": 20, "bold": False})]] if eg else []), size=22, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 6.65, y, 0.6, 1.18, "→", size=32, color=col, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 7.3, y, W - 2 * M - 7.55, 1.18, [[(res, {"color": rc})]], size=21, bold=True, anchor=MSO_ANCHOR.MIDDLE)
pill(s, M + 6.65, 1.75 + 2 * 1.35 + 1.18 + 0.15, "↑ A hypothesis I'm testing in calls", color=ACC, size=20, w=5.4)
foot(s, "Bessemer Venture Partners, Apr 2026 (one-stop shops).  Bitwave: bitwave.io · Request Finance: help.request.finance (both checked 28 Oct 2026).")

# 4 ---------------------------------------------------------------- WHAT I BUILT
s = new("""
Clearline asks for each payment clearly, matches it to its invoice, checks it's genuine, explains anything that went wrong in plain English, and posts it to your accounting system when you approve. On approval, the payment posts to the invoice in Xero with the transaction hash, token, network and USD value. A short payment posts as a partial payment with a note. Counterfeit and wrong-network payments are never posted. Every posting is in an audit log. It only reads the blockchain: it never holds or moves money.
STATUS (exactly this): Xero is built and tested in demo mode with a fictional company; the first live test with Xero's demo company is next. QuickBooks Online is next; NetSuite is on the roadmap. 0 customers. Working demo.
SCREENSHOT: Clearline's own "In your books" panel, in demo mode, with a fictional company (Northwind Pay) and fictional people. It is not Xero's interface.
VIDEO: the 60-second demo plays on this slide in PowerPoint (click it); in a PDF, scan the QR code (github.com/trysarathy/investigation-desk, pitch/demo_live_60s.mp4). The video was recorded before the "In your books" step, so it shows steps 1–3 only.
""")
topline(s)
text(s, M, 0.62, W - 2 * M, 0.7, "Stablecoin payments, matched, explained and in your books.", size=28, bold=True, name="Title")
text(s, M, 1.32, W - 2 * M, 0.6, "Clearline asks for each payment clearly, matches it to its invoice, checks it's genuine, explains anything that went wrong in plain English, and posts it to your accounting system when you approve.", size=18, color=MUTED)
steps = [("Ask", "A payment page per invoice"), ("Match", "Correct ones tick themselves off"),
         ("Explain", "Wrong ones explained, reply drafted"), ("In your books", "Posted to Xero on approval")]
cw = (W - 2 * M - 3 * 0.25) / 4
for k, (nm, d) in enumerate(steps):
    x = M + k * (cw + 0.25)
    box(s, x, 2.08, cw, 1.52, line=(ACC if k == 3 else LINE))
    text(s, x + 0.2, 2.08, cw - 0.4, 1.52, [[("①②③④"[k] + " ", {"color": ACC}), (nm, {"color": ACC2 if k == 3 else WHITE})], [(d, {"size": 18, "bold": False, "color": MUTED})]],
         size=21, bold=True, anchor=MSO_ANCHOR.MIDDLE, spacing=2)
sw = 5.2; sh = sw * 632 / 1312
Y4 = 3.82
img(s, A / "shots" / "books_posted.png", M, Y4, w=sw)
text(s, M, Y4 + sh + 0.06, sw, 0.35, "Step 4 in Clearline · demo mode, fictional company", size=16, color=MUTED, align=PP_ALIGN.CENTER)
sx = M + sw + 0.35; sbw = 3.7; sbh = sh
box(s, sx, Y4, sbw, sbh, fill=CARD, line=LINE)
text(s, sx + 0.3, Y4, sbw - 0.6, sbh, [[("Where it is today", {"bold": True, "color": ACC2, "size": 20})],
     [("✓  Xero: built and tested in demo mode", {})], [("→  QuickBooks: next", {})], [("0 customers", {"bold": True, "color": WHITE})]],
     size=18, anchor=MSO_ANCHOR.MIDDLE, spacing=10)
vx = sx + sbw + 0.3; vw = W - M - vx; vh = vw * 9 / 16
mv = s.shapes.add_movie(VIDEO, Inches(vx), Inches(Y4), Inches(vw), Inches(vh), poster_frame_image=str(A / "demo_poster.png"), mime_type="video/mp4")
mv.name = "Demo video (60 s)"
text(s, vx, Y4 + vh + 0.05, vw, 0.35, "▶ 60-second demo", size=16, bold=True, color=ACC2, align=PP_ALIGN.CENTER)
qs = 0.9
img(s, IL / "demo_qr.png", vx + (vw - qs) / 2, Y4 + vh + 0.42, w=qs)
foot(s, "The screenshot is Clearline's own panel, not Xero's. It reads payments only and never holds or moves money; it writes to the books only when a person approves.", key=False)

# 5 ---------------------------------------------------------------- HOW GOOD IT IS SO FAR
s = new("""
The product side is further along than the customer side. It works in a demo, and on real transactions its investigation part reached the right verdict every time on cases it hadn't seen. I don't yet know whether the people it's for actually need it, because I haven't spoken to them yet.
SOURCES / LABELS:
- 7 payment situations [VERIFIED]: demo/REQUESTS_DEMO.md.
- 52/52 [VERIFIED]: demo/REPORT.md, 24–25 Oct 2026. These are held-out real transactions collected after the fixes; 59/59 on the tuning cases, 43/59 before the fixes. The part that matches payments to invoices, and the plain-English explanations, are not yet tested on real data; company records were sample data.
- 3 early calls [VERIFIED, my notes, names withheld]: 16 Oct 2026, about an earlier version of the idea; reconciliation was "not really an issue" for them.
- 0 customers. In full: "my 3 early calls reached vendors, not finance teams"; "do customers mostly pay directly or via checkout pages?".
""")
topline(s)
head(s, "It works in a demo. I don't yet know if people need it")
cols = [("What works", GREEN := RGBColor(0x66, 0xD9, 0xA3), ["7 payment situations work end to end", "52 of 52 real transactions: correct verdict¹"]),
        ("What I don't know yet", ACC2, ["Do customers pay directly, or via checkout?", "Would finance teams use it?", "0 customers; my 3 calls reached vendors only"])]
cw = (W - 2 * M - 0.4) / 2
for k, (h, col, rows) in enumerate(cols):
    x = M + k * (cw + 0.4)
    box(s, x, 1.75, cw, 4.5, line=(LINE if k == 0 else ACC))
    text(s, x + 0.4, 2.0, cw - 0.8, 0.5, h, size=24, bold=True, color=col)
    text(s, x + 0.4, 2.75, cw - 0.8, 3.4, [[("•  " + r, {})] for r in rows], size=20, spacing=14)
foot(s, "¹ Real transactions it hadn't seen before (demo/REPORT.md). The invoice-matching part is not yet tested on real data.", key=False)

# 6 ---------------------------------------------------------------- ADVICE + THANK YOU
s = new("""
Any one of these would help, even a one-line reply, and I'd especially like to hear if you think I'm looking at the wrong problem. If it's easier, I can show you the working demo in about 15 minutes. Thank you for reading.
""")
topline(s)
head(s, "Three questions I'd love your view on")
qs_ = ["Does the direct-payment gap seem real to you?", "What would you test first?", "Is there anyone you'd suggest I speak to?"]
for k, q in enumerate(qs_):
    y = 1.75 + k * 0.95
    text(s, M, y, 0.7, 0.8, str(k + 1), size=34, bold=True, color=ACC, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 0.8, y, W - 2 * M - 0.8, 0.8, q, size=26, bold=True, anchor=MSO_ANCHOR.MIDDLE)
box(s, M, 4.85, W - 2 * M, 1.5, fill=CARD, line=LINE)
text(s, M + 0.4, 4.85, 5.6, 1.5, [[("Thank you for reading.", {"bold": True, "color": WHITE, "size": 24})], [("Happy to show the demo in 15 minutes.", {})]], size=20, color=MUTED, anchor=MSO_ANCHOR.MIDDLE, spacing=4)
text(s, M + 6.1, 4.85, W - 2 * M - 6.4, 1.5, [[("Aashmiin Kaur", {"bold": True, "color": WHITE})], [("aashmiin@gmail.com", {})], [("linkedin.com/in/aashmiin-kaur-479665391", {})]], size=20, color=MUTED, anchor=MSO_ANCHOR.MIDDLE)

prs.save(OUT)
print("saved", OUT, len(prs.slides._sldIdLst), "slides")
