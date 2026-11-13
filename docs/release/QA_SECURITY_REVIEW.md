# QA + security review: Clearline unified customer-trial release

- **Reviewer:** general-purpose subagent briefed with the `qa-security-engineer` role (`.claude/agents/qa-security-engineer.md`). Independent: I wrote none of the code under review.
- **Date:** 2026-11-13, roughly 11:06 to 11:30 UTC.
- **Software target:** `release/clearline-unified-20261113` at **6fb9433**. Every result below is for 6fb9433 unless marked otherwise.
- **Website target:** `/home/user/rel/site/marketing` at 864dd4b, static export `out/` built 11:11:06 UTC. Reviewed read-only and last, as asked.
- **Data:** everything is fictional and sandbox. I ran no exploit against anything except local servers I started myself.

> **The worktree moved during the review.** At 11:06 UTC HEAD was already d806bb4, with uncommitted edits to `exceptions.ts` and `sample.ts`. By 11:25 it was b5d6d1b ("WIP … untested, not for review") with more uncommitted engine edits.
>
> So that results would hold still, I ran everything against a frozen copy of 6fb9433: `git archive 6fb9433` into my scratchpad, with `node_modules` symlinked. Section 5 has a short, clearly labelled note on the live tree.

## 1. Verdict

**Not ready for a public synthetic-data release at 6fb9433.**

- **What blocks it:** three High defects.
  - The engine can report a payment as "verified" on-chain when it was not (H1, H2).
  - A compliance hold can be bypassed by a provider event (H3).
  - All three contradict claims currently on the website (section 4). Fix them, or withdraw the claims.
- **What I found sound:**
  - Production/demo separation.
  - Secrets hygiene.
  - XSS defences.
  - Maker/checker against honest callers.
  - Idempotency, webhook handling and reconciliation, apart from the items listed below.
- **Overall:** 12 defects (3 High, 3 Medium, 6 Low) and 85 resisted attacks or edge cases, all in `tests/qa-release/`.

## 2. Findings, by severity

Each `DEFECT …` test asserts the correct behaviour and **fails** on 6fb9433. Repro command for all of them: `npx vitest run tests/qa-release`.

### High

**H1. One on-chain transfer is counted as verified settlement for two different payments.**
- **File:** `src/lib/clearline/chain.ts`, `ingestChainObservation`.
  - `existing = chainObservations.find(o => o.txHash === input.txHash)` ignores `intentId`.
  - The existing observation is then refreshed, and the *new* intent's settlement is set to `verified` and its reconciliation to `matched`.
- **Repro:**
  1. Submit two USDC→USDC payouts on `prv_tidewater` with the same amount and beneficiary.
  2. Send `ingest_chain_observation` for intent A with 12 confirmations.
  3. Send the same `txHash` again for intent B.
  4. Both intents now show `settlement: verified`.
- **Reachable from:** the public v1 API (`POST /api/clearline/test/v1/actions` with `{"action":{"type":"ingest_chain_observation",…}}`).
- **Test:** `engine-release.test.ts` › "DEFECT (High) one on-chain transfer (same txHash)…".
- **Fix:** key observations by `txHash` (plus log index). Refuse, or raise `contradictory_evidence`, when a `txHash` already attributed to one intent arrives for another. Never set `verified` on the second.
- **Blocks the release:** yes. A duplicate counted as paid is an escalation case under the role rules, and it contradicts the on-chain claim on the website. There is no money or confidentiality exposure.

**H2. A chain observation marks any payment verified and matched, whatever its route, currency, state or amount.**
- **File:** `chain.ts`, `ingestChainObservation` and `expectedChainAmount`.
  - The amount is only checked when the selected quote's destination currency is USDC.
  - There is no check that the intent was submitted on the testnet route.
- **Repro:** create an SGD→PHP intent (state `created`, no route chosen). Send `ingest_chain_observation` with `amountMinor: 1` and 12 confirmations. The result is `settlement: verified` and `reconciliation: matched`.
- **Test:** "DEFECT (High) a chain transfer of any amount marks a non-stablecoin, never-submitted payment verified and matched".
- **Fix:** only accept chain evidence for an intent whose instruction is on a `stablecoin_testnet` route and in `submitted`, `in_transit` or `provider_reported_completed`. Require an expected amount; refuse otherwise.
- **Blocks the release:** yes, for the same reason as H1.

