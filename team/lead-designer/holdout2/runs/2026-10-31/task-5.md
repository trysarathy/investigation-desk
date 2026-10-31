# Task 5: one Clearline look for the mentor pack (deck + white paper)

lead-designer → Aashmiin (via chief-of-staff) · Sat 1 Nov 2026 · PAUSE: could not check (live tools off). Nothing sent to Prof Griffin.

## Verdict: deck aligned, paper fix held back, nothing sent

- **Deck (done, PR prepared):** its colours are now the website's tokens. The 10-pt source lines get brighter (FAINT 4.72 → 6.32:1), and A7 is fixed. I rendered all 12 slides and read the contact sheet.
- **White paper (prepared, held):** the fix is small: link colour plus honesty tags that match the deck. But this container has no `xelatex`, so I can't build the PDF, and the playbook says not to change what I can't render. It needs one build on a machine with the toolchain (devops-engineer, or your Mac: `python3 whitepaper/build.py`). Then I check the pages and open the PR.
- **Sending to Prof Griffin is yours** (company rules 6–7: mentors, nothing overnight). A draft cover note is below, for the 07:30 queue. Recommendation: send the **PDF** of the deck as well as the .pptx. Arial vs Inter and projector colour vary by machine; a PDF doesn't.
- **Bright room: a dark deck will wash out whatever we do to it.** On my simple projection model [ASSUMPTION: ambient light = 15% of projector white], body text stays readable (4.75:1). MUTED drops to 2.7:1, the 10-pt sources to about 2:1, and card fills disappear. Options: (a) keep the dark deck; he reads sources in the PDF and you say the key numbers aloud; (b) a light "projection" export. Option (b) breaks the two-look system (website/deck dark, product/paper light), so that's your decision, not mine. I recommend (a) for 6 Nov.

## The brand sheet (one page)

**Two looks, one family.** Dark brand on the website and deck. Calm light instrument in the product and paper. Same accent family, same honesty system.

| Role | Website / deck (dark) | Paper (print, white) | Product (light) |
|---|---|---|---|
| Background | ink `#0a0c11` | white | canvas `#f7f7f5` / panel `#fff` |
| Card | panel `#11141b` (site) / CARD `#151a24` (deck) | status box `#f4f5ff` | panel-2 `#fafaf9` |
| Text | fg `#eceef4` 16.86:1 | ink `#0a0c11` 19.56:1 | `#17181c` 16.54:1 |
| Secondary | muted `#a3abba` 8.47:1 | muted `#5b6272` 6.11:1 | `#5b5e66` 6.49:1 |
| Small print / sources | faint `#8a93a3` 6.32:1 (5.63 on CARD) | muted `#5b6272` | text-3 `#6a6d72` ≥4.54:1 (task 1) |
| Accent (graphics, rules) | `#8ea2ff` 8.16:1 | `#6e7df0` (rules and bars only; 3.59:1, not for text) | `#3b5bdb` |
| Links | `#8ea2ff` | **`#3b5bdb` 5.67:1** (proposed; now `#6e7df0` 3.59:1, A6) | `#3b5bdb` |

**Type.** Inter everywhere except the .pptx, which uses Arial for portability (your earlier decision; brand-system §8). Headlines are full-sentence takeaways in sentence case. Minimums: deck body 18 pt and sources 10 pt; paper body 10 pt and captions small; site body 15.5–17 px.

**Honesty labels and footnotes (one system, three classes):**

| Class | Deck (on slide) | Paper, review copy | Paper, clean copy | Website |
|---|---|---|---|---|
| Sourced | unmarked + superscript ¹ → footer source | `[VERIFIED]` green + footnote | footnote | "Source:" line under the figure |
| Estimate / assumption | **◦** | `[◦ ASSUMPTION]` amber (proposed: add the glyph) | text says "estimate" | "estimate" in the label |
| Untested guess | **†** | `[† GUESS]` red (proposed) | text says "guess" / cut | not shown |

Rules: never colour alone (glyph + word + colour, so a B&W printout still reads); the key is in every deck footer and in the paper's review-copy note; footnotes are muted and ragged-right; no claim is louder than its label.

---

