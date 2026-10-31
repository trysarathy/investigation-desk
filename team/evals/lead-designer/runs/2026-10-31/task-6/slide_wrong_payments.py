"""Mentor brief: one new slide, 'Why the wrong payments are the hard part'.
Paste the block between the ---- markers into pitch/src/build_brief.py (after slide 2), or run this file
on its own for a one-slide preview:  python3 slide_wrong_payments.py <out.pptx>
Uses only deck_style helpers/tokens: INK CARD LINE WHITE MUTED FAINT ACC2; Arial; icons from assets/icons."""
import sys, pathlib
sys.path.insert(0, sys.argv[2] if len(sys.argv) > 2 else str(pathlib.Path(__file__).resolve().parent))
from deck_style import *

KEY = "◦ estimate or assumption   † untested   unmarked = sourced"
mk = lambda m: (m, {"color": ACC2, "bold": True, "size": 26})
def head(s, runs):
    n = sum(len(t) for t, _ in runs)
    text(s, M, 0.5, W - 2 * M, 0.9, [runs], size=36 if n <= 46 else 32, bold=True, name="Title")
def foot(s, sources):
    text(s, M, H - 0.62, W - 2 * M, 0.5, [[(sources, {})], [(KEY, {"color": MUTED})]], size=10, color=FAINT, name="Sources")

# ---- slide: Why the wrong payments are the hard part ------------------------------------------
s = new("""
SAY: Most stablecoin payments arrive fine. The work is in the few that don't: paid short, sent on the wrong network, a counterfeit token, or no invoice reference. That's where I've focused. In my own test, the checks gave the right answer on 52 of 52 real public transfers I hadn't used while building the rules. I don't yet know how long these take a finance team; my guess is 15 to 30 minutes each, and that's one of the first things I want to check with you and with finance teams.
LABELS:
- "Most arrive fine. The work is in the ones that don't" [ASSUMPTION]: our own view, not measured. Marked ◦ on the subtitle.
- Four problem types (short, wrong network, counterfeit token, no reference): the same four as slide 2 of this brief (build_brief.py, opened 31 Oct 2026). "No reference": an ERC-20 transfer records sender, receiver and amount only (eips.ethereum.org/EIPS/eip-20, cited on slide 2; not reopened this run, so [ASSUMPTION] until re-checked).
- "52 of 52" [VERIFIED]: website/src/components/Sections.tsx lines 66-71 on pitch-deck: real public USDC/USDT transfers not used while building the rules; right answers confirmed on block explorers. Our own small test, not a customer result. Covers the checks (real token, right network, right address), not automatic matching, which hasn't been tested on real data.
- "15-30 minutes per problem payment" [GUESS]: docs/SPEC.md section 1, not measured. Marked † on the slide.
""")
head(s, [("The wrong payments are the hard part", {})])
text(s, M, 1.38, W - 2 * M, 0.5, [[("Most arrive fine. The work is in the ones that don't", {}), ("◦", {"color": ACC2, "bold": True})]], size=20, color=MUTED, name="Subtitle")
items = [("short", "Paid short"), ("road", "Wrong network"), ("fake", "Counterfeit token"), ("nolabel", "No reference")]
gap = 0.35; cw = (W - 2 * M - 3 * gap) / 4
for k, (ic, lab) in enumerate(items):
    x = M + k * (cw + gap)
    box(s, x, 2.1, cw, 2.05)
    img(s, A / f"icons/{ic}.png", x + (cw - 1.1) / 2, 2.25, w=1.1)
    text(s, x + 0.15, 3.45, cw - 0.3, 0.55, lab, size=20, bold=True, align=PP_ALIGN.CENTER)
half = (W - 2 * M - gap) / 2
box(s, M, 4.45, half, 1.8)
text(s, M + 0.35, 4.6, half - 0.7, 0.7, "52 of 52", size=40, bold=True)
text(s, M + 0.35, 5.35, half - 0.7, 0.85, "real public transfers checked right. Our own test, not a customer result", size=18, color=MUTED)
box(s, M + half + gap, 4.45, half, 1.8)
text(s, M + half + gap + 0.35, 4.6, half - 0.7, 0.7, [[("15–30 min", {}), ("†", {"color": ACC2})]], size=40, bold=True)
text(s, M + half + gap + 0.35, 5.35, half - 0.7, 0.85, "per problem payment. Our guess, not measured", size=18, color=MUTED)
foot(s, "52 of 52: own test of real public USDC/USDT transfers not used to build the rules (clearline website, Trust section). 15–30 min: untested guess (Clearline spec §1).")
# ---- end slide ------------------------------------------------------------------------------------

if __name__ == "__main__":
    prs.save(sys.argv[1] if len(sys.argv) > 1 else "slide.pptx")