**H3. A signed provider `payout.in_transit` moves an on-hold payout to `in_transit` with no compliance decision.**
- **Files:**
  - `src/lib/clearline/state.ts`: `on_hold: ["in_transit", …]`.
  - `src/lib/clearline/events.ts`, `ingestPayload`: the generic path applies any allowed transition when `sequence > maxApplied`.
- **Repro:**
  1. Load the sample. The s3_hold intent is `on_hold`, the hold is `open` and reviewer Priya is assigned.
  2. Ingest a correctly signed `{type:"payout.in_transit", sequence: max+1}` for its provider payment id. (The sandbox secret is public by design.)
  3. Execution becomes `in_transit`, while the hold record stays `open` with no decision.
- **Test:** "DEFECT (High) a signed provider payout.in_transit moves an on-hold payout…".
- **What it contradicts:**
  - The `events.ts` header ("A partner hold is never released by a provider event alone").
  - The exception text "the hold is never released automatically".
  - The website (`/developers`: "Holds are never released automatically").
- **Fix:** while a hold is not `released` or `rejected`, record provider progress events as `contradictory_exception_raised` (or `recorded_no_state_change`) and leave execution in `on_hold`. Allow `on_hold → in_transit` only through the release path that requires both a human decision and the partner's release.
- **Blocks the release:** yes, while that claim is published.

### Medium

**M1. Two correction intents for the same returned payout are both accepted (double re-payment).**
- **File:** `src/lib/clearline/actions.ts`, `createIntent`.
  - Any input with `correctsIntentId` skips the duplicate-reference check.
  - Nothing limits the number of corrections per original.
- **Repro:** on the sample, create a correction for s2_returned with key `qa-corr-0001`. Then create another with key `qa-corr-0002`. Both are `applied`.
- **Test:** "DEFECT (Medium) two correction intents…".
- **Fix:** refuse a correction while another non-cancelled, non-failed, non-returned correction exists for the same original. Keep the reference-uniqueness check against unrelated intents.
- **Blocks the release:** no, but fix it before any real pilot.

**M2. A chain transfer to a wallet that is not the beneficiary's still counts as verified.**
- **File:** `chain.ts`. `toAddress` is validated for format only, never compared with the beneficiary's expected wallet. The sandbox adapter derives that wallet from `beneficiaryRef`, but the engine never checks it.
- **Test:** "DEFECT (Medium) a transfer to a wallet that is not the beneficiary's…".
- **Fix:** compare against a per-beneficiary allowlisted address. On mismatch, raise `contradictory_evidence`.
- **Blocks the release:** no on its own. Fix it together with H1 and H2.

**M3. CPU denial of service on the public v1 API: `POST /liquidity` cost grows cubically with workspace size.**
- **Files:**
  - `src/lib/clearline/liquidity.ts`, `computeLiquidity`: for each snapshot × each committed intent, it runs `instructions.find`.
  - `src/app/api/clearline/test/v1/[...path]/route.ts`: `MAX_BODY = 2_000_000`.
  - `src/lib/clearline/serialize.ts`: no limits on array lengths or item shapes.
- **Measured with the public example key:**

  | Body | Snapshots × intents × instructions | Where | Time |
  |---|---|---|---|
  | 186 KB | 400 × 800 × 800 | in-process | 491 ms |
  | 736,401 bytes | 1600 × 3200 × 3200 | real `next start` server | 200 OK in 16.51 s |

  During the 736 KB request, a concurrent `GET /health` took 14.51 s (event loop blocked). Cost multiplies by about 8 per doubling of size, so the 2 MB cap admits requests lasting minutes.
- **Test:** "DEFECT (Medium) a ~190 KB workspace keeps POST /liquidity busy…". The threshold is timing-based; it measured 0.5–1.0 s against a 100 ms bound.
- **Fix:**
  - Use `Map` lookups by id.
  - Cap each workspace array (for example ≤ 500) and the body (for example 256 KB).
  - Validate item shapes in `parseWorkspace`.
  - Set a short `maxDuration` on the host.
