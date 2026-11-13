# QA + security review V2: Clearline v2 release candidate

- **Reviewer:** a fresh general-purpose subagent briefed with the `qa-security-engineer` role (`.claude/agents/qa-security-engineer.md`). I wrote none of this code and had not reviewed it before. I read `QA_SECURITY_REVIEW.md` and `CODE_REVIEW.md` for context only.
- **Date:** 2026-11-13, about 15:10 to 15:40 UTC.
- **Software target:** `release/clearline-v2-20261113` at **c498da6**, frozen with `git archive c498da6` into my scratchpad. Diff under review: `13e2a34..c498da6`.
- **Website target:** `release/clearline-site-v2-20261113` at **8d98e3d** (`marketing/`), frozen the same way and reviewed read-only.
- **Data:** fictional sandbox only. Every exploit ran against servers I started locally, and I stopped them all afterwards.
- **I did not** edit source, commit or push. New files are listed in section 6.

> **HEAD moved during the review.** By 15:37 UTC the live branch was at **dd52f88**, which adds `e3336da` ("code review v2 — F1 order-independent … outstanding vs resolved differences") and `dd52f88`.
>
> All verdicts below are for **c498da6**. Section 5 has an informational run of my new tests on a frozen dd52f88. That run does **not** sign dd52f88 off: I did not build it, run its full suite or run its e2e.

## 1. Verdict for c498da6

**No finding blocks a public trial on fictional data.** There is one Medium defect and four Low ones. None of them counts money as paid, verifies settlement that has no evidence, releases a hold, or exposes data or secrets.

**What I found sound:**
- Route isolation: no route outside the allow-list answered with anything except 404.
- The 308 redirects: same origin, and query or path tricks could not turn them into open redirects.
- Security headers on every response type.
- The v1 limits and malformed input: 1,111 requests, zero 5xx.
- Every financial invariant I was asked to check, except where M1 below says otherwise.
- Engine gating in the UI: buttons forced on with devtools are still refused by the engine.
- XSS: no execution through 212 user fields on 20 pages, including exports.
- No secrets in the bundles.
- The website: links, overflow at 4 widths, axe, keyboard, and contrast claims checked against the tokens.

**What to fix:** M1 is a gap in the headline F1 fix. It is order-dependent: one order surfaces the contradiction and the other drops it. Fix M1 before F1 is described as done. Fix L1 and L2 before the console is shown at tablet or small-laptop widths.

## 2. Findings, by severity

Each "DEFECT" test asserts the correct behaviour and **fails on c498da6**.

### Medium

**M1. F1 depends on the order of events: a settlement report recorded before the payout fails stays as settlement evidence, and no contradiction is raised.**
- **Files:**
  - `src/lib/clearline/reconciliation.ts` `reconcileLine`: the F1 check only runs when the report arrives *after* the terminal status.
  - `src/lib/clearline/derive.ts` `recomputeDimensions`: it has a terminal guard, but it runs only after a person resolves an exception (`actions.ts:642`), not when the execution status changes.
- **Repro through the real v1 API** (`next start`, `CLEARLINE_CUSTOMER_PREVIEW=1`, script `scratchpad/probes/f1order.mjs`):
  1. Create, quote, route, approve (`usr_daniel`) and submit a payout of SGD 10,000.00.
  2. `events/simulate` moves it to `in_transit`.
  3. `reconciliation/statement-lines` with a full-amount `provider_settlement_report` returns `recorded_provider_report`. Settlement is now `observed`, scope `provider_report`.
  4. A signed `payout.failed` webhook returns `applied`. The status is now `{execution: failed, settlement: observed, settlementScope: provider_report}`.
  5. `investigate()` gives `contradictions: []`. The only exception is `PV_FAILED_BENEFICIARY_REJECTED`.
- **What the console shows** (localStorage seeded with that workspace, `/clearline/payments/<id>`):
  - Headline: "Provider reports failed · Settlement observed (not verified) (Provider report only) · Awaiting statement".
  - "What contradicts": "No contradictions found."
  - In the other order (report after failure), the same two provider claims produce `RC_REPORT_ON_TERMINAL_PAYOUT` and settlement `none`.
