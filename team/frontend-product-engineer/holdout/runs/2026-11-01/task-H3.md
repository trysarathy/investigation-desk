# Holdout run 2026-11-01: frontend-product-engineer

## H3. Contrast ratios and AA-passing replacements (FPE-2)

**Method.** WCAG 2.x relative luminance and contrast ratio, computed this run with a script on the hex values in `h3-colour-pairs.csv` (`python3 -I cr.py` in the session scratchpad).
- sRGB channel `c = v/255`; linear = `c/12.92` if `c ≤ 0.04045`, else `((c+0.055)/1.055)^2.4`.
- `L = 0.2126 R + 0.7152 G + 0.0722 B`.
- Ratio = `(L_light + 0.05) / (L_dark + 0.05)`.

The formula and thresholds come from SC 1.4.3 / 1.4.11 and the WCAG definitions. Text needs ≥ 4.5:1. Large text, meaning ≥ 24 px, or ≥ 18.66 px bold, needs ≥ 3:1. Non-text UI component boundaries need ≥ 3:1. Sources:
- `[VERIFIED: frontend-product-engineer 2026-11-01, https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/20/contrast-minimum.html]`
- large-text definition and 1.4.11: `[VERIFIED: lead-designer 2026-10-31, w3c/wcag source]`

None of these pairs is large text: the biggest is 13 px / 500, and 11 px / 600 uppercase is still small. So every text pair is judged at **4.5:1**.

### Working for P1 and P8
**P1, `#8a8d94` on `#ffffff`:**
- R 138 → 0.54118 → linear 0.25415. G 141 → 0.55294 → 0.26636. B 148 → 0.58039 → 0.29614.
- L = 0.2126×0.25415 + 0.7152×0.26636 + 0.0722×0.29614 = 0.05403 + 0.19050 + 0.02138 = **0.26591**.
- White L = 1.00000.
- Ratio = (1.00000 + 0.05) / (0.26591 + 0.05) = 1.05 / 0.31591 = **3.32:1** → fails 4.5.

**P8, `#767982` on `#18191d` (dark):**
- Foreground: R 118 → 0.18116, G 121 → 0.19120, B 130 → 0.22323. L = 0.03851 + 0.13675 + 0.01612 = **0.19138**.
- Background: R 24 → 0.00913, G 25 → 0.00972, B 29 → 0.01229. L = 0.00194 + 0.00695 + 0.00089 = **0.00978**.
- Ratio = (0.19138 + 0.05) / (0.00978 + 0.05) = 0.24138 / 0.05978 = **4.04:1** → fails 4.5.

### All 11 pairs
| id | Mode | Pair | Use | Ratio | Threshold | Result |
|---|---|---|---|---|---|---|
| P1 | light | text-3 `#8a8d94` / panel `#ffffff` | .faint timestamps, 12/400 | **3.32** | 4.5 | **FAIL** |
| P2 | light | text-3 / canvas `#f7f7f5` | .eyebrow 11/600 caps | **3.10** | 4.5 | **FAIL** |
| P3 | light | text-3 / panel-2 `#fafaf9` | th 12/500 | **3.18** | 4.5 | **FAIL** |
| P4 | light | text-2 `#5b5e66` / panel-2 | demo badge text 11/500 | 6.21 | 4.5 | pass |
| P5 | light | amber `#8a5a00` / amber-soft `#fdf3dc` | warning badge 12/500 | 5.37 | 4.5 | pass |
| P6 | light | `#ffffff` / accent `#3b5bdb` | Approve label 13/500 | 5.67 | 4.5 | pass |
| P7 | light | green `#1f7a3d` / green-soft `#e9f5ec` | Paid pill 12/500 | 4.79 | 4.5 | pass (thin margin) |
| P8 | dark | text-3 `#767982` / panel `#18191d` | .faint 12/400 | **4.04** | 4.5 | **FAIL** |
| P9 | dark | text-3 / panel-2 `#1d1e23` | th 12/500 | **3.82** | 4.5 | **FAIL** |
| P10 | dark | text-3 / canvas `#111215` | .eyebrow 11/600 | **4.31** | 4.5 | **FAIL** |
| P11 | light | border-strong `#d2d2cc` / panel-2 | demo badge dashed border (non-text) | **1.45** | 3.0 if 1.4.11 applies | see below |

**P11.** 1.4.11 asks for 3:1 for visual information *required to identify* a UI component or its state. The demo badge is not interactive, and its text "Demo data" (P4, 6.21:1) carries the meaning, so the border is decorative. **It is not an AA failure as used.** It would fail (1.45 < 3) if it were the only cue, for example a dashed-border control or the input boundary tracked as lead-designer A4. I don't change `--border-strong` in this PR. I flag it so the badge never relies on its border. The demo label must stay readable, and it is, via its text.