- **Blocks the release:** only if it is served from a single long-running Node process (the repo has a Dockerfile). On per-request serverless hosting it costs compute but does not block the release.

### Low

**L1. The middleware matcher skips any path that merely *starts with* `favicon.ico` or `_next/image`.**
- **File:** `src/middleware.ts`, `config.matcher` `/((?!_next/static|_next/image|favicon.ico).*)`.
- **Repro:** `curl --path-as-is http://HOST/favicon.icox` (also `/favicon.ico/../books`, `/_next/imagex`). With `CLEARLINE_CUSTOMER_PREVIEW=1` the response is a 404, but it is rendered by the **legacy root layout**: "Stablecoin payment requests · Demo", "Northwind Pay Pte Ltd", and nav links to `/books` and `/requests`.
- **Data exposure:** none in demo mode, because the layout passes `searchIndex()` only when `DEMO_MODE` is off. With `DEMO_MODE=off` this page would also embed the legacy search index.
- **Test:** "DEFECT (Low) the matcher skips middleware…".
- **Fix:** anchor the exclusions, for example `/((?!_next/static/|_next/image$|favicon\\.ico$).*)`. Also make the root layout's preview branch independent of the header.

**L2. No security headers.**
- **Observed:** `/clearline` and `/api/clearline/test/v1/health` send no `Content-Security-Policy`, no `frame-ancestors` or `X-Frame-Options`, no `X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy`, and do send `X-Powered-By: Next.js`.
- **File:** `next.config.mjs`.
- **Impact:** clickjacking can only change the victim's own local sandbox.
- **Fix:** add `headers()` with these, plus `poweredByHeader: false`. The CSP needs a nonce or hash for the legacy inline theme script.

**L3. Workspaces with malformed items crash both the API and the console.**
- **API:** `{"workspace":{…valid header…,"intents":[null]}}` with valid input returns **HTTP 500** with an empty body. No stack trace leaks and the server stays up.
- **Console:** a valid-schema localStorage workspace with `intents: [null]` or `intents[0].status = null` crashes 6 of 12 pages with Next's "Application error". There is no error boundary or reset link; `/clearline/settings` still works if the user navigates there.
  - Invalid JSON and wrong `schemaVersion` are handled correctly (the console falls back to the sample).
  - A future change to item shapes would hit returning trial users the same way.
- **File:** `serialize.ts` `parseWorkspace` (shallow validation).
- **Test:** "DEFECT (Low) malformed workspace array items crash the handler…".
- **Fix:** deep-validate items, add `src/app/clearline/error.tsx` with a "reset to sample" action, and wrap the handler in try/catch returning 422.

**L4. A deeply nested workspace (≈200 KB of `[[[…]]]`) overflows the stack.**
- **Where:** `workspaceFrom` → `JSON.stringify(body.workspace)` throws RangeError, giving HTTP 500.
- **Test:** "DEFECT (Low) a deeply nested workspace…".
- **Fix:** same as L3.

**L5. An idempotency key equal to an `Object.prototype` name is treated as already used.**
- **Cause:** `KEY_RE` accepts `constructor` and `__proto__`. `ws.idempotency[key]` then returns an inherited member, so the request fails with `idempotency_conflict`.
- **File:** `actions.ts` `createIntent`.
- **Test:** "DEFECT (Low) an idempotency key equal to an Object.prototype name…".
- **Fix:** use `Object.hasOwn`, or a null-prototype map.

**L6. A note containing a newline can forge a line in the exported text report.**
- **Cause:** `safeNote` allows `\n`. `exportCaseReport` writes notes unindented, so `"ok\nSTATUS  execution=… settlement=verified …"` produces a second `STATUS` line.
- **File:** `investigation.ts` `exportCaseReport`.
- **Test:** "DEFECT (Low) a note containing a newline…".
- **Fix:** indent continuation lines, or escape `\n`.

