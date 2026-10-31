# Task 5: Review of the draft "How matching works" section (before it becomes a PR into pitch-deck)

PAUSE: off (per tasks.md). Fixture `task5/section.html` served locally (`python3 -m http.server 3410`),
audited with `tools/screen-audit.cjs` + axe-core 4.10.2 at 1280x800 and 390x844, plus a 320 px spot check.
Evidence in `runs/2026-10-31/task-5/`: `before-desktop-1280.png`, `before-phone-390.png`, `audit-before.json`;
my fixed version for comparison: `after-fix-desktop-1280.png`, `after-fix-phone-390.png`, `audit-after-fix.json`,
`proposed-fix.diff`.

**Verdict: not ready. Two honesty gates fail (a logo strip and an invented 99.9%), plus a false NetSuite/QuickBooks
claim, and the section scrolls sideways on every phone.** Escalated to Aashmiin (logo strip).

## Measured (this run)

| Check | 1280 | 390 | Notes |
|---|---|---|---|
| Horizontal scroll | none (1280/1280) | **1132 / 390** (also 1132 at 320) | `.steps { grid-template-columns: repeat(3, 360px) }` is fixed width |
| Rendered text pairs / failing | 9 / 2 | 9 / 2 | see contrast table |
| Targets < 24 px without exception | 2 (ⓘ, ⧉ 20x20) | 2 | axe target-size (serious) x2 |
| Focus visible | **0 of 10 stops** | 0 of 10 | `.icon-btn:focus { outline:none }`; the 10 stops are the two icon buttons cycling |
| Reduced motion | **1 running** ("pulse") | | no `prefers-reduced-motion` rule |
| axe | color-contrast x6, target-size x2 | same | |

Contrast (`node tools/contrast.mjs`, composited where alpha/opacity applies):

