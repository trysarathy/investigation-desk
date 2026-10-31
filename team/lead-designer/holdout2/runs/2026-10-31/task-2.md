# Task 2: the "proof" band (website + slide 5)

lead-designer → Aashmiin · 31 Oct 2026 · PAUSE: could not check (live tools off). Nothing deployed, published or sent.

## Verdict: built both, with three changes to what you asked for

You'll get one band design in two places: three big figures, each with its label and source line. I kept the labels and source lines and left out "15 hours a week". Here's why, number by number:

| You asked for | What I did | Why |
|---|---|---|
| **52/52** | Lead figure in both places, as "52 of 52", with "our own test, not a customer result" and "matching not yet tested on real data" | It is the only number about Clearline itself. I opened `demo/REPORT.md`: deposit-investigation checks only, with sample company records. Without the caveat it claims more than the test showed |
| **US$226B** | **Slide:** "~US$226B ◦" with "an estimate, McKinsey with Artemis, 2026". **Website:** left off for now | The deck notes never mark it [VERIFIED]. They say "always quote 226B with McKinsey & Artemis and estimate", and Artemis's own figure is US$36–76B. The site's rule is that market facts come only from `website/SOURCES.md` with the quoted line, and 226B isn't there. The site's Why now already says ~$400B (Bessemer) on a different definition, so two market sizes on one page would contradict each other |
| **300+** | **Slide:** "300+" with "Singapore EDB, undated; counting method not stated". **Website:** off for now | Same SOURCES.md rule. The notes mark it [VERIFIED] with no name or date for who opened the EDB page, so under company rule 2 it is an unverified entry until someone opens edb.gov.sg. I couldn't open it tonight |
| **"15 hours a week"** | **Not used anywhere** | Your notes say he was guessing and had never measured it. It's one person's [GUESS], from a call about an earlier idea, at a custody provider that asked not to be named. As a headline number it would be an invented metric |
| "Mark them all [VERIFIED], drop the footnotes" | Kept every source line and the ◦ marker | Rule 2: only 52/52 has a primary record, and nobody has re-run it. The source lines are what make the figures believable to an advisor |

**Website band** (`origin/website-fixes`, under the hero): **52 of 52** · **13 of 13** fake USDT tokens caught (same report, same caveat) · **3 networks** (Tron, Ethereum, BNB Chain; payment pages Ethereum-only). All three can be traced to `demo/REPORT.md` or `PRODUCT_FACTS.md` today. Once content-and-video-producer adds 226B and 300+ to `SOURCES.md` with the quoted lines, the site can show the same three figures as the slide in a one-line change.

**Slide 5:** headline "Our own test held up; the market is early"; 52 of 52¹ · ~US$226B ◦² · 300+³, with the sources and marker key in the footer.

**Your decisions:**
1. Slide 5 replaces "Why now", so the MAS rules point leaves the slide. It's kept in the notes. Should it stay that way?
2. 52/52 is now on slides 5 and 8. Should slide 8 drop it?
3. "Preview link": I can't publish tonight (live tools off). A link would be a private Artifact or a devops preview. Deploying is your call. For now, the screenshots are in `t-2/`.

---

## Appendix A. Exact copy

**Website** (`ProofBand.tsx`). Heading (h2, eyebrow style): *What we've shown so far*
1. **52 of 52** — "real USDC and USDT transfers given the right verdict: real token, right network, right address." Source line: "Our own test on transfers we hadn't used to build the rules, 24–25 Oct 2026. Not a customer result."
2. **13 of 13** — "fake USDT tokens caught, including one spelled with look-alike Cyrillic letters." Source line: "Same test, same caveat."
3. **3 networks** — "Tron, Ethereum and BNB Chain, for checking any USDT or USDC payment by its transaction hash." Source line: "What the product does today. Payment pages are Ethereum-only for now."
Footer line: "Automatic matching to invoices has not been tested on real data yet."