**L7. The legacy test API is weaker than v1 and still public.**
- **Currency:** `POST /api/clearline/test/quotes` with `currency: "BTC"` returns 200 with eligible quotes.
- **USDC units:** the legacy `createIntent` uses ×100 minor units for USDC, while the engine uses 6 decimals.
- **File:** `src/app/api/clearline/test/[action]/route.ts` and `core.ts`.
- **Test:** "DEFECT (Low) legacy /quotes…".
- **Fix:** validate currencies, or retire the legacy endpoints from the preview allow-list.

**L8 (documentation). Maker/checker is not an authentication boundary in the stateless API.**
- **How:** the caller chooses the actor through `X-Clearline-Actor` or body `actorId`. The caller can also send a workspace whose `actors` grant two invented ids `operator` and `approver`, then make and check its own instruction (HTTP 200). Tests marked `DOCUMENTED` pin this.
- **Impact on the public deployment:** none on shared state. Nothing is persisted server-side, so forged roles only change the caller's own copy, returned in the response. There is no cross-user effect and no privilege over any stored data.
- **Risk:** a claims risk. `openapi.yaml` and `/clearline/docs` do say the actor is selected per request. Neither says maker/checker here demonstrates the rule and is not an access control.
- **Fix:** add one sentence to the docs and the website `/developers` page. A real deployment needs server-side identity and stored workspaces before maker/checker means anything.

**Not a defect, but noted.** Both API routes read the full body (`req.text()`) before checking its size, and `middlewareClientMaxBodySize` is 21 MB, so the 2 MB and 12 KB caps do not bound memory per request. Stream the body with a byte limit, or check `content-length` first.

## 3. Attacks and edge cases the code resisted

All of these are passing tests in `tests/qa-release/`.

- **Amounts and currencies:**
  - Refused amounts: 0, −1, 1.5, NaN, Infinity, 1e16, MAX_SAFE_INTEGER+2, "100", null.
  - Refused currencies: BTC, usd, `__proto__`, constructor, toString, "", USDT.
  - `parseAmount` refuses exponents, extra decimals, separators and blanks, and is exact (`"0.29"` → 29; `"6427.830000"` USDC → 6,427,830,000).
  - Statement lines with a bad currency or zero amount are refused.
- **Idempotency:**
  - Same key and body replays the original and creates nothing.
  - Same key with a different body returns `idempotency_conflict`.
  - Header key and body key disagreeing returns 409.
  - A second active intent with the same internal reference is refused.
- **Roles and transitions:**
  - Unknown actor, viewer and compliance cannot create.
  - The maker cannot self-approve; an operator cannot approve; a second approval returns `invalid_transition`.
  - Submit before approve, cancel after submit, choose route before quotes, a clock moved backwards, and approving an expired quote are all refused.
  - The preparer cannot decide their own advance.
- **Webhooks:**
  - Signatures from the wrong provider's secret, a timestamp 1 h stale, a malformed header, or a tampered body are rejected and change nothing.
  - Another provider's payment id gives `rejected_unknown_payment`.
  - A duplicate is ignored; the same id with a different payload gives a `duplicate_event` exception.
  - A late `in_transit` after `completed` gives `stored_late_no_regression`.
  - A contradictory amount, or `failed` after `completed`, raises an exception and leaves state unchanged.
  - A body over 16 KB is refused.
- **Holds (apart from H3):**
  - Partner release alone gives `partner_release_reported`, not released.
  - Reviewer release alone does not release.
  - Only the assigned compliance reviewer can decide.
  - The hold exception cannot be resolved while the hold is undecided.
  - Moving the clock 7 weeks forward does not release it.
- **Reconciliation:**
  - Amount-only matches are never allocated.
  - Missing reference, currency mismatch, overpayment and an ambiguous two-id reference are not allocated.
  - The same line twice gives `duplicate_statement_line`; a re-keyed duplicate is flagged and not counted twice.
  - A partial payment followed by the remainder reaches `matched` only on the full amount.
- **Repayments:**
  - Partial, remainder, overpayment, duplicate, currency mismatch, missing reference, and an amount-only match equal to the outstanding balance are all handled correctly.
  - The repaid state is derived only by reference.
- **Liquidity:**
  - Stale snapshots are excluded.
  - Restricted and safeguarded amounts are subtracted.
  - An advance covered only by a stale balance raises `funding_shortfall` and cannot be approved.
