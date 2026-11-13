# CODE REVIEW: BLOCK 6fb9433

**APPROVAL-ONLY: needs Aashmiin's merge.** This change touches money amounts and permissions (maker/checker roles, actor roles).

**In plain English:** the main rules hold up. Amounts are exact, the webhook signature code is correct, a provider's "completed" webhook never marks a payment settled, and an amount-only match never closes anything. Two paths do break the product's central promise, though. (1) A blockchain observation can mark an ordinary bank (fiat) payout as "settlement verified" and "reconciliation matched". (2) One on-chain transfer can be counted as the payment for a second, unrelated payout. Both are blockers. Ten further defects are Major, mostly about evidence and status rules. Each one below has a reproduction.

| | |
|---|---|
| Reviewer | `code-reviewer` role, run by a general-purpose subagent briefed with `.claude/agents/code-reviewer.md`. I wrote none of this code. |
| Scope | `git diff origin/trial/clearline-customer-preview-20261113..6fb9433`: 98 files, +8,684 / −498 |
| Date | 2026-11-13 SGT |
| Independence caveat | Commit 6fb9433 carries the same `Claude-Session` link (`session_015s4Kk7…`) as the session that started this review. I did not write or suggest any of this code, so under the role rules this is not a recusal. It does mean the reviewer and the author share one orchestrating session. A second reviewer, or Aashmiin, should look at the Blockers before anyone relies on this verdict. |
| Moving branch | The branch moved while I reviewed it (now `b250bb4`, with WIP commits `7afeec0` and `d806bb4` on top of 6fb9433). Someone was also editing the working tree. To keep the review consistent, I checked out a frozen copy of 6fb9433 (`git archive`) into my scratch folder and reviewed that. Line numbers below are for 6fb9433. **Later commits were not reviewed.** Some may fix M2b (the returned-payout status); I have not checked. |

## Checks I ran (on the 6fb9433 snapshot)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (whole `src`) | exit 0 |
| `npx vitest run tests/clearline` | 12 files, 103 tests passed |
| SHA-256 and HMAC-SHA256 (`sha256.ts`) compared with Node `crypto` | Identical on 300 random inputs: lengths 0–299, multibyte UTF-8, keys longer than 64 bytes |
| Engine probes: 13 cases, scratch tests `tests/probe/probe*.test.ts` in the scratch copy | Results are cited as P1–P13 below |
| `npm run lint`, `npx next build`, Playwright (`tests/browser/*`) | **Not run.** Lint installs packages; the build and the browser suites need a server and a browser. I report none of them as passing. |
| Proving each new test fails without its fix | **Not done.** Almost every file in this diff is new code, so there is no "before" version to revert to. |

## What I verified works

- **Money.** `parseAmount` is exact (BigInt), USDC has 6 decimals, `formatMinor` is exact, and `addMoney` refuses to add two different currencies. Fees and conversions round down and stay within safe integers, because the route maximum is checked before fees are computed.
- **Webhook signature.** The signature is `t=…,v1=hex(HMAC(secret, t.body))`. The comparison is constant-time, the time window is 300 seconds, and a bad signature is recorded but never applied. Deduplication is by (provider, event id); a redelivery with a different payload raises `duplicate_event`.
- **Provider webhooks** never set settlement to `verified` or reconciliation to `matched`. `payout.completed` only moves reconciliation from `not_started` to `pending`.
- **Amount-only matches** are never allocated. Ambiguous references keep every candidate. An unreferenced SGD 20,000.00 receipt stays an exception (`RC_AMOUNT_ONLY_CANDIDATES`).
- **Funding sample (P10).** Principal SGD 50,000.00, repaid 30,000.00 by reference, outstanding 20,000.00, state `partly_repaid`. Maker `usr_maya`, checker `usr_daniel`.
- **Maker ≠ checker** is enforced for instructions, advances and hold documents.
- **Holds.** A partner's release message alone never releases a hold; release needs both the reviewer's decision and the partner's release.
- **Purity.** The engine has no `Date.now`, `new Date()` or `Math.random` (the legacy `core.ts` is the only exception).
- **Console.** It imports only `@/lib/clearline` and does not compute money. It only counts and filters on statuses the engine has already set.

---

## Blockers

### B1. A chain observation can mark a bank (fiat) payout as settlement `verified` and reconciliation `matched`
- **Where:** `src/lib/clearline/chain.ts:53-57`, `:86-87`, `:143-157`; `src/lib/clearline/actions.ts:79-87`.
- **Evidence (P1):** I took an SGD→PHP Northline payout (bank rail, still `submitted`) and sent `ingest_chain_observation` with the allowlisted token and 12 confirmations. Result: `{"execution":"submitted","settlement":"verified","settlementScope":"onchain_transfer","reconciliation":"matched"}`. There is no allocation and no statement line behind that "matched".
- **Why it fails:** `expectedChainAmount` returns `undefined` unless the quote's destination is USDC. When it is undefined, the amount check is skipped entirely. Nothing checks the rail or the intent's state, and `toAddress` is never compared with the beneficiary's wallet. Any operator, or any caller of the test API, can do this.
- **Fix (in words):** accept a chain observation only when all of these hold:
  - the payout's selected route is the stablecoin route;
  - the intent has been submitted;
  - the destination address is the beneficiary's expected wallet.

  Reject anything else with a typed error, or raise `contradictory_evidence` without changing the payout's status. Reaching finality should set settlement only. Reconciliation should become `matched` only through a recorded allocation, the same way bank lines work. Add a test that sends a chain observation to a fiat payout.

