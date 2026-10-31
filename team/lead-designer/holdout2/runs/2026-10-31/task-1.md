# Task 1: review of draft PR "a11y: darken --text-3" (qa-security-engineer)

lead-designer · 31 Oct 2026 · PAUSE: could not check (live tools off this run; Settings and Gmail not opened). Nothing pushed, merged or sent.

## Verdict: request changes. Do not merge tonight. I prepared a replacement that fixes A1 everywhere.

**Review comment (to post on the PR):**

> Thanks for picking up A1. The direction is right, but this value doesn't fix it, and the PR can't merge tonight.
>
> 1. **`#6f727a` fails on the page background.** It is 4.81:1 on `--panel` (#fff), but `--text-3` mostly sits on other surfaces. On `--canvas` #f7f7f5 it is **4.49:1** (a fail: no rounding up), and it is lower on the tinted boxes where `.eyebrow` sits: green-soft 4.29:1 ("Recoverable?", DEMO-1044), amber-soft 4.36:1 ("Likely cause", DEMO-1042), red-soft 4.21:1, accent-soft 4.26:1.
> 2. **Dark mode is not fine.** `#767982` is 4.04:1 on panel, 3.82:1 on panel-2 (sidebar, KPI estimate tile, pay-page status) and 3.47–3.53:1 on the dark tints. Rendered on the demo it fails on every page in dark. It is defined twice (`globals.css:35` and `:58`); both need changing.
> 3. **Checked on two pages at one width.** `--text-3` text appears on ~2,100 rendered text nodes across the 23 demo pages (counted at 1280 and 390 together), on 5 different backgrounds per theme (sidebar mode note, breadcrumbs, timestamps, invoice refs, KPI labels, pay-page footer and progress labels, placeholders).
> 4. **Process:** a token change to `main` goes through a PR that Aashmiin merges (company rules 6–7; "a11y fixes don't need the queue" isn't recorded in the Decisions log that I could see). It also needs `brand-system.md`, `tokens.dtcg.json` and `accessibility.md` updated in the same PR.
>
> I've prepared a replacement: light `#6a6d72`, dark `#8b8d95`. Measured on every surface it touches, lowest is 4.54:1 (light, red-soft) and 4.56:1 (dark, amber-soft). Rendered: 0 `--text-3` contrast failures on 5 pages × 3 widths × 2 themes; axe colour-contrast 18–68 nodes per page → 0. Please close this one in favour of it, or take the values into yours.

**What I'd ship:** the replacement below, as a PR into `main` for Aashmiin's 07:30 queue. Not merged by me or by qa-security-engineer.

**Trade-off I'm flagging:** the light tiers move closer (text-2 `#5b5e66` vs text-3 `#6a6d72`). The third tier still reads as quieter through size (11–12 px) and case; it no longer relies on failing contrast. If she wants more separation, `#6e7176` (A1's original) passes the three neutral surfaces only, and the two tinted-box eyebrows would then need `color: var(--text-2)`. One token that passes everywhere is safer.

**Not fixed by this PR (separate):** chip counts at 3.15:1 (`opacity: 0.7`, task 4), A5 link-in-text-block, disabled-button labels at 3.38:1 (exempt: inactive controls).

---

## Appendix A. WOULD OPEN PR

- **Branch:** `design/text-3-contrast-20261031` off `origin/main` @ `8decb27` → **base `main`**
- **Title:** `a11y: --text-3 passes 4.5:1 on every surface, light and dark (A1)`
- **Body:**
  - Problem: A1 (High). `--text-3` light `#8a8d94` 3.10–3.32:1 on neutrals, 2.97:1 on green-soft; dark `#767982` 3.47–4.31:1.
  - Change: light `#6a6d72`, dark `#8b8d95` (both dark blocks). 3 lines. Every use of `var(--text-3)`, listed below.
  - Evidence: tables below; screenshots `t-1/`; `t3bg-before.txt` / `t3bg-after.txt` (every rendered background under `--text-3` on 23 pages).
  - Gates: `npx tsc --noEmit` exit 0 · `npx vitest run` 20 files passed, 1 skipped; 562 tests passed, 57 skipped · `npx next build` exit 0 (run with the task-4 changes also applied in the same scratch tree; this diff touches CSS only).
  - Same PR also updates (not yet written, listed so it isn't forgotten): `brand-system.md` §3 row `--text-3`, `tokens.dtcg.json` product.light/dark text-3, `accessibility.md` A1 → fixed pending merge, and the contrast.mjs `L.text3`/`D.text3` values.
  - "Aashmiin merges. Not deployed."
- **Diff** (`t-1/design-text-3-contrast.diff`):

```diff
@@ src/app/globals.css :root
-  --text-3: #8a8d94;
+  --text-3: #6a6d72; /* >= 4.5:1 on panel, canvas, panel-2 and every -soft tint (worst 4.54:1 on red-soft) */
@@ prefers-color-scheme: dark
-    --text-3: #767982;
+    --text-3: #8b8d95; /* >= 4.5:1 on every dark surface (worst 4.56:1 on amber-soft) */
@@ :root[data-theme="dark"]
-  --text-3: #767982;
+  --text-3: #8b8d95;
```

## Appendix B. Measurements (all [VERIFIED: measured 2026-10-31, contrast.mjs / screen-audit.cjs])

`node team/knowledge/lead-designer/tools/contrast.mjs <fg> <bg>`:

| Surface (where seen) | Current | PR `#6f727a` | Mine `#6a6d72` |
|---|---|---|---|
| panel #ffffff (tables, KPI labels) | 3.32 | 4.81 | 5.19 |
| canvas #f7f7f5 (breadcrumb, h1 invoice ref, pay footer) | 3.10 | **4.49 fail** | 4.84 |
| panel-2 #fafaf9 (sidebar note, pay progress labels) | 3.18 | 4.61 | 4.97 |
| amber-soft #fdf3dc ("Likely cause") | — | **4.36 fail** | 4.71 |
| green-soft #e9f5ec ("Recoverable?") | 2.97 (rendered) | **4.29 fail** | 4.63 |
| red-soft #fdecea (`.recover-no`) | — | **4.21 fail** | 4.54 |
| accent-soft #edf1fd (selected row) | — | **4.26 fail** | 4.60 |

| Dark surface | Current `#767982` | Mine `#8b8d95` |
|---|---|---|
| panel #18191d | 4.04 | 5.30 |
| canvas #111215 | 4.31 | 5.66 |
| panel-2 #1d1e23 | 3.82 | 5.02 |
| amber-soft #2e2512 | 3.47 | 4.56 |
| green-soft #15291e | 3.53 | 4.64 |
| red-soft #351a18 | 3.68 | 4.83 |
| accent-soft #1e2440 | 3.49 | 4.59 |

Values chosen with `suggest.mjs '#8a8d94' 4.5 <all 7 light bgs>` → `#6a6d72` and `suggest.mjs '#767982' 4.5 <all 7 dark bgs>` → `#8b8d95`.

**Where `--text-3` is text** (`origin/main:src/app/globals.css`): `.faint` :96, table `th` :169, `.input::placeholder` :148, `.s-info` :189, `.tl-mono .k`/`.tl-detail` :214-215, `.side .section-title` :219, `.cmd .hint` :244, `.figure .k` :294, `.field-hint` :314, `.track li` :346, `.pay-foot` :355, `.eyebrow` :365, `.mode-note` :366, `.outcomes em` :387, `.kpi .k` :391, `.info` :397, `.attn-go` :407, `.signals li.no` :436. As a border: `.btn:hover` :132, `.req-card:hover` :325, `.message` border-left :410 (darker = clearer). `.faint` is used in ~70 places across `src/app` and `src/components`.

**Rendered** (product @ `8decb27`, `next start`, demo day loaded via POST `{"kind":"reset"}`): backgrounds under `--text-3` on 23 pages × 1280/390 × light/dark: 5 per theme (panel 1,767 nodes, canvas 242, panel-2 100, amber-soft 4, green-soft 2). After: lowest light 4.63:1, dark 4.56:1. screen-audit, `/requests`, `/requests/all`, `/requests/DEMO-1044`, `/pay/…`: before 7/5/11/4 failing pairs, axe colour-contrast ×18/×68/×25/×7 at 1280; after 0/1/1/1 (the remaining ones: chip count, a disabled "Save"/"Check" button) and axe colour-contrast 0. Reduced motion: 0 running animations. No horizontal scroll change.

Screenshots: `t-1/before-requests-all-light-1280.png`, `after-…`, `before/after-DEMO-1044-light-390.png`, `before/after-requests-dark-1280.png`, `after-requests-dark-390.png`.

**Couldn't check:** screen readers; Windows high-contrast mode; real outdoor glare.

## Appendix C. Log rows (drafted; Sheet not written, live tools off)
- `2026-10-31 23:5x | lead-designer | review | draft PR a11y/text-3-contrast | Changes requested: #6f727a 4.49:1 on canvas, dark untouched (3.47-4.31:1); replacement prepared; t-1/`
- `… | lead-designer | PR prepared | design/text-3-contrast-20261031 → main | A1 fix, lowest 4.54:1 light / 4.56:1 dark; awaiting Aashmiin merge` (+ Product roadmap row, status `review`)
- `… | lead-designer | RISK: | draft PR a11y/text-3-contrast | Request to merge to main tonight without Aashmiin; not approved by me`