- **Chain (apart from H1, H2, M2):**
  - The wrong chain (8453 or 84533), the wrong contract and the wrong symbol are never counted.
  - Below 12 confirmations gives `pending_finality`.
  - A drop in confirmations is a contradiction.
  - An amount that differs from the quote is a contradiction.
  - A malformed hash, address or confirmation count is refused.
- **API:**
  - 401 without the example key; 422 for a non-JSON content type, invalid JSON, a JSON array, or a body over 2 MB.
  - Non-sandbox, non-fictional or field-missing workspaces are refused.
  - An unknown action type returns 422; an unknown endpoint returns 404.
  - A 500 leaks no stack trace.
- **Preview separation** (`CLEARLINE_CUSTOMER_PREVIEW=1` on `next start`): every non-allowed route returns 404 "Not found" with no data. Section 5 has the counts and the routes covered.
- **Redirects:**
  - The only redirect is `/` → `/clearline`, same origin. `?next=https://evil.example` is ignored.
  - A spoofed `Host` or `X-Forwarded-Host` did not change the redirect host.
  - The `/_next/image` remote URL is not allowed; a local `/api/funding` gives 400 "isn't a valid image".
  - No URL parameter is used as a redirect target anywhere in the console.
- **XSS:**
  - No `dangerouslySetInnerHTML` in the Clearline UI.
  - Markup in intent fields and notes is refused at input.
  - Injected `<img onerror>` in localStorage (beneficiary name, exception explanation, case title, audit summary, actor name, evidence description) renders as literal text on all 12 pages. It never executed and created no `img[onerror]`.
  - Exports are `.txt` and `.json` only, so there is no CSV formula or HTML injection surface.
- **Secrets:**
  - No key patterns (Anthropic, AWS, GitHub, Slack, Stripe, private keys, Google) in `.next/static`, the tracked tree, or `git grep` over 400 revisions.
  - The only hit is the detection regex in `team/knowledge/…/secrets-and-supply-chain.md`.
  - No `NEXT_PUBLIC_*` in `src`. `.env.example` names `TRONGRID_API_KEY` and `ETHERSCAN_API_KEY` with no values. No `.env` is committed anywhere in history.
- **localStorage tampering:** invalid JSON, a wrong schema, or an empty `actors` array fall back safely. The malformed-items case is L3.
- **Mobile and keyboard:** the existing e2e checks for overflow and keyboard pass on desktop (1440×900) and mobile (iPhone 13). The skip link is the first tab stop on `/clearline`.

## 4. Website (`/home/user/rel/site/marketing`, read-only)

Another agent is still editing the site. These results are for commit 864dd4b; no source file is newer than `out/` (11:11:06 UTC).

**Navigation and layout: all checks passed.**
- **Links:** 12 pages, no broken internal links or anchors (`/trial#historical`, `/developers#status-model`, `#quickstart`).
- **Overflow:** none at 320, 390 or 1280 px.
- **Keyboard:** the skip link comes first and every tab stop showed a visible focus ring.

**External links: not checked live.** The `clearline-customer-trial.vercel.app` targets (`/clearline/trial`, `/clearline`, `/clearline/docs`, `/mentor-demo`) are blocked by this session's egress proxy, so I couldn't load them. All four paths return 200 on the 6fb9433 build. The LinkedIn link was not checked.

**Contact form:** it posts to Formspree only when `NEXT_PUBLIC_FORMSPREE_ID` is set; otherwise it shows an email panel.

**Claims the code at 6fb9433 does not back.** I'm flagging these for the copy owner; I did not edit them.
1. `app/developers/page.tsx:215`: "Holds are never released automatically." H3 contradicts this.
2. `app/onchain/page.tsx:15`: "Check token contract, network and finality before attributing a transfer … by its exact reference." Chain evidence is attributed by a caller-supplied `intentId`, with no reference, recipient or transaction-uniqueness check (H1, H2, M2).
3. `app/connect/page.tsx:16` and `app/developers/page.tsx:54`: "self-approval is refused". This is true for honest callers. Add the L8 sentence so it isn't read as an access control.

## 5. Commands run and results (all on the 6fb9433 snapshot unless stated)

**Setup and baseline**