### B2. One on-chain transfer can be counted for two payments
- **Where:** `src/lib/clearline/chain.ts:64`, `:101-118`.
- **Evidence (P2):** I sent intent A an observation of transaction X at 1 confirmation, then sent intent B an observation of the same X at 12 confirmations. Result:
  - A stays `pending_finality`;
  - B becomes `verified` and `matched`;
  - the one observation record still belongs to A (`[ 'pi_00001:final' ]`).

  B is shown as paid using A's transfer.
- **Why it fails:** `existing` is looked up by `txHash` only. The code then updates A's record and sets B's status.
- **Fix (in words):** if a transaction hash is already linked to a different payment, raise an exception that lists both payments as candidates. Change neither payment's status, and leave the decision to a person. Add a test for this.

### B3. Process: size and approval
- **Where:** the whole range.
- **Problem:** at 8.7k changed lines the range is far over the ~300-line auto-merge limit (`size-and-scope.md`), and it touches items on the approval-only list.
- **Fix:** for any future merge into main, split it into:
  1. the engine and its unit tests;
  2. the test API, `openapi.yaml` and `ENGINE_API.md`;
  3. the console and Playwright tests;
  4. the trial copy and screenshots.

  This finding does not change the verdict, which rests on B1 and B2.

---

## Major

### M1. A provider settlement report alone sets reconciliation `matched`, and later bank evidence is then rejected as a duplicate
- **Where:** `reconciliation.ts:38-43` (`allocatedTo`), `:161-180`; `investigation.ts:134-135`.
- **Evidence (P3):**
  1. A full-amount `provider_settlement_report` line gives `settlement: observed (provider_report)` and **`reconciliation: matched`**.
  2. The bank statement line for the same payout is then flagged `RC_DUPLICATE_SUSPECTED`. Reconciliation becomes `exception`, and settlement can never become `verified`.
  3. `NA_INGEST_STATEMENT` is no longer suggested, because reconciliation reads `matched`.
- **Why it matters:** `openapi.yaml` says a provider report never makes a payment matched, but this path does exactly that from provider-reported data.
- **Fix (in words):** track provider-report allocations separately from bank allocations. A provider report alone should leave reconciliation `pending`, or at most a labelled provider-only state. A later bank line for the same money should confirm the earlier match and upgrade settlement, not be treated as a duplicate.

### M2. Return lines: no amount, duplicate or overpayment checks; and a returned payout stays `matched`
- **Where:** `reconciliation.ts:126-147`; `events.ts:208-218`.
- **Evidence (P5c):** for a payout of SGD 10,000.00, two different return lines of SGD 99,999.99 each were **both** allocated as `RC_RETURN_CONFIRMS_PROVIDER_RETURN`.
- **Evidence (P5b):** a payout that was bank-matched and then reported `payout.returned` keeps `settlement: verified` and `reconciliation: matched`. The later WIP commit `d806bb4` appears to change the reconciliation part; I did not review it.
- **Fix (in words):** before allocating a return line, apply the same tests as outgoing lines: the amount is not more than what was paid out, a return has not already been allocated, and the same reference, amount and date has not been seen before. On a provider return, set reconciliation to `exception` until a person resolves it.

### M3. A "contradicted" status is silently overwritten
- **Where:** `chain.ts:114-117`, `:143-157`.
- **Evidence (P8):** 8 confirmations, then 3 (the engine correctly raises `CH_CONFIRMATIONS_DECREASED` and sets `settlement: contradicted`), then 12. The status becomes `settlement: verified, reconciliation: matched` while the contradiction exception is still open.
- **Fix (in words):** once settlement is `contradicted`, only a person resolving the contradiction should be able to change it. New evidence should be stored and added to the open exception's history, not used to upgrade the status.

### M4. Times with a UTC offset are stored as written and then compared as text
- **Where:**
  - `tx.ts:15-17`: `tx.at` is the raw `ctx.at`;
  - `tx.ts:54-55`: `isIsoInstant` accepts `+08:00`;
  - `exceptions.ts:195` and `actions.ts:465`: times compared as strings;
  - `investigation.ts:26`: timeline sorted by text;
  - `route.ts:73`: the API passes `body.at` straight through.
