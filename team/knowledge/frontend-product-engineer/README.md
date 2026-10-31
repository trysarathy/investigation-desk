# Knowledge pack: frontend-product-engineer

Reference material for the engineer who builds the finance controller's screens: payment list, match
explanation, approve/reject flow, exceptions queue, Xero entry preview. lead-designer designs; this
engineer builds, measures and proves.

**Last refreshed:** 2026-11-01 SGT against `origin/main` @ `0c7d9f1` (Next 15.5.28).
**Refresh owner:** frontend-product-engineer — re-measure `baseline.md` after every merged PR that
touches an owned screen, and in full monthly with the golden-task re-run; re-read `screens-today.md`
when `src/app` or `src/components` changes. research-intern's monthly knowledge refresh re-opens the
standards' sources.

Labels: `[VERIFIED: <url> opened <date>]` primary source opened (the publisher's page or its own source
repo); `[VERIFIED: measured <date>, <script>]` a number measured this run; `[VERIFIED: code read]` read
from the code at the commit above; `[ASSUMPTION: …]` not checked or secondary; `[GUESS]`. No invented
facts, numbers or people. A fact reused from another pack keeps its owner and date.

| File | Use it for | Refresh when |
|---|---|---|
| `screens-today.md` | Route → file → which owned screen; what states exist or are missing; copy that conflicts with PRODUCT_FACTS; UI defects | Any change in `src/app`, `src/components`, `src/lib/requests/present.ts`, `ui.ts` |
| `baseline.md` | The measured baseline: load times (n = 5, method), axe results, keyboard, reflow, states; scorecard 0/5 screens at standard; open a11y issues (8) | After each owned-screen PR (the metric), monthly in full |
| `baseline/` | Screenshots (`<route>-1280.png`, `-390.png`, `state-*`, `xero-preview-*`, `approve-flow-*`) and raw `measure.json`, `measure-cpu4.json` | With `baseline.md` |
| `standards.md` | The role's standards S1-S9 with their measurable definitions and sources (WCAG 2.2 SCs, APG, Next.js, web-vitals thresholds, GOV.UK); the benchmark table with honest labels | When a blocked host opens (flip labels), when WCAG/Next changes |
| `error-messages.md` | Five rules for errors/status/empty states; every existing message with keep/fix and the replacement line | When copy changes |
| `component-conventions.md` | How UI is built here: server pages + small client islands, lib owns wording and amounts, tokens, classes and components to reuse, test hooks, CI | When a shared component or token changes |
| `measuring.md` | Copy-paste procedure for load time, a11y, reflow, keyboard flows and state screenshots | When a tool or the method changes |
| `tools/*.cjs` | `measure.cjs`, `keyboard-flow.cjs`, `reflow-dark.cjs`, `state-shot.cjs` | — |

Related packs (read, don't copy): `team/knowledge/lead-designer/` (tokens, contrast table, A1-A10
findings, review checklist — the designer's gate); `team/knowledge/crypto-protocol-engineer/codebase-map.md`
(the lib behind the screens).

## Decisions recorded here (2026-11-01)
- "Loads in under 1 s" = median of 5 fresh-context navigations, local production build, demo day loaded,
  Chromium 1280×800, 1× CPU: load event AND LCP < 1000 ms. 4× CPU reported, not gated. This is stricter
  than Google's 2.5 s "good" LCP, on purpose (a finance tool should feel instant), and it measures our
  code, not the network.
- WCAG 2.2 AA is the gate; axe-core 0 serious/critical is necessary, not sufficient (keyboard pass and
  screenshots always).
- Amounts and posting lines on screen come only from `src/lib` (`planPosting`, `formatUsdc`); the UI never
  computes, rounds or edits them.

## Could not verify on 2026-11-01
w3.org, web.dev, nextjs.org, nngroup.com, design-system.service.gov.uk, linear.app, stripe.com,
vercel.com did not resolve from the session (proxy/DNS). Source repos used instead where they exist; NN/g,
Linear, Stripe and web.dev claims are `[ASSUMPTION: not opened]`. Screen readers, 200 % zoom, a deployed
(networked) load time, and `/payments` / `/inbox` with real-sized data were not measured.