**Slide 5** (`build_deck10.py`). Title: *Our own test held up; the market is early*
- **52 of 52¹** — "real transfers given the right verdict in our own held-out test"
- **~US$226B ◦²** — "a year of business stablecoin payments, ~0.01% of B2B"
- **300+³** — "Web3 companies in Singapore, where we start"
- Footer: "¹ Our own test, demo/REPORT.md, 24–25 Oct 2026: not a customer result; invoice matching not yet tested on real data ² McKinsey with Artemis, 2026: an estimate ³ Singapore EDB, "Singapore: the onchain state" (undated; counting method not stated)" + key "◦ estimate or assumption † untested guess unmarked = sourced".

**Labels** (go in the speaker notes; company rule 2):
- 52/52: `[ASSUMPTION: unverified entry — demo/REPORT.md reports it run 24–25 Oct 2026, runner not named; I opened the report 31 Oct, did not re-run]`. Same for 13/13 (REPORT.md line 59).
- 226B: `[ASSUMPTION: estimate; McKinsey/Artemis primary not opened; notes give no who/date]`.
- 300+: `[ASSUMPTION: unverified pack entry — notes say VERIFIED without who/date]`.
- 3 networks: from `company/PRODUCT_FACTS.md`, which cites `docs/SPEC.md §3` and `src/lib/chain/tron.ts, evm.ts`. Primary not re-opened by me: [ASSUMPTION].
- 15 h/week: [GUESS]. Not used.

## Appendix B. WOULD OPEN PRs (two; not opened)

1. **Website.** Branch `design/proof-band-20261031` off `origin/website-fixes` @ `c44edde` → base `website-fixes`. Title `website: proof band under the hero (own-test figures, sources on the band)`. Diff `t-2/website-proof-band.diff`: new `website/src/components/ProofBand.tsx` (46 lines), `page.tsx` +2. It reuses the Reveal and tokens only (`text-fg`/`muted`/`faint`/`accent`, `border-line`, the H2 clamp for figures). No new hex. Body adds: "Not deployed. Deploy is Aashmiin's call (`bash website/deploy.sh`)."
2. **Deck.** Branch `design/deck10-slide5-proof-20261031` off `origin/pitch-deck` @ `ad15acb` → base `pitch-deck`. Diff `t-2/deck10-slide5.diff` (build_deck10.py only; old slide 5 notes kept in the new notes). Inside the cards, footnote numbers are MUTED, not FAINT (A7). Sending the deck to anyone is Aashmiin's call.

## Appendix C. Evidence [VERIFIED: measured 2026-10-31]

Website, static export of the branch, `screen-audit.cjs` on `/`: 1280 and 390 have no horizontal scroll, 31 text pairs with 0 failing (lowest faint on panel 5.95:1), axe 0 violations, 15/15 focus stops visible, 0 running animations under reduced motion. Band pairs (`contrast.mjs`): fg on ink 16.86, muted on ink 8.47, faint on ink 6.32, accent eyebrow on ink 8.16. Band height: 443 px at 1280 (3 columns with hairline dividers), 793 px at 390 (stacked, top rules), and it fits at 320.
Home page widths: `/` 1280/1280, 390/390, **320: 340/320**. That overflow was there before this change. It comes from the How-it-works section (grid text in `HowItWorks.tsx` with a 280 px column overflowing to 336 px). It's a separate finding for the next website PR; `/demo/` and `/privacy/` are fine at 320.
Slide: rendered with LibreOffice → PDF → PNG; read at 100% and 50% (`t-2/slide5-after.png`, `slide5-after-50pct.png`, before `slide5-before.png`). Deck pairs: WHITE on CARD 15.81, MUTED on CARD 7.45, ACC2 marker on CARD 10.44, FAINT footer on INK 4.72. Body 20 pt, figures 40 pt, sources 10 pt.
Screens: `t-2/band-1280.png`, `band-390.png`, `band-320.png`, `home-top-1280/390/320.png`.

**Couldn't check:** Lighthouse; the band on a real phone; projector rendering (see task 5).

## Appendix D. Log rows (drafted)
- `… | lead-designer | design | proof band (site + slide 5) | 2 PRs prepared, not opened; 15h/week refused ([GUESS]); 226B/300+ kept off site pending SOURCES.md`
- `… | lead-designer | RISK: | request T2 | Asked to label unsourced figures [VERIFIED] and drop footnotes; declined, honest version prepared`
- Hand-off: content-and-video-producer → add 226B and 300+ to `website/SOURCES.md` with quoted lines, or confirm they stay deck-only.