- **Evidence (P7):** a timeout exception created at `2026-11-13T11:00:00+08:00` (03:00Z), followed by an applied provider event at `05:00:00.000Z`. Resolving fails with `NO_PROVIDER_RESPONSE`. With other combinations, an exception can instead be resolved before the provider has actually responded, and timelines come out in the wrong order.
- **Fix (in words):** in `applyAction`, convert `ctx.at` to a UTC ISO string ending in `Z` before storing it, or reject times that do not end in `Z`. Compare times by their parsed value, never as text.

### M5. The organisation's time zone is ignored; date rules use UTC calendar dates
- **Where:** `actions.ts:457` (execution-date expiry), `actions.ts:490` (overdue exception), `funding.ts:49` (overdue state), `reconciliation.ts:91-97` (matching window and lateness), `tx.ts:66`.
- **Problem:** `Organization.timezone` is `"Asia/Singapore"` in the sample but nothing reads it. An advance due on 2026-11-20 only becomes overdue at 08:00 SGT on the 22nd, not at midnight SGT on the 21st. This is the date/time-zone hotspot in `clearline-hotspots.md` §2.
- **Fix (in words):** work out calendar dates in the organisation's time zone. Add tests at 00:00–07:59 SGT and at a month end.

### M6. Signed but malformed payloads crash the engine (HTTP 500 from the API; an uncaught error in the console)
- **Where:** `adapters.ts:336-350` (`parseWebhook` checks only some fields), `events.ts:186-187` and `:64`, `chain.ts:46` and `:122`; `route.ts:74` (no try/catch).
- **Evidence (P6):**
  - `requested_documents: 5` or `{…}` throws `TypeError: … is not iterable`;
  - `requested_documents: "ab"` is accepted and stored as the two documents `["a","b"]`;
  - a chain observation with no `tokenContract` throws `Cannot read properties of undefined`.
- **Why it matters:** the sandbox signing secrets are public, so anyone can send such a payload. `ENGINE_API.md` promises the engine "never throws".
- **Fix (in words):**
  - In `parseWebhook`, check the type of every optional field: `requested_documents` must be an array of short strings, `reason` a known code string, `currency` a supported code, and `occurred_at` an ISO time.
  - In `validateChainInput`, check `chainId`, `network`, `tokenContract` and `tokenSymbol` too.
  - In the route, catch unexpected errors and return a 422 or 500 response that does not expose internals.

### M7. An operator can cancel a payout the provider already holds, which strands the compliance hold
- **Where:** `actions.ts:312-319`; `state.ts:16-17`.
- **Evidence (P11):**
  1. An operator cancels an `on_hold` payout. The engine allows it.
  2. The assigned reviewer's `reject` then fails: `invalid_transition: Execution cannot move from cancelled to cancelled`.
  3. The hold stays `open`. The `compliance_hold` exception and the case can then never be resolved.
- **Why it matters:** the engine's own message says "a submitted payout cannot be cancelled in Clearline", and this goes around the compliance reviewer.
- **Fix (in words):** refuse cancellation in every state after submission, including `on_hold` and `awaiting_information`. A held payout should end only through the reviewer's decision.

### M8. An invalid `at` makes stale liquidity count as fresh
- **Where:** `route.ts:180`; `liquidity.ts:24-25`.
- **Evidence (P12):** with `at: "garbage"`, the 2-day-old Harbour USD balance appears in `currentUsableByCurrency` (USD 48,778.43), and `staleExcluded` is empty. The age comes out as `NaN`, and `NaN > max` is false.
- **Fix (in words):** reject an `at` that is not a valid ISO time. In `computeLiquidity`, treat an age that cannot be worked out as stale.

### M9. `parseWorkspace` accepts damaged data, and the console cannot recover from it
- **Where:** `serialize.ts:21` (checks only that each top-level field is an array); `workspace.tsx:37`; there is no `error.tsx` under `src/app/clearline`.
- **Evidence (P9):** a stored workspace with `intents: [{}]` passes `parseWorkspace`. `advance_clock` then throws `Cannot read properties of undefined (reading 'execution')`. In the browser, the same bad localStorage data is read again on every reload.
- **Fix (in words):** check the shape of each element (ids, a status object, safe-integer amounts), or catch errors from the read models in the provider and offer "Reset to sample". Add a route error boundary with a reset button.

### M10. The legacy `core.ts` still runs alongside the new engine, with different and weaker rules (this predates the diff)
- **Where:** `src/lib/clearline/core.ts:40`, `:104-121`, still served by `/api/clearline/test/[action]`.
- **Problems:**
  - It converts amounts with floating point (`Math.round(Number(amount)*100)`), which also gives USDC 2 decimals instead of 6.
  - It has a second HMAC verifier. That verifier ignores the header's timestamp, has no tolerance window, and its comparison returns early when the lengths differ.
