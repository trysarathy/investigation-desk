"""Builds the 10-slide Clearline deck (+ 2 backup slides) in the same design as the full deck.
One idea per slide, a full-sentence takeaway as every headline, ~30 words on the slide; everything cut
from the 17-slide deck lives in that slide's speaker notes. Honesty markers on slides:
  ◦ = estimate or assumption, † = untested guess, unmarked = sourced; full labels + sources in the notes.

    build_deck10.py <out.pptx> <demo_60s.mp4>
"""
import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from deck_style import *   # prs, palette, text/title/footer/box/pill/img/fit, Inches/Pt/PP_ALIGN/MSO_ANCHOR

OUT = sys.argv[1]; VIDEO = sys.argv[2] if len(sys.argv) > 2 else ""
KEY = "◦ estimate or assumption   † untested guess   unmarked = sourced"
QA = json.load(open(pathlib.Path(__file__).resolve().parent / "hard_questions.json"))
mk = lambda m: (m, {"color": ACC2, "bold": True, "size": 26})   # a marker run (◦ is a small glyph, so it's set large)
sup = lambda n: (n, {"size": 12, "color": FAINT, "bold": False})  # a footnote number run

def foot(s, sources, key=True):
    text(s, M, H - 0.62, W - 2 * M, 0.5, [[(sources, {})]] + ([[(KEY, {"color": MUTED})]] if key else []), size=10, color=FAINT, name="Sources")

# ================================================================ 1. Title
s = new("""
SAY: Thank you for making time. This is Clearline, a working demo I built myself. It helps a business that gets paid in digital dollars (stablecoins such as USDC and USDT) by doing the detective work that today falls on a finance person. I'm here for honest feedback, not to sell anything.
LABELS: no factual claims on this slide.
FROM OLD SLIDE 1: everything kept.
""")
img(s, A / "icons/logo.png", M, 2.05, w=1.15)
text(s, M + 1.4, 1.95, 9, 1.3, "Clearline", size=72, bold=True)
text(s, M, 3.5, 11, 0.8, "Get paid in digital dollars without the detective work.", size=30, color=ACC2)
text(s, M, 4.15, 11, 0.5, "Digital dollars: stablecoins such as USDC and USDT.", size=18, color=MUTED)
pill(s, M, 4.95, "Working demo · seeking feedback", color=ACC, size=18, w=4.4)
text(s, M, 6.3, 11, 0.4, "Aashmiin Kaur  ·  Singapore Management University  ·  October 2026", size=16, color=MUTED)

# ================================================================ 2. Problem (old 2 + 3)
s = new("""
SAY: Imagine Maya, a finance manager (an illustrative persona) whose customers pay in digital dollars. The money arrives in seconds, but when something is off she ends up in pages of codes, spreadsheets and email chains to work out what happened. It's one of four things: paid a little too little, sent on the wrong network, counterfeit digital dollars, or no invoice number, because a token transfer has no reference field. "Hours" is an assumption, the first thing the interviews must confirm.
SOURCES / LABELS:
- "Arrives in seconds" [VERIFIED, general knowledge]: Ethereum adds a block about every 12 s (ethereum.org/developers/docs/blocks); receivers may wait minutes for confirmations.
- "Checked for hours" [ASSUMPTION], untested.
- The quote is illustrative, from the product's fictional demo data (Orbit Retail, INV-1043), not a real customer.
- ¹ A token transfer records sender, receiver and amount only, no invoice reference [VERIFIED]: ERC-20 standard, eips.ethereum.org/EIPS/eip-20. Any contract can set its own name and symbol, which is why counterfeits exist.
- Real cases in our tests include 13 fake-USDT and 6 wrong-network transfers [VERIFIED]: demo/REPORT.md.
- Short payments, for example because an exchange took a fee; how often each problem happens [ASSUMPTION], which the interviews measure.
FROM OLD SLIDES 2-3 (moved here): the "pages of codes, spreadsheets, email chains" picture; "Today a person sorts out each one".
""")
title(s, [[("Paid in seconds. Checked for hours.", {}), mk("◦")]])
box(s, M, 1.75, W - 2 * M, 1.25)
text(s, M + 0.4, 1.75, W - 2 * M - 0.8, 1.25, [[("“We paid INV-1043 in full yesterday. Please confirm and close the invoice.”", {"color": WHITE})],
                                               [("Illustrative · fictional demo company", {"size": 14, "color": FAINT})]], size=24, anchor=MSO_ANCHOR.MIDDLE)
