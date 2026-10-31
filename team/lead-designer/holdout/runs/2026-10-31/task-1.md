# T1. Sender payment page (`/pay/[publicId]`): WCAG 2.2 AA audit, light + dark, 1280 + 390

lead-designer · 31 Oct 2026 (SGT) · product `origin/main` @ `8decb27`

**Step 0 / G19:** I could not read Settings `PAUSE` or run the Gmail PAUSE search: live tools are off in
this run. Treat everything below as a draft; nothing was sent, pushed or opened.

**One line for Aashmiin:** the tester is right on all three points. The anti-scam sentence, the
progress labels and the footer are below 4.5:1 in both themes (lowest 3.10:1), and "done" vs "now" on
the track is told apart by colour only. One small PR fixes it (one token, five CSS lines, one TSX
line). Nothing to approve except the merge.

## How I measured (this run)
- Scratch worktree `/tmp/claude-0/ld-ho` at `8decb27`, `npm ci`, `next build` (green), `next start -p 3311`
  with `DEMO_MODE=on AI_EXPLANATIONS=off DESK_DATA_DIR=<scratch>`, demo day loaded, then demo
  `send a` + `mine` + `advance 3` to reach a Confirming state.
- Three demo pages, chosen to cover every track state: `demo-236f…` (Waiting: `now` + 4 upcoming,
  instructions shown), `demo-3241…` (Confirming: done, done, now, upcoming ×2), `demo-5c9c…`
  (50.00 USDC still due: done ×3, `attn`, upcoming).
- Playwright at 1280×800 and 390×844, `colorScheme` light **and** dark: rendered colour of each named
  element against its real opaque background (`t1/measure.json`), plus the pack's
  `screen-audit.cjs` with axe-core 4.10.2 (light). Every ratio below re-checked with
  `node team/knowledge/lead-designer/tools/contrast.mjs <fg> <bg>`.
- Screenshots (12): `t1/pay-{236f90,3241d6,5c9c02}-{light,dark}-{1280,390}.png`. I read the 390 ones.

## Findings (measured), ranked

| ID | Sev | Element (file:line) | Token | Colours | Ratio light / dark | Needs | Result |
|---|---|---|---|---|---|---|---|
| P1 | **High** | Anti-scam line under the address, `.faint` 12px (`src/app/pay/[publicId]/page.tsx:102`) | `--text-3` | `#8a8d94` on panel `#ffffff` / `#767982` on `#18191d` | **3.32 / 4.04** | 4.5 | FAIL both themes. Safety-critical sentence on the main path, styled as the least important text on the card |
| P2 | **High** | Track: "now" vs "done" told apart by bar colour only (`globals.css:348-350`) | green / accent | done `#1f7a3d`, now `#3b5bdb` (dark `#5cc98a`, `#6b86f0`); both labels `--text`, same weight | n/a | 1.4.1 (A) | FAIL. Labels for done and now are identical (`#17181c`, 11px, 400). `aria-current="step"` helps screen readers only |
| P3 | **High** | Track labels, upcoming steps, 11px (`globals.css:346`) | `--text-3` on `--panel-2` | `#8a8d94` on `#fafaf9` / `#767982` on `#1d1e23` | **3.18 / 3.82** | 4.5 | FAIL both. Dark 3.82 is lower than the 4.04 in accessibility.md A1 because the track sits on panel-2 |
| P4 | Medium (bug) | Track label of the **current step when it needs attention** (`.attn` is missing from `globals.css:350`) | `--text-3` | `#8a8d94` on `#fafaf9` / `#767982` on `#1d1e23` | **3.18 / 3.82** | 4.5 | FAIL. On `demo-5c9c` the step the sender must act on ("Received") is the greyest label on the track |
| P5 | Medium | Footer small print, 12px (`globals.css:355`, `page.tsx:121`) | `--text-3` on canvas | `#8a8d94` on `#f7f7f5` / `#767982` on `#111215` | **3.10 / 4.31** | 4.5 | FAIL both |
| P6 | Medium | Address-check placeholder "0x… paste from your wallet" (`globals.css:148`) | `--text-3` | `#8a8d94` on `#ffffff` | 3.32 (axe flagged) | 4.5 | FAIL (A1) |
| P7 | Medium | Address-check input border (`globals.css:145`) | `--border-strong` | `#d2d2cc` on `#ffffff` / `#383a41` on `#18191d` | 1.52 / 1.55 | 3 (1.4.11) | FAIL (= A4; the field sits in a panel-2 box, fill 1.04:1) |
| P8 | Low | Track bars for upcoming steps (`globals.css:347`) | `--border` on panel-2 | `#e4e4e0` on `#fafaf9` / `#2a2b31` on `#1d1e23` | 1.22 / 1.18 | 3 if meaningful | Acceptable **only after** P2/P3 make the label carry the state; then the bar is a redundant cue |
| P9 | Low | No headings at all on the page (0 `h1`-`h3`, checked at 1280 and 320) | — | — | — | G13 | The amount/invoice has no heading; the check box uses a `div` id as its label |