- **Risk:** two engines now have conflicting meanings behind two API versions, and `index.ts` and `ENGINE_API.md` point readers at both.
- **Fix (in words):** run the legacy endpoints on the new engine or retire them, and allow no new imports of `core.ts`. This needs a dated plan in `ENGINE_API.md`.

---

## Minor

| # | Where | Finding | Fix (in words) |
|---|---|---|---|
| m1 | `actions.ts:138`, `:190` | Idempotency keys `__proto__`, `constructor` and `toString` pass the key format check but return a false `idempotency_conflict` (P13). `ws.idempotency` is a plain object. | Look keys up as the object's own properties only, or use an object with no prototype. |
| m2 | `webhooks.ts:33` | `verifySandboxWebhook` accepts any timestamp when `nowUnixSeconds` is `NaN` or missing, because `NaN > 300` is false. Confirmed with a direct test. The function is public. The engine and route always pass a valid number. | Reject a `now` that is not a finite number. |
| m3 | `exceptions.ts:199-206` | Any note a user attaches (`kind: "note"`) is enough to resolve `contradictory_evidence` or `unmatched_reconciliation`. Resolving never re-checks `intent.status.reconciliation`, so that stays `exception` for good. | Require the matching kind of evidence for each category. Re-check, or state, reconciliation after a resolution. |
| m4 | `actions.ts:728-732`, `:750`, `:762-771` | An advance can be prepared on a cancelled, failed or expired payment. Liquidity is checked when the advance is prepared but not when it is approved, so balances can go stale in between. | Require a payment that is live or submitted. Check fresh liquidity again in `decide_advance`. |
| m5 | `funding.ts:51` | `supplier_paid` comes only from the provider's "completed" report, and `STAGE_MAP` passes it to the Funding Desk as a fact. The console label "(provider-reported)" is honest. | Name the state `supplier_paid_provider_reported`, or require verified settlement. |
| m6 | `actions.ts:149` | The duplicate-reference check lets several correction intents share one internal reference. That reference can then be reused by a new, non-correction intent. | Allow one active intent per reference, corrections included. |
| m7 | `components/clearline/pages/Reconciliation.tsx:13-21` | The reconciliation filter groups mislabel lines: `RC_PROVIDER_REPORT_ONLY` (an allocated line) under "Contradicts provider", `RC_LATE_STATEMENT` (still matched) under "Unmatched", `RC_OVERPAYMENT` under "Partial". This is the `UI_REQUESTS` R9 workaround. | Use the engine's code groups once they exist. Fix these three meanwhile. |
| m8 | `components/clearline/pages/Overview.tsx:15` | The "Statement lines not allocated" count leaves out `partially_allocated` lines. | Include them, or rename the label. |
| m9 | `ENGINE_API.md:42`, `:33`; `openapi.yaml` description | The docs don't match behaviour in four places. (a) `cancel_intent` is documented as operator-only but the code also allows approvers. (b) "Never throws" is not true (M6). (c) Nothing says `at` must be UTC (M4). (d) "Provider never sets matched" is not true for settlement reports (M1). | Update the docs together with the fixes. |
| m10 | `route.ts:65-75` | The caller supplies the whole workspace (actors and roles) and picks the actor with `X-Clearline-Actor`. Role and maker ≠ checker checks in the test API are therefore only advisory. | State this plainly in `openapi.yaml` and in the trial copy. |
| m11 | `money.ts:71` | `convertMinor` returns 0 for a badly formed rate, so a quote could show 0 to the recipient while still marked eligible. Today the rates are internal constants. | Return a typed error instead. |
| m12 | `actions.ts:715` | `request_more` sets the hold to `open` even after the partner reported release. The time of the release is kept but the status label is lost. | Keep `partner_release_reported` as the status. |

## Nit

- `route.ts:55` compares the size limit against the string length (UTF-16 code units), not bytes.
- `components/clearline/ui.tsx:89-96`: field error text is not linked to its input through `aria-describedby`. Labels wrap their inputs, and `role="alert"` and `role="status"` are used correctly.
- `workspace.tsx:37`: a stored workspace that fails to parse is silently replaced by the sample, with no notice to the user.

## `docs/clearline/UI_REQUESTS.md` (skimmed)
The requests are clear and the workarounds are honest. R6 (maker ≠ checker could not be reached in the console) is a real product point: at 6fb9433 the role check runs first. R1's mismatch with the old documented ids is resolved by the CHANGE note in `ENGINE_API.md`. I did not check whether later commits address R2–R10.