- **Test:** `tests/qa-release-v2/engine-v2.test.ts` › "DEFECT (Medium) F1 report BEFORE failure…".
- **Blocks a fictional-data trial:** no. Nothing shows as verified or paid, and the label says "not verified". But this breaks the "contradictions don't disappear" invariant, and F1 should not be called fixed at c498da6.
- **Status at dd52f88 (informational):** the test passes. `onExecutionChanged` was added in e3336da.

### Low

**L1. A fully matched payout still lists a stale "remainder stays outstanding" difference.**
- **File:** `src/lib/clearline/investigation.ts`. `investigate().amountDifferences` takes every linked line with `amountDifference` and never checks whether a later line closed the gap.
- **Repro** (real API, then the console):
  1. A completed SGD 10,000.00 payout gets a bank line of SGD 2,500.00 and then the SGD 7,500.00 remainder.
  2. Status: `verified`, `matched`, and `outstanding: []`.
  3. `amountDifferences` still contains `RC_PARTIAL_AMOUNT` with difference SGD 7,500.00 and the text "Find the statement line for the remaining SGD 7,500.00. The remainder stays outstanding…".
  4. The console renders this table under **"Financially outstanding"**, below a headline that says "Settlement verified … Matched".
- **Impact:** it overstates what is outstanding. That is the safe direction, but the figure is wrong, and a person would chase a shortfall that does not exist.
- **Test:** `engine-v2.test.ts` › "DEFECT (Low) after a partial bank line and the exact remainder…".
- **Blocks:** no.
- **Status at dd52f88:** the test passes.

**L2. The Payments list scrolls horizontally at tablet and small-laptop widths.**
- **Where:** `/clearline/payments`. `document.scrollWidth` is 888 px at viewport widths 700–800 and 1144 px at 1000–1100. The wide `ui_table ui_stack` table pushes past the viewport.
- **Effect:** at 768 px the Settlement and Reconciliation columns are cut off at the right edge (screenshot `scratchpad/probes/payments-768.png`).
- **Unaffected:** every other console page, and every page at 1440, 1280, 600, 480, 390 and 320 px.
- **Why the existing e2e missed it:** it checks 1440 px and iPhone 13 only.
- **Test:** `tests/qa-release-v2/console-v2.spec.ts` › "DEFECT (Low) /clearline/payments has no horizontal page overflow at 768px / 1024px".
- **Blocks:** no.
- **Status at dd52f88:** not run. Neither `Payments.tsx` nor `ui.module.css` changed after c498da6, so it most likely persists.

**L3. R4 (streamed body limit) only holds inside the route handler; the deployed server still takes the whole chunked body.**
- **Handler level: holds.** `readBodyLimited` stops at 512 KB, and the existing `change5.test.ts` R4 tests pass.
- **Real `next start`: does not hold.** Chunked POSTs to `/api/clearline/test/v1/liquidity` with no Content-Length were received in full before the 422:

  | Body | Status | Time | Server RSS |
  |---|---|---|---|
  | 3 MB | 422 | 26 ms | 291 → 297 MB |
  | 20 MB | 422 | 130 ms | 303 → 372 MB |
  | 30 MB | 422 | 93 ms | not recorded |

  An endless writer was accepted for 50 MB before the response arrived.
- **Likely cause:** Next's middleware request-body cloning (`middlewareClientMaxBodySize` 21 MB) runs before the handler. I inferred this and did not isolate it.
- **Bound:** the same as the previous review's R4: about 21 MB per request plus the host's own limit.
- **What is misstated:** the CHANGE 5 comment "chunked bodies are never read in full" is true only for the handler.
- **Test:** none (it needs a real server). Repro: `scratchpad/probes/chunked.mjs <pid> 20971520`.
- **Blocks:** no.

