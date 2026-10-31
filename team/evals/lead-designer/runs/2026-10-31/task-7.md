# Task 7: Payment-flow diagram (white-paper light + deck dark)

PAUSE: off (per tasks.md). Hand-written SVG from one generator so both versions share geometry.
Files in `runs/2026-10-31/task-7/`: `payment-flow-light.svg`, `payment-flow-dark.svg`, PNGs at 1x and 2x
(`payment-flow-{light,dark}@{1x,2x}.png`, Playwright screenshots of the SVGs), `payment-flow-light-phone-390.png`
(the SVG as an `<img>` at 390 px), `build_diagrams.py` (generator).

## What it shows (the real mechanism, from the brief's true facts and SPEC)
1 Customer pays (USDC or USDT, on-chain) -> 2 Reads the transfer (public chain, no wallet keys) -> 3 Checks it's
genuine (token contract, network, address, confirmations) -> 4 Matches to its invoice. Then two paths:
**checks pass, matched** (solid accent) straight to **5 A person approves**; **something is wrong** (dashed, own
colour, labelled) from steps 3 and 4 to **Explains what's wrong** (plain English + a draft reply), then also to
step 5. Only after approval: **6 Posted in Xero** (to the invoice; "QuickBooks next (not built)"). Steps 2-4 and
the explanation sit inside a "Clearline · read-only, never holds funds" boundary; the person and Xero are outside it.
Margin note: "NetSuite: designed, not built". 7 nodes, nothing claimed that isn't built.

## Accessibility check (`contrast.mjs`, every pair used)

**Light (paper style).** Text: ink `#0a0c11` on white 19.56, on `#f4f5f8` 17.94, on `#f7f8ff` 18.47 · secondary
`#5b6272` on white 6.11, on `#f4f5f8` 5.61, on `#f7f8ff` 5.77, on `#eaf7f0` 5.55 · green `#2f7d5b` on `#eaf7f0`
4.53 (title "6 Posted in Xero", 15px) . All ≥ 4.5:1. PASS.
Lines/arrows that carry meaning: accent `#6e7df0` on white 3.59, on `#f7f8ff` 3.39 · amber `#a8670f` on white 4.55,
on `#f7f8ff` 4.30 · approval border `#0a0c11` 19.56 · green border 4.99. All ≥ 3:1. PASS.
Decorative only: `#a3abba` border on "Customer pays" 2.31:1 (the box is identified by its text and fill; R2 exempt).

**Caught and fixed while building:** the paper style puts accent `#6e7df0` on labels (e.g. the boundary title in
`architecture.svg`). As text that's **3.39:1 on `#f7f8ff`** and 3.59 on white (fails 4.5, same as A6), and amber
text `#a8670f` on `#f7f8ff` is **4.30:1**. So in the light version path labels and the boundary title use `#5b6272`
(5.77:1) and colour stays on the lines. Worth the same fix in `architecture.svg` (flag for §4 / A6).

**Dark (deck tokens: INK, CARD, LINE, WHITE, MUTED, ACC, ACC2, RED; Arial).** WHITE on CARD 15.81 · MUTED on CARD
7.45, on INK 8.26 · ACC `#8ea2ff` text/lines on CARD 7.27, on INK 8.06 · RED `#ff8a7f` (problem path, deck's
"warnings only" colour) on CARD 7.63, on INK 8.46 · ACC2 on CARD 10.44. PASS. LINE on INK 1.48 / CARD on INK 1.11
are decorative (box text identifies them).

**Colour not alone:** the problem path is a different colour **and** dashed **and** labelled "something is wrong";
legend repeats both line styles in words; the approval box has a 2 px dark border and the word "approve" on the arrow.

**Alt text / SVG:** each SVG has `role="img"`, `<title>` "How one stablecoin payment flows through Clearline" and
a `<desc>` stating the takeaway. Alt for the `<img>`:
"Clearline reads a stablecoin payment read-only, checks it's genuine and matches it to the invoice; if something's
wrong it explains why and drafts a reply. Nothing is posted to Xero until a person approves."

**Looked at:** both PNGs at 1x and 2x: no crossings between the two paths, no text past a box edge (two layout
passes fixed a label crossing the boundary and an overflowing line).

**Fails / not done (honest):**
- **Phone:** at 390 px the 900 px diagram scales to 358 px (×0.40), so 13 px secondary text renders ≈5 px:
  unreadable. For the website it needs a stacked, top-to-bottom phone variant (or `<picture>` swap below 640 px).
  Paper (A4) and deck (16:9) are fine. Not built in this run.
- Colours `#a8670f` (amber) are the paper's `aamber` from `style.tex`, not in the brief's diagram list; no new hex
  was invented, but it's a new use of that token for diagrams (record in `deck-and-paper-layouts.md` §3 in the PR).
- Not rendered inside the actual paper PDF (XeLaTeX) or a deck slide; checked as standalone images only.

**Verdict:** both versions pass the contrast, colour-not-alone and alt-text checks for paper and deck use; the
website use does not pass yet (phone legibility).

**WOULD OPEN PR:** `design/payment-flow-diagram-20261031` -> `whitepaper` (light SVG into `whitepaper/diagrams/`,
caption: "One payment, end to end: nothing is posted until a person approves.") and a second PR -> `pitch-deck`
for the dark PNG @2x. Publishing the paper or sending the deck is Aashmiin's call.

## Log row (would write)
`2026-10-31 <hh:mm> SGT | lead-designer | diagram | payment-flow light+dark, task-7/ | 7 nodes; text ≥ 4.53:1, lines ≥ 3.39:1; problem path dashed+labelled; title/desc/alt; phone variant still needed for website; paper accent-as-text fails 4.5 (fixed here, flag architecture.svg).`