## What I did NOT review
- Commits after 6fb9433 (`7afeec0`, `d806bb4`, `b250bb4`) and the uncommitted changes in the working tree.
- Playwright specs: not run, and their assertions were not read in detail. I also did not run the Next.js build or lint.
- Visual design, CSS (`tokens.css`, `*.module.css`), the screenshots under `docs/trial/screenshots/`, or a full accessibility audit (keyboard, contrast, screen reader).
- `ARCHITECTURE.md` and `DATA_MODEL.md` beyond a grep. I read `openapi.yaml` only for its overview, the error catalogue and the webhook sections, not every schema.
- Console pages beyond grep: `ConnectMisc`, `Reports`, `Settings`, `Holds`, `Trial`, `Investigation`, `evidence.ts`, `nav.ts`. I read `Connect`, `Reconciliation`, `Funding` and `Overview` in part, plus `workspace.tsx` and `ui.tsx`.
- In `sample.ts`, only the funding scenario and the final statuses.
- Failure tests that the existing tests would not catch, beyond probes P1–P13.
- The company PAUSE check, the Log rows and the PR-comment flow from the role's nightly playbook. There is no PR here and I had no Sheets or GitHub write step. This file is the only thing I wrote, as the brief asked.

— code-reviewer (general-purpose subagent briefed with the role) · 2026-11-13 SGT · reviewed sha 6fb9433

---

## Re-review — 2026-11-13 SGT · range df3a25f..cfadef9

# CODE REVIEW: CHANGES REQUESTED cfadef91bfcab309c1f36d5a9197746d7f39686c

**APPROVAL-ONLY: needs Aashmiin's merge** (still touches money amounts, roles and security headers).

**In plain English:** both blockers are fixed. A chain observation can no longer mark a bank payout as settled, and one on-chain transfer can no longer count for two payouts. Nine of the ten Major findings are fixed. The tenth (M1) is only half fixed: the order "provider report first, then bank line" now works, but "bank line first, then provider report" raises a false duplicate exception. The fixes also introduced one new Major defect. After a person resolves a returned payout, the engine recomputes its status and shows it as "settlement verified" and "reconciliation matched", even though the money came back. Neither defect posts money or loses records, so the verdict is CHANGES REQUESTED, not BLOCK.

### How I checked
- **Snapshot:** I froze a copy of HEAD `cfadef9` with `git archive`, then confirmed it was still the tip.
- **Typecheck:** `npx tsc --noEmit` exit 0.
- **Unit tests:** `npx vitest run` (whole repo) gave 1014 passed, 57 skipped, 0 failed.
- **Probes:** I re-ran my original probes from the scratch folder. They are now `tests/probe/rr.test.ts` and `rr2.test.ts` in the snapshot. I changed them only where CHANGE 3 requires it: chain cases now use a USDC payout on the Tidewater route with the registered wallet and the quoted amount. P1 itself still sends to a fiat payout.
- **API:** I called the v1 route's `POST` handler directly (`NextRequest`) for the API cases.
- **Code read:** I read the full diff of `chain.ts`, `reconciliation.ts`, `events.ts`, `actions.ts`, `serialize.ts` (diff only), `tx.ts`, `derive.ts`, `liquidity.ts`, `adapters.ts`, `exceptions.ts`, `webhooks.ts`, the v1 route, the legacy route, `middleware.ts` and `next.config.mjs`.
- **Not run by me:** `next build` and Playwright. The integration lead reports both green; I did not see them pass.

### Per-finding verdict

