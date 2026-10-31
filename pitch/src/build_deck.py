"""Builds the Clearline pitch deck (python-pptx): 14 slides + appendix, dark, one font family (Arial),
three colours (ink, white, periwinkle; red only for warnings). Every claim on a slide is either sourced
(numbered, sources in the speaker notes and the footer) or labelled ASSUMPTION / GUESS.

    build_deck.py <out.pptx> <demo_60s.mp4 or ''>
"""
import sys, pathlib
from PIL import Image
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

OUT = sys.argv[1]; VIDEO = sys.argv[2] if len(sys.argv) > 2 else ""
A = pathlib.Path(__file__).resolve().parent.parent / "assets"
FONT = "Arial"
INK, CARD, LINE = RGBColor(0x0B, 0x0E, 0x14), RGBColor(0x15, 0x1A, 0x24), RGBColor(0x2A, 0x31, 0x40)
WHITE, MUTED, FAINT = RGBColor(0xF2, 0xF4, 0xF7), RGBColor(0xA3, 0xAA, 0xB6), RGBColor(0x76, 0x7E, 0x8C)
ACC, ACC2, RED = RGBColor(0x8E, 0xA2, 0xFF), RGBColor(0xB9, 0xC6, 0xFF), RGBColor(0xFF, 0x8A, 0x7F)
W, H, M = 13.333, 7.5, 0.6

prs = Presentation(); prs.slide_width, prs.slide_height = Inches(W), Inches(H)
BLANK = prs.slide_layouts[6]

def new(notes):
    s = prs.slides.add_slide(BLANK)
    s.background.fill.solid(); s.background.fill.fore_color.rgb = INK
    s.notes_slide.notes_text_frame.text = notes.strip()
    return s

def text(s, x, y, w, h, runs, size=20, color=WHITE, bold=False, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=None, name=None):
    """runs: a string, or a list of paragraphs; each paragraph a string or a list of (text, {size,color,bold}) runs."""
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name: tb.name = name
    tf = tb.text_frame; tf.word_wrap = True; tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    paras = runs if isinstance(runs, list) else [runs]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if spacing: p.space_after = Pt(spacing)
        for t, o in ([(para, {})] if isinstance(para, str) else para):
            r = p.add_run(); r.text = t; f = r.font
            f.name = FONT; f.size = Pt(o.get("size", size)); f.bold = o.get("bold", bold)
            f.color.rgb = o.get("color", color); f.italic = o.get("italic", False)
    return tb

def title(s, t, sub=None):
    text(s, M, 0.5, W - 2 * M, 0.9, t, size=36, bold=True, name="Title")
    if sub: text(s, M, 1.38, W - 2 * M, 0.5, sub, size=20, color=MUTED, name="Subtitle")

def footer(s, t):
    text(s, M, H - 0.5, W - 2 * M, 0.3, t, size=10, color=FAINT, name="Sources")

def box(s, x, y, w, h, fill=CARD, line=LINE, radius=0.08):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.adjustments[0] = radius; sh.fill.solid(); sh.fill.fore_color.rgb = fill
    if line is None: sh.line.fill.background()
    else: sh.line.color.rgb = line; sh.line.width = Pt(1)
    sh.shadow.inherit = False
    return sh