items = [("short", "Paid too little"), ("road", "Wrong network"), ("fake", "Counterfeit"), ("nolabel", "No invoice number¹")]
cw = (W - 2 * M - 3 * 0.35) / 4
for k, (ic, lab) in enumerate(items):
    x = M + k * (cw + 0.35)
    box(s, x, 3.3, cw, 3.0)
    img(s, A / f"icons/{ic}.png", x + (cw - 1.6) / 2, 3.5, w=1.6)
    text(s, x + 0.15, 5.35, cw - 0.3, 0.7, lab, size=22, bold=True, align=PP_ALIGN.CENTER)
foot(s, "¹ A token transfer records sender, receiver and amount: no invoice reference (ERC-20 standard, eips.ethereum.org/EIPS/eip-20).")

# ================================================================ 3. Solution (old 4)
s = new("""
SAY: Clearline is a smart cashier for digital-dollar payments. Before anyone pays, it tells the customer exactly what to send, on which network and to which address. When a payment arrives correctly, it ticks the invoice off by itself; when something is wrong, it explains why in plain English and drafts the reply. It never holds or moves money, and a person makes every decision that isn't routine.
SOURCES / LABELS: the three outcomes are product capabilities [VERIFIED in the working demo], demo/REQUESTS_DEMO.md, "Working now" column. Real-world accuracy of the payment-matching side is not yet tested on real data (demo/REPORT.md).
FROM OLD SLIDE 4 (moved here): the third outcome's full wording "Problems explain themselves" + "the reply drafted"; subtitle "It does the checking a finance person does today, and shows its work"; card details "amount, network and address on one page" / "checked and marked paid automatically" / "the cause in plain English, and the reply drafted"; footer "runs on fictional data; reads payments, never holds or moves money".
""")
title(s, "Clearline is a smart cashier for digital dollars")
outs = [("howtopay", "Customers know exactly how to pay"), ("ticked", "Correct payments tick themselves off"), ("explains", "Problems explain themselves, reply drafted")]
cw = (W - 2 * M - 2 * 0.4) / 3
for k, (ic, h1) in enumerate(outs):
    x = M + k * (cw + 0.4)
    box(s, x, 1.85, cw, 4.2)
    img(s, A / f"icons/{ic}.png", x + (cw - 1.6) / 2, 2.25, w=1.6)
    text(s, x + 0.35, 4.25, cw - 0.7, 1.5, h1, size=26, bold=True, align=PP_ALIGN.CENTER)
foot(s, "Runs today in the working demo, on fictional data. Clearline reads payments; it never holds or moves money.", key=False)

