# Measured baseline (2026-11-01 SGT, `origin/main` @ `0c7d9f1`)

All numbers in this file were measured by frontend-product-engineer this run:
`[VERIFIED: measured 2026-11-01, tools/measure.cjs]`. Raw data: `baseline/measure.json` (1× CPU, with
a11y) and `baseline/measure-cpu4.json` (4× CPU slowdown, timing only). Screenshots: `baseline/*.png`
(`<route>-1280.png`, `<route>-390.png`, `state-*.png`, `xero-preview-*.png`, `approve-flow-*.png`).

## Method (copy this exactly when you re-measure; change one thing and the numbers aren't comparable)
- **Build:** `git archive <sha> | tar -x` into a scratch dir, `npm ci`, `DEMO_MODE=on AI_EXPLANATIONS=off
  npx next build`, then `DEMO_MODE=on AI_EXPLANATIONS=off DESK_DATA_DIR=<scratch>/desk npx next start -p 3300`.
  Production build, local server, never `next dev` (dev compiles on first hit and is 10-100× slower).
- **Data:** `POST /api/requests/demo {"kind":"reset"}` once ("Load the demo day": 18 requests, 30 demo
  invoices). Pages measured with that data; `/inbox` and `/payments` are hidden-in-demo pages with no
  records (their empty states).
- **Browser:** Playwright Chromium headless (pre-installed), viewport 1280×800, no network throttling
  (localhost), CPU 1× and, as a stress pass, CDP `Emulation.setCPUThrottlingRate` 4×.
- **Per route:** 1 warm-up navigation (discarded), then **n = 5** navigations, each in a **fresh browser
  context** (empty HTTP cache, warm server). Metrics: Navigation Timing `responseStart` (TTFB),
  `domContentLoadedEventEnd`, `loadEventEnd` (**load**), and the last `largest-contentful-paint` entry
  (**LCP**, buffered PerformanceObserver, read 300 ms after load). Reported: **median of 5**, plus max.
