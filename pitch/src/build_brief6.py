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
Companies are starting to get paid in digital dollars (stablecoins: tokens designed to stay worth one US dollar). A bank transfer usually arrives with a reference such as "Invoice 1043"; a digital-dollar payment arrives with no note at all, so someone in finance has to work out who paid and what for. Maya is a fictional finance manager, and the message is illustrative, from the demo's fictional data.
SOURCES / LABELS:
- No reference on a digital-dollar payment [VERIFIED]: a token transfer records only the sender, the receiver and the amount (ERC-20 standard, eips.ethereum.org/EIPS/eip-20).
- Blockchain transfers can't be reversed by the receiver [VERIFIED, general knowledge]. That is why "hard to send back".
- "Companies are starting to get paid" [VERIFIED, context]: McKinsey with Artemis (2026) estimate about US$226B a year of business stablecoin payments, still only about 0.01% of business payments.
""")
topline(s)
head(s, "Getting paid in digital dollars is like cash through the letterbox, with no note")
img(s, IL / "letterbox.png", M - 0.1, 2.0, w=6.6)
box(s, 7.3, 2.0, W - M - 7.3, 2.1)
text(s, 7.6, 2.0, W - M - 7.9, 2.1, [[("“We paid yesterday. Why is our invoice still unpaid?”", {"size": 24, "color": WHITE})], [("A customer, to Maya, a finance manager (fictional)", {"size": 18, "color": MUTED})]],
     size=24, anchor=MSO_ANCHOR.MIDDLE, spacing=6)
text(s, 7.3, 4.45, W - M - 7.3, 1.7, "A bank transfer says which invoice it pays. A digital-dollar payment says nothing, so Maya has to find out.", size=20, color=MUTED)
foot(s, "Digital dollars = stablecoins (e.g. USDC, USDT). A digital-dollar transfer records sender, receiver and amount only (ERC-20 standard).", key=False)

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
Checkout pages from companies like Stripe and HitPay handle this well, because the customer pays through their page, so the amount and the invoice are already known. But many business customers send money directly from their own account, and I haven't found anything that explains those messy payments in plain English. This is my belief, not something I've proven yet.
SOURCES / LABELS:
- Stripe: stablecoin payments in invoices, payment links and checkout, settling in local currency — docs.stripe.com/crypto/stablecoins. US businesses only for now; not yet Singapore; USDC only; up to US$10,000 per payment.
- HitPay + Triple-A: stablecoin acceptance offered to 20,000+ Singapore merchants, Oct 2025 — fintechnews.sg.
- Wallets that warn about scam addresses: MetaMask (2026, KuCoin News), Trust Wallet (Mar 2026), Safe + Blockaid (Sep 2024).
- Accounting tools that match payments to invoices: Request Finance (eco.com), Bitwave (bitwave.io).
- "Many business customers send directly" and "nobody explains the mess" [BELIEF †]: untested. This is the first thing I need to check with finance teams.
""")
topline(s)
head(s, "Checkout pages solve it, but only when customers use them")
paths = [("A", "Pays through a checkout page", "e.g. Stripe, HitPay", "Handled  ✓", MUTED, LINE, WHITE),
         ("B", "Sends directly from their own account", "", "Nobody explains the mess  ✗", ACC2, ACC, RED)]
for k, (n, lab, eg, res, col, line, rc) in enumerate(paths):
    y = 2.05 + k * 1.6
    box(s, M, y, W - 2 * M, 1.35, line=line)
    text(s, M + 0.3, y, 0.8, 1.35, n, size=36, bold=True, color=col, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 1.1, y, 6.6, 1.35, [[(lab, {"color": WHITE})]] + ([[(eg, {"color": MUTED, "size": 20, "bold": False})]] if eg else []), size=22, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 7.6, y, 0.6, 1.35, "→", size=32, color=col, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 8.3, y, 3.7, 1.35, [[(res, {"color": rc})]], size=22, bold=True, anchor=MSO_ANCHOR.MIDDLE)
pill(s, M + 7.95, 3.65 + 1.35 + 0.12, "← The gap I'm exploring", color=ACC, size=20, w=3.6)
text(s, M, 5.75, W - 2 * M, 0.9, [[("Wallets warn about scam addresses; accounting tools match clean payments. The messy direct payments are left.", {}), mk("†")]], size=20, color=MUTED)
foot(s, "Stripe: docs.stripe.com · HitPay: fintechnews.sg · wallets and accounting tools: sources in the speaker notes.")

# 4 ---------------------------------------------------------------- WHAT I BUILT
s = new("""
Clearline is a smart cashier for digital-dollar payments. It gives each invoice a clear "how to pay" page, watches the money that arrives, ticks off correct payments automatically, and when one is wrong, explains why in plain English and drafts the reply to the customer. It only reads payment information: it never holds or moves money, and a person makes every decision that isn't routine.
VIDEO: the 60-second demo plays on this slide in PowerPoint (click it). In a PDF, scan the QR code, which opens the video on GitHub (github.com/trysarathy/investigation-desk, file pitch/demo_live_60s.mp4), or open the copy attached to my email. A 2-minute version is available too.
LABELS: real screenshots from the working app; all demo data is fictional [VERIFIED]. I built it myself with AI coding tools.
""")
topline(s)
head(s, "Clearline: a smart cashier for digital-dollar payments")
steps = [("request_head.png", "The customer sees exactly how to pay"), ("auto_head.png", "Correct payments tick themselves off"), ("fake_head.png", "A problem is explained, with the reply drafted")]
rowh = 1.35
for k, (f, cap) in enumerate(steps):
    y = 1.8 + k * (rowh + 0.25)
    text(s, M, y, 0.6, rowh, "①②③"[k], size=30, bold=True, color=ACC, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 0.65, y, 2.75, rowh, cap, size=20, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    w, h = fit(A / "shots" / f, 5.2, rowh)
    img(s, A / "shots" / f, M + 3.55, y + (rowh - h) / 2, w=w)
vx = M + 3.55 + 5.2 + 0.4; vw = W - M - vx; vh = vw * 9 / 16
mv = s.shapes.add_movie(VIDEO, Inches(vx), Inches(1.75), Inches(vw), Inches(vh), poster_frame_image=str(A / "demo_poster.png"), mime_type="video/mp4")
mv.name = "Demo video (60 s)"
text(s, vx, 1.75 + vh + 0.1, vw, 0.4, "▶ 60-second demo", size=18, bold=True, color=ACC2, align=PP_ALIGN.CENTER)
qs = 1.25
img(s, IL / "demo_qr.png", vx + (vw - qs) / 2, 1.75 + vh + 0.6, w=qs)
text(s, vx, 1.75 + vh + 0.6 + qs + 0.05, vw, 0.4, "Scan to watch", size=18, color=MUTED, align=PP_ALIGN.CENTER)
foot(s, "Real screenshots of the working app. All demo data is fictional. It reads payments only; it never holds or moves money.", key=False)

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