# ================================================================ 4. Demo (old 5)
s = new("""
SAY: Here is the real product, running on a fictional company. One: the customer's page says exactly what to send and on which network. Two: a correct payment is checked and marked paid with no one touching it. Three: fake digital dollars are caught, explained in plain English, and can't be marked paid by mistake. [Click the video for the 60-second demo; for the full 2-minute walkthrough, play demo_live_full.mp4.]
SOURCES / LABELS: screenshots captured from the app in demo mode (pitch/assets/shots); the video is a real recording of the app (demo/live). All companies, people and amounts are fictional [VERIFIED].
FROM OLD SLIDE 5: everything kept; the "Full 2-minute walkthrough" line is now only in these notes.
""")
title(s, "It works today: a real demo on fictional data")
shots = [("request_top.png", "1", "The customer sees what to send"), ("auto_paid.png", "2", "A correct payment marks itself paid"), ("fake_verdict.png", "3", "Fake dollars, explained")]
rowh, sw = 1.45, 5.0
for k, (f, n, cap) in enumerate(shots):
    y = 1.6 + k * (rowh + 0.4)
    text(s, M, y, 0.5, rowh, n, size=36, bold=True, color=ACC, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 0.55, y, 2.2, rowh, cap, size=18, anchor=MSO_ANCHOR.MIDDLE)
    w, h = fit(A / "shots" / f, sw, rowh)
    img(s, A / "shots" / f, M + 2.95, y + (rowh - h) / 2, w=w)
vx, vw = 9.0, W - M - 9.0; vh = vw * 9 / 16; vy = 2.2
mv = s.shapes.add_movie(VIDEO, Inches(vx), Inches(vy), Inches(vw), Inches(vh), poster_frame_image=str(A / "demo_poster.png"), mime_type="video/mp4")
mv.name = "Live demo (60 s)"
pill(s, vx, vy + vh + 0.25, "▶  Live demo · 60 s", color=ACC, size=18, w=vw)
foot(s, "Real screenshots and a real recording of the app in demo mode. All companies, people and amounts are fictional.", key=False)

# ================================================================ 5. Why now (old 6: 3 facts)
s = new("""
SAY: Three things are arriving together. Rules: Singapore's central bank consulted on the law changes for its stablecoin framework in September and October 2026, after the US signed its stablecoin law in July 2025. Use: McKinsey and Artemis estimate about 226 billion US dollars a year of business stablecoin payments, still only about 0.01% of business payments. And Singapore is one of the top five countries sending stablecoin payments. I expect more businesses to get paid this way, and the checking work to grow with them [ASSUMPTION].
SOURCES:
[1] MAS consultation and draft amendments to the Payment Services Act for the stablecoin framework, published 1 Sep 2026, comments closed 16 Oct 2026 — mas.gov.sg media release; Gibson Dunn client alert, Sep 2026.
[2] "About $226 billion a year" of B2B stablecoin payments — McKinsey, "Stablecoins in payments: What the raw transaction numbers miss" (2026, with Artemis Analytics). An estimate assuming ~20% of tagged activity is B2B, annualised from Dec 2025; B2B penetration ~0.01%. Also reported by CoinDesk, 23 Jan 2026. Artemis's own Oct 2025 report gives a lower B2B run-rate (US$76B annualised, Aug 2025; its conclusion says US$36B): the definitions differ, so always quote 226B with "McKinsey & Artemis" and "estimate".
[3] Singapore among the top five stablecoin-sending countries — Artemis, "Stablecoin Payments from the Ground Up", Oct 2025; checked via PaymentExpert's 29 Oct 2025 write-up (US, Singapore, Hong Kong, Japan, UK). Open the Artemis PDF once to see the exact chart.
FROM OLD SLIDE 6 (moved here, not on the slide):
- US GENIUS Act signed 18 Jul 2025 — eco.com GENIUS Act tracker (Aug 2026); Morgan Lewis, Jul 2025 (House passed 17 Jul 2025). Final rules still pending as of mid-2026.
- Stripe stablecoin payments: US businesses; private preview in the EU, Hong Kong, Mexico and Switzerland; not Singapore; USDC (USDP/USDG US-only); US$10,000 limit per transaction — docs.stripe.com/crypto/stablecoins (Oct 2026).
- HitPay × Triple-A, 14 Oct 2025: "will enable more than 20,000 Singapore merchants" to accept stablecoins with instant fiat settlement — fintechnews.sg. These are eligible merchants, not active users.
""")
title(s, "The rules and the money are arriving now")
facts = [("Rules", "Singapore consulted on its stablecoin law, Sep–Oct 2026", "¹", ""),
         ("Business use", "~US$226B a year of business stablecoin payments", "²", "◦"),
         ("Singapore", "A top-5 sender of stablecoin payments", "³", "")]