| Text | Pair | Ratio | Needs | Result |
|---|---|---|---|---|
| `.hint` 13px (teammate's new `--hint`) | `#5a6170` on panel `#11141b` | **2.96:1** | 4.5 | FAIL |
| Logo strip 16px bold at `opacity:.5` | faint `#8a93a3` over ink -> `#4a505a` on `#0a0c11` | **2.41:1** | 4.5 | FAIL (and must go anyway, F1) |
| Card body 15.5px | muted `#a3abba` on panel | 7.98:1 | 4.5 | PASS |
| Card titles | fg `#eceef4` on panel | 15.88:1 | 4.5 | PASS |
| H2 | fg on ink `#0a0c11` | 16.86:1 | 3 (large) | PASS |
| Eyebrow 13px | accent `#8ea2ff` on ink | 8.16:1 | 4.5 | PASS |
| "Matched" / "Not matched" | good `#5fd3a0` 9.93:1, bad `#f28b82` 7.71:1 on panel | | 4.5 | PASS (words differ too, so not colour alone) |
| Icon buttons (glyph) | faint `#8a93a3` on panel | 5.95:1 | 3 | PASS |

## Findings, in the order I'd fix them

| ID | Severity | Where (section.html) | Finding | Fix |
|---|---|---|---|---|
| F1 | **High (Gate G1)** | `.logos` `aria-label="Used by"`: CIRCLE, XERO, STRIPE | Implies these companies use Clearline. None do (0 customers) and none agreed. Also 2.41:1 | Delete the strip. No replacement logos. Escalate (`RISK:` row) |
| F2 | **High (Gate G3)** | Card 2 hint: "99.9% of payments match automatically." | Invented. The site itself says "Automatic matching hasn't been tested on real data yet" (`Sections.tsx:66-71`) | "Anything that doesn't match is explained in plain English." |
| F3 | **High (Gate G5)** | Card 3 hint: "Then it posts to Xero, QuickBooks and NetSuite." | QuickBooks is not built, NetSuite is designed only; posting happens only once a person approves | "Then it posts to Xero. QuickBooks is next." |
| F4 | Medium (G3/G5, judgement) | H2 "Every payment, matched in seconds." | "In seconds" has no measurement behind it; "every payment, matched" over-promises (the hard ones get explained, not matched) | "Every payment checked, matched and explained." Copy owner content-and-video-producer; final wording Aashmiin |
| F5 | **High (1.4.10 / G12)** | `.steps` `repeat(3, 360px)` | Page is 1132 px wide at 390 and 320: cards 2 and 3 are off-screen | `grid-template-columns: 1fr` and `repeat(3, minmax(0,1fr))` from 768 px (`md`) |
| F6 | **Medium (2.4.7 AA)** | `.icon-btn:focus { outline:none; }` | Keyboard focus invisible on both buttons | `.icon-btn:focus-visible { outline:2px solid var(--accent); outline-offset:2px }` (accent on panel 7.69:1, as the site's ring) |
| F7 | Medium (1.4.3 AA) + G14 | `--hint: #5a6170` (new, off-system hex) | 2.96:1 | Use the existing `--faint #8a93a3` (5.95:1 on panel). No new token. (Same-hue fix would be `#797f8b`, 4.58:1, but there's no reason to add a hex) |
| F8 | Medium (2.5.8 AA) | `.icon-btn` 20x20, `gap:0` | Under 24 px and no spacing exception (adjacent) | 24x24 minimum (Tailwind `size-6`); 44 px on phone if they stay |
| F9 | Medium (G11, house rule) | `.pulse` 1.4s infinite | Runs under reduced motion; also decorative movement next to a heading | Remove the dot, or add `@media (prefers-reduced-motion: reduce){ .pulse{animation:none} }` and `aria-hidden="true"` |
| F10 | Low (4.1.2 / craft) | Icon buttons named only by `title` "info"/"copy"; they do nothing | Vague names, no behaviour | Either remove them (my preference: marketing section, no tool UI) or `aria-label="Copy the official contract address"` with a real action |
| F11 | Low (G13) | Card titles are `<strong>` | No heading structure under the H2 | `<h3>` per card (18px/600, as `Sections.tsx:61`) |
| F12 | Advisory (craft) | Whole section | Three identical cards with numbered titles is on our anti-template list. It's acceptable here only because each card says something specific; stronger: replace card 1's empty icon row with a real cropped product screenshot (demo data, labelled) of the verdict | Next iteration |

Fix order: F1-F4 first (honesty; nothing ships with these), then F5 (layout), F6-F9 (AA), F10-F12.

## Fixes verified (my patched copy in scratch, `proposed-fix.diff`)
After F1-F11: 1280 and 390 no horizontal scroll (320: 320/320); 8 text pairs, 0 failing (lowest faint
on panel 5.95:1); 0 targets under 24 px; focus visible on 10/10 stops; reduced motion 0 running
animations; axe 0 violations at both widths. Screenshots `after-fix-*.png`.

Not checked: real Inter rendering (the fixture loads no web font, system fallback used); screen-reader
output; how it sits between the real site's neighbouring sections.

## Checklist (draft as received)
G1 **fail** · G2 pass · G3 **fail** · G4 n/a · G5 **fail** · G6 **fail** · G7 pass · G8 **fail** · G9 **fail** ·
G10 pass · G11 **fail** · G12 **fail** · G13 partial · G14 **fail** (`--hint`) · G15 pass (dark brand) ·
G16 pass (type scale matches `ui.tsx`) · G17 attached · G18 not yet a PR (fine) · G19 PAUSE checked.

## Note to the teammate and Aashmiin
"How matching works" draft: please fix F1-F5 before opening the PR into `pitch-deck`; the logo strip
can't be there in any version (no customer or partner has agreed). Patched copy attached as a starting point.

## Log rows (would write)
- `2026-10-31 <hh:mm> SGT | lead-designer | review | task5 section.html draft | 1280+390: 4 honesty/claim findings (Used-by logo strip, invented 99.9%, QuickBooks/NetSuite posting, "in seconds"), page 1132 px wide at 390, 2 contrast fails (2.96, 2.41), no focus, 20 px targets, pulse ignores reduced motion. Fixed copy verified 0 axe violations.`
- `2026-10-31 <hh:mm> SGT | lead-designer | escalate | task5 section.html | RISK: draft section shows CIRCLE/XERO/STRIPE as "Used by"; none are customers or have agreed. Removed in the fix; flagged to Aashmiin.`