def pill(s, x, y, t, color=ACC, size=12, w=None):
    w = w or (0.18 + 0.085 * len(t) * size / 12)
    b = box(s, x, y, w, 0.34 * size / 12, fill=INK, line=color, radius=0.5)
    text(s, x, y, w, 0.34 * size / 12, t, size=size, color=color, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    return w

def img(s, path, x, y, w=None, h=None):
    kw = {}
    if w: kw["width"] = Inches(w)
    if h: kw["height"] = Inches(h)
    return s.shapes.add_picture(str(path), Inches(x), Inches(y), **kw)

def fit(path, maxw, maxh):
    im = Image.open(path); r = min(maxw / im.width, maxh / im.height); return im.width * r, im.height * r

TAG = {"A": ("ASSUMPTION", ACC2), "G": ("GUESS", ACC2), "V": ("VERIFIED", MUTED)}
def tag(kind, n=""):
    t, c = TAG[kind]; return (f"  [{t}{(' ' + n) if n else ''}]", {"size": 12, "color": c, "bold": False})

# ---------------------------------------------------------------- 1. Title
s = new("""
SAY: Thank you for making time. This is Clearline, a working demo I built on my own. It helps a business that gets paid in digital dollars (stablecoins) by doing the detective work that today falls on a finance person. I'm here for honest feedback, not to sell anything.
LABELS: no factual claims on this slide.
""")
img(s, A / "icons/logo.png", M, 2.05, w=1.15)
text(s, M + 1.4, 1.95, 9, 1.3, "Clearline", size=72, bold=True)
text(s, M, 3.5, 11, 0.8, "Get paid in digital dollars without the detective work.", size=30, color=ACC2)
text(s, M, 4.15, 11, 0.5, "Digital dollars: stablecoins such as USDC and USDT.", size=18, color=MUTED)
pill(s, M, 4.95, "Working demo · seeking feedback", color=ACC, size=18, w=4.4)
text(s, M, 6.3, 11, 0.4, "Aashmiin Kaur  ·  Singapore Management University  ·  October 2026", size=16, color=MUTED)

# ---------------------------------------------------------------- 2. Problem
s = new("""
SAY: Imagine Maya, a finance manager (an illustrative persona) whose customers pay in digital dollars. The money arrives in seconds, but every time something is off, she ends up in pages of codes, spreadsheets and email chains to work out what happened. The message on the right is the kind she gets every day. "Hours" is our assumption: it is the first thing the interviews must confirm.
LABELS: "arrives in seconds" — [VERIFIED as general knowledge: stablecoin transfers settle on-chain within seconds to minutes; e.g. Ethereum blocks are ~12 s (ethereum.org/developers/docs/blocks)]. "Takes hours" — [ASSUMPTION], untested. The quote is illustrative, taken from the product's fictional demo data (Orbit Retail, INV-1043), not from a real customer.
""")
title(s, "Paid in seconds. Checked for hours.")
dig = A / "dig_crop.jpg"
if not dig.exists():
    Image.open(A / "dig.jpg").crop((130, 250, 1790, 660)).save(dig, quality=92)
img(s, dig, M, 2.25, w=7.4)
text(s, M, 2.25 + 7.4 * 410 / 1660 + 0.25, 7.4, 0.5, [[("What a finance manager like Maya (illustrative) opens to find one payment", {}), tag("A")]], size=18, color=MUTED)
box(s, 8.55, 2.25, 4.18, 2.6)
text(s, 8.85, 2.5, 3.6, 1.6, "“We paid INV-1043 in full yesterday. Please confirm and close the invoice.”", size=22, color=WHITE)
text(s, 8.85, 4.2, 3.6, 0.5, "Illustrative message · fictional demo company", size=13, color=FAINT)
text(s, 8.55, 5.2, 4.2, 1.2, [[("Seconds", {"bold": True, "color": WHITE}), ("  to pay.", {})], [("Hours", {"bold": True, "color": ACC2}), ("  to check.", {}), tag("A")]], size=26, color=MUTED, spacing=4)
footer(s, "Ethereum adds a block about every 12 s (ethereum.org); receivers may wait minutes for confirmations. “Hours” is our assumption, to be tested in interviews.")

# ---------------------------------------------------------------- 3. Why it happens
s = new("""
SAY: Four things go wrong. Customers pay a little too little, for example because an exchange took a fee (how often is an assumption the interviews will measure). They send on the wrong network, like using the wrong road. Some are tricked into paying with counterfeit digital dollars: anyone can create a token with the same name. And many forget to say which invoice they're paying, because a blockchain transfer has no reference field.
LABELS: "A transfer carries an amount and an address, not an invoice number" — [VERIFIED] ERC-20 standard: a Transfer has only from, to and value (eips.ethereum.org/EIPS/eip-20). Fake tokens with real names — [VERIFIED] any contract can set its own name/symbol (same standard). Which of the four is most common and how often — [ASSUMPTION], untested.
""")
title(s, "Four things go wrong with these payments", [[("A token transfer records sender, receiver and amount: no invoice reference.¹", {})]])
items = [("short", "Paid a little\ntoo little"), ("road", "Sent on the\nwrong network"), ("fake", "Counterfeit\ndigital dollars"), ("nolabel", "No invoice\nnumber")]
cw = (W - 2 * M - 3 * 0.35) / 4
for k, (ic, lab) in enumerate(items):
    x = M + k * (cw + 0.35)
    box(s, x, 2.45, cw, 3.6)
    img(s, A / f"icons/{ic}.png", x + (cw - 1.7) / 2, 2.8, w=1.7)
    text(s, x + 0.2, 4.75, cw - 0.4, 1.1, lab, size=24, bold=True, align=PP_ALIGN.CENTER)
text(s, M, 6.3, W - 2 * M, 0.4, [[("Today a person sorts out each one. How often each happens is what the interviews will measure.", {}), tag("A")]], size=18, color=MUTED)
footer(s, "¹ ERC-20 standard (eips.ethereum.org/EIPS/eip-20). Real cases in our tests include 13 fake-USDT and 6 wrong-network transfers (demo/REPORT.md).")

# ---------------------------------------------------------------- 4. Solution
s = new("""
SAY: Clearline is a smart cashier for digital-dollar payments. Before anyone pays, it tells the customer exactly what to send, on which network and to which address. When a payment arrives correctly, it checks it and has the invoice ready to mark paid once you approve. When something is wrong, it explains why in plain English and drafts the reply to the customer. It never moves money; a person makes every decision that isn't routine.
LABELS: these are product capabilities, [VERIFIED] in the working demo (demo/REQUESTS_DEMO.md, "Working now" column). Real-world accuracy of the payment-matching side — not yet tested on real data (demo/REPORT.md).
""")
title(s, "A smart cashier for digital-dollar payments", "It does the checking a finance person does today, and shows its work.")
outs = [("howtopay", "Customers know exactly how to pay", "Amount, network and address on one page"),
        ("ticked", "Correct payments, ready to mark paid", "Once you approve, with the reasons written down"),
        ("explains", "Problems explain themselves", "The cause in plain English, and the reply drafted")]
cw = (W - 2 * M - 2 * 0.4) / 3
for k, (ic, h1, h2) in enumerate(outs):
    x = M + k * (cw + 0.4)
    box(s, x, 2.3, cw, 4.0)
    img(s, A / f"icons/{ic}.png", x + 0.4, 2.65, w=1.35)
    text(s, x + 0.4, 4.05, cw - 0.8, 1.2, h1, size=24 if len(h1) < 34 else 22, bold=True)
    text(s, x + 0.4, 5.4, cw - 0.8, 0.8, h2, size=18, color=MUTED)
footer(s, "All three run in the working demo today, on fictional data. Clearline reads payments; it never holds or moves money.")

# ---------------------------------------------------------------- 5. Demo
s = new("""
SAY: Here is the real product, running on a fictional company. One: the customer's payment page says exactly what to send and on which network. Two: a correct payment is checked and marked paid with no one touching it. Three: fake digital dollars are caught, explained in plain English, and can't be marked paid by mistake. [Click the video to play the 60-second demo; for the full 2-minute walkthrough, play demo_live_full.mp4.]
LABELS: screenshots captured from the app in demo mode (pitch/assets/shots); all data fictional. [VERIFIED]
""")
title(s, "The working demo")
shots = [("request_top.png", "1", "The customer sees exactly what to send, and where"),
         ("auto_paid.png", "2", "A correct payment marks itself paid"),
         ("fake_verdict.png", "3", "Fake digital dollars, explained in plain English")]
im = Image.open(A / "shots/request.png"); im.crop((0, 0, im.width, int(im.height * 0.2))).save(A / "shots/request_top.png")
im = Image.open(A / "shots/fake_explained.png"); im.crop((0, 0, im.width, int(im.height * 0.5))).save(A / "shots/fake_verdict.png")
rowh, sw = 1.45, 5.0
for k, (f, n, cap) in enumerate(shots):
    y = 1.6 + k * (rowh + 0.4)
    text(s, M, y, 0.5, rowh, n, size=36, bold=True, color=ACC, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 0.55, y, 2.2, rowh, cap, size=18, anchor=MSO_ANCHOR.MIDDLE)
    w, h = fit(A / "shots" / f, sw, rowh)
    img(s, A / "shots" / f, M + 2.95, y + (rowh - h) / 2, w=w)
vx, vw = 9.0, W - M - 9.0; vh = vw * 9 / 16; vy = 2.2
if VIDEO:
    mv = s.shapes.add_movie(VIDEO, Inches(vx), Inches(vy), Inches(vw), Inches(vh), poster_frame_image=str(A / "demo_poster.png"), mime_type="video/mp4")
    mv.name = "Live demo (60 s)"
else:
    img(s, A / "demo_poster.png", vx, vy, w=vw)
pill(s, vx, vy + vh + 0.25, "▶  Live demo · 60 s · click to play", color=ACC, size=14, w=vw)
text(s, vx, vy + vh + 0.85, vw, 0.8, "Full 2-minute walkthrough: demo_live_full.mp4", size=14, color=MUTED, align=PP_ALIGN.CENTER)
footer(s, "Real screenshots and a real recording of the app in demo mode. All companies, people and amounts are fictional.")

# ---------------------------------------------------------------- 6. Why now
s = new("""
SAY: Three things changed. Rules: the US signed its stablecoin law in July 2025, and Singapore's central bank published draft legislation for its stablecoin framework on 1 September 2026. Use: McKinsey and Artemis counted about 226 billion US dollars of business-to-business stablecoin payments in 2025, and Singapore is one of the top five sending countries. Gateways are arriving: Stripe accepts stablecoins and HitPay offers them to Singapore merchants. I expect more businesses will get paid this way, and the checking work to grow with them [ASSUMPTION].
SOURCES:
[1] GENIUS Act signed 18 July 2025 — eco.com GENIUS Act implementation tracker (Aug 2026); Morgan Lewis, July 2025 (House passed 17 July 2025). Final implementing rules still pending as of mid-2026.
[2] MAS consultation and draft amendments to the Payment Services Act for the stablecoin framework, published 1 Sep 2026, comments closed 16 Oct 2026 — mas.gov.sg media release; Gibson Dunn client alert, Sep 2026.
[3] "About $226 billion a year" of B2B stablecoin payments — McKinsey, "Stablecoins in payments: What the raw transaction numbers miss" (2026, with Artemis Analytics), mckinsey.com; an estimate assuming ~20% of tagged activity is B2B, annualised from Dec 2025; B2B penetration ~0.01%. Also reported by CoinDesk, 23 Jan 2026. NOTE: Artemis's own Oct 2025 report gives a lower B2B run-rate (US$76B annualised, Aug 2025; its conclusion says US$36B) — the definitions differ, so quote 226B only with "McKinsey & Artemis" attached.
[4] Singapore among the top five stablecoin-sending countries — Artemis, "Stablecoin Payments from the Ground Up", Oct 2025.
[5] Stripe stablecoin payments: available to US businesses; private preview in the EU, Hong Kong, Mexico, Switzerland; not Singapore; USDC (USDP/USDG US-only); customer limit US$10,000 per transaction — docs.stripe.com/crypto/stablecoins (checked Oct 2026).
[6] HitPay × Triple-A, 14 Oct 2025: "will enable more than 20,000 Singapore merchants" to accept stablecoins, with instant fiat settlement — fintechnews.sg. Eligible merchants, not active users.
[4] note: checked via PaymentExpert's 29 Oct 2025 write-up of the Artemis report (US, Singapore, Hong Kong, Japan, UK); open the Artemis PDF once to see the exact chart.
""")
title(s, "Why now: rules, money and rails are arriving")
cols = [("Rules", [("US GENIUS Act signed, 18 Jul 2025", "1"), ("MAS consulted on stablecoin law changes, Sep–Oct 2026", "2")]),
        ("Business use", [("~US$226B a year of business stablecoin payments: an estimate, ~0.01% of B2B payments", "3"), ("Singapore: a top-5 sender of stablecoin payments", "4")]),
        ("Gateways", [("Stripe: US, EU/HK in preview; not Singapore; USDC, max US$10k", "5"), ("HitPay + Triple-A: offered to 20,000+ Singapore merchants", "6")])]
cw = (W - 2 * M - 2 * 0.4) / 3
for k, (h, rows) in enumerate(cols):
    x = M + k * (cw + 0.4)
    box(s, x, 1.8, cw, 4.3)
    text(s, x + 0.35, 2.05, cw - 0.7, 0.5, h, size=22, bold=True, color=ACC2)
    text(s, x + 0.35, 2.75, cw - 0.7, 3.2, [[(t, {}), (f" {n}", {"size": 12, "color": FAINT})] for t, n in rows], size=20, spacing=16)
footer(s, "1 eco.com GENIUS tracker · 2 mas.gov.sg, Gibson Dunn · 3 McKinsey, 2026 (with Artemis) · 4 Artemis, Oct 2025 · 5 docs.stripe.com, Oct 2026 · 6 fintechnews.sg")

# ---------------------------------------------------------------- 7. Who it's for
s = new("""
SAY: Checkout pages already handle payments that go through them. Our first customer is the other lane: finance teams whose business customers send digital dollars directly, from an exchange account or a company wallet, to a fixed address. That's where short payments, wrong networks, fakes and missing references land on a person. In Singapore I'd start with crypto and Web3 companies that invoice other businesses in USDC or USDT.
LABELS: that direct payments are common for this group — [ASSUMPTION], it is exactly what the key interview question tests. 300+ Web3 companies in Singapore — [VERIFIED] Singapore EDB, "Singapore: the onchain state" (edb.gov.sg). 37 MAS-licensed digital payment token service providers — [VERIFIED] fintechnews.sg, 6 Aug 2026, citing a parliamentary reply.
""")
title(s, "First customer: teams paid directly", "Not through a checkout page, which already handles its own payments")
# two lanes
for k, (lab, steps, who, col) in enumerate([  # two lanes, from y=2.05
        ("Through a checkout page", ["Customer clicks a payment link", "Gateway matches it"], "Handled within their limits: Stripe, HitPay  [ASSUMPTION]", MUTED),
        ("Direct transfer", ["From an exchange account or company wallet", "To a fixed address, any network"], "Exceptions land on a person → Clearline  [ASSUMPTION]", ACC2)]):
    y = 2.05 + k * 2.0
    box(s, M, y, W - 2 * M, 1.8, line=(ACC if k else LINE))
    text(s, M + 0.35, y + 0.22, 3.0, 0.5, lab, size=22, bold=True, color=col)
    for j, st in enumerate(steps):
        bx = M + 3.5 + j * 3.05
        box(s, bx, y + 0.3, 2.75, 1.25, fill=INK)
        text(s, bx + 0.15, y + 0.3, 2.45, 1.25, st, size=18, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 9.7, y + 0.3, 2.45, 1.25, who, size=18, color=col, anchor=MSO_ANCHOR.MIDDLE, bold=bool(k))
text(s, M, 6.0, W - 2 * M, 0.7, [[("Start: Singapore crypto and Web3 firms that invoice other businesses in USDC/USDT", {"bold": True}), tag("A")],
                                   [("EDB counts 300+ Web3 companies¹; MAS licenses 37 token providers². How many are paid in stablecoins: unknown.", {"color": MUTED})]], size=18, spacing=2)
footer(s, "¹ Singapore EDB, “Singapore: the onchain state” (undated; counting method not stated) · ² fintechnews.sg, 6 Aug 2026 (parliamentary reply)")

# ---------------------------------------------------------------- 8. Competition
s = new("""
SAY: Every piece of this exists somewhere, and these companies do it well. Checkout tools match payments made through their own pages. Wallets warn the sender about look-alike addresses. Risk tools flag scam tokens. Accounting tools keep the books. What I haven't found is a tool built for the finance person facing a direct payment that went wrong, with the explanation and the reply ready. That's a gap I believe exists, not one I've proven.
SOURCES:
Stripe — docs.stripe.com/crypto/stablecoins (invoices, payment links, checkout; settles in local currency). Coinbase Commerce, Request Finance (hosted invoice pages; Request Finance marks invoices paid and syncs QuickBooks/Xero) — eco.com "Best B2B stablecoin invoicing tools 2026". HitPay × Triple-A — fintechnews.sg, Oct 2025.
MetaMask address-poisoning alert (2026) — KuCoin News; Trust Wallet Address Poisoning Protection (Mar 2026) — trustwallet.com; Safe{Wallet} + Blockaid (Sep 2024) — blockaid.io.
Blockaid token security (scam tokens, address poisoning) — blockaid.io/token-security. Elliptic, Chainalysis — blockchain analytics and compliance (general knowledge; not checked feature by feature).
Bitwave — matches payouts to vendors and invoices, ERP sync (bitwave.io reconciliation guide).
"Leaves to a person" column — [ASSUMPTION] from public product pages; not tested with these products.
""")
title(s, "The gap I believe exists: direct payments", "Every piece exists somewhere. What each does well, and what it leaves to a person.")
rows = [("Checkout pages", "Stripe, Coinbase Commerce, Request Finance, HitPay", "Match payments made through their page", "Payments sent straight to an address"),
        ("Wallet warnings", "MetaMask, Trust Wallet, Safe + Blockaid", "Warn the sender about look-alike addresses", "The invoice, and the receiving side"),
        ("Risk and compliance", "Blockaid, Elliptic, Chainalysis", "Flag scam tokens and risky addresses", "“Which invoice is this, and what do I reply?”"),
        ("Crypto accounting", "Bitwave, Request Finance", "Books, ERP sync, payouts", "Investigating each exception"),
        ("Clearline", "working demo, fictional data", "Explains 7 payment situations, with the reply drafted", "No customers; matching untested on real data")]
tb = s.shapes.add_table(len(rows) + 1, 3, Inches(M), Inches(2.05), Inches(W - 2 * M), Inches(4.4)).table
tb.columns[0].width = Inches(4.3); tb.columns[1].width = Inches(3.9); tb.columns[2].width = Inches(W - 2 * M - 8.2)
for j, h in enumerate(["Who", "Does well", "Leaves to a person  [ASSUMPTION]"]):
    c = tb.cell(0, j); c.fill.solid(); c.fill.fore_color.rgb = INK
    p = c.text_frame.paragraphs[0]; r = p.add_run(); r.text = h; r.font.size = Pt(16); r.font.bold = True; r.font.color.rgb = MUTED; r.font.name = FONT
for i, (cat, ex, good, gap) in enumerate(rows, start=1):
    last = i == len(rows)
    for j in range(3):
        c = tb.cell(i, j); c.fill.solid(); c.fill.fore_color.rgb = RGBColor(0x1B, 0x22, 0x33) if last else CARD
        c.margin_left = c.margin_right = Inches(0.15); c.margin_top = c.margin_bottom = Inches(0.06); c.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf = c.text_frame; tf.word_wrap = True
        if j == 0:
            p = tf.paragraphs[0]; r = p.add_run(); r.text = cat; r.font.size = Pt(18); r.font.bold = True; r.font.name = FONT; r.font.color.rgb = ACC2 if last else WHITE
            p2 = tf.add_paragraph(); r = p2.add_run(); r.text = ex; r.font.size = Pt(13); r.font.name = FONT; r.font.color.rgb = MUTED
        else:
            p = tf.paragraphs[0]; r = p.add_run(); r.text = good if j == 1 else gap; r.font.size = Pt(18); r.font.name = FONT
            r.font.color.rgb = WHITE if j == 1 else (ACC2 if last else MUTED)
footer(s, "Not yet compared: TRES Finance, Cryptio. Elliptic and Chainalysis described from general knowledge. Sources: docs.stripe.com · eco.com · fintechnews.sg · KuCoin News · trustwallet.com · blockaid.io · bitwave.io")

# ---------------------------------------------------------------- 9. Insight
s = new("""
SAY: Here's what I believe, and I want to be clear these are beliefs, not findings. First, many business customers pay from exchange accounts or company wallets rather than checkout pages. Second, the cost isn't the payments, it's the exceptions: each one is a small investigation. Third, gateways and custodians would rather plug in exception handling than build it. If the first belief is wrong, the plan changes, and slide 12 says how.
LABELS: all three [ASSUMPTION]/[GUESS]. The "15–30 minutes per exception" is a [GUESS]: the demo's own "time saved" figure (20 min per explained exception) is a demo estimate, not a measurement. The three earlier calls (custodian and compliance-software teams) said reconciliation was "not really an issue" for them — that cuts against belief 2 for vendors; buyers (finance teams receiving payments) are untested.
""")
title(s, "What I believe that others may not")
beliefs = [("1", "Business customers often pay from exchange accounts and company wallets, not checkout pages.", "A"),
           ("2", "The cost is in the exceptions: each one is a 15–30 minute investigation.", "G"),
           ("3", "Gateways would rather plug in exception handling than build it.", "A")]
for k, (n, b, kind) in enumerate(beliefs):
    y = 1.75 + k * 1.65
    box(s, M, y, W - 2 * M, 1.4)
    text(s, M + 0.3, y, 0.9, 1.4, n, size=40, bold=True, color=ACC, anchor=MSO_ANCHOR.MIDDLE)
    text(s, M + 1.25, y, W - 2 * M - 1.6, 1.4, [[(b, {}), tag(kind)]], size=24, anchor=MSO_ANCHOR.MIDDLE)
footer(s, "None of these is tested yet. Three early calls with vendor teams, on an earlier idea, found reconciliation “not really an issue” for them; buyer teams are untested.")

# ---------------------------------------------------------------- 10. Business model
s = new("""
SAY: The founding pilot price is set: US$300 for 30 days, then US$200 a month, for the first 10 businesses. Beyond the pilot I haven't tested pricing, so these are two hypotheses. Direct: a monthly subscription per finance team, priced by payment volume. Embedded: a gateway or custodian pays per exception Clearline handles for its merchants. The interviews will tell me which one people would actually pay for: I'll ask what an exception costs them today in staff time.
LABELS: both models and all prices [ASSUMPTION]/[GUESS], untested.
""")
title(s, "Business model: two hypotheses, both untested")
cards = [("Direct", "Monthly subscription per finance team, priced by payment volume", "S$300–800 / month", "A"),
         ("Embedded", "A gateway or custodian pays per exception handled for its merchants", "S$1–3 / exception", "G")]
cw = (W - 2 * M - 0.5) / 2
for k, (h, d, price, kind) in enumerate(cards):
    x = M + k * (cw + 0.5)
    box(s, x, 1.75, cw, 4.1)
    text(s, x + 0.4, 2.05, cw - 0.8, 0.6, h, size=28, bold=True, color=ACC2)
    text(s, x + 0.4, 2.85, cw - 0.8, 1.2, d, size=22)
    text(s, x + 0.4, 4.5, cw - 0.8, 0.9, [[(price, {"size": 36, "bold": True}), tag(kind)]], size=36)
text(s, M, 6.15, W - 2 * M, 0.6, "Test: ask 10 teams what one exception costs them today, in staff time.", size=20, color=MUTED)
footer(s, "Prices are placeholders for interviews, not quotes.")

# ---------------------------------------------------------------- 11. Market
s = new("""
SAY: Bottom-up, and deliberately small. Singapore has over 300 Web3 companies. If about half are paid directly in stablecoins, and a team pays about 6,000 Singapore dollars a year, that's under a million dollars a year. That's a test market, not the business. The bigger prize is the region and India, and the embedded route through gateways, and I'll size those once the interviews tell me how many exceptions a team really has.
LABELS / SOURCES: 300+ Web3 companies in Singapore — [VERIFIED] Singapore EDB, "Singapore: the onchain state" (edb.gov.sg). "About half paid directly" — [GUESS]. S$6,000/year — [ASSUMPTION] (S$500/month, the middle of the untested range on slide 10). 300 × 50% × S$6,000 = S$900,000 / year. No top-down TAM is claimed.
""")
title(s, "Market: start small and countable")
chain = [("300+", "Web3 companies in Singapore¹", "V"), ("× ~50%", "invoice businesses that pay them directly in stablecoins", "G"), ("× S$6k", "a year per finance team", "A"), ("S$0.9M", "a year if every one bought: a ceiling for a test market", "A")]
cw = (W - 2 * M - 3 * 0.3) / 4
for k, (big, small, kind) in enumerate(chain):
    x = M + k * (cw + 0.3)
    box(s, x, 1.9, cw, 2.9, line=(ACC if k == 3 else LINE))
    text(s, x + 0.3, 2.15, cw - 0.6, 1.0, big, size=36, bold=True, color=ACC2 if k == 3 else WHITE)
    text(s, x + 0.3, 3.15, cw - 0.6, 1.5, [[(small, {}), tag(kind)]], size=18, color=MUTED)
text(s, M, 5.25, W - 2 * M, 1.2, [[("Next, sized only after interviews: ", {"bold": True}), ("Southeast Asia and India, and gateways' merchants through the embedded model.", {})]], size=20, color=MUTED)
footer(s, "¹ Singapore EDB, “Singapore: the onchain state”, edb.gov.sg. The other three figures are estimates; no top-down market size is claimed.")

# ---------------------------------------------------------------- 12. Traction & validation
s = new("""
SAY: Honestly: a working product, no customers yet. The demo runs seven real-world payment situations end to end. On the investigation side, it gave the correct verdict on 52 of 52 new real transactions, after being tuned on 59 others; but the explanations and the payment matching haven't been tested on real data, and the company records were sample data. My three early calls were with custodian and compliance-software teams about an earlier idea, and they said reconciliation wasn't really an issue for them. So the next step is ten conversations with the actual buyers, and one question decides the direction.
SOURCES / LABELS: 7 payment cases — [VERIFIED] demo/REQUESTS_DEMO.md. Correct verdicts: 43/59 before fixes, 59/59 after, 52/52 on held-out cases collected afterwards (deposit-investigation part; 6 networks + Bitcoin IDs) — [VERIFIED] demo/REPORT.md, 24–25 Oct 2026; matching side and AI explanations NOT tested on real data. 3 early calls (custodian and compliance-software teams, 16 Oct 2026) — [VERIFIED from the founder's notes; names withheld]. 0 customers, 0 paid pilots — [VERIFIED].
""")
title(s, "Traction: a working product, no customers yet")
stats = [("7", "payment situations\nrun end to end in the demo"), ("52 / 52", "new real transactions given\nthe correct verdict¹"), ("3", "early calls, all with\nvendor teams²"), ("0", "customers or\npaid pilots")]
cw = (W - 2 * M - 3 * 0.3) / 4
for k, (big, small) in enumerate(stats):
    x = M + k * (cw + 0.3)
    text(s, x, 1.7, cw, 0.9, big, size=40, bold=True, color=WHITE if k < 3 else ACC2)
    text(s, x, 2.6, cw, 0.9, small, size=16, color=MUTED)
box(s, M, 3.85, W - 2 * M, 2.45, line=ACC)
text(s, M + 0.4, 4.05, W - 2 * M - 0.8, 0.5, "Next: 10 finance teams that receive stablecoins, one question", size=18, color=MUTED)
text(s, M + 0.4, 4.5, W - 2 * M - 0.8, 0.7, "“Do customers pay through a checkout page, or send directly?”", size=26, bold=True)
text(s, M + 0.4, 5.45, W - 2 * M - 0.8, 0.8, [[("Mostly directly → ", {"bold": True, "color": WHITE}), ("sell to finance teams.   ", {}), ("Mostly checkout → ", {"bold": True, "color": WHITE}), ("become a plug-in for gateways.", {})]], size=20, color=MUTED)
footer(s, "¹ demo/REPORT.md: held-out cases (59/59 on tuning cases). Explanations and matching not yet tested on real data; company records were sample data. ² Custodian and compliance-software teams, 16 Oct 2026, earlier idea.")

# ---------------------------------------------------------------- 13. Team
s = new("""
SAY: It's just me for now. I'm a second-year accountancy student at SMU, which is why the finance person's side of this matters to me. I taught myself to code through Harvard's CS50 and built this product myself, using AI coding tools. I've done business development as a student analyst at Protégé Ventures and in partner outreach at Hatch, and I'm in SMU's BIG incubator. What I lack is payments operations experience, which is part of why I'm asking for your help.
LABELS: background as stated by the founder — please check each line before presenting.
""")
title(s, "Team")
box(s, M, 1.75, 1.5, 1.5, fill=CARD, line=ACC, radius=0.5)
text(s, M, 1.75, 1.5, 1.5, "AK", size=40, bold=True, color=ACC2, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
text(s, M + 1.85, 1.8, 8, 0.6, "Aashmiin Kaur", size=32, bold=True)
text(s, M + 1.85, 2.5, 9, 0.5, "Founder · builds the product and talks to customers", size=20, color=MUTED)
facts = ["Year 2, Bachelor of Accountancy, Singapore Management University", "Self-taught coder (Harvard CS50); built Clearline's working product myself, with AI coding tools",
         "Business development: student analyst, Protégé Ventures; partner outreach, Hatch", "SMU BIG incubator"]
text(s, M + 1.85, 3.45, W - 2 * M - 1.85, 2.5, facts, size=20, spacing=12)
text(s, M + 1.85, 6.05, W - 2 * M - 1.85, 0.6, "Missing: payments operations experience. That's what I'm asking mentors for.", size=20, color=ACC2)
footer(s, "Founder's own background.")

# ---------------------------------------------------------------- 14. The ask
s = new("""
SAY: Three things would help most. Your honest view of the wedge: am I right that direct payments and their exceptions are underserved, or am I missing something? Introductions to three to five finance teams that receive stablecoin payments, for a 20-minute conversation, not a sales pitch. And your advice on whether and how to approach gateways or custodians as partners. Thank you.
LABELS: no factual claims.
""")
title(s, "What I'd value from you")
asks = [("Honest feedback on the wedge", "Are direct payments and their exceptions really underserved?"),
        ("3–5 introductions", "Finance teams that receive stablecoin payments, for a 20-minute conversation"),
        ("Advice on gateways", "Whether and how to partner with gateways or custodians")]
for k, (h1, h2) in enumerate(asks):
    y = 1.7 + k * 1.35
    text(s, M, y, 0.8, 1.1, str(k + 1), size=40, bold=True, color=ACC)
    text(s, M + 0.85, y + 0.05, 10.5, 0.5, h1, size=26, bold=True)
    text(s, M + 0.85, y + 0.6, 10.5, 0.5, h2, size=20, color=MUTED)
box(s, M, 5.85, W - 2 * M, 0.85, fill=CARD, line=LINE)
text(s, M + 0.35, 5.85, W - 2 * M - 0.7, 0.85, [[("Aashmiin Kaur   ", {"bold": True}), ("aashmiin@gmail.com   ·   linkedin.com/in/aashmiin-kaur-479665391", {"color": MUTED})]], size=20, anchor=MSO_ANCHOR.MIDDLE)

# ---------------------------------------------------------------- Appendix A1. Risks
s = new("""
SAY (only if asked): These are the risks I see, and what I'd do about each.
LABELS: mitigations are plans, [ASSUMPTION]. Licensing note is not legal advice: Clearline reads payment data and drafts messages; it never holds, moves or exchanges money, which is why I believe it sits outside a payment-services licence, but that needs confirming with a Singapore lawyer.
""")
title(s, "Appendix · Risks and open questions")
risks = [("Checkout tools absorb the problem", "Interview test on slide 12; if so, become a plug-in for gateways"),
         ("Licensing", "Read-only: never holds or moves money. Confirm with a Singapore lawyer"),
         ("Data access", "Start with public blockchain data plus an invoice export; integrations later"),
         ("A wrong match", "Never matches on a guess; a person confirms with a note"),
         ("Solo founder", "Find a co-founder with payments operations experience")]
for k, (r, m) in enumerate(risks):
    y = 1.6 + k * 0.98
    box(s, M, y, W - 2 * M, 0.82)
    text(s, M + 0.3, y, 4.2, 0.82, r, size=20, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    lab = ("  [VERIFIED in the demo; untested on real data]", {"size": 12, "color": MUTED}) if r == "A wrong match" else tag("A")
    text(s, M + 4.6, y, W - 2 * M - 4.9, 0.82, [[(m, {}), lab]], size=18, color=MUTED, anchor=MSO_ANCHOR.MIDDLE)

QA = {}   # filled by the honesty check (appendix A2, A3)
try:
    import json
    QA = json.load(open(pathlib.Path(__file__).resolve().parent / "hard_questions.json"))
except FileNotFoundError:
    pass
for key, ttl in [("yc", "Appendix · Hard questions: a YC partner"), ("expert", "Appendix · Hard questions: a payments expert")]:
    if key not in QA: continue
    s = new("These are the hardest questions from the honesty check, with the short answer to give. Full answers:\n\n" +
            "\n\n".join(f"Q: {q['q']}\nA: {q['full']}" for q in QA[key]))
    title(s, ttl)
    for k, q in enumerate(QA[key]):
        y = 1.5 + k * 1.08
        text(s, M, y, W - 2 * M, 1.0, [[(q["q"], {"bold": True, "size": 18})], [(q["short"], {"size": 18, "color": MUTED})]], size=18)

prs.save(OUT)
print("saved", OUT, len(prs.slides._sldIdLst), "slides")