cw = (W - 2 * M - 2 * 0.4) / 3
for k, (h, t, n, m) in enumerate(facts):
    x = M + k * (cw + 0.4)
    box(s, x, 1.85, cw, 4.0)
    text(s, x + 0.4, 2.15, cw - 0.8, 0.5, h, size=22, bold=True, color=ACC2)
    text(s, x + 0.4, 2.9, cw - 0.8, 2.6, [[(t, {}), mk(m), sup(n)]], size=26, bold=True)
foot(s, "¹ MAS consultation, 1 Sep 2026 (mas.gov.sg; Gibson Dunn)  ² McKinsey with Artemis, 2026: an estimate, ~0.01% of B2B payments  ³ Artemis, Oct 2025")

# ================================================================ 6. First customer & the gap (old 7 + 8 + 9)
s = new("""
SAY: Checkout pages already handle the payments made through them. Our first customer is the other lane: finance teams whose business customers send digital dollars directly, from an exchange account or a company wallet, to a fixed address, where exceptions land on a person. Every piece of this exists somewhere: checkout tools, wallet warnings, risk tools and accounting tools each do their part well, but none, as far as I can tell, is built for the finance person facing a direct payment that went wrong. That gap is my belief, not a finding, and the interviews test it.
THE THREE BELIEFS (old slide 9; only the first is on the slide):
1. Business customers often pay from exchange accounts and company wallets, not checkout pages [ASSUMPTION].
2. The cost is in the exceptions: each one is a 15–30 minute investigation [GUESS]. The demo's "time saved" figure (20 min per explained exception) is a demo estimate, not a measurement.
3. Gateways would rather plug in exception handling than build it [ASSUMPTION].
None is tested. Three early calls with vendor teams, on an earlier idea, found reconciliation "not really an issue" for them; buyer teams are untested.
FIRST CUSTOMER (old slide 7): Singapore crypto and Web3 firms that invoice other businesses in USDC/USDT [ASSUMPTION]. EDB counts 300+ Web3 companies (undated; counting method not stated); MAS has licensed 37 digital payment token service providers (fintechnews.sg, 6 Aug 2026, parliamentary reply). How many are paid in stablecoins: unknown.
COMPETITORS (old slide 8; table abbreviated on the slide). "Left to a person" is [ASSUMPTION], from public product pages, not from using the products.
- Checkout pages: Stripe, Coinbase Commerce, Request Finance, HitPay. Match payments made through their own page; payments sent straight to an address skip them. Sources: docs.stripe.com/crypto/stablecoins; eco.com "Best B2B stablecoin invoicing tools 2026" (Request Finance marks invoices paid, syncs QuickBooks/Xero); fintechnews.sg.
- Wallet warnings: MetaMask (2026, KuCoin News), Trust Wallet (Mar 2026, trustwallet.com), Safe + Blockaid (Sep 2024, blockaid.io). Warn the sender about look-alike addresses; nothing about the invoice or the receiving side.
- Risk and compliance: Blockaid (blockaid.io/token-security), Elliptic, Chainalysis (general knowledge, not checked feature by feature). Flag scam tokens and risky addresses; not "which invoice is this, and what do I reply?".
- Crypto accounting: Bitwave (bitwave.io reconciliation guide), Request Finance. Books, ERP sync, payouts; investigating each exception is still left to a person.
- Clearline: working demo on fictional data; explains 7 payment situations with the reply drafted; no customers; matching untested on real data.
- Not yet compared: TRES Finance, Cryptio.
""")
title(s, [[("Direct payments are the gap others leave", {}), mk("◦")]])
# left: the two lanes
LW = 4.5
for k, (lab, sub, col, line) in enumerate([("Checkout page", "Gateway matches it", MUTED, LINE), ("Direct transfer", "A person sorts it out", ACC2, ACC)]):
    y = 1.75 + k * 1.75
    box(s, M, y, LW, 1.5, line=line)
    text(s, M + 0.35, y + 0.2, LW - 0.7, 0.5, lab, size=24, bold=True, color=col)
    text(s, M + 0.35, y + 0.8, LW - 0.7, 0.5, [[(sub, {}), mk("◦" if k else "")]], size=18, color=MUTED if not k else WHITE)
