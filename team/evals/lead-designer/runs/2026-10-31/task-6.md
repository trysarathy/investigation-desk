# Task 6: Mentor-brief slide "Why the wrong payments are the hard part"

PAUSE: off (per tasks.md). Built from `origin/pitch-deck` @ `ad15acb` `pitch/src/deck_style.py` and
`build_brief.py` (opened this run) in a scratch worktree (removed). python-pptx 1.0.2 and LibreOffice were
available, so the slide was **built and rendered**, not just described.

Files in `runs/2026-10-31/task-6/`:
- `slide_wrong_payments.py`: the slide as code. The block between `# ---- slide` and `# ---- end slide`
  pastes into `build_brief.py` after slide 2 (it uses that file's own `head`/`foot`/`KEY`/`mk` helpers,
  redefined identically so the file also runs alone for a preview).
- `slide-preview.pptx`, `slide-render.png` (100%, 1280x720), `slide-render-50pct.png` (projector/phone check).

## The slide
- **Headline (36pt bold WHITE):** "The wrong payments are the hard part"
- **Subtitle (20pt MUTED):** "Most arrive fine. The work is in the ones that don't◦" (her "our own view" -> ◦)
- **Four icon cards** (CARD, 1pt LINE, existing `short.png`, `road.png`, `fake.png`, `nolabel.png`, 20pt bold
  labels): Paid short · Wrong network · Counterfeit token · No reference
- **Two evidence cards:** "52 of 52" (40pt, unmarked = sourced) + "real public transfers checked right. Our own
  test, not a customer result" (18pt MUTED); "15–30 min†" (40pt, † in ACC2) + "per problem payment. Our guess,
  not measured" (18pt MUTED)
- **Footer (10pt FAINT on INK) + marker key (MUTED):** sources for both numbers.

## Speaker notes (in the code, verbatim)
SAY: Most stablecoin payments arrive fine. The work is in the few that don't: paid short, sent on the wrong
network, a counterfeit token, or no invoice reference. That's where I've focused. In my own test, the checks
gave the right answer on 52 of 52 real public transfers I hadn't used while building the rules. I don't yet
know how long these take a finance team; my guess is 15 to 30 minutes each, and that's one of the first
things I want to check with you and with finance teams.
LABELS:
- "Most arrive fine…" [ASSUMPTION]: our own view, not measured. ◦ on the subtitle.
- Four problem types: same four as slide 2 of this brief (`build_brief.py`, opened 31 Oct 2026). "No reference":
  ERC-20 records sender, receiver, amount only (eips.ethereum.org/EIPS/eip-20, cited on slide 2; not reopened
  this run, so [ASSUMPTION] until re-checked).
- "52 of 52" [VERIFIED]: `website/src/components/Sections.tsx:66-71` on `pitch-deck` (opened 31 Oct 2026):
  real public USDC/USDT transfers not used while building the rules, confirmed on block explorers. Own small
  test, not a customer result. Covers the checks, not automatic matching (untested on real data).
- "15–30 minutes" [GUESS]: `docs/SPEC.md` §1, not measured. † on the slide.

## Checks run
| Check | Result |
|---|---|
| Contrast (`contrast.mjs`) | WHITE `#f2f4f7` on CARD `#151a24` 15.81:1 · on INK 17.53:1 · MUTED `#a3aab6` on CARD 7.45:1 · on INK 8.26:1 · ACC2 `#b9c6ff` on CARD 10.44:1 · on INK 11.58:1 · FAINT `#767e8c` on INK 4.72:1 (footer only; **no FAINT inside cards**, avoiding A7's 4.26:1) · LINE on CARD 1.34:1 and CARD on INK 1.11:1 are decorative (cards also separated by spacing). All text pairs pass 4.5:1 |
| Type sizes | Title 36, subtitle 20, labels 20, numbers 40, card body 18, sources 10 (read back from the .pptx: nothing under 18pt except the 10pt sources) |
| Markers | ◦ on the opinion, † on the guess, 52 of 52 unmarked (sourced); key in the footer; full labels in notes |
| Colour not alone | markers are glyphs, every icon has a text label; red appears only inside the existing icons |
| Tokens | Only deck_style colours, Arial, `box`/`img`/`text`/`new` helpers, card radius 0.08; no new hex |
| Render | LibreOffice -> PDF -> PNG; viewed at 100% and 50%: headline one line, nothing overlaps, readable at 50% |
| Word count | **50 words** on the slide (excl. footer). Over the house "~30": 8 are icon labels and 12 are the caveats that keep 52-of-52 and the guess honest. If she wants ~30, drop the subtitle into the notes and shorten the evidence lines to "own test, not customers" / "a guess" (≈34) |

## Design notes for Aashmiin
- Slide 2 of the brief already shows these four icons ("Payments arrive in seconds; checking can take hours").
  Two slides with the same icons in a 5-minute read feels repetitive. Recommendation: put this slide **in place
  of** slide 2's icon row, or keep slide 2 and drop the icon row here (evidence cards only). Your call.
- Not done: rebuilding the whole brief (needs the demo video path argument) and the contact sheet;
  I rendered the single slide only. PR into `pitch-deck` would carry the full contact sheet before/after.

**WOULD OPEN PR:** `design/brief-wrong-payments-20261031` -> `pitch-deck`, "Mentor brief: slide on why the wrong
payments are the hard part", body = this file's checks table + render. Sending the brief to mentors is hers.

## Log row (would write)
`2026-10-31 <hh:mm> SGT | lead-designer | deck slide | mentor brief, design/brief-wrong-payments-20261031 | New slide built + rendered; all pairs ≥ 7.45:1 in cards, footer 4.72:1; markers ◦/† applied; 50 words (flagged); duplicate-icons note for Aashmiin.`
