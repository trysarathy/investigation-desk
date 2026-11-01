# Task 1: Review of PR #52 "Quieter UI" (design/quieter-ui-20261105 -> main)

Run 2026-10-31 (SGT). PAUSE: off (per tasks.md; live tools off). Sources: fixture `task1/pr-52.diff`;
baseline tokens `origin/main:src/app/globals.css` @ `8decb27` (opened this run). Ratios from
`node team/knowledge/lead-designer/tools/contrast.mjs` and fixes from `tools/suggest.mjs`, output pasted below.
I did not render this PR: it is a fixture diff, not a branch I can check out, so nothing below is a
rendered measurement. The author must attach the rendered evidence listed at the end.

## Review comment I would post on PR #52 (draft; posting is a `gh` write, off in this run)

**Verdict: request changes.** The PR makes four AA failures (two of them on every page), adds an
off-system colour that SPEC §9 rules out, and removes the motion and size safeguards. The goal (a calmer
request page) is right; the way to get there is spacing and fewer elements, not lighter text.

| ID | Severity | Where | Finding | Evidence (computed from the diff's hex) | Fix |
|---|---|---|---|---|---|
| F1 | **High** (1.4.3 AA, every page) | `globals.css` `--text-2` (diff line `+  --text-2: #7a7d85;`) | `.muted` body text, labels and the "who" lines drop below 4.5:1 everywhere | `#7a7d85` on panel `#ffffff` **4.12:1**, on canvas `#f7f7f5` **3.84:1**, on panel-2 `#fafaf9` **3.94:1** (was `#5b5e66`: 6.49 / 6.05 / 6.21) | Keep `--text-2: #5b5e66`. The smallest same-hue value that passes would be `#6e7178` (4.56:1 worst), but that collapses text-2 into text-3's range and loses a tier |
| F2 | **High** (1.4.3 AA, every page; makes A1 worse) | `--text-3` (`+  --text-3: #a3a6ad;`) | Table headers 12px, `.eyebrow` 11px, `.faint` refs, timestamps, KPI `.k` labels, placeholders. Already failing at `#8a8d94` (A1); this makes it much worse. 11-13px is never "large text" | `#a3a6ad` on `#ffffff` **2.44:1**, on `#f7f7f5` **2.27:1**, on `#fafaf9` **2.33:1**, on accent-soft `#edf1fd` 2.16:1 (was 3.32 / 3.10 / 3.18) | `--text-3: #6e7176` (light; 4.57:1 worst, on canvas) and, in both dark blocks, `#82858d` (4.76 panel / 5.07 canvas / 4.51 panel-2). This is the open A1 fix; it can ride in this PR |
| F3 | **High** (SPEC §9 + 1.4.3 AA + G14) | New `--info: #4c9aff`, `--info-soft: #eef5ff`, `.pill-info` | (a) SPEC §9: "one accent blue `#3B5BDB`", semantic colours only for evidence. A second blue is a new tone the system doesn't have. (b) 12px pill text fails. (c) Not defined in the two dark blocks, so dark mode shows a light-blue pill on `#18191d`. (d) Not in `brand-system.md` / `tokens.dtcg.json` | `#4c9aff` on `#eef5ff` **2.60:1**; on white 2.85:1; on canvas 2.66:1 | Drop `--info*` and `.pill-info`. "Arriving now" is the existing in-progress state: use `.pill-confirming` (accent `#3b5bdb` on accent-soft `#edf1fd` **5.02:1**; dark `#6b86f0` on `#1e2440` 4.56:1). If a separate tone is truly needed, the passing same-hue text is `#3770ba` (4.57:1 on `#eef5ff`, worst of info-soft/white), plus dark values, plus a system update in the same PR, plus Aashmiin's OK because it changes SPEC §9 |
| F4 | **Medium** (G11 house rule; 2.3.3 AAA) | `.pill-info::before { animation: pulse 1.2s … infinite; }` | No `prefers-reduced-motion` override. The existing reduce rule (`:288`) names only `.pill-confirming`, so this pulse keeps running | Read from `origin/main:globals.css:284,288` | Removed with F3. If kept: add `.pill-info::before` to the `@media (prefers-reduced-motion: reduce)` rule at `:288` |
| F5 | **Medium** (2.5.8 AA risk; house target fail) | `.btn { height: 22px; padding: 0 8px; }` (was 32px / 12px) | Every default button drops below the 24px AA minimum and below `.btn-sm` (26px), so "small" becomes bigger than "default". It passes 2.5.8 only where the spacing exception holds; stacked or adjacent toolbars (sidebar foot `gap: 8px`, panel headers) need a render to prove it. Phone house goal is 44px for primary actions ("Mark paid") | 22 < 24 CSS px. `.next .btn` keeps `min-height: 32px` (`:356`), so only the request-page next-step button is protected | Keep `height: 32px; padding: 0 12px`. If density is the goal, use `.btn-sm` (26px) for secondary actions in dense rows only |
| F6 | **Medium** (1.4.11 AA, judgement; makes A4 worse) | `--border-strong: #e4e4e0` (was `#d2d2cc`) | Same value as `--border`, so buttons, chips and empty inputs lose their stronger edge. Buttons are fine (their text identifies them); empty `.input` fields are identified only by the border | `#e4e4e0` on `#ffffff` **1.27:1**, on canvas **1.19:1** (was 1.52:1, already under 3:1, A4) | Keep `--border-strong: #d2d2cc` for buttons/chips. For inputs only, a new `--border-input: #8f8f8b` (3.03:1 on white) as proposed in A4, in its own PR |
| F7 | Low (process, G17) | PR body | "Screenshots attached (desktop only)"; "Looks much calmer" is not evidence | No 390px, no dark mode, no ratios | See the attach list below |
| F8 | Low (G14, system drift) | Whole PR | Changes light tokens only; dark blocks (`:28-49`, `:52-71`) untouched, so light and dark no longer match tier-for-tier. No `brand-system.md` / `tokens.dtcg.json` / `accessibility.md` update | Diff touches `globals.css` only | Any token change updates both themes and all three files in the same PR |

**What would actually make the request page calmer (suggested, all on-system):** fewer competing
elements per panel (one primary action, the rest as text links), more space between panels (16 -> 24px,
on the 8px grid), fewer borders inside panels (use spacing), and the demo note collapsed on phone (A10).
I can review a spacing-only version the same day.

**Before re-review, please attach:**
1. `screen-audit.cjs` output for `/requests`, `/requests/DEMO-1043`, `/requests/all` at **1280 and 390**,
   light **and** dark, before and after (screenshots + `audit.json`, axe 4.10.2 included).
2. The `contrast.mjs` lines for every changed pair (light and dark).
3. `getAnimations()` count under `prefers-reduced-motion: reduce` on a page showing the pill.
4. `npx tsc --noEmit`, `npx vitest run`, `npx next build` results (company code rules).
5. The `brand-system.md` / `tokens.dtcg.json` changes for any token that stays.

Merge is Aashmiin's call after re-review. Not merged, not approved by me.

## Command output (this run)

```
#7a7d85 on #ffffff: 4.12:1   #7a7d85 on #f7f7f5: 3.84:1   #7a7d85 on #fafaf9: 3.94:1
#a3a6ad on #ffffff: 2.44:1   #a3a6ad on #f7f7f5: 2.27:1   #a3a6ad on #fafaf9: 2.33:1   #a3a6ad on #edf1fd: 2.16:1
#5b5e66 on #ffffff: 6.49:1   #8a8d94 on #ffffff: 3.32:1
#e4e4e0 on #ffffff: 1.27:1   #e4e4e0 on #f7f7f5: 1.19:1   #d2d2cc on #ffffff: 1.52:1
#4c9aff on #eef5ff: 2.60:1   #4c9aff on #ffffff: 2.85:1   #4c9aff on #f7f7f5: 2.66:1
#3b5bdb on #edf1fd: 5.02:1   #3b5bdb on #eef5ff: 5.17:1
#82858d on #18191d: 4.76:1   #82858d on #111215: 5.07:1   #82858d on #1d1e23: 4.51:1
suggest #4c9aff 4.5 #eef5ff #ffffff            -> #3770ba (worst 4.57:1)
suggest #7a7d85 4.5 #ffffff #f7f7f5 #fafaf9    -> #6e7178 (worst 4.56:1)
suggest #8a8d94 4.5 #ffffff #f7f7f5 #fafaf9    -> #6e7176 (worst 4.57:1)
suggest #767982 4.5 #18191d #111215 #1d1e23    -> #82858d (worst 4.51:1)
suggest #d2d2cc 3 #ffffff #f7f7f5              -> #8f8f8b (worst 3.03:1)
```

## Checklist (for this PR as submitted)
G1-G5 n/a (no copy or claims changed) · **G6 fail** (F1, F2, F3) · **G7 fail** (F6) · G8 not shown (no focus
evidence) · **G9 fail** (F5) · G10 pass (pill keeps text + dot) · **G11 fail** (F4) · G12 not shown (no 390) ·
G13 not shown · **G14 fail** (F3, F8) · G15 pass (light instrument) · G16 partial (F5 breaks the control scale) ·
**G17 fail** (F7) · G18 pass (branch + PR into main, not merged).

## Log row (would write)
`2026-10-31 <hh:mm> SGT | lead-designer | review | PR #52 @ design/quieter-ui-20261105 | Request changes: 3 High (text-2 4.12:1, text-3 2.44:1, info pill 2.60:1 + off-SPEC blue), 3 Medium (pulse ignores reduced motion, .btn 22px, border-strong 1.27:1), 2 Low. Diff reviewed from token values; not rendered. Note: <PR comment link>`