pill(s, M + LW - 1.75, 3.68, "our wedge", color=ACC, size=16, w=1.55)
# right: compact table
rows = [("Checkout", "Own payments", "Direct transfers"), ("Wallets", "Warn senders", "The invoice"),
        ("Risk tools", "Scam tokens", "The reply"), ("Accounting", "The books", "Exceptions")]
tx = M + LW + 0.4; tw = W - M - tx
tb = s.shapes.add_table(len(rows) + 1, 3, Inches(tx), Inches(1.75), Inches(tw), Inches(3.25)).table
tb.columns[0].width = Inches(2.25); tb.columns[1].width = Inches(2.35); tb.columns[2].width = Inches(tw - 4.6)
for i in range(len(rows) + 1):
    for j in range(3):
        c = tb.cell(i, j); c.fill.solid(); c.fill.fore_color.rgb = INK if i == 0 else CARD
        c.margin_left = c.margin_right = Inches(0.12); c.margin_top = c.margin_bottom = Inches(0.05); c.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = c.text_frame.paragraphs[0]; c.text_frame.word_wrap = True
        val = (["Tool", "Does well", "Leaves"][j] if i == 0 else rows[i - 1][j])
        r = p.add_run(); r.text = val; r.font.name = FONT; r.font.size = Pt(18)
        r.font.bold = (i == 0 or j == 0); r.font.color.rgb = MUTED if i == 0 else (WHITE if j < 2 else ACC2)
        if i == 0 and j == 2:
            r2 = p.add_run(); r2.text = " ◦"; r2.font.name = FONT; r2.font.size = Pt(26); r2.font.bold = True; r2.font.color.rgb = ACC2
box(s, M, 5.35, W - 2 * M, 0.85, fill=CARD, line=LINE)
text(s, M + 0.35, 5.35, W - 2 * M - 0.7, 0.85, [[("Belief: business customers often pay directly, not via checkout pages", {}), mk("◦")]], size=18, anchor=MSO_ANCHOR.MIDDLE)
foot(s, "Examples and sources for each row in the speaker notes (docs.stripe.com · eco.com · fintechnews.sg · KuCoin News · trustwallet.com · blockaid.io · bitwave.io). Not yet compared: TRES Finance, Cryptio.")

# ================================================================ 7. Business model & market (old 10 + 11)
s = new("""
SAY: I haven't tested pricing, so these are two hypotheses. Direct: a monthly subscription per finance team, priced by payment volume; embedded: a gateway or custodian pays per exception handled for its merchants. Bottom-up, the Singapore test market is deliberately small: 300-plus Web3 companies, about half paid directly in stablecoins, about 6,000 Singapore dollars a year each, is a ceiling of about 0.9 million a year. It grows beyond Singapore through Southeast Asia and India and through gateways, and I'll size that only after the interviews.
SOURCES / LABELS:
- Both models and both prices [ASSUMPTION]/[GUESS], untested; they're placeholders for the interviews, not quotes. Direct S$300–800/month [ASSUMPTION]; embedded S$1–3 per exception [GUESS].
- 300+ Web3 companies in Singapore [VERIFIED]: Singapore EDB, "Singapore: the onchain state" (edb.gov.sg; undated, counting method not stated).
- ~50% that invoice businesses which pay them directly in stablecoins [GUESS].
- S$6,000/year [ASSUMPTION]: S$500/month, the middle of the untested direct range.
- 300 × 50% × S$6,000 = S$900,000 a year, if every one bought: a ceiling for a test market, not the business. No top-down market size is claimed.
- Growth beyond Singapore (Southeast Asia, India, gateways' merchants through the embedded model) [ASSUMPTION], sized only after interviews.
- Test: ask 10 teams what one exception costs them today, in staff time.
""")
title(s, "Two pricing bets, and a small test market first")
cards = [("Direct", "per team", "S$300–800/mo", "◦"), ("Embedded", "per exception", "S$1–3", "†")]
cw = (W - 2 * M - 0.4) / 2
for k, (h, d, price, m) in enumerate(cards):
    x = M + k * (cw + 0.4)
    box(s, x, 1.75, cw, 1.85)
    text(s, x + 0.4, 1.95, cw - 0.8, 0.5, [[(h, {"color": ACC2, "bold": True}), (f"  {d}", {"color": MUTED, "size": 18})]], size=24)
    text(s, x + 0.4, 2.6, cw - 0.8, 0.8, [[(price, {}), mk(m)]], size=36, bold=True)
