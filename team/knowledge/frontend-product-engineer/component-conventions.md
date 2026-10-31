# Component conventions in this codebase (match them; don't invent a second way)

Read from `origin/main` @ `0c7d9f1` on 2026-11-01. [VERIFIED: code read] unless marked.

## Stack and structure
- Next.js 15.5 App Router, React 19.1, TypeScript 5.9. **No UI library, no Tailwind in the product**
  (Tailwind is only in the website on `pitch-deck`). Styling = one global stylesheet
  `src/app/globals.css` (~480 lines) with CSS custom properties (tokens) and small utility classes, plus
  inline `style={{…}}` for one-off layout. Fonts: `@fontsource/inter` 400/500/600 and
  `@fontsource/jetbrains-mono` 400/500, imported in `layout.tsx`.
- Pages are **server components** that load from the JSON store (`requestsStore()`, `loadAccounting()`,
  `paymentsStore()`, `inboxStore()`) and are `dynamic = "force-dynamic"`. Interactivity lives in small
  `"use client"` components under `src/components/` (and `components/requests/`, `components/books/`).
- **All wording and verdict logic lives in `src/lib/`** (`requests/present.ts` `verdict()`,
  `nextAction()`, `replyDraft()`; `requests/ui.ts` `glance()`; `accounting/rules.ts` `planPosting()`;
  `payments/view.ts` labels). Components render what lib returns. **Amounts are decimal strings**
  formatted with `formatUsdc()` (`lib/requests/lifecycle.ts`); never `parseFloat`, never arithmetic in a
  component. A UI change that needs a different number is a lib change (matching-engine-engineer /
  accounting-integrations-engineer own those) and, if it touches posting or money amounts, approval-only.

## Tokens (globals.css :root; dark under `prefers-color-scheme` and `[data-theme="dark"]`)
`--canvas #f7f7f5`, `--panel #fff`, `--panel-2 #fafaf9`, `--text #17181c`, `--text-2 #5b5e66`,
`--text-3 #8a8d94` (**fails AA, lead-designer A1**), `--border`, `--border-strong`, `--accent #3b5bdb`,
`--green/-soft`, `--amber/-soft`, `--red/-soft`, `--focus`, `--radius 6px`, `--sidebar 220px`.
Full table with ratios: `team/knowledge/lead-designer/brand-system.md` and `accessibility.md` §3.
**Never add a hex in a component**; a new token goes in globals.css + lead-designer's brand-system in the
same PR, designed by lead-designer.

## Classes and components to reuse
| Need | Use | Where |
|---|---|---|
| Page frame | `.page`, `.page-head` (h1 + actions) | every page |
| Card | `.panel` + `.panel-h` (h2 + meta) + `.panel-b` | everywhere |
| Text tiers | `.muted` (text-2, passes), `.faint` (text-3, **fails today**: don't put essential text in `.faint` until A1 is merged) | |
| Buttons | `.btn`, `.btn-primary`, `.btn-sm`, `.btn-locked` (disabled with reason in the label) | `.btn:disabled` = opacity .5 |
| Banners | `.bar .bar-red` (`role="alert"`), `.bar-amber` (`role="status"`), `.bar-info` | queue, payments, inbox |
| Status | `<Status status="pass|warn|fail|info" label>`: **icon + text, never colour alone** | `components/Status.tsx` |
| Request tone | `<TonePill tone label>` (paid green, progress blue, waiting grey, attention amber, blocked red; dot + text) | `requests/StatePill.tsx` |
| Demo label | `<DemoBadge />` ("Demo data", title explains fictional + simulated) | `requests/StatePill.tsx` |
| Tables | `.table` inside **`.table-wrap`** (scrolls on its own); or `.wide-only` table + `.narrow-only` `ul.cards` below 760 px (inbox pattern) | `/books` demo table forgot `.table-wrap` (F1) |
| Numbers | `.amount` / `.num` (tabular), `.mono` for hashes/IDs; `shortHash`, `shortAddr` for display, full value in `title` | |
| Filters | `nav.chips` of `<Link className="chip">` — use `aria-current="page"` for the active one (A2 fix), restyle `.chip[aria-current="page"]` | `requests/all`, `inbox` |
| Who acts | `useActor()` + `<ActingAs />`; every action sends `actor`; demo default "Mei Tan (Finance ops)" via `data-demo-actor` | `components/ActingAs.tsx` |
| Refresh after a write | `refreshAfterChange(router)` (refreshes at 0/500/1200/2200 ms and pauses `AutoRefresh` 2.5 s) | `requests/AutoRefresh.tsx` |
| Live-ish pages | `<AutoRefresh ms={4000|5000} />` (router.refresh while tab visible) | requests pages |
| Copy to clipboard | `<CopyButton text label />` | `requests/Copy.tsx` |
| Test hooks | `data-testid="…"` on anything e2e checks (`verdict`, `next-step`, `books-panel`, `books-status`, `posting-lines`, `approve-posting`, `decide-<kind>`, `mark-paid-blocked`, `attention-item`) — **never rename one without updating `tests/e2e/demo_cases.py`** | |
| Responsive | breakpoints in globals.css: 1100 px (`.cols` to one column), 760 px (`.wide-only`/`.narrow-only`, sidebar to top bar) | |
| Motion | every animation has a `prefers-reduced-motion: reduce` off switch (`.skel`, `.pill-confirming`, `.tone-progress`) | keep it that way |
| Focus | global `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }` — don't remove outlines; don't set `outline: none` without a replacement | globals.css:87 |

## Tests for UI
- `vitest` runs only `tests/**/*.test.ts` in Node: **there are no component render tests**. Logic that
  produces UI text (present.ts, ui.ts, rules.ts) is unit-tested there; put new copy logic in lib so it
  can be tested.
- The browser e2e is Python Playwright: `tests/e2e/demo_cases.py` (cases a-g on the demo; checks verdict,
  evidence, next step, reply, the decision, no console errors, no horizontal scroll at 1280×720 and
  390). Run it against `next start` on port 3300 (`BASE=…`). `tests/e2e/record_demo.py` records the demo.
- CI (`.github/workflows/ci.yml`): `npm ci`, `npx tsc --noEmit`, `npx vitest run`, `npx next build`,
  and a lint job (`npm run lint`). e2e and a11y are **not** in CI: you run them and paste results.

## Code style seen in owned components
Comments explain *why* in one line at the top of a component; strings are written inline in the
component or in a `COPY`/`KIND`/`STATUS` record at the top of the file; short helper components in the
same file; no state libraries; `fetch` to `/api/...` with `{ actor, ... }` JSON and `{ error }` /
`{ message }` responses.