**L4. axe `landmark-unique` (moderate) on 5 console pages.**
- **Pages and duplicated region ids:** `/clearline` (`#attention`), `/clearline/payments/pi_00027` and `pi_00090` (`#timeline`), `/clearline/treasury` (`#balances`), `/clearline/reports` (`#cases`).
- **Seen at:** 1440 and 390 px.
- **Every other axe rule:** 0 violations on all 17 console pages.
- **Blocks:** no.

**L5. Website status words differ from the console's for the same API value.**
- **Where:** `marketing/components/Status.tsx` against the engine's `HUMAN_LABELS`.

  | API value | Website | Console |
  |---|---|---|
  | `failed` | "Failed" | "Provider reports failed" |
  | `returned` | "Returned" | "Provider reports returned" |
  | `submitted` | "Submitted to provider" | "Sent to provider" |
  | `observed` | "Observed, not verified" | "Settlement observed (not verified)" |
  | `pending` | "Awaiting match" | "Awaiting statement" |
  | `exception` | "Exception" | "Needs review" |

  The exact API values match everywhere, and no wording is financially wrong.
- **Developers page gap:** `/developers` describes a provider settlement report as `recorded_provider_report` and does not mention the F1/F2 outcomes: `exception_raised` with `RC_UNDER_AMOUNT_REPORT`, and `contradictory_exception_raised` with `RC_REPORT_ON_TERMINAL_PAYOUT`.
- **Blocks:** no. This is for the copy owner; I did not edit the site.

### Informational (not defects at c498da6)