chain = [("300+", "Web3 firms in Singapore¹", ""), ("× ~50%", "paid directly", "†"), ("× S$6k", "a year each", "◦"), ("S$0.9M", "test-market ceiling", "◦")]
cw = (W - 2 * M - 3 * 0.3) / 4
for k, (big, small, m) in enumerate(chain):
    x = M + k * (cw + 0.3)
    box(s, x, 3.9, cw, 1.6, line=(ACC if k == 3 else LINE))
    text(s, x + 0.3, 4.05, cw - 0.6, 0.7, [[(big, {}), mk(m)]], size=32, bold=True, color=ACC2 if k == 3 else WHITE)
    text(s, x + 0.3, 4.8, cw - 0.6, 0.6, small, size=18, color=MUTED)
text(s, M, 5.8, W - 2 * M, 0.5, [[("Then: Southeast Asia, India, gateways", {}), mk("◦")]], size=20, color=MUTED)
foot(s, "¹ Singapore EDB, “Singapore: the onchain state” (edb.gov.sg). Prices are placeholders for interviews, not quotes; no top-down market size is claimed.")

# ================================================================ 8. Traction (old 12)
s = new("""
SAY: Honestly: a working product, no customers yet. The demo runs seven payment situations end to end, and the investigation side gave the correct verdict on 52 of 52 new real transactions. My three early calls were with custodian and compliance-software teams about an earlier idea, and they said reconciliation wasn't really an issue for them. So the next step is ten conversations with actual buyers, and one question decides the direction: mostly direct means selling to finance teams; mostly checkout means becoming a plug-in for gateways.
SOURCES / LABELS:
- 7 payment situations [VERIFIED]: demo/REQUESTS_DEMO.md.
- Correct verdicts [VERIFIED]: 43/59 before fixes, 59/59 after, 52/52 on held-out cases collected afterwards (deposit-investigation part; 6 networks + Bitcoin IDs). Source: demo/REPORT.md, 24–25 Oct 2026. Explanations and payment matching NOT tested on real data; company records were sample data.
- 3 early calls [VERIFIED from the founder's notes; names withheld]: custodian and compliance-software teams, 16 Oct 2026, about an earlier idea.
- 0 customers, 0 paid pilots [VERIFIED].
FROM OLD SLIDE 12 (moved here): full labels "payment situations run end to end in the demo", "new real transactions given the correct verdict", "early calls, all with vendor teams", "customers or paid pilots"; "Next: 10 finance teams that receive stablecoins, one question"; the decision rule "Mostly directly → sell to finance teams. Mostly checkout → become a plug-in for gateways."
""")
title(s, "A working product, no customers yet")
stats = [("7", "situations in\nthe demo"), ("52 / 52", "real transactions\ncorrect¹"), ("3", "vendor calls²"), ("0", "customers")]
cw = (W - 2 * M - 3 * 0.3) / 4
for k, (big, small) in enumerate(stats):
    x = M + k * (cw + 0.3)
    text(s, x, 1.8, cw, 0.9, big, size=44, bold=True, color=WHITE if k < 3 else ACC2)
    text(s, x, 2.75, cw, 0.9, small, size=18, color=MUTED)