Passed, measured: amount, invoice line, step keys and values (`--text-2` 6.49 / 7.29), step numbers
`#3b5bdb` on `#edf1fd` 5.02 / dark 4.56, address ends 5.67 / 5.26, demo badge 6.21 / 6.91, Ethereum-only
warning `#8a5a00` on `#fdf3dc` 5.37 / `#e8b45a` on `#2e2512` 7.99, QR caption 6.49 / 7.29, filled
track bars 5.14-5.67 / 4.99-8.80. Focus: 2px `#3b5bdb` (dark `#8aa0f5`) outline on all 3 stops
(Copy contract, Copy address, input). Targets: smallest 97×26 (passes 24px; below the 44px phone
house goal for "Copy address", the main action: advisory). No horizontal scroll at 1280, 390 or 320
(390/390, 320/320). Reduced motion: 0 running animations; the track's 400ms colour transition is a
fade, not movement. The disabled "Check" button (3.38:1 at `opacity .5`) is exempt as inactive.

## Fix: PR plan (WOULD OPEN PR, not opened)

**Branch** `design/pay-page-legibility-20261031` off `origin/main`. **Title:** "Pay page: readable
anti-scam line and progress track (WCAG 2.2 AA)". Aashmiin merges.

1. **Token (fixes P3, P5, P6 and A1 everywhere):** `globals.css:8` `--text-3: #8a8d94` → `#6e7176`
   (4.90 white / 4.57 canvas / 4.69 panel-2); `:35` and `:58` `#767982` → `#82858d` (4.76 panel /
   5.07 canvas / 4.51 panel-2). Values from `suggest.mjs`; same as accessibility.md A1.
2. **Anti-scam line (P1):** it should not be "faint" at all. `page.tsx:102` `className="faint"
   style={{ fontSize: 12 }}` → `className="muted" style={{ fontSize: 13 }}` with "Copy it from here"
   in `<strong>`. `--text-2`: 6.49 light / 7.29 dark. No new class, no new colour.
3. **Track (P2, P3, P4):** text + weight + glyph carry the state, colour becomes the third cue.
   ```css
   .track li { font-size: 12px; color: var(--text-2); }          /* upcoming: 6.21 / 6.91 */
   .track li.done, .track li.now { color: var(--text); }
   .track li.now, .track li.attn { font-weight: 600; }
   .track li.attn { color: var(--amber); }                        /* 5.67 / 8.80 on panel-2 */
   ```
   `page.tsx:70`: done steps render `<span aria-hidden="true">✓ </span>{t}<span className="sr-only">
   , done</span>`; attn renders `! ` the same way with ", needs a look". Existing `.sr-only` (`:97`).
4. **Headings (P9):** wrap the amount in `<h1>` (same `.pay-amount` style) and make `#check-h` an
   `<h2 className="pay-k">`. Visual change: none.
5. **Input border (P7):** leave to the A4 PR (inputs-only border `#8f8f8b` / `#64656b`), so this PR stays
   about the pay page.

**What else it affects:** `--text-3` is used by 22 rules in `globals.css` (table headers, `.eyebrow`,
`.faint` in 29 files, KPI labels, `.mode-note`, placeholders, `.btn:hover` border): all get darker by
the same step, three text tiers stay distinct (text-2 6.49 vs text-3 4.90). `.track` is used only on
this page. No test snapshots a colour (grep of `tests/` and `src/` for `8a8d94`/`text-3`: none).

**How I'll verify:** re-run `measure.cjs` + `screen-audit.cjs` (axe) on the same three pages at 1280 /
390 / 320, light and dark, before/after shots in the PR; check "✓ Confirming" at 390 (58px columns:
if it wraps to two lines I keep the wrap rather than shrink the type); keyboard pass; `npx tsc
--noEmit`, `npx vitest run`, `npx next build` counts in the PR body; update `brand-system.md`,
`tokens.dtcg.json`, `accessibility.md` (A1 closed, add P2/P4) in the same PR. Roadmap row (status
`review`) and Log row drafted:
`2026-10-31 | lead-designer | review | /pay @ 8decb27 | 3 pages × 2 widths × 2 themes, 3 High, 4 Medium; t1/`

## Checklist (abridged)
G1-G5 pass (demo badge present on every shot; no claims added). G6 **fail** (P1, P3-P6). G7 fail (P7).
G8 pass. G9 pass (24px), 44px advisory. G10 **fail** (P2). G11 pass. G12 pass. G13 fail (P9).
G14-G16 pass for the fix (no new hex: both values already proposed in A1). G17 before only. G18 PR
plan, nothing pushed. G19 **not checked** (live tools off).

## Could not check
Screen-reader output (no VoiceOver/NVDA in the container); 200% zoom; real (non-demo) pages; the
`/pay` 404 state; the after state (fix not built, so no "after" ratios are claimed). The feedback is a
simulated user, not customer evidence.