## Appendix A. WOULD OPEN PR — deck (ready)
- Branch `design/deck-one-look-20261101` off `origin/pitch-deck` @ `ad15acb` → base `pitch-deck`.
- Title: `deck: use the website's ink/fg/muted/faint tokens (one Clearline look; fixes A7)`.
- Diff `t-5/deck-style-tokens.diff`, `pitch/src/deck_style.py:13-17`: INK `#0b0e14→#0a0c11`, WHITE `#f2f4f7→#eceef4`, MUTED `#a3aab6→#a3abba`, FAINT `#767e8c→#8a93a3`. CARD/LINE/ACC/ACC2/RED unchanged. **This also changes** `build_deck.py` (17-slide) and the mentor briefs (`build_brief*.py`), because they import the same palette. Intended, but listed so nobody is surprised.
- Ratios [VERIFIED: measured 2026-11-01, contrast.mjs]: fg on ink 16.86, fg on CARD 15.02, muted on ink 8.47, muted on CARD 7.54, faint on ink 6.32, faint on CARD 5.63 (was 4.26, A7), ACC on ink 8.16, ACC2 on ink 11.72, RED on ink 8.56.
- Evidence: `t-5/deck10-contact-before.png` and `-after.png` (all 12 slides, LibreOffice render), `slide8-before/after.png` at 100%. Also update `brand-system.md` §4, `tokens.dtcg.json` deck block and `contrast.mjs` K values in the same PR.
- **Found while looking (not in this PR):** slide 6's comparison table renders with white cells and black text (the default table style), which is off-system on a dark deck. Next deck PR.

## Appendix B. PREPARED, NOT OPENED — white paper (needs a render)
Base `origin/whitepaper` @ `827a0ec`, branch `design/paper-one-look-20261101`:
```diff
@@ whitepaper/style.tex
 \definecolor{accent}{HTML}{6E7DF0}
+\definecolor{link}{HTML}{3B5BDB}  % product accent; 5.67:1 on white (A6). accent stays for rules/bars (graphics)
@@ whitepaper/build.py:87
-         "-V", "linkcolor=accent", "-V", "urlcolor=accent"])
+         "-V", "linkcolor=link", "-V", "urlcolor=link"])
@@ whitepaper/build.py:67 and :73 (review copy only)
-        return " [ASSUMPTION]{.atag}" if kind == "A" else " [GUESS]{.gtag}"
+        return " [◦ ASSUMPTION]{.atag}" if kind == "A" else " [† GUESS]{.gtag}"
   (and the same two words in the review-copy note)
```
Before opening: build both copies, confirm Inter has ◦ and † (or set them in DejaVu), read every page with a tag or link (Read tool, `pages`), print one page in greyscale, and check that tags still read as words and links as underlined/coloured text. Tag ratios already pass: vgreen 4.99, aamber 4.55, gred 5.93 on white.

**Couldn't check tonight:** the printed paper (no xelatex, no printer); a real projector; how the .pptx looks in PowerPoint/Keynote (only LibreOffice).

## Appendix C. Bright-room model (`t-5/projection-model.md`, [ASSUMPTION: simple flare model, not a measurement of his room])
WHITE on INK 17.53 → 4.75:1 · MUTED on INK 8.26 → 2.65:1 · FAINT now 4.72 → 1.84:1 · faint proposed 6.32 → 2.19:1 · CARD vs INK 1.11 → 1.02:1.

## Appendix D. Draft for the 07:30 queue (Aashmiin sends, not me)
> Subject: Clearline deck and white paper for 6 Nov
> Dear Prof Griffin, ahead of our call on 6 November, attached are the 10-slide deck (PDF and PowerPoint) and the review copy of the white paper. In the paper, every claim carries a label: [VERIFIED] with its source, [◦ ASSUMPTION], or [† GUESS]; the deck uses the same ◦ and † marks. Clearline is a working demo with no customers yet; I'd value your view on [her question]. Best, Aashmiin

Attach only after the paper PR is rendered and merged by her.

## Appendix E. Log rows (drafted)
- `… | lead-designer | PR prepared | design/deck-one-look-20261101 → pitch-deck | website tokens in deck; A7 fixed; contact sheets t-5/`
- `… | lead-designer | RISK: | whitepaper one-look | xelatex not available; paper change prepared but not rendered or opened; needs devops-engineer build`
- `… | lead-designer | note | mentor pack | Send to Prof Griffin queued for Aashmiin (rule 6); not sent`