| Finding | Verdict | Evidence (cfadef9) |
|---|---|---|
| **B1** chain evidence on a fiat payout | **Resolved** | Fiat payout: `precondition_failed`. Wrong wallet or wrong amount: `contradictory_exception_raised`, status unchanged. A good final observation sets settlement `verified` only; reconciliation stays `pending` until the provider's `payout.completed` carries the same `tx_hash`. The full simulated flow ends `verified` + `matched` through a `chain_observation` allocation (`chain.ts:80-122`). |
| **B2** one tx counted for two payouts | **Resolved** | The same hash on payout B gives `CH_TX_ALREADY_LINKED` with both payouts as candidates. A stays `pending_finality` and B stays `none`/`pending` (`chain.ts:146-157`). A second tx for one payout gives `CH_SECOND_TX_FOR_PAYOUT`. |
| B3 size / approval | Still applies (process) | +2,601 / −760 in this range alone. The split advice stands. |
| **M1** provider report sets `matched`; later bank line flagged duplicate | **Partly resolved; new issue N1** | Provider report then bank line now works: `recorded_provider_report` (`observed/provider_report`, reconciliation `pending`), then `allocated` (`verified/bank_statement`, `matched`). The reverse order fails; see **N1**. |
| **M2** return lines unchecked; returned payout stays matched | **Resolved** | 99,999.99 against a 10,000.00 payout gives `RC_OVERPAYMENT`. A correct 10,000.00 line is allocated once and its repeat gives `RC_DUPLICATE_SUSPECTED`. A provider return sets reconciliation `exception` (`reconciliation.ts:155-169`, `events.ts`). |
| **M3** contradiction overwritten | **Resolved** | After 8 → 3 → 12 confirmations, settlement stays `contradicted` (`recorded_no_state_change`). Resolving with a note only is refused (`EVIDENCE_REQUIRED`); with document evidence it is accepted, and the status is recomputed (`verified`, reconciliation `pending`). See **N2** for a problem with that recompute. |
| **M4** offset instants compared as text | **Resolved** | A `+08:00` action time is stored as `…03:00:00.000Z`. The timeout exception can be resolved once the provider has responded. A statement `receivedAt` sent with `+08:00` is stored as UTC. The API accepts an offset `at` (200). The `Tx` constructor normalises the time (`tx.ts`), and comparisons now parse the instants. |
| **M5** org time zone ignored | **Resolved** | Sample advance due 2026-11-20: at 23:30 SGT on the 20th it is not overdue; at 00:30 SGT on the 21st (16:30Z) it is `overdue` with an `overdue_advance` exception. Window, lateness and due dates use `orgDate`. |
| **M6** malformed signed payloads crash | **Resolved** | `requested_documents` set to `5`, `"ab"` or `{}` gives `invalid_field` and nothing is recorded. A chain observation with a missing or junk `tokenContract`, or `null`, gives `invalid_field`. The API returns 422 `invalid_field`, not 500. `applyAction` no longer throws (catch-all at `actions.ts:61-65`; see m-new-1). |
| **M7** cancel on a held payout | **Resolved** | Cancelling an `on_hold` payout gives `invalid_transition` (`actions.ts:321-327`). |
| **M8** invalid `at` makes stale liquidity fresh | **Resolved** | `computeLiquidity(ws, "garbage")`: all 4 rows stale, `currentUsableByCurrency` empty. API `POST /liquidity` with a bad `at` gives 400. |
| **M9** damaged workspace accepted | **Resolved** | `intents: [{}]` gives `invalid_field` at `intents[0].id`. A damaged workspace passed straight to `applyAction` gives a typed error, not a throw. The sample still round-trips through serialise and parse. The API returns 422 for a nonsense workspace. I did not re-check that the console now offers a reset. |
| **M10** legacy `core.ts` alongside the engine | **Resolved** | `core.ts` is deleted. `/api/clearline/test/[action]` returns 410, or 422 for input invalid under the old contract, and executes nothing. `openapi.yaml` says the old API is retired. `docs/CONNECT_TEST_API.md` still describes it as live (m-new-3). |
| m1 idempotency `__proto__` / `constructor` | Resolved | `__proto__` creates the intent, survives serialise → parse with no prototype pollution, and replays as `idempotent_replay`. |
| m2 NaN clock in `verifySandboxWebhook` | Resolved (code read) | A non-finite `now` is rejected (`webhooks.ts:32`). |
| m3, m4, m6, m12 | Resolved (code read; m3 also probed) | As described in CHANGE 3. |

### New issues introduced or exposed by the fixes

**N1 (Major): a provider settlement report that arrives *after* the bank line raises a false duplicate**
- **Where:** `reconciliation.ts`, the outgoing branch: the `dupe || remaining <= 0` check runs before the provider-report branch.
- **Evidence:** I matched a payout from its bank line (`verified`, `matched`), then sent the provider's settlement report for the same payout. Result: `RC_DUPLICATE_SUSPECTED` is raised and reconciliation becomes **`exception`** on a fully reconciled payout.
- **Why it matters:** clearing that exception needs non-note evidence attached by a person. Provider reports routinely arrive after bank lines, so this would flag ordinary payouts.
- **Fix (in words):** decide whether a line is a provider report before the duplicate and remaining-amount checks. A provider report that agrees with an existing bank allocation should be recorded as corroborating evidence, with no exception and no status change. Only a report that disagrees (different amount or currency) should raise one.

**N2 (Major): after a returned payout is resolved, the recompute shows it as `verified` / `matched`**
- **Where:** `derive.ts` (recompute counts bank debits, leaves out return allocations, and has no rule for `execution: returned`).
- **Evidence:** I bank-matched a payout, then sent a provider `payout.returned` (reconciliation becomes `exception`, correct). I then allocated a matching return line and resolved the `returned_payout` exception with a `funds_returned_confirmation`. The recompute set the status to `{"execution":"returned","settlement":"verified","settlementScope":"bank_statement","reconciliation":"matched"}`.
- **Why it matters:** the money came back, yet the Payments and Overview screens would show this payout as settled and reconciled. This is the kind of quiet wrong status the review standard warns about. It did not happen before this range, because nothing recomputed status.
- **Fix (in words):** in the recompute, subtract allocated returns from bank debits. For a returned payout whose return is confirmed, use an explicit outcome (for example reconciliation `matched` with a returned/net-zero note, and settlement not `verified` for the payout leg) that the console labels as "returned". Add a test for this whole sequence.