- **Client-held state is trusted as data.**
  - `parseWorkspace` accepts a localStorage workspace in which the hold is `released` with no decisions, and a returned payout is `verified`/`matched`. The console renders those values, for example "Released by reviewer".
  - This only changes the visitor's own sandbox. Engine actions on it still go through the state machine.
  - It is the same class as the earlier L8 (the stateless API trusts the caller's workspace). It needs cross-field validation before any shared or persisted deployment.
- **A resolved under-amount exception becomes "observed" settlement.**
  - After a person resolves an `RC_UNDER_AMOUNT_REPORT` exception, `recomputeDimensions` sets settlement to `observed` / `provider_report` on the strength of the short report.
  - It is still labelled "not verified".
  - The dd52f88 diff appears to address it (`isAgreeingProviderReport`). I did not test that.
- **Held payouts and settlement.**
  - At c498da6, a provider settlement report on a held payout gives settlement `observed`, while execution stays `on_hold` and the hold stays `open`. dd52f88 adds `RC_REPORT_ON_HELD_PAYOUT` (not tested by me).
  - A bank debit on a held payout gives `verified`/`matched` with the hold still open. This predates the diff: settlement here means evidence of the debit.

## 3. Attacks and edge cases the code resisted (c498da6)

**F1 and F2 through the real v1 API, and in the console**
- **F1:**
  - A provider report on the returned sample payout (`pi_00027`) gives `contradictory_exception_raised`; settlement stays `none`.
  - A report on a failed payout (report after failure) gives the same result.
  - The console's "What contradicts" shows `RC_REPORT_ON_TERMINAL_PAYOUT` with the explanation.
- **F2:**
  - An SGD 4,000.00 report against SGD 10,000.00 gives `exception_raised`, with `amountDifference` {expected 1,000,000, reported 400,000, difference 600,000, SGD, source, next action}. Settlement stays `none`.
  - The console shows Expected, Reported, Difference, Source and Next action.
  - Two half-amount reports never add up to settlement.
  - An exact report gives `observed` / `provider_report`, never `verified`.
  - A tampered `amountDifference` (`{}`, `null`, `"x"`, an inconsistent difference, currency `XXX`, 1e20) is rejected with 422.

**Financial invariants**
- **One transaction, one obligation:** an amount-only repayment equal to the outstanding SGD 50,000.00 is not allocated. It stays unallocated after the clock is moved forward, and its exception cannot be resolved without an owner and evidence (409).
- **Provider completion never proves settlement:** three simulated events lead to `provider_reported_completed` with settlement `none`. `describeStatus` never says paid or delivered.
- **A returned payout is never shown as delivered:** the sample shows "Provider reports returned · No settlement evidence · Needs review".
- **Maker ≠ checker:** a maker approving their own instruction gets 403 `maker_checker_violation`.
- **Holds are never silently released:**
  - A signed `payout.completed` on the held payout gives `contradictory_exception_raised`; it stays `on_hold` and the hold stays `open`.
  - Moving the clock to 2027-03-01 leaves it `on_hold`/`open`.
  - The partner's `hold_released` alone gives `partner_release_reported`, still `on_hold`.
  - A release by Maya or Daniel gives 403 `unauthorized_actor`. A release by Priya before documents are submitted gives 422 `precondition_failed`.
  - A reject by Priya gives `rejected`, then `cancelled`, which matches the website's `/developers` claim.
- **Contradictions don't disappear:**
  - The F1 contradiction cannot be resolved with a note alone (409).
  - A later identical report does not clear it.
  - The exception (F1 order gap: see M1).
- **Chain claims on the website (`/onchain`, `/developers`):**
  - Finality with the provider-reported hash gives `verified` + `matched`.
  - A different provider hash gives `verified`, reconciliation `pending`, and a `CH_TX_DIFFERS_FROM_PROVIDER` contradiction.
  - No provider hash gives `verified`, reconciliation `pending`.
  - All three are consistent with "finality sets settlement; reconciliation becomes matched only when the provider reported the same transaction hash".

**Engine-gated UI actions**
- On `/clearline/payments/pi_00001`, "Cancel payment" is disabled. I removed `disabled` in the DOM and clicked: the result was "Cancel payment — not applied … (invalid_transition)" and the status was unchanged.
- The same forcing on "Resolve" (case) and on "Record reviewer decision: release" as a non-compliance actor: the engine refused (`unauthorized_actor`), and the hold stayed `open`.
- Every action calls `applyAction` (`workspace.tsx` `dispatch`). The disabled state is only a dry-run preview.
- Setting `clearline.console.actor.v1` to an unknown id is ignored (only `SAMPLE_ACTORS` are accepted).

**XSS and exports**
- **Injected:** `<img onerror>`, `<svg onload>` and `<script>` payloads in 212 string fields: beneficiary, titles, notes, explanations, reasons, actor names, `requiredAction`, `requiredNextAction`, counterparty, purpose and more.
- **Result on 20 console pages:** no script ran, no injected element was created, and no dialog appeared.
- **Exports:**
  - `.txt` and `.json` downloads (Blob, `text/plain` and `application/json`) contain the payload as inert text.
  - There is no CSV or HTML export.
  - A case title with `\n` does not forge a `STATUS` line (the earlier R3 still holds).

**Route isolation** (`next start`, `CLEARLINE_CUSTOMER_PREVIEW=1`)
- **Coverage:** 74 built routes × GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS, 518 requests. This covers all the new `/clearline/routes*`, `/clearline/holds`, `/clearline/reports` and `/clearline/treasury*` routes, and the 9 moved URLs.

  | Status | Count |
  |---|---|
  | 200 | 108 |
  | 204 | 11 |
  | 307 | 7 |
  | 308 | 18 |
  | 400 | 17 |
  | 401 | 1 |
  | 404 | 301 |
  | 405 | 49 |
  | 410 | 6 |

- **What returned 404:** every route outside the allow-list, with a plain "Not found" body. That covers legacy `/books`, `/requests*`, `/payments*`, `/inbox*`, `/funding`, `/settings`, `/pay/x` and every legacy `/api/*`.
- **Headers:** every response carried CSP. None carried `X-Powered-By`.
- **Lookalike paths:** `/_next/imagex`, `/_next/foo` and `/clearline/..%2fbooks` render "Not found — Clearline" with no legacy branding. `/favicon.icox` returns a plain 404.
- **Other methods on console pages:** POST, PUT, PATCH and DELETE render the page (200). There are no server actions (`"use server"` appears nowhere in `src`).

**308 redirects**
- **Shape:** 9 old URLs return 308 on GET and HEAD with a **relative** `Location` (`/clearline/...` plus `url.search`), `Cache-Control: no-store`, and the CSP. Other methods return 405.
- **Tricks tried:** `?next=https://evil.example`, `?//evil.example`, `?%0d%0aSet-Cookie:x=1` (encoded), `?@evil.example`, an absolute request URL on another host, and a spoofed `Host`.
- **Result:** the Location always started with `/clearline/` and resolved to the same origin.
- **Path variants:**
  - `//clearline/connect` and `/clearline/connect/` return 308 to `/clearline/connect`, which then 308s to the target.
  - `/clearline/connect//evil.example` returns 308 to `/clearline/connect/evil.example`, which is a 404.
  - `%2f%2f`, `..%2f`, `%00`, `;` and upper-case variants return 404.
  - `/\evil.example` returns 308 to `/evil.example`, which is a same-origin 404.
- **`/` → `/clearline`:** the 307 ignores `Host: evil.example`. `X-Forwarded-Proto: https` changes only the scheme.

**v1 limits and malformed input**
- **512 KB:**
  - 512 KB − 100 B gives 200.
  - 512 KB + 1 B gives 422.
  - Chunked bodies give 422, but are received in full (L3).
- **1,000 items:** at the HTTP level, 1,000 or 1,001 realistic statement lines exceed 512 KB, so both gave 422 on size. The item cap is still in code (`route.ts:80`), and the earlier 1,001-item test passes in the full suite.
- **Depth:** `organization.extra` nested 28 or 29 deep gives 200; 30 to 33 deep give 422 "Workspace nests deeper than 32 levels". 200,000-deep `input`, `line` and `action` give 422 in 73–144 ms.
- **Fuzz: 1,111 requests, zero 5xx.**
  - 23 endpoints × 31 malformed bodies.
  - 380 requests with structurally valid workspaces carrying one broken item (19 arrays × 5 bad values × 4 operations).
  - Plus the limits and tamper cases above.
  - Results: 200 × 44, 400 × 36, 404 × 154, 409 × 20, 422 × 857.

**Error boundary**
- **Tampered localStorage workspaces (10 variants):**
  - 7 were refused by `parseWorkspace`, and a visible "replaced by the sample" notice was shown.
  - 2 (case `notes: [null]`, exception `history: [null]`) reached `src/app/clearline/error.tsx`. The navigation stayed usable; "Try again" kept the data; "Reset to sample" showed the reset notice and the page then rendered.
  - 1 (bogus quote currency) rendered normally.
- **"Application error":** none seen.

**Secrets**
- A key-pattern scan of `.next/static` (app) and `marketing/out` found **0** hits.
- The added lines in both diffs had no secrets.
- The public sandbox key and webhook secret are not in the client bundle.
- The only `NEXT_PUBLIC_*` variables are site URLs and the Formspree id.

**Website (8d98e3d, static `out/`)**
- **Overflow:** none on 12 pages at 1440, 768, 390 or 320 px.
- **axe-core 4.10.2:** 0 violations at 1440 and 320 px.
- **Links:** 15 internal links and anchors resolve.
- **Keyboard:** on `/`, `/developers` and `/contact` the skip link is the first tab stop, and all of the first 25 tab stops show a visible focus.
- **Contrast:**
  - I recomputed all 27 ratios documented in `tokens.css`, and all 27 match within 0.02. Electric Blue as text on off-white is 4.495:1, as stated, and the file correctly forbids that pair.
  - The console and the website use the identical hex set.
- **Sample data:** the site's sample payments match the engine sample (amounts, statuses, `returnStatus`).
- **Hold claim:** the `/developers` hold claims ("No provider event alone moves it", reject → cancelled) match the engine.

## 4. Commands and results (c498da6 snapshot unless stated)

**Setup and baseline**

| Command | Result |
|---|---|
| `git archive c498da6 \| tar -x` and `git -C site archive 8d98e3d \| tar -x`; `npm ci` in each | ok (122 and 127 packages) |
| `npx tsc --noEmit` | exit 0. Exit 0 again with `tests/qa-release-v2` added. |
| `npx vitest run` × 3 | **51 files passed, 1 skipped; 1079 passed, 57 skipped (1136)**; identical 3 of 3. Times 13.21 s, 44.12 s and 39.52 s (runs 2 and 3 overlapped with other work). |
| `npx next build` | exit 0. "Compiled successfully in 23.3s"; 44 static pages. |

**End-to-end**

`npx playwright test -c playwright.qa.config.ts --retries=0` used a copy of `playwright.clearline.config.ts` with the port changed from 3184, which another process held, to 3484. Chromium 1194 was found by the config's own preinstalled-path fallback. Result: **64 passed, 2 skipped**, 1.6 min.

**Preview server and probes**

`CLEARLINE_CUSTOMER_PREVIEW=1 npx next start -H 127.0.0.1 -p 3491`, probed with scripts in `scratchpad/probes/`:
- `routes.mjs`: route × method isolation.
- `api.mjs`, `hold2.mjs`, `claims.mjs`, `f1order.mjs`: F1/F2, invariants and website claims.
- `limits.mjs`: limits and fuzz.
- `chunked.mjs`: streaming.
- `browser1.mjs`, `browser2.mjs`, `view.mjs`, `eb.mjs`: console F1/F2, XSS, forced clicks, localStorage tampering and the error boundary.
- `console-a11y.mjs`, `ov768.mjs`: overflow at 9 widths and axe.

In `api.mjs`, one check was mine and wrong: it expected status 200 where the API correctly returns 201 for a created exception. It is not counted as a finding.

**New tests**

| Command | Result |
|---|---|
| `npx vitest run tests/qa-release-v2` × 3 | **2 failed, 20 passed (22)**; identical 3 of 3. The 2 failures are the M1 and L1 DEFECT tests. |
| `npx playwright test -c tests/qa-release-v2/playwright.qa-v2.config.ts --retries=0` (port 3485, needs a prior `next build`) | **2 failed, 3 passed**. The 2 failures are the L2 DEFECT tests at 768 and 1024 px. |

**Website**

| Check | Result |
|---|---|
| `npm test` | 28 passed, 1 skipped (29). The skipped test needs `out/` to exist before the run. |
| `npx tsc --noEmit` | exit 0 |
| `npx next build` | exit 0, 17 routes, static export |

I then ran a static server over `out/` on port 3492 and a Playwright and axe pass (`site.mjs`). The external `clearline-customer-trial.vercel.app` links could not be fetched from here (curl got status 000 through the egress proxy). Their paths (`/clearline`, `/clearline/trial`, `/clearline/docs`, `/clearline/docs/openapi.yaml`, `/mentor-demo`) all return 200 on my c498da6 preview server.

**Cleanup**

I stopped the servers I started on 3491 and 3492. Playwright's own servers on 3484 and 3485 exited with their runs. I did not touch the process on 3184.

## 5. Informational: my new tests on dd52f88

I froze dd52f88 with `git archive` and symlinked the dependencies. `npx vitest run tests/qa-release-v2` × 3 gave **22 passed (22)**, identical 3 of 3. The M1 and L1 DEFECT tests pass there.

During that run, one of my own pinned tests failed at first. It asserted the outcome string `exception_raised` for a second identical half-amount report, and dd52f88 now returns `duplicate_report_linked`. The invariant that test protects (settlement stays `none`) still held, so I narrowed the assertion to the invariant. This was over-specification in my new test, not a defect.

Not done on dd52f88: build, full vitest, e2e, server probes, and the L2 overflow check. **Before shipping dd52f88 or later, re-run the full gates and these probes.**

## 6. Files written

- `tests/qa-release-v2/engine-v2.test.ts`: 13 tests, 2 of them DEFECT (M1, L1).
- `tests/qa-release-v2/api-v2.test.ts`: 9 tests (redirect invariants and tricks, F1 through the v1 route, `amountDifference` tampering, error boundary present).
- `tests/qa-release-v2/console-v2.spec.ts` and `playwright.qa-v2.config.ts`: 5 browser tests, 2 of them DEFECT (L2). Output goes to `test-results/qa-release-v2`.
- `docs/release/QA_SECURITY_REVIEW_V2.md`: this report.