| Command | Result |
|---|---|
| `git archive 6fb9433 \| tar -x` into the scratchpad, symlink `node_modules` | Frozen snapshot, because HEAD moved during the review. |
| `npx vitest run` × 3 | 46 files passed, 1 skipped; **876 passed, 57 skipped (933)**; identical 3 of 3; 7.49 s. |
| `npx tsc --noEmit` | exit 0 (8.0 s). Run again with `tests/qa-release` included: exit 0. |
| `npx next build` | exit 0 in 29.3 s ("Compiled successfully in 14.3s"). |

**End-to-end**

`npx playwright test -c playwright.clearline.config.ts --retries=0` could not run as given: port 3184 was already in use by another process ("already used"). I ran a copy of the config with only the port changed to 3295: **29 passed, 1 skipped**, 33.7 s. I deleted `test-results/` in the snapshot afterwards.

A `test-results/` directory created at 11:17:47 UTC exists in `/home/user/rel/trial`. It came from another agent's Playwright run, not mine, so I left it.

**Preview server and route probes**

`CLEARLINE_CUSTOMER_PREVIEW=1 npx next start -p 3291`. My first attempt on port 3191 failed with EADDRINUSE because another process held it. I discarded the probe results from that foreign server and re-ran everything on 3291.

- **Every route, four methods:** all 64 built routes × GET/POST/PUT/DELETE, 256 requests:

  | Status | Count | Routes |
  |---|---|---|
  | 200 | 69 | `/clearline/**`, `/mentor-demo`, `/icon.svg` |
  | 307 | 4 | `/` → `/clearline` |
  | 401 | 2 | v1 API without the key |
  | 404 | 174 | everything else |
  | 405 | 7 | unsupported methods |

  Non-allowed routes probed include `/api/funding`, `/api/payments/*`, `/api/requests/*`, `/api/accounting/*`, `/api/uploads/x`, `/api/inbox/*`, `/api/demo/reset`, `/api/bulk*`, `/api/pay/x/check`, `/books`, `/funding`, `/requests*`, `/payments*`, `/inbox*`, `/cases/x`, `/bulk`, `/investigate`, `/settings`, `/pay/x`. All returned 404.
  - `/mentor-demo` is allowed by design. Its page imports only the `MentorDemo` component.
- **Bypass probes:**
  - Encoded and dot-segment paths (`%2e%2e`, `..%2f`), `//`, `/API`, `;.css` and `?_rsc`: all 404, or 308 to a path that then returns 404.
  - Headers `x-middleware-subrequest` (3 variants), `x-invoke-path`, `x-matched-path`, `x-now-route-matches`: all 404.
  - Exception: L1.
- **Headers and secrets:** `curl -D -` gives the L2 findings. The bundle, tree and history `grep` and `git grep` scans found nothing (section 3).
- **DoS:** a curl with the 736,401-byte workspace returned 200 in 16.51 s; a concurrent health check took 14.51 s.

**Browser probes**

Playwright scripts (Chromium) for localStorage tampering, XSS and tab order. Results are in L3 and section 3.

**New tests**

`npx vitest run tests/qa-release` × 3: **12 failed, 85 passed (97)**, identical 3 of 3. The 12 failures are exactly the DEFECT tests.

**Website**

A static server over a copy of `out/`, then a Playwright pass for links, anchors, overflow at 320/390/1280, and tab order (section 4). The `curl` reachability check on the Vercel links was refused by the proxy.

**Live tree (informational only).** At b5d6d1b plus uncommitted WIP, around 11:25 UTC, the same 97 tests gave **6 failed, 91 passed**.
- **Still failing:** H3, M3, L4, L6, L7, L1.
- **Now passing:** H1, H2, M1, M2, L3, L5.
- **Caveat:** those fixes are uncommitted and labelled "untested, not for review". I did not review them, or run the full suite, build or e2e on them, so this is not a sign-off of the live tree.

## 6. Files written

- `tests/qa-release/engine-release.test.ts` (67 tests)
- `tests/qa-release/api-release.test.ts` (30 tests)
- `docs/release/QA_SECURITY_REVIEW.md` (this report)

I modified no source file, committed nothing and pushed nothing.