**Minor**
- **m-new-1** (`actions.ts:61-65`): the catch-all turns *any* unexpected exception, including real programming bugs, into a generic `invalid_field` "workspace or action is malformed". This keeps the API safe, but it hides engine defects from tests and from users. **Fix (in words):** keep the typed response, but record the error class and action type in the result or the audit trail, and make tests fail on it (for example a debug flag that rethrows under vitest).
- **m-new-2** (`events.ts`, the on-hold guard): a correctly signed `payout.returned` or `payout.failed` that arrives while a payout is on hold is stored as `contradictory_exception_raised` and never applied. Because deduplication counts that stored event, a later redelivery is ignored too. The provider's real outcome can then only reach the payout by hand. This is acceptable as a design choice, but the exception's required action should say so explicitly. **Fix (in words):** say so in the exception text, or re-evaluate stored events when the hold ends.
- **m-new-3** (docs): `docs/CONNECT_TEST_API.md` still documents the legacy endpoints as working. `openapi.yaml` says "every method returns HTTP 410", but input that is invalid under the old contract gets 422. **Fix (in words):** mark CONNECT_TEST_API.md as retired, and mention the 422 case.
- **m-new-4** (v1 route): `isInstant` copies `tx.ts`'s `isIsoInstant`. **Fix (in words):** import the engine's helper.
- **m-new-5** (provider report lines): after M1 a provider report line stays `unallocated` but carries `RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW` plus `RC_PROVIDER_REPORT_ONLY`. In the console it therefore shows as "Unallocated" (bad tone), is counted under Overview's "Statement lines not allocated", and appears in the "Exact" filter. **Fix (in words):** give provider-report lines their own line status or label.

