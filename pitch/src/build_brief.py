"""Builds the Clearline MENTOR BRIEF: a short deck to send (as a PDF) to mentors, readable cold in 5 minutes.
Humble and explanatory, not a pitch. Same design as the pitch deck (deck_style.py). Every number is sourced
or marked: ◦ = estimate or assumption, † = untested; full labels and sources in the speaker notes.

    build_brief.py <out.pptx> <demo_60s.mp4>
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from deck_style import *

OUT = sys.argv[1]; VIDEO = sys.argv[2] if len(sys.argv) > 2 else ""
KEY = "◦ estimate or assumption   † untested   unmarked = sourced"
mk = lambda m: (m, {"color": ACC2, "bold": True, "size": 26})
sup = lambda n: (n, {"size": 12, "color": FAINT, "bold": False})

def head(s, runs):   # a full-sentence headline: 36pt when it fits one line, else 32pt
    n = sum(len(t) for t, _ in runs) if isinstance(runs, list) else len(runs)
    text(s, M, 0.5, W - 2 * M, 0.9, [runs] if isinstance(runs, list) else runs, size=36 if n <= 46 else 32, bold=True, name="Title")

def foot(s, sources, key=True):
    text(s, M, H - 0.62, W - 2 * M, 0.5, [[(sources, {})]] + ([[(KEY, {"color": MUTED})]] if key else []), size=10, color=FAINT, name="Sources")

# 1 ---------------------------------------------------------------- Title
s = new("""
This is a short brief on a project I'm exploring, shared so you can see what I'm working on and tell me where I'm wrong. It takes about five minutes to read, and I'd be grateful for any reaction, however brief.
NOTE: "Digital dollars" here means stablecoins, such as USDC and USDT: tokens designed to stay worth one US dollar.
""")
img(s, A / "icons/logo.png", M, 1.9, w=1.0)
text(s, M + 1.25, 1.8, 11, 1.2, [[("Clearline", {"bold": True}), (": a project I'm exploring", {"color": MUTED, "bold": False, "size": 40})]], size=64)
text(s, M, 3.3, 11.5, 0.8, "A smart cashier for digital-dollar (stablecoin) payments.", size=28, color=ACC2)
pill(s, M, 4.3, "Shared for feedback and guidance", color=ACC, size=18, w=4.5)
text(s, M, 6.2, 11, 0.4, "Aashmiin Kaur  ·  Singapore Management University  ·  October 2026", size=16, color=MUTED)

# 2 ---------------------------------------------------------------- The problem I noticed
s = new("""
Maya is an illustrative finance manager, not a real person. When her customers pay in stablecoins, the money arrives within seconds, but when something is off she has to piece together what happened from blockchain records, spreadsheets and emails. A token transfer carries only the sender, the receiver and the amount, so nothing in it says which invoice it pays.
SOURCES / LABELS:
- "Arrives in seconds" [VERIFIED, general knowledge]: Ethereum adds a block about every 12 s (ethereum.org); receivers may wait minutes for confirmations.
- "Checking can take hours" [ASSUMPTION], untested; it is the first thing I need to check with finance teams.
- ¹ No invoice reference [VERIFIED]: ERC-20 token standard, eips.ethereum.org/EIPS/eip-20.
- Real examples in my tests include 13 counterfeit-USDT and 6 wrong-network transfers [VERIFIED]: demo/REPORT.md.
- How I came across it [as stated by me — please check]: I started from month-end close tools for crypto finance teams and narrowed down to single payments that don't match.
""")
head(s, [("Payments arrive in seconds; checking can take hours", {}), mk("◦")])
text(s, M, 1.5, W - 2 * M, 0.5, "Maya, a finance manager, must work out which of these went wrong:", size=20, color=MUTED)
items = [("short", "Paid too little"), ("road", "Wrong network"), ("fake", "Counterfeit"), ("nolabel", "No invoice number¹")]
cw = (W - 2 * M - 3 * 0.35) / 4
for k, (ic, lab) in enumerate(items):
    x = M + k * (cw + 0.35)
    box(s, x, 2.2, cw, 2.9)
    img(s, A / f"icons/{ic}.png", x + (cw - 1.5) / 2, 2.4, w=1.5)
    text(s, x + 0.15, 4.2, cw - 0.3, 0.7, lab, size=22, bold=True, align=PP_ALIGN.CENTER)
text(s, M, 5.45, W - 2 * M, 0.7, "How I found it: exploring tools for crypto finance teams, I narrowed in on payments that don't match.", size=18, color=MUTED)
foot(s, "¹ A token transfer records sender, receiver and amount only: no invoice reference (ERC-20 standard, eips.ethereum.org/EIPS/eip-20). Maya is illustrative.")

# 3 ---------------------------------------------------------------- Why I think it matters
s = new("""
These are context, not a forecast. Businesses are only starting to use stablecoins (the McKinsey and Artemis estimate is still about 0.01% of business payments), but the rules are being written now, and Singapore sits near the middle of this activity.
SOURCES:
[1] "About $226 billion a year" of business-to-business stablecoin payments — McKinsey, "Stablecoins in payments: What the raw transaction numbers miss" (2026, with Artemis Analytics). An estimate (assumes ~20% of tagged activity is B2B, annualised from Dec 2025); B2B penetration ~0.01%. Artemis's own Oct 2025 report gives a lower figure (US$76B annualised); definitions differ.
[2] MAS consultation and draft amendments to the Payment Services Act for its stablecoin framework, published 1 Sep 2026, comments closed 16 Oct 2026 — mas.gov.sg; Gibson Dunn. (The US GENIUS Act was signed on 18 Jul 2025 — eco.com tracker.)
[3] Singapore among the top five stablecoin-sending countries — Artemis, Oct 2025, via PaymentExpert's 29 Oct 2025 write-up.
""")
head(s, "Stablecoin use is growing, and rules are arriving")
facts = [("Business use", "About US$226B a year of business stablecoin payments, still ~0.01% of the total", "¹", "◦"),
         ("New rules", "Singapore consulted on its stablecoin law, Sep–Oct 2026", "²", ""),
         ("Singapore's role", "One of the top five countries sending stablecoin payments", "³", "")]
cw = (W - 2 * M - 2 * 0.4) / 3
for k, (h, t, n, m) in enumerate(facts):
    x = M + k * (cw + 0.4)
    box(s, x, 1.75, cw, 4.15)
    text(s, x + 0.4, 2.05, cw - 0.8, 0.5, h, size=22, bold=True, color=ACC2)
    text(s, x + 0.4, 2.8, cw - 0.8, 2.9, [[(t, {}), mk(m), sup(n)]], size=24, bold=True)
foot(s, "¹ McKinsey with Artemis, 2026 (an estimate)  ² MAS consultation, 1 Sep 2026 (mas.gov.sg; Gibson Dunn)  ³ Artemis, Oct 2025")

# 4 ---------------------------------------------------------------- What I built
s = new("""
To understand the problem properly, I built a working version myself, with AI coding tools. It only reads payment information and drafts messages: it never holds or moves money, and a person makes every decision that isn't routine.
LABELS: all three steps work in the demo today, on fictional data [VERIFIED: demo/REQUESTS_DEMO.md]. The payment-matching side has not yet been tested on real data (demo/REPORT.md).
""")
head(s, "To explore it, I built a smart cashier")
steps = [("howtopay", "The customer sees exactly how to pay"), ("ticked", "Correct payments tick themselves off"), ("explains", "Problems are explained, with the reply drafted")]
cw = (W - 2 * M - 2 * 0.6) / 3
for k, (ic, t) in enumerate(steps):
    x = M + k * (cw + 0.6)
    box(s, x, 1.8, cw, 4.0)
    text(s, x + 0.35, 2.0, 1.0, 0.6, str(k + 1), size=32, bold=True, color=ACC)
    img(s, A / f"icons/{ic}.png", x + (cw - 1.5) / 2, 2.35, w=1.5)
    text(s, x + 0.35, 4.15, cw - 0.7, 1.4, t, size=24, bold=True, align=PP_ALIGN.CENTER)
    if k < 2: text(s, x + cw + 0.05, 3.3, 0.5, 0.6, "→", size=32, color=ACC, align=PP_ALIGN.CENTER)
foot(s, "It reads payment information only; it never holds or moves money.", key=False)

# 5 ---------------------------------------------------------------- The working demo
s = new("""
These are real screenshots of the working app, running on a fictional company. The 60-second video walks through the same steps; it plays inside the PowerPoint, and I've also sent it alongside the PDF (demo_live_60s.mp4). A 2-minute version is available if useful.
LABELS: all companies, people and amounts in the demo are fictional [VERIFIED].
""")
title(s, "The working demo, on fictional data")
shots = [("request_top.png", "1", "What the customer sees"), ("auto_paid.png", "2", "A correct payment, marked paid"), ("fake_verdict.png", "3", "A fake payment, explained")]
rowh, sw = 1.45, 5.0
for k, (f, n, cap) in enumerate(shots):
    y = 1.6 + k * (rowh + 0.4)
    text(s, M, y, 0.5, rowh, n, size=36, bold=True, color=ACC, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 0.55, y, 2.2, rowh, cap, size=18, anchor=MSO_ANCHOR.MIDDLE)
    w, h = fit(A / "shots" / f, sw, rowh)
    img(s, A / "shots" / f, M + 2.95, y + (rowh - h) / 2, w=w)
vx, vw = 9.0, W - M - 9.0; vh = vw * 9 / 16; vy = 2.2
mv = s.shapes.add_movie(VIDEO, Inches(vx), Inches(vy), Inches(vw), Inches(vh), poster_frame_image=str(A / "demo_poster.png"), mime_type="video/mp4")
mv.name = "Demo video (60 s)"
pill(s, vx, vy + vh + 0.25, "▶  60-second demo video", color=ACC, size=18, w=vw)
text(s, vx, vy + vh + 0.85, vw, 0.6, "Plays in PowerPoint; also attached to my email", size=14, color=MUTED, align=PP_ALIGN.CENTER)
foot(s, "All data is fictional: the company, its customers and every amount.", key=False)

# 6 ---------------------------------------------------------------- What already exists
s = new("""
Much of this is already handled well by others, and I'd like to learn from them rather than compete with them. Checkout tools work best when the customer pays through their page; my open question is what happens when business customers send money directly instead.
SOURCES:
- Stripe: stablecoin payments in invoices, payment links and checkout, settling in local currency; US businesses, with EU/HK/MX/CH in preview; not yet Singapore; USDC; US$10,000 per transaction — docs.stripe.com/crypto/stablecoins (Oct 2026).
- HitPay + Triple-A: stablecoin acceptance offered to 20,000+ Singapore merchants, with instant fiat settlement (14 Oct 2025) — fintechnews.sg.
- Request Finance: invoices; marks them paid and syncs QuickBooks/Xero — eco.com "Best B2B stablecoin invoicing tools 2026".
- Wallets: MetaMask (2026, KuCoin News), Trust Wallet (Mar 2026, trustwallet.com) and Safe + Blockaid (Sep 2024, blockaid.io) warn the sender about look-alike addresses.
- Blockaid: flags scam tokens (blockaid.io/token-security).
- Also relevant, not yet compared: Bitwave, TRES Finance, Cryptio (crypto accounting).
- "The gap I think may remain" [ASSUMPTION]: drawn from public product pages, not from using the products.
""")
title(s, "Others already do much of this well")
rows = [("Stripe", "Checkout and payment links"), ("HitPay + Triple-A", "Stablecoins for Singapore shops"), ("Request Finance", "Invoices, marked paid"),
        ("Wallets", "Warn senders of look-alike addresses"), ("Blockaid", "Flags scam tokens")]
tb = s.shapes.add_table(len(rows), 2, Inches(M), Inches(1.7), Inches(W - 2 * M), Inches(3.3)).table
tb.columns[0].width = Inches(3.6); tb.columns[1].width = Inches(W - 2 * M - 3.6)
for i, (who, what) in enumerate(rows):
    for j, val in enumerate((who, what)):
        c = tb.cell(i, j); c.fill.solid(); c.fill.fore_color.rgb = CARD
        c.margin_left = c.margin_right = Inches(0.2); c.vertical_anchor = MSO_ANCHOR.MIDDLE
        r = c.text_frame.paragraphs[0].add_run(); r.text = val; r.font.name = FONT; r.font.size = Pt(20)
        r.font.bold = j == 0; r.font.color.rgb = WHITE if j == 0 else MUTED
box(s, M, 5.3, W - 2 * M, 1.05, fill=CARD, line=ACC)
text(s, M + 0.35, 5.3, W - 2 * M - 0.7, 1.05, [[("Every piece exists somewhere. The gap that may remain: direct business payments and their exceptions", {}), mk("◦"), (". I'm not sure.", {})]], size=20, anchor=MSO_ANCHOR.MIDDLE)
foot(s, "docs.stripe.com · fintechnews.sg · eco.com · KuCoin News · trustwallet.com · blockaid.io. Details in the speaker notes.")

# 7 ---------------------------------------------------------------- What I've learned
s = new("""
The product side is further along than the customer side. The real-data test covered the part that investigates payments, not the matching or the plain-English explanations. The three calls I've had were with vendor teams (a custodian and compliance-software providers), not with the finance teams who would actually use this.
SOURCES / LABELS:
- 7 payment situations [VERIFIED]: demo/REQUESTS_DEMO.md.
- 52/52 [VERIFIED]: demo/REPORT.md, 24–25 Oct 2026. These were held-out cases collected after the fixes; 59/59 on the cases used for tuning, and 43/59 before the fixes. The matching and explanations are not yet tested on real data, and company records were sample data.
- 3 early calls [VERIFIED, my notes, names withheld]: 16 Oct 2026, about an earlier version of the idea; reconciliation was "not really an issue" for them.
- 0 customers, 0 pilots.
In full: "My 3 early calls reached vendors, who said it isn't a big issue for them"; "I haven't yet spoken to a finance team that receives stablecoins".
""")
head(s, "What I've learned: it works, but the need is untested")
learn = [("The demo handles 7 payment situations", WHITE), ("52 of 52 new real transactions: correct verdict¹", WHITE),
         ("3 early calls, all with vendors: “not really an issue”", WHITE),
         ("Not yet spoken to a finance team that receives stablecoins", ACC2), ("0 customers", ACC2)]
for k, (t, col) in enumerate(learn):
    y = 1.65 + k * 0.92
    box(s, M, y, W - 2 * M, 0.76)
    text(s, M + 0.35, y, W - 2 * M - 0.7, 0.76, t, size=20, color=col, anchor=MSO_ANCHOR.MIDDLE)
foot(s, "¹ demo/REPORT.md: held-out cases; the matching and explanations are not yet tested on real data. Calls: 16 Oct 2026, on an earlier version of the idea.", key=False)

# 8 ---------------------------------------------------------------- What I'm unsure about
s = new("""
In full: (1) Do business customers mostly pay through checkout pages, or send directly? (2) Is this big enough to be a business, or a feature for payment companies? (3) Should it serve finance teams, or plug into payment companies? (4) What licensing applies to a read-only tool? These are the questions I can't answer yet, and the ones I'd most like help thinking through. The first one matters most: if business customers mostly pay through checkout pages, most of these problems disappear, and Clearline is at best a feature for payment companies.
LABELS: all open [UNTESTED]. On licensing: Clearline reads payment data and drafts messages; it never holds, moves or exchanges money, which is why I think it may sit outside a payment-services licence. I haven't confirmed that with a lawyer.
""")
title(s, "The four things I'm most unsure about")
qs = ["Do customers mostly use checkout pages, or pay directly?", "A business, or a feature for payment companies?",
      "Serve finance teams, or plug into payment companies?", "What licensing applies to a read-only tool?"]
for k, q in enumerate(qs):
    y = 1.7 + k * 1.15
    text(s, M, y, 0.7, 0.95, str(k + 1), size=36, bold=True, color=ACC, anchor=MSO_ANCHOR.MIDDLE)
    box(s, M + 0.8, y, W - 2 * M - 0.8, 0.95)
    text(s, M + 1.15, y, W - 2 * M - 1.5, 0.95, q, size=22, anchor=MSO_ANCHOR.MIDDLE)
foot(s, "All four are open; I don't know the answers yet.", key=False)

# 9 ---------------------------------------------------------------- Where I'd value your guidance
s = new("""
In full: (1) Does the direct-payment gap seem real to you, from what you've seen, or not at all? (2) What would you test first, and how: what's the quickest way to learn if this matters? (3) Is there anyone I should speak to, especially finance teams that receive stablecoins? Any one of these would help, even a one-line reply. I'm especially keen to hear if you think I'm looking at the wrong problem altogether.
""")
title(s, "Where I'd value your guidance")
asks = [("Does the direct-payment gap seem real to you?", "From what you've seen"), ("What would you test first, and how?", "The quickest way to learn"),
        ("Is there anyone I should speak to?", "Especially finance teams receiving stablecoins")]
for k, (h1, h2) in enumerate(asks):
    y = 1.75 + k * 1.45
    text(s, M, y, 0.8, 1.1, str(k + 1), size=40, bold=True, color=ACC)
    text(s, M + 0.85, y + 0.05, 11, 0.55, h1, size=26, bold=True)
    text(s, M + 0.85, y + 0.65, 11, 0.5, h2, size=20, color=MUTED)

# 10 --------------------------------------------------------------- Thank you
s = new("""
Thank you for reading. If a short walk-through would be easier than slides, I can show the working demo in about 15 minutes, at whatever time suits you.
""")
title(s, "Thank you for reading")
text(s, M, 1.7, W - 2 * M, 1.2, "Thank you for taking the time. Any reaction, however brief, would help me.", size=26, color=WHITE)
box(s, M, 3.2, W - 2 * M, 1.9, fill=CARD, line=LINE)
text(s, M + 0.4, 3.2, W - 2 * M - 0.8, 1.9, [[("Aashmiin Kaur", {"bold": True, "size": 26, "color": WHITE})], [("aashmiin@gmail.com", {})], [("linkedin.com/in/aashmiin-kaur-479665391", {})]],
     size=20, color=MUTED, anchor=MSO_ANCHOR.MIDDLE, spacing=4)
pill(s, M, 5.55, "Happy to walk you through the demo in 15 minutes if useful", color=ACC, size=18, w=8.0)

# Appendix -------------------------------------------------------- Early thinking on the business side
s = new("""
This is very rough, and I'm including it only in case you're curious; none of it is tested. I'd rather get the problem right first.
SOURCES / LABELS:
- Two pricing ideas [ASSUMPTION/GUESS]: a monthly fee per finance team (S$300–800, ASSUMPTION), or a fee per exception paid by a payment company (S$1–3, GUESS).
- Size, Singapore only [mixed]: 300+ Web3 companies (VERIFIED: Singapore EDB, "Singapore: the onchain state", undated) × ~50% paid directly in stablecoins (GUESS) × S$6,000/year (ASSUMPTION) = about S$0.9M/year if every one bought. That's a ceiling for a test market; no wider market size is claimed.
- Main risks [ASSUMPTION]: checkout tools absorb the problem; licensing (read-only, but unconfirmed); getting access to companies' payment and invoice data; I'm a solo founder without payments-operations experience.
""")
head(s, "Appendix · Early thinking on the business side")
text(s, M, 1.38, W - 2 * M, 0.4, "Very rough, and none of it tested.", size=18, color=MUTED)
cols = [("How it might earn", [("Fee per finance team, S$300–800/mo", "◦"), ("Or per exception, via payment companies, S$1–3", "†")]),
        ("How big, Singapore only", [("300+ Web3 firms¹ × ~50% × S$6k ≈ S$0.9M a year ceiling", "◦")]),
        ("Main risks", [("Checkout tools may absorb it", "◦"), ("Licensing unconfirmed", ""), ("Solo, no payments experience", "")])]
cw = (W - 2 * M - 2 * 0.4) / 3
for k, (h, items_) in enumerate(cols):
    x = M + k * (cw + 0.4)
    box(s, x, 1.95, cw, 4.15)
    text(s, x + 0.35, 2.2, cw - 0.7, 0.9, h, size=22, bold=True, color=ACC2)
    text(s, x + 0.35, 3.05, cw - 0.7, 2.9, [[(t, {}), mk(m)] for t, m in items_], size=20, spacing=14)
foot(s, "¹ Singapore EDB, “Singapore: the onchain state”. Everything else here is untested; prices are placeholders, not quotes.")

prs.save(OUT)
print("saved", OUT, len(prs.slides._sldIdLst), "slides")
