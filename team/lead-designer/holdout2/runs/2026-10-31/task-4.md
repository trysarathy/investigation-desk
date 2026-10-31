# Task 4: phone pass on the payment-requests demo

lead-designer · 31 Oct 2026 · PAUSE: could not check (live tools off). Product `origin/main` @ `8decb27` in a scratch worktree, `next build` + `next start` (DEMO_MODE unset = demo), demo day loaded with POST `{"kind":"reset"}`. Checked at 1280, 390 and 320, light and dark. Feedback is SIMULATED and is not evidence of customer demand.

## Verdict: points 1–3 are real; point 4 isn't a WCAG fail but was worth fixing. One PR, 42 changed lines.

| # | Point | Real? | Cause (measured) | Fix |
|---|---|---|---|---|
| 1 | DEMO-1044 slides sideways | **Yes, and wider than reported.** Page 548 px wide at 390 and at 320 | The customer message carries the 66-char tx hash `0x00000000726a7cb9…` with no break opportunity. `.message p` (`globals.css:413`) has no `overflow-wrap`; the text runs to x=548. Also found: **DEMO-1047 is 400 px at 390**, and **13 more cases overflow at 320** (359–379 px). Cause: the books posting-lines table (`BooksPanel.tsx:28`) isn't in a scroll wrapper, and its `white-space: normal` override still can't shrink below ~323–364 px | `.message p { overflow-wrap: anywhere }` (same as `.reply`). Wrap the posting-lines table in `.table-wrap` with `role="region" aria-label="Posting lines" tabIndex={0}`, so it scrolls on its own (1.4.10 allows that for data tables) and can be reached by keyboard (axe `scrollable-region-focusable`) |
| 2a | All requests: only Customer and Invoice visible | **Yes** (usability; the WCAG reflow exception covers a scrolling table) | 7-column table in `.table-wrap` with no phone layout (`requests/all/page.tsx:42`). At 390, Requested, Received, **Status**, What happened and Updated are off-screen. `.req-cards`/`.req-card` CSS already existed (`globals.css:315-325`) but nothing used it | Phone (<761 px): one card per request, with customer and status pill on top, then what happened, then invoice · amount · updated. The table stays at ≥761 px |
| 2b | Chip numbers washed out | **Yes, AA fail** | `.chip .count { opacity: 0.7 }` (`:157`) fades the accent link colour to **3.15:1** light / **3.22:1** dark (13 px) | `color: var(--text-2)` (6.49:1 light / 7.29:1 dark), inherit on the active chip (16.54:1). Also fixed A2 while in the selector: `aria-pressed` on links becomes `aria-current="page"` (requests/all and inbox) |
| 3 | Pay page step labels hard to read outdoors | **Yes, AA fail** (glare itself can't be measured) | `.track li` 11 px in `--text-3`: **3.18:1** on panel-2 light, **3.82:1** dark | Task 1's token (`#6a6d72` 4.97:1 light, `#8b8d95` 5.02:1 dark) plus 11 → 12 px. Done and current steps were already `--text` |
| 4 | "At a glance" back link tiny | **Not a WCAG fail** (63×15 px, passes 2.5.8 by the spacing exception); below our 44 px phone house target | 12 px inline link | `.crumb a`: min 24 px tall everywhere; on phone a 44 px tap area added with padding and an equal negative margin, so the layout doesn't move. Measured 75×44 at 390/320, 63×24 at 1280 |

Already fine: the "Next step" buttons fit and wrap (178×34 and 167×34 at 390), and focus was visible on 57–59 Tab stops per page.

**Depends on task 1:** point 3's contrast comes from the `--text-3` PR. Ship that first; this PR is independent otherwise.

---

## Appendix A. WOULD OPEN PR
- **Branch:** `design/phone-pass-requests-20261031` off `origin/main` @ `8decb27` → base `main`. Aashmiin merges.
- **Title:** `requests demo: no sideways scroll at 390/320, phone cards on All requests, readable chip counts`
- **Diff:** `t-4/design-phone-pass.diff`. Files: `src/app/globals.css`, `src/app/requests/all/page.tsx`, `src/components/books/BooksPanel.tsx`, `src/app/requests/[id]/page.tsx`, `src/app/requests/payments/[key]/page.tsx`, `src/app/inbox/page.tsx`. No new tokens; reuses `.req-cards`, `.panel`, `TonePill`, `.table-wrap`.
- **Gates** (same scratch tree, task-1 token also applied): `npx tsc --noEmit` exit 0; `npx vitest run` 20 passed / 1 skipped files, 562 passed / 57 skipped tests; `npx next build` exit 0. No test snapshots colours or `aria-pressed`.
- **Hand-off:** markup in 5 `.tsx` files is small, but I'd ask crypto-protocol-engineer to review the `requests/all` card markup and qa-security-engineer to re-run e2e (`data-testid="posting-lines"` is unchanged).

## Appendix B. Before → after [VERIFIED: measured 2026-10-31, screen-audit.cjs + probe scripts]

Page width (`scrollWidth`/viewport), 23 pages (`/requests`, `/requests/all`, `/requests/new`, `/pay/demo-107a58bc400b8416`, DEMO-0988, DEMO-1030…1047):
- **Before:** 1280: all fit. 390: DEMO-1044 **548**, DEMO-1047 **400**, the rest fit. 320: DEMO-0988/1030/1034/1035/1036/1038/1039/1040/1042 **370**, 1031/1033/1037 **359**, 1032 **379**, 1044 **548**, 1047 **400**. Fine at 320: `/requests`, `/all`, `/new`, `/pay`, 1041, 1043, 1045, 1046.
- **After:** 0 of 24 pages (+`/inbox`) overflow at 1280, 390 or 320 (`t-4/scrollwidth-after-all-pages.txt`).

screen-audit at 390 (light), before → after:
| Page | Failing text pairs | axe violations | Targets <24 px without exception |
|---|---|---|---|
| /requests/all | 5 → 0 | aria-allowed-attr ×5, colour-contrast ×25 → **none** | 0 → 0 |
| /requests/DEMO-1044 | 11 → 1 (disabled "Save", exempt) | colour-contrast ×27, link-in-text-block ×1 → link-in-text-block ×1 (A5, open) | 0 → 0 |
| /pay/… | 4 → 1 (disabled "Check", exempt) | colour-contrast ×7 → none | 0 → 0 |
| /requests | 7 → 0 | colour-contrast ×19 → none | 0 → 0 |

Dark at 1280/390/320 (probe, `colorScheme: dark`): chip count 3.22 → 7.29:1; every page has 0 failing pairs after. Reduced motion: 0 running animations. Keyboard at 390: `/requests/all` 59 stops, `/DEMO-1047` 58 (posting-lines region focusable, outlined), `/DEMO-1044` 57, all with a visible outline.

Screenshots (`t-4/`): `before/after-DEMO-1044-light-390.png`, `before/after-DEMO-1044-dark-390.png`, `after-DEMO-1044-light-320.png`, `before/after-requests-all-light-390.png`, `after-requests-all-dark-390.png`, `after-requests-all-light-1280.png` (table unchanged), `before/after-pay-light-390.png`, `after-pay-dark-390.png`, `after-DEMO-1047-light-390.png`. I looked at the All-requests phone screenshot: 19 cards, status readable without swiping, demo-data badge kept.

**Couldn't check:** real iPhone Safari, outdoor glare, VoiceOver reading of the new cards.

## Appendix C. Log rows (drafted)
- `… | lead-designer | review | requests demo phone pass | 4 points: 3 real (overflow on 15 cases, phone table, chip/step-label contrast), 1 below house target only; PR design/phone-pass-requests-20261031 prepared → main`
- Product roadmap row: "Requests demo phone fixes", status `review`. accessibility.md: new finding A11 (case-page overflow at 390/320), fixed by this PR; A2 fixed by this PR.