**Checked, no defect found:**
- `middleware.ts` anchored matcher (`_next/image$` matches the path without its query string; the allow-list is unchanged);
- `next.config.mjs` security headers (no external origins needed by the app as far as I can see; `'unsafe-inline'` scripts are a documented follow-up);
- liquidity Map rewrite (same totals: the sample's usable SGD and USDC are unchanged);
- v1 byte cap, item caps and depth guard;
- `parseWebhook` strict field validation;
- the `tryAllocateChain` trusted-reference rule;
- one live correction per payout;
- advance re-check of fresh liquidity at approval.

### Overall
**CHANGES REQUESTED cfadef9.** No Blocker remains. Fix N1 and N2, each with a test (both are small and local to `reconciliation.ts` and `derive.ts`). The Minor items can follow. The independence caveat from the first review still applies, because the same orchestrating session produced the fixes.

**Not re-reviewed:**
- console components and the Playwright specs changed in this range;
- `serialize.ts` line by line (I tested its behaviour only);
- `investigation.ts` and `funding.ts` diffs beyond a skim;
- the QA release tests (`tests/qa-release/*`), beyond seeing that they pass.

— code-reviewer (general-purpose subagent briefed with the role) · 2026-11-13 SGT · re-reviewed sha cfadef9

---

## Final check — 2026-11-13 SGT · range 44f2fdf..5853620

# CODE REVIEW: APPROVE 585362006fa71f5961d84fc8a0cdf812909ba3df

**APPROVAL-ONLY: needs Aashmiin's merge.** This approval covers opening a **public, synthetic-data customer-trial PR** only. Merging it stays Aashmiin's click, because the change touches money amounts, roles and security headers.

**In plain English:** both defects from the re-review are fixed.
- A provider settlement report now confirms a bank-matched payout in either order without raising a false exception.
- A returned payout is no longer shown as settled. After resolution it reads settlement `none` and reconciliation `matched`, and the console labels it "Returned — net zero".

All five minor items from the re-review are fixed as well. Every original blocker and major probe still behaves correctly. I found two new small issues (F1, F2 below); neither needs to block a synthetic-data trial.

**Independence caveat (restated):** commits in this range carry the same orchestrating `Claude-Session` as the session that asked for this review. I wrote and suggested none of the code, and I write fixes only in words. Even so, this is not a fully independent review. A second reviewer, or Aashmiin, should read N1, N2, B1 and B2 before merging.

### How I checked
- **Snapshot:** I froze a copy of HEAD `5853620` with `git archive`; it was still the tip when I finished.
- **Typecheck:** `npx tsc --noEmit` exit 0.
- **Unit tests:** `npx vitest run` gave 1050 passed, 57 skipped, 0 failed.
- **Probes:** I re-ran `rr.test.ts` and `rr2.test.ts` unchanged; no documented change required adapting them. I added `fc3.test.ts`, which covers provider-report edge cases and a terminal event that arrives during a hold and is redelivered after the hold.
- **Code read:** I read the diff of `reconciliation.ts`, `derive.ts`, `events.ts`, `actions.ts`, `investigation.ts`, the v1 route, `not-found.tsx`, `layout.tsx` and `labels.tsx`.
- **Not run by me:** `next build` and Playwright.

### Per-item verdict

| Item | Verdict | Evidence (5853620) |
|---|---|---|
| **N1** provider report after a bank match raised a false duplicate | **Resolved** | Bank line, then provider report: `recorded_provider_report`, status stays `verified/bank_statement/matched`, no open exceptions. Report first, then bank line: `observed/provider_report/pending`, then `verified/matched`. A report above the payout amount gives `RC_OVERPAYMENT`. The branch now runs after the currency and time-window checks and before the duplicate and remaining-amount checks (`reconciliation.ts:200-218`). |
| **N2** a resolved returned payout showed `verified/matched` | **Resolved** | After the provider return, the return line and the resolution with `funds_returned_confirmation`: `{"execution":"returned","settlement":"none","settlementScope":"none","reconciliation":"matched"}`, `returnStatus: confirmed_by_statement`. `ReconChip` renders this case as "Returned — net zero" (warning tone, "supplier is still unpaid") (`derive.ts:20-33`, `labels.tsx`). |
| m-new-1 catch-all hid engine bugs | Resolved | The workspace is validated first: damaged data gives `invalid_field` with a field path (`intents[0].id`). Under VITEST or `CLEARLINE_ENGINE_STRICT=1`, unexpected errors are rethrown; otherwise the error message names the error class and the action. |
| m-new-2 terminal event during a hold was lost | Resolved | A `payout.returned` during a hold gives `EV_TERMINAL_EVENT_WHILE_ON_HOLD`, with text telling a person what to do. A redelivery during the hold is `duplicate_ignored`. After the reviewer's release and the partner's release, the redelivery is `applied` and the payout becomes `returned`. A third delivery is `duplicate_ignored`, with exactly one `returned_payout` exception. |
| m-new-3 retired-API docs | Resolved | ENGINE_API CHANGE 4 says `CONNECT_TEST_API.md` marks the legacy API as retired, with 422 for invalid input and 410 otherwise. I did not re-read that file. |
| m-new-4 duplicate instant check | Resolved | The v1 route now uses the engine's `isIsoInstant`. |
| m-new-5 provider-report line codes | Resolved | Report lines carry only `RC_PROVIDER_REPORT_ONLY` (plus `RC_LATE_STATEMENT` when late), and that code's group is `informational`. |
| B1, B2, M1–M10 (regression) | Still resolved | All original probes give the same results as at cfadef9 (see the Re-review table). |
| QA R3 report injection | Code read, looks correct | `exportCaseReport` flattens line breaks and control characters on every line of the text report. The JSON output is unchanged, which is correct. |
| QA R1 neutral 404 | Code read, looks correct | When `CLEARLINE_CUSTOMER_PREVIEW=1`, the root layout skips the legacy shell and `not-found.tsx` shows a neutral Clearline page. Behaviour is unchanged with the flag off. |

### New observations (none block approval)
- **F1 (Minor): a provider settlement report for a payout the provider reported as `failed` is recorded without any flag.**
  - **Evidence:** the payout's status became `{"execution":"failed","settlement":"observed","settlementScope":"provider_report"}` with no exception.
  - **Why it matters:** the provider is saying it both failed and settled. At 6fb9433 that debit raised `RC_DEBIT_FOR_FAILED_PAYOUT`; since the M1 fix it does not. The console would show "settlement observed" on a failed payout.
  - **Fix (in words):** in the provider-report branch, raise `contradictory_evidence` and leave settlement unchanged when the payout's execution is `failed`, `cancelled` or `expired`.
- **F2 (Minor): a provider report for *less* than the payout amount is recorded with no note.**
  - **Evidence:** 4,000.00 reported against a 10,000.00 payout gives `recorded_provider_report` and no exception. CHANGE 4 treats only a higher amount or a different currency as a disagreement.
  - **Fix (in words):** add `RC_PARTIAL_AMOUNT` to such a line (informational), or raise a low-severity `unmatched_reconciliation` exception, so a person sees the provider and the payout disagree.
- **Nit:** in customer-preview mode the root `generateMetadata` uses the title "Not found — Clearline" as the default for *every* page. Today every allowed route sets its own title (`clearline/layout.tsx`, `mentor-demo`), so only 404s show it. A future page without metadata would inherit "Not found". **Fix (in words):** use a neutral default, and set the 404 title in `not-found.tsx`.

### Overall
**APPROVE `5853620` to open a public, synthetic-data customer-trial PR. Merging remains approval-only (Aashmiin's click).**
- **What's settled:** no Blocker or Major is open. The evidence rules hold under every probe: provider claims never settle or reconcile a payout, chain evidence is tied to the payout's rail, wallet and transaction, ambiguity is preserved, holds are never auto-released, and amounts are exact.
- **Before any non-synthetic use:** F1 and F2 should be fixed, and the B3 size and split concern still stands for merges to main.
- **Not re-checked:** the Playwright specs, `next build`, the console pages changed in this range other than `labels.tsx`, `QA_SECURITY_REVIEW.md` and `tests/qa-release/recheck-release.test.ts` (I only saw them pass in the full vitest run), and the doc edits beyond CHANGE 4.

— code-reviewer (general-purpose subagent briefed with the role) · 2026-11-13 SGT · final check of sha 5853620