Six text pairs fail, all on `--text-3`. That matches lead-designer finding A1 `[VERIFIED: lead-designer 2026-10-31, accessibility.md §4 A1]`. My numbers agree with theirs: 3.32 / 3.10 / 3.18 / 4.04 / 4.31. P9 (3.82) is a pair their table didn't list.

### Replacement tokens (one per mode)
Goals: ≥ 4.5:1 on every surface `--text-3` sits on in that mode (canvas, panel, panel-2: `.faint`, th, `.eyebrow`, `.k` labels, `.mode-note`, placeholders, per `globals.css:96-436` `[VERIFIED: code read]`), and still visibly lighter than `--text-2`.

| Mode | Token | Now | **Proposed** | on panel | on panel-2 | on canvas | worst | text-2 on same worst surface | text-2 : text-3 |
|---|---|---|---|---|---|---|---|---|---|
| light | `--text-3` | `#8a8d94` | **`#6d7077`** | 4.96 | 4.75 | 4.62 | **4.62 ✅** | 6.05 (canvas) | 1.31 |
| dark | `--text-3` | `#767982` | **`#84878f`** | 4.89 | 4.63 | 5.21 | **4.63 ✅** | 6.91 (panel-2) | 1.49 |

- **Hierarchy kept.** Light: text-2 L = 0.1119 and new text-3 L = 0.1617 (text-3 is still clearly lighter; text-2 on white 6.49 vs text-3 4.96). Dark: text-2 L = 0.3859 and text-3 L = 0.2422 (text-3 clearly dimmer; 7.29 vs 4.89 on panel).
- **Versus lead-designer's A1 proposal** (`#6e7176` / `#82858d`): both pass too, but their worst cases are 4.57 (light canvas) and 4.51 (dark panel-2), only 0.07 and 0.01 above the line. That margin can be lost to font smoothing or a future background tweak. Mine are one step darker or lighter, with a worst case of 4.62 / 4.63, and keep the tier gap at 1.31 / 1.49 versus their 1.32 / 1.53. **The final choice is lead-designer's.** Either pair passes. I would put both in the PR comment.
- **Watch-out:** neither value reaches 4.5 on the tinted "soft" surfaces. Light `#6d7077` on accent-soft gives 4.39 and on amber-soft 4.49. Dark `#84878f` on accent-soft gives 4.23 and on amber-soft 4.21. So `.faint` must not be used inside `.bar-*`, pills or soft panels. The PR's axe run at 1280/390 in both themes will catch any instance. If one exists, that element moves to `--text-2`. The token does not get darkened further, because that would collapse the hierarchy.
- The `--text-3` uses as non-text borders (`.btn:hover`, `.req-card:hover`, `.message` left border) only get stronger. Fine.

### How it gets built and approved
1. **Owner:** lead-designer's contrast fix is build-order item 4 (OPERATING_MODEL §2). lead-designer picks the values. I build the PR: branch `ui/text-3-contrast-20261102` from fresh `main`.
2. **Diff:** 3 lines in `src/app/globals.css` (light `:root`, the dark `@media` block, `[data-theme="dark"]`). lead-designer updates `brand-system.md` and `tokens.dtcg.json` in the same PR. No component changes and no new token.
3. **Tests and evidence:**
   - Before/after `measure.cjs` axe `color-contrast` counts on every owned route at 1280 and 390, light, plus `reflow-dark.cjs` for dark. Baseline: 727 failing nodes `[VERIFIED: measured frontend-product-engineer 2026-11-01]`. I expect the text-3 nodes to go to 0 and any leftovers to be listed by pair.
   - `contrast.mjs` output for each new pair.
   - Screenshots at 1280 and 390, light and dark, before and after, demo label visible.
   - Load time unchanged (a CSS value change), still measured, n = 5.
   - The usual tsc, vitest, build and lint runs.
4. **Sign-off:** lead-designer review comment against `review-checklist.md` (visual change), then `CODE REVIEW: APPROVE <sha>` from code-reviewer, then `QA: PASS <sha>` from qa-security-engineer.
5. **Merge:** it is not approval-only (no posting, money, auth or pricing), so it can go through tech-lead-architect's 06:17 gate. But only once `main`'s ruleset has the required `ci` status check. As of 1 Nov it doesn't, so until Aashmiin adds it, this waits for her merge.
6. **Afterwards:** update `baseline.md` (A1 closed, a11y open count from 8 to 7, screens-at-standard recounted). I don't write "AA" for any screen until every gate is evidenced.
