# T4. Traction slide "his way": recommendation + slide spec + a11y check of slides 2 and 8

lead-designer · 31 Oct 2026 (SGT) · deck `origin/pitch-deck` @ `ad15acb`, `pitch/src/build_deck10.py`
**PAUSE (G19):** not checked (live tools off). Nothing sent; the deck goes to the angels only from you.

## Reply to Aashmiin

> Doug is right about one thing: slide 8 opens with what you *don't* have, so it reads like an
> apology. I'd fix that by **reordering, not inflating**: lead with the strongest true number large
> (52 / 52), keep "0 customers" on the slide at the same size as the other facts, and end on the one
> question your next ten interviews answer. I built it (pictures below).
>
> What I'd not do, and why, in one line each:
> - **"Pilots underway"**: false today: 0 customers, 0 paid pilots (PRODUCT_FACTS; slide notes).
>   Angels check this in the first follow-up call; it's the claim that costs you the round.
> - **"100% accuracy"**: the real result is 52 of 52 on the *investigation checks*, on held-out cases
>   in our own test; matching and explanations aren't tested on real data (`demo/REPORT.md`, slide 8
>   footnote). "100% accuracy" claims the whole product.
> - **Logos of the three teams**: they were vendor calls about an earlier idea, names withheld, no
>   permission to show them, and they told you reconciliation wasn't their problem. Logos would
>   imply customers or partners.
> - **Footnotes to 8 pt or cut**: our floor is 10 pt so they read in a PDF on a phone; I shortened
>   the text instead. Investors who read footnotes are the ones who'd catch "100%".
> - **Bright green on white, Poppins**: the deck is built dark, Arial, periwinkle accent on purpose
>   (`deck_style.py:12-16`); green is kept for "verified" states. Typical "bright green" `#22c55e`
>   with white text is **2.28:1**, unreadable on a projector. One slide in another style would look
>   pasted in.
> - **Slide 2's "Illustrative · fictional demo company"**: please keep it. Without it, the INV-1043
>   quote reads as a real customer quote, which we don't have. It *is* too faint, though: it fails
>   contrast (4.26:1), so I made it readable rather than smaller.
>
> Needs your OK: the new headline wording, and whether you want this version for Monday. I haven't
> touched the shared deck files; it's a PR.

## The slide I'd build (slide 8, built in scratch)

Grid from `deck_style.py`: 13.333 × 7.5 in, margin 0.6 in, ink background, Arial.

| Element | Position (in) | Copy | Type | Colour (deck token) |
|---|---|---|---|---|
| Headline | y 0.5 | "The checks work. Next, the first ten buyers." | 36pt bold | WHITE `#f2f4f7` on INK 17.53:1 |
| Hero number | x 0.6, y 1.75 | "52 / 52" | 72pt bold | ACC `#8ea2ff` on INK 8.06:1 |
| Its label | y 3.0 | "real transactions given the right verdict¹" | 20pt | MUTED `#a3aab6` on INK 8.26:1 |
| Fact rows (3) | x 6.6, y 1.8 / 2.52 / 3.24 | "7 · payment situations run in the demo"; "3 · early calls, vendor teams, earlier idea²"; "0 · customers or paid pilots today" | number 32pt bold WHITE, label 18pt MUTED | as above |
| Next card | y 4.3, full width, 1.75 high | "Next: 10 finance-team interviews, one question" / "“Do customers pay through a checkout page, or send directly?”" | 20pt MUTED / 28pt bold WHITE | CARD `#151a24` fill, ACC 1pt line; WHITE on CARD 15.81:1, MUTED on CARD 7.45:1 |
| Footer | H − 0.62 | "¹ Investigation checks on held-out cases (demo/REPORT.md); matching and explanations not yet tested on real data. ² Custodian and compliance-software teams, 16 Oct 2026." | 10pt | FAINT `#767e8c` on INK 4.72:1 |

~38 words on the slide (was ~45). Speaker notes unchanged (SAY already opens "Honestly: a working
product, no customers yet"; LABELS and sources stay). Every number is from the existing notes:
7 [VERIFIED demo/REQUESTS_DEMO.md], 52/52 [VERIFIED demo/REPORT.md], 3 calls [VERIFIED founder's
notes], 0 [VERIFIED]. No marker key needed (no ◦/† on the slide), same as today.

Rendered with python-pptx 1.0.2 → LibreOffice headless PDF → `pdftoppm`: `t-4/before-slide-08.png`,
`t-4/after-slide-08.png`, contact sheet of all 12 rebuilt slides `t-4/after-contact-sheet.png`
(others unchanged). Diff: `t-4/proposed.diff` (slide 8 body + one colour on slide 2).

## Accessibility check of the slides the request mentions

| ID | Sev | Slide / where | Finding | Ratio | Fix |
|---|---|---|---|---|---|
| D1 | Low (= A7; 1.4.3 if the PDF is shared) | Slide 2, `build_deck10.py:49` "Illustrative · fictional demo company", 14pt FAINT on CARD | FAINT `#767e8c` on CARD `#151a24` | **4.26:1** (needs 4.5; 14pt regular is not large text) | MUTED → **7.45:1**. One token swap, applied in the diff (`t-4/after-slide-02.png`) |
| D2 | Pass | Slide 8 footer, 10pt FAINT on INK | `#767e8c` on `#0b0e14` | 4.72:1 | keep; 8pt (Doug's ask) would break our 10pt floor |
| D3 | Pass | Slide 8 stats MUTED on INK, "0" in ACC2 | 8.26:1; ACC2 11.58:1 | — | — |
| D4 | Advisory | Slides 2 and 8 cards | LibreOffice render shows a faint drop shadow under cards although `box()` sets `shadow.inherit = False` | by eye | check in PowerPoint/Keynote before Monday; renderer difference, not changed |
| D5 | Advisory | Slide 8 before: footnote markers ¹ ² were 12pt next to 18pt labels | by eye | — | after: inline ¹ at label size |

**WOULD OPEN PR:** `design/deck10-traction-20261031` off `origin/pitch-deck` → `pitch-deck`. Title
"Deck 10: traction slide leads with 52/52; slide 2 caption readable". Body: Doug's six asks and the
answer to each, before/after slides 2 and 8, contact sheet, ratio table, "Sending the deck is
Aashmiin's." Rebuild `Clearline_Pitch_Deck_10.pptx/.pdf`, `slides10/` and the contact sheet via
`pitch/README.md` in the PR (I rebuilt only in scratch). Log row drafted.

## Checklist
G1-G5 pass (refused logos, "pilots underway", "100%"; kept the illustrative label). G6 pass after
(D1 fixed). G10 pass (no colour-only meaning). G14-G16 pass (deck tokens, Arial, existing helpers).
G17 before/after attached. G18 PR plan only. G19 not checked. Deck extras: one idea, sentence
headline, body ≥ 18pt, sources 10pt, contact sheet viewed.
**Could not check:** the projector at 50% brightness; PowerPoint/Keynote rendering (LibreOffice only).