- **Pass rule (the role's standard):** median **load < 1000 ms AND median LCP < 1000 ms** at 1× CPU on
  this setup. The 4× CPU numbers are reported, not gated (house stress check).
- **A11y:** axe-core 4.10.2 (npm, MIT) injected after `networkidle`, tags wcag2a/2aa/21a/21aa/22aa, at
  1280×800 and 390×844, light theme; plus a dark-theme contrast pass at 1280 and a 320 px reflow pass
  (`tools/reflow-dark.cjs`). Keyboard: Tab through every stop at 1280 recording focus visibility
  (outline or box-shadow on the focused element), traps (same element 3 Tabs running) and whether focus
  returns to `<body>` (end of page). Flows by keyboard only: `tools/keyboard-flow.cjs`.
- **Limits:** one machine (the session container), localhost (no network latency), headless, n = 5.
  This measures *our code's* load cost, not a customer's experience over the internet; a deployed
  check (Vercel preview + real network) is a separate number and was not taken.

## 1. Load time (ms, median of 5; lower is better)

| Route | TTFB | Load | LCP | Max load / LCP (1×) | 4× CPU median load / LCP | axe colour-contrast nodes (+ other) 1280 / 390 | Page width at 1280 / 390 |
|---|---|---|---|---|---|---|---|
| `/requests` (At a glance + Needs attention) | 16 | 148 | 188 | 219 / 428 | 516 / 308 | 18 / 19 | 1280 / 390 |
| `/requests/all` (payment list) | 16 | 128 | 412 | 152 / 420 | 397 / 520 | 68 + aria-allowed-attr 5 / 25 + aria-allowed-attr 5 | 1280 / 390 |
| `/requests/all?view=attention` | 14 | 127 | 100 | 136 / 120 | — | 27 + aria-allowed-attr 5 / 18 + aria-allowed-attr 5 | 1280 / 390 |
| `/requests/DEMO-1043` (counterfeit, blocked) | 15 | 127 | 132 | 162 / 412 | 457 / 636 | 23 + link-in-text-block 1 / 25 + 1 | 1280 / 390 |
| `/requests/DEMO-1042` (short; Xero preview "Ready to post") | 15 | 119 | 412 | 155 / 420 | 359 / 520 | 30 + link-in-text-block 1 / 32 + 1 | 1280 / 390 |
| `/requests/DEMO-1047` (paid twice; decisions) | 15 | 163 | 164 | 184 / 416 | — | 30 + link-in-text-block 1 / 32 + 1 | 1280 / **400** |
| `/requests/DEMO-1040` (paid, posted) | 14 | 131 | 408 | 143 / 424 | — | 24 + 1 / 26 + 1 | 1280 / 390 |
| `/requests/payments/<key>` (suggested match) | 14 | 139 | 124 | 148 / 412 | — | 7 / 9 + link-in-text-block 1 | 1280 / 390 |
| `/books` | 14 | 147 | 408 | 167 / 424 | 403 / 564 | 67 / 67 | 1280 / **743** |
| `/inbox` (empty in demo) | 14 | 138 | 408 | 154 / 420 | 417 / 544 | 52 + aria-allowed-attr 11 / 64 + 11 | 1280 / 390 |
| `/payments` (empty in demo) | 13 | 136 | 104 | 149 / 120 | 497 / 560 | 3 / 4 | 1280 / **407** |
| `/pay/<publicId>` (customer page, not owned) | 12 | 120 | 136 | 175 / 404 | 438 / 232 | 7 / 7 | 1280 / 390 |
| `/requests/NOPE-1` (unknown id) | 14 | 125 | 148 | 128 / 156 | — | 3 / 3 | 1280 / 390 |

**Verdict on speed:** every measured route is **under 1 s** at 1× CPU (worst median LCP 412 ms; worst
single run 428 ms) and also at 4× CPU (worst median LCP 636 ms on `/requests/DEMO-1043`; worst single
run 880 ms LCP on `/payments`). The ~410 ms LCP cluster is consistent with web-font swap (Inter via
`@fontsource`) repainting the largest text block [ASSUMPTION: not traced]. Speed is not the problem on
this data; the risk is growth: `/payments` and `/inbox` list up to 500 rows (`SHOWN = 500`) and were
measured empty. **Re-measure with a 500-row import before calling them under 1 s.**

## 2. Accessibility (axe-core 4.10.2 + manual keyboard)

| Check | Result | Owner / ID |
|---|---|---|
| Text contrast (1.4.3) | **727 failing nodes across 28 page×width runs** (light), same pages fail in dark. Root cause: `--text-3 #8a8d94` = 3.32:1 on white, 3.18:1 on panel-2, 3.10:1 on canvas; dark `#767982` 4.04:1. Used by `.faint`, table headers, `.mode-note`, Theme label/select text, placeholders | lead-designer **A1** (still open on main) |
| Links in text (1.4.1) | `link-in-text-block` on every request page (the "audit log" link in BooksPanel's `.faint` footer: 1.7:1 vs surrounding text, no underline); `/books` dark 43 nodes | A5 |
| ARIA (4.1.2) | `aria-allowed-attr` critical: `aria-pressed` on `<a>` filter chips, `/requests/all` (5) and `/inbox` (11) | A2 |
| Reflow (1.4.10, 320 px) | **Fail on 4 pages:** `/books` 743 px (demo invoice table not wrapped in `.table-wrap`; audit-log fixed grid), `/requests/DEMO-1047` 400 px, `/requests/DEMO-1042` 370 px, `/payments` 407 px. Pass: `/requests`, `/requests/all`, `/requests/DEMO-1043`, `/inbox` | new: F1 |
| Keyboard reach + traps (2.1.1, 2.1.2) | **0 traps** on 14 routes; Tab reached the end of every page; every focused element showed a visible outline (0 invisible stops of 310) | — |
| Keyboard flows | Approve posting on DEMO-1042: reached in 11 Tabs, Enter posted ("Posted 2 line(s) to the demo books."). Decision on DEMO-1047: note reached in 8 Tabs; Enter on "Record the refund" with an empty note → "Add a note first: it's kept with the decision." and focus moved to the note (good) | — |
| Focus after action (2.4.3) | After posting, focus fell to `<body>` (2 of 2 runs): the button unmounts. Badge updated to "Posted" 133 ms after Enter in run 2; in run 1 it still read "Ready to post" 2.5 s later while the message said "Posted" (n = 2, unexplained: re-test) | new: F2 |
| Error state | No `error.tsx` in `src/app`: an unreadable data file gives "Application error: a server-side exception has occurred… Digest: 3082415950", HTTP 200 (`state-error-store-unreadable-1280.png`) | new: F3 |
| Not-found | Unknown request → "Case not found… Back to the queue" (queue hidden in demo), HTTP 200 | new: F4 |
| Loading | Root skeleton labelled "Loading cases" on every route without its own `loading.tsx` | new: F5 |
| Screen reader output | **Not checked** (no VoiceOver/NVDA in the container) | — |
| Zoom 200 % | **Not checked** this run | — |

## 3. Standard scorecard today (the metric: screens meeting the standard / owned screens)

A screen meets the standard only if ALL of: median load and LCP < 1 s (this method), 0 axe
serious/critical, AA contrast, full keyboard with visible focus and no trap, no 2-D scroll at 320 px,
empty + loading + error states that say what to do next, demo label visible in demo.

| Owned screen | < 1 s | AA contrast | Keyboard | Reflow 320 | States | Meets? |
|---|---|---|---|---|---|---|
| 1 Payment list | ✅ | ❌ A1 | ✅ (but A2 ARIA) | ✅ `/requests/all`; ❌ `/payments` | ❌ no error boundary, weak empty | ❌ |
| 2 Match explanation | ✅ | ❌ A1, A5 | ✅ | ❌ DEMO-1042/1047 | ❌ error, not-found | ❌ |
| 3 Approve / reject | ✅ | ❌ A1 | ⚠️ focus lost after action | ❌ (same pages) | ⚠️ "Failed (500)." | ❌ |
| 4 Exceptions queue | ✅ | ❌ A1 | ✅ (A2 on `/inbox`) | ✅ | ❌ | ❌ |
| 5 Xero entry preview | ✅ | ❌ A1, A5 | ⚠️ F2 | ❌ `/books` | ❌ | ❌ |

**Baseline: 0 of 5 owned screens meet the standard. 5 of 5 meet the speed bar.** Fixing A1 (one token,
lead-designer's PR) + F1 + F3 is the shortest path to most of them.

## Open a11y issues (count for the metric)
High: A1 (contrast, everywhere). Medium: A2 (aria-pressed), F1 (reflow, 4 pages), F2 (focus after
action), F3 (no error boundary). Low: A5 (link in text), F4 (not-found copy/status), F5 (loading label).
**Total open: 8** (1 High, 4 Medium, 3 Low). A3, A4 (website form; product `.input` border) are tracked
by lead-designer; A4's product half also touches our forms.