box(s, M, 4.05, W - 2 * M, 1.95, line=ACC)
text(s, M + 0.4, 4.3, W - 2 * M - 0.8, 0.5, "Next: 10 finance-team interviews", size=20, color=MUTED)
text(s, M + 0.4, 4.9, W - 2 * M - 0.8, 0.8, "“Do customers pay through a checkout page, or send directly?”", size=28, bold=True)
foot(s, "¹ demo/REPORT.md: held-out cases (59/59 on tuning cases); explanations and matching not yet tested on real data. ² Custodian and compliance-software teams, 16 Oct 2026, on an earlier idea.", key=False)

# ================================================================ 9. Team (old 13)
s = new("""
SAY: It's just me for now. I'm a second-year accountancy student at SMU, which is why the finance person's side matters to me. I taught myself to code through Harvard's CS50 and built this product myself, using AI coding tools, and I've done business development at Protégé Ventures and Hatch. What I lack is payments operations experience, which is part of why I'm asking for your help.
LABELS: background as stated by the founder; please check each line before presenting.
FROM OLD SLIDE 13 (moved here): "Founder · builds the product and talks to customers"; the BD roles in full: student analyst at Protégé Ventures, partner outreach at Hatch.
""")
title(s, "A solo founder who builds and sells")
box(s, M, 1.8, 1.5, 1.5, fill=CARD, line=ACC, radius=0.5)
text(s, M, 1.8, 1.5, 1.5, "AK", size=40, bold=True, color=ACC2, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
text(s, M + 1.85, 1.85, 8, 0.6, "Aashmiin Kaur", size=32, bold=True)
facts = ["Year 2 Accountancy, Singapore Management University", "Self-taught coder (CS50); built Clearline with AI coding tools",
         "Business development: Protégé Ventures, Hatch", "SMU BIG incubator"]
text(s, M + 1.85, 2.65, W - 2 * M - 1.85, 2.6, facts, size=20, spacing=12)
box(s, M + 1.85, 5.3, W - 2 * M - 1.85, 0.8, fill=CARD, line=ACC)
text(s, M + 2.15, 5.3, W - 2 * M - 2.45, 0.8, "Looking for: payments operations experience", size=20, color=ACC2, anchor=MSO_ANCHOR.MIDDLE)
foot(s, "Founder's own background.", key=False)

# ================================================================ 10. The ask (old 14)
s = new("""
SAY: Three things would help most. Your honest view of the wedge: are direct payments and their exceptions really underserved, or am I missing something? Introductions to three to five finance teams that receive stablecoin payments, for a 20-minute conversation, not a sales pitch. And your advice on whether and how to partner with gateways or custodians. Thank you.
LABELS: no factual claims.
FROM OLD SLIDE 14 (full wording, shortened on the slide): "Are direct payments and their exceptions really underserved?"; "Finance teams that receive stablecoin payments, for a 20-minute conversation"; "Whether and how to partner with gateways or custodians".
""")
title(s, "Three things would help me most")
asks = [("Honest feedback on the wedge", "Is direct payment really the gap?"), ("3–5 introductions", "Finance teams receiving stablecoins"),
        ("Advice on gateways", "How to partner, if at all")]
for k, (h1, h2) in enumerate(asks):
    y = 1.75 + k * 1.3
    text(s, M, y, 0.8, 1.1, str(k + 1), size=40, bold=True, color=ACC)
    text(s, M + 0.85, y + 0.05, 10.5, 0.5, h1, size=26, bold=True)
    text(s, M + 0.85, y + 0.6, 10.5, 0.5, h2, size=20, color=MUTED)
box(s, M, 5.85, W - 2 * M, 0.85, fill=CARD, line=LINE)
text(s, M + 0.35, 5.85, W - 2 * M - 0.7, 0.85, [[("Aashmiin Kaur   ", {"bold": True}), ("aashmiin@gmail.com   ·   linkedin.com/in/aashmiin-kaur-479665391", {"color": MUTED})]], size=20, anchor=MSO_ANCHOR.MIDDLE)

# ================================================================ Backup A: risks (old 15)
s = new("""
SAY (only if asked): These are the risks I see, and what I'd do about each.
LABELS:
- Mitigations are plans [ASSUMPTION].
- "Never matches on a guess; a person confirms with a note" is [VERIFIED in the demo; untested on real data].
- The licensing line is not legal advice. Clearline reads payment data and drafts messages; it never holds, moves or exchanges money. That's why I believe it sits outside a payment-services licence, but a Singapore lawyer must confirm that before any live customer.
FROM OLD SLIDE 15: all five risks kept, wording shortened.
""")
title(s, "Backup · Five risks, and what I'd do about each")
risks = [("Checkout tools absorb it", "Interview test; if so, a gateway plug-in", "◦"), ("Licensing", "Read-only, never moves money; a lawyer confirms", "◦"),
         ("Data access", "Public chain data + invoice export first", "◦"), ("A wrong match", "No guessing: a person confirms", ""), ("Solo founder", "Find a payments-ops co-founder", "◦")]
for k, (r, m, mark) in enumerate(risks):
    y = 1.65 + k * 0.98
    box(s, M, y, W - 2 * M, 0.82)
    text(s, M + 0.3, y, 4.2, 0.82, r, size=20, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 4.6, y, W - 2 * M - 4.9, 0.82, [[(m, {}), mk(mark)]], size=18, color=MUTED, anchor=MSO_ANCHOR.MIDDLE)
foot(s, "“No guessing” is how the demo works today; matching is untested on real data.")

# ================================================================ Backup B: hard questions (old 16 + 17: best 3 of each)
pick = [("YC", QA["yc"][0]), ("YC", QA["yc"][1]), ("YC", QA["yc"][2]), ("Expert", QA["expert"][0]), ("Expert", QA["expert"][1]), ("Expert", QA["expert"][3])]
SHORT_Q = ["No buyer interviews yet: how do you know?", "S$0.9M market: why venture-scale?", "Why won't Stripe or HitPay just build this?",
           "Per-invoice addresses fix references. What's left?", "Crypto accounting tools reconcile already. Why you?", "Who's liable for a wrong match? A licence?"]
dropped = [QA["yc"][3], QA["yc"][4], QA["expert"][2], QA["expert"][4]]
s = new("SAY: only if asked; give the short answer, then stop.\n\nFULL ANSWERS:\n\n" +
        "\n\n".join(f"[{who}] Q: {q['q']}\nA: {q['full']}" for who, q in pick) +
        "\n\nFROM OLD SLIDES 16-17 (not on the slide; same honesty):\n\n" + "\n\n".join(f"Q: {q['q']}\nShort: {q['short']}\nA: {q['full']}" for q in dropped))
title(s, "Backup · Hard questions, honest answers")
colw = (W - 2 * M - 0.5) / 2
for c, (hdr, qs) in enumerate([("A YC partner", pick[:3]), ("A payments expert", pick[3:])]):
    x = M + c * (colw + 0.5)
    text(s, x, 1.45, colw, 0.4, hdr, size=18, bold=True, color=ACC2)
    for k, (_, q) in enumerate(qs):
        y = 1.95 + k * 1.6
        text(s, x, y, colw, 1.55, [[(SHORT_Q[c * 3 + k], {"bold": True})], [(q["short"], {"color": MUTED})]], size=18)

prs.save(OUT)
print("saved", OUT, len(prs.slides._sldIdLst), "slides")
