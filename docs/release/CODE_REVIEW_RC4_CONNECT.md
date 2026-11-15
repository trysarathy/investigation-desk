# Code review: rc4 Clearline Connect adapter framework

- **Scope:** `git diff 85fd6bf rc4/wip-connect` (head `d968f34`, merged into `rc4/clearline-app` at `395db0f`). 25 files, +2929/−8.
- **Reviewer:** independent code reviewer (security and payments). I wrote none of this code.
- **Date:** 2026-11-15.

## Verdict: CHANGES REQUESTED

**APPROVAL-ONLY: needs Aashmiin's merge.** The change touches signing keys (fictional `test_` keys), webhook authentication and amount validation, so it is on the approval-only list in `company/OPERATING_MODEL.md` §2.

In plain terms, the security core is sound. Webhook verification works on the raw body and uses a constant-time comparison. The replay window is two-sided. Key rotation works. An unknown or unimplemented scheme is never accepted. No provider claim can make settlement verified, and provider reports never count as independent evidence.

Three things need fixing before this is called done:

1. The new "provider moved backwards" rule depends on the order events arrive in. When the newer, lower-ranked version arrives first, the regression is lost silently.
2. A Connect payout put on hold can never be released.
3. The webhook intake can report "ingested" for a delivery the engine actually rejected.

The spec also claims more arrival-order independence than the code and tests deliver.

## Checks run (frozen copy of `rc4/wip-connect` via `git archive`, node_modules symlinked)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run tests/clearline` | 34 files, 596 tests passed |
| `npx vitest run` (whole repo) | 77 files passed, 1 skipped; 1594 tests passed, 57 skipped |
| `rc4-connect-*` suites | 91 tests passed |
| Mutation check (16 mutants, one mutation copy, each applied, the rc4 suites run, then restored) | 14 killed, 2 survived (both close to equivalent, see L4) |
| Probe tests (scratch only, deleted) | 8 probes, results quoted below |
| Research citations | All 35 IDs in spec §12 resolve to the same URL in `docs/research/PAYMENTS_AND_STABLECOIN.md`; spot-checked claims match |

### Mutation results

| # | Mutant | Result |
|---|---|---|
| M1 | Replay-window check removed (`verify.ts`) | killed |
| M2 | Signature compared on an 8-character prefix only, not constant-time | killed |
| M3 | Key `activeUntil` ignored | killed |
| M4 | `test_`-only filter removed from the verifier keyring | killed |
| M5 | `unverified` mapped to valid (`adapter.ts:toWebhookVerification`) | killed |
| M6 | Preliminary hash passed through as the engine `tx_hash` | killed |
| M7 | Unmapped raw status guessed as the first mapping row | killed |
| M8 | Regression rule disabled | killed |
| M9 | Side states (hold) counted as progress | killed |
| M10 | Connect settlement-report row emitted as `bank_statement` | killed |
| M11 | `poll_provider` role check removed | killed |
| M12 | Reconciler "unchanged snapshot" skip removed | killed |
| M13 | Ledger-claim confidence upgraded to `provider_claim` | killed |
| M14 | Time-inferred confidence upgraded to `provider_claim` | killed |
| M15 | `events.ts:175` gate `p.sequence > maxApplied` removed | **survived** |
| M16 | `headers-v1:` prefix check removed from `decodeHeaderBundle` | **survived** |

## Findings

### Critical / High

None found.

### Medium (blocking)

**M-1. The regression rule depends on arrival order (false negative).**
- **Where:** `src/lib/clearline/events.ts:175` and `src/lib/clearline/connect/normalize.ts:157-165`. The interaction is with `events.ts:190`.
- **Failure scenario:** take Cobalt Wren's `regress_substatus` script.
  - The versions are v3 `delivered/bank_confirmed` (rank 52) and then v4 `delivered/handed_to_bank` (rank 50), a real regression.
  - In provider order (v2, v3, v4), the result is an open `EV_PROVIDER_STATUS_REGRESSED`.
  - If v4 arrives before v3 (at-least-once delivery, no ordering guarantee, which is the situation this descriptor models), v4 is applied. The late v3 then reaches `target === current` and is recorded as `recorded_no_state_change`.
  - The end state is **no exception at all**. Probe output:
    - in order: `openExceptions: ["contradictory_evidence:EV_PROVIDER_STATUS_REGRESSED"]`
    - v4 before v3: `openExceptions: []`
- **Why it matters:** the rule exists so that a provider moving backwards is "never silent" (spec §4). In this case it is silent. Spec §4 lists "older version arriving late → no exception", which is correct for a lower-ranked late version but wrong for a late version that ranks *higher* than an already-accepted newer one.
- **Fix (in words):** when an event is older than the newest accepted one, also check whether its declared rank is higher than the rank of any accepted event with a newer sequence. If so, raise the same `EV_PROVIDER_STATUS_REGRESSED`, naming both events. Add `regress_substatus` (and `regress_to_routing`) to the every-permutation test in `rc4-connect-delivery.test.ts` §5b. The assertion should be that the set of open contradiction codes is the same in every order.

**M-2. Cobalt Wren paid → failed ends in a different execution state depending on arrival order, and the spec says otherwise.**
- **Where:**
  - `src/lib/clearline/events.ts:204` (the late path stores a late `completed` as `stored_late_no_regression`)
  - `docs/clearline/CONNECT_ADAPTERS.md:231` ("every arrival order of the success and return webhooks ends in the same state")
- **Failure scenario:** take Cobalt Wren's `return` script (v3 `delivered`, then v4 `bounced`).
  - In order: execution stays `provider_reported_completed`, with `EV_IMPOSSIBLE_TRANSITION` open.
  - With v4 first: execution is `failed`, the late `delivered` is stored quietly, and only `PV_FAILED_BENEFICIARY_REJECTED` is open. Nothing records that the provider first said "paid".
  - The test at `rc4-connect-delivery.test.ts:95` deliberately accepts both outcomes. The permutation test at line 77 covers only CW success, QF success, CW clawback and QF return.
- **Why it matters:** two operators who receive the same provider truth see different execution states. The "paid then failed" history, which is the documented reason for this provider [ST4][ST7][AW3], is visible in only one of them. Part of this comes from the existing engine's late-event rule, but the Connect spec states an arrival-order guarantee that does not hold for this script.
- **Fix (in words):** at minimum, correct spec §6 to name the scripts that are order-independent and to state the CW `return` behaviour. Preferably, make a late `completed` that arrives after an applied `failed`/`returned` open an owned contradiction, so the provider's earlier "paid" claim always reaches a person. Fixing M-1 in the same way covers both cases.

**M-3. A Connect payout on hold can never be released.**
- **Where:**
  - `src/lib/clearline/connect/descriptors.ts:30` and `:55` (holds mapped)
  - no descriptor maps any raw status to `payout.hold_released`
  - `src/lib/clearline/actions.ts:862` (release needs `partnerReleaseReportedAt`, which only a `payout.hold_released` provider event sets, at `events.ts:~160`)
- **Failure scenario:** take a Cobalt Wren or Quillfern `hold` script. Documents are submitted and the compliance reviewer chooses "release". The hold stays waiting for a partner release that no Connect provider can ever send. The only way out is "reject", which cancels the payout. Probe P4 shows `hold_released` mapped: false for all three descriptors.
- **Why it matters:** this fails safe (nothing is released without a person), but it leaves a payout stuck forever. The gap is not tested or mentioned in the spec, and the reconciler keeps polling the payout (`on_hold` is in `UNRESOLVED_EXECUTION`).
- **Fix (in words):** give each hold-capable fictional provider a raw status that maps to `payout.hold_released` (a side state, outside rank comparisons). Add an end-to-end test of hold → documents → reviewer release → partner release → `in_transit`, then a later progress version. That test should also check that resuming does not trip the regression rule (for example, at_bank rank 25 before the hold, awaiting_bank rank 20 after). Alternatively, document the limitation in spec §15.

**M-4. `receiveConnectWebhook` can report `ingested` for a delivery the engine recorded as `rejected_signature`.**
- **Where:**
  - `src/lib/clearline/connect/reconciler.ts:54` bundles *every* supplied header
  - `:57` derives `action` from the pre-check, not from the engine outcome
  - `src/lib/clearline/connect/verify.ts:46` makes the bundle decoder reject more than 16 headers, any name outside `[a-z0-9-]`, and any value over 1024 characters
- **Failure scenario:** a correctly signed Cobalt Wren delivery arrives with one extra header containing an underscore, or with 20 ordinary headers (a normal HTTP request carries that many). Probe P3:
  - `verification: verified, action: ingested, outcome: rejected_signature`
  - The receipt says the event was ingested. The engine says the signature was rejected, and the event is not applied.
- **Why it matters:** the receipt is the record an operator or a future intake reads. It contradicts the engine's own ledger, and a full-header intake (spec §11 TARGET) would reject every genuine webhook while reporting success.
- **Fix (in words):** pass only the headers the provider's declared schemes read into the bundle. Derive `action` from the event the engine actually recorded: "ingested" only when its outcome is not `rejected_signature`.

### Low (non-blocking)

**L-1. The reconciler's "unchanged" skip ignores the hold redelivery rule.**
- **Where:** `connect/reconciler.ts:77-80`.
- **Problem:** `alreadyRecorded` treats any earlier event with the same bytes as "unchanged", including one recorded with `suppressedOnHold`. The engine deliberately processes such a redelivery after the hold ends (`events.ts:196`).
- **Effect:** once M-3 is fixed, a status suppressed during a hold would never be re-applied by the reconciler.
- **Fix:** exclude events with `suppressedOnHold` (and contradiction outcomes) from the skip once the hold has ended.

**L-2. Saltglass gives `onchain_final` and `book_transfer_done` the same rank (50).**
- **Where:** `connect/descriptors.ts:80/82`.
- **Problem:**
  - Under `state_rank` ordering, whichever arrives second is `recorded_no_state_change`, with no contradiction, even though one claims an on-chain final transfer and the other claims an internal ledger book entry.
  - The regression rule can never fire for a `state_rank` provider, because `sequence` is the rank (this part is documented in spec §6/§15).
- **Fix:** give them distinct ranks, or treat two different `settlementClaim`s at the same rank as a contradiction.

**L-3. The audit text is wrong for unverified providers.**
- **Problem:** through the raw `ingest_webhook` action, a Saltglass (unverified-scheme) delivery is logged as "Webhook signature invalid; not applied" (`events.ts:84`). That is safe and documented in spec §15. It is misleading in an audit trail, though, because there is no signature scheme to fail.
- **Fix:** log the `unverified_scheme` reason.

**L-4. Test gaps.**
- **M15 survived.** Removing the `sequence > maxApplied` gate changes nothing, because `findRawRegression` already filters on `e.sequence < p.sequence`. The gate is redundant, and no test pins its intent.
- **M16 survived.** Removing the `headers-v1:` prefix check is not detected. It is harmless, because the sender controls every header anyway, but the spec presents the prefix as part of the format.
- **No test covers** hold release (M-3) or `regress_substatus` under permutation (M-1).

**L-5. The spec cites a research file that is not on the branch reviewed.**
- `docs/research/PAYMENTS_AND_STABLECOIN.md` is not in `rc4/wip-connect`. It arrives in `rc4/clearline-app` through `2dcf2d2`.
- After the merge, all 35 cited IDs and URLs match the research register.
- The claims I spot-checked are faithful to the research text:
  - ST4/ST7 paid→failed
  - MT2 completed→returned/reversed
  - AW3 PAID→FAILED
  - NI2 DEEMED_PAID and PROCESSED_BY_CLEARING
  - NI5 at-most-once
  - TH1 poll after callbacks stop
  - BR1 preliminary hash
  - ZH1 internal CONFIRMED
  - BG2 Go Account ledger events
  - GR9 multiple signatures
  - PR6 rotation header
  - BV5 400 on repeat
  - BR5 body must match
  - ST11/MT3/NI4/GR8 24 h TTLs
  - ST12/AW6 no ordering guarantee
  - "at least eight schemes"
- Minor wording: §8 says a different body "is rejected [BR5]", while the research says only "the body must match on retry".
- The spec correctly says the author did not reopen the pages and that no person has reviewed it.

### Info (verified correct)

**Constant-time comparison.**
- `matchAny` (`verify.ts`) compares every (key, signature) pair with `constantTimeEqual` (`sha256.ts:74`, a full-length XOR fold) and does not exit early.
- The `clearline_sandbox_v1` path reuses `verifySandboxWebhook`, which is also constant-time.

**Replay window and timestamp parsing.**
- The check is two-sided: |now − ts| > 300 s fails. A future timestamp (+301 s) is rejected (probe P6).
- The timestamp must match `^\d{1,12}$`, so `1e9` is rejected as malformed.
- A non-finite `now` is rejected.
- The engine clock cannot go backwards (`actions.ts:55`), so a stale delivery cannot be replayed by choosing an older `at`.
- Inside the window, a replay is caught by dedupe.

**Key rotation.**
- A retired key alone fails; both keys during rotation verify.
- Validity is judged at receive time, not at the signed timestamp. That fails closed for a retiring key, and errs slightly open for a key that is not yet active.

**Unknown or unimplemented schemes.**
- Both are always `unverified`. `unverified` maps to `valid: false` and is recorded as `rejected_signature` (M5 killed).
- A forged Saltglass "onchain_final" body with a hash is never recorded as a fact. The intake polls the engine-side truth instead (probe P5: the poll returned `intake`, and execution stayed `submitted`).

**Raw body.** Verification uses the exact received string. A reserialised body (`{ "a": 1 }` versus `{"a":1}`) fails with `signature_mismatch`.

**`test_`-only keyring.** It is enforced at module load and in `signDelivery`. The verifier silently drops other keys and returns `no_active_key` (M4 killed).

**Header bundle.** It is not an injection vector. Signatures never cover headers, the sender already controls every header, and keys are restricted to a lower-case character set (so `__proto__` cannot appear). Duplicate JSON keys resolve to the last one, and the result is still checked by HMAC. The real problem with the bundle is M-4, not confusion.

**Normalisation.**
- No connect code assigns `settlement` except the regression rule's `contradicted`.
- Time-inferred, preliminary and ledger confidences cannot become `verified` (M13 and M14 killed).
- An unmapped (status, sub-status) is refused with `invalid_field`, and nothing is recorded when the signature is valid (M7 killed).
- A preliminary hash goes only to `rawTxHashPreliminary`, never to `tx_hash`, so it never allocates (M6 killed).

**`poll_provider`.**
- It is operator-only (M11 killed).
- The caller supplies only `intentId` and an optional positive integer `version`. The body is generated by the engine from the immutable intent, instruction and script (metadata cannot change after creation).
- It is idempotent: a repeat poll gives `duplicate_ignored`, and an older version gives `stored_late_no_regression` (probe P7).
- The simulated truth is deterministic.

**Evidence classification.**
- Provider status events are pushed with `independent: false`.
- Connect report rows are always `provider_settlement_report` (M10 killed).
- Records attached by a person classify as `supporting`, whatever kind they name.

**Backward compatibility.**
- The original parser whitelists fields, so a `raw` key in an original-provider body is dropped and the regression rule cannot run for them.
- `SandboxAdapter` behaviour is unchanged (types widened only).
- The sample workspace and `SANDBOX_PROVIDERS` are unchanged.
- The rc3 migration and property suites pass. `serialize.ts` and `derive.ts` are untouched.

**Other interactions.**
- F1 (`TERMINAL_FOR_SETTLEMENT_REPORT`), N1, the terminal rule and H3 hold priority are unchanged. The regression block runs after the amount, hold and hold-released rules.
- I found no false positive on a legitimate forward move among the shipped scripts. The resume-after-hold case (M-3) cannot be reached today.

## Summary

- **Verdict:** CHANGES REQUESTED, approval-only.
- **No security defect found.** Webhook verification, the replay window, key rotation, the `test_` keyring, raw-body checking, unverified-scheme handling, the protection against settlement inflation and evidence classification all hold under mutation (14 of 16 mutants killed; both survivors are close to equivalent).
- **Blocking correctness issues:**
  1. The new regression rule is lost when the regressed version arrives first (M-1).
  2. CW paid→failed is order-dependent while the spec says it is not (M-2).
  3. Connect holds cannot be released (M-3).
  4. The intake receipt can say "ingested" for a rejected delivery (M-4).
- **Should be fixed:** five Low items (L-1 to L-5).
- **Checks:** tsc is clean and every vitest suite is green.

---

## Re-review: fixes 7c22176 and 6dc2dda (rc4/wip-connect head 6dc2dda; merged into rc4/clearline-app at d1a8c5b)

### Verdict: APPROVE, with non-blocking follow-ups

**APPROVAL-ONLY: needs Aashmiin's merge.**

All four Medium findings are fixed, and each has a test that fails on the pre-fix code. L-1, L-2, L-3 and L-5 are fixed. L-4 is fixed for M15 and M16.

Three follow-ups remain. None of them blocks the merge:
- The two mutants that survive the owner's run are **not** equivalent. Each one hides a real behaviour that no test pins.
- An undocumented order dependence around holds produces a false-positive contradiction. It fails safe: a person sees an extra owned exception.
- The conflict path now moves execution outside `EXECUTION_TRANSITIONS`, and the spec does not say so.

### Checks run (fresh frozen copy of rc4/wip-connect via `git archive`; deleted afterwards)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` (whole repo) | 82 files passed, 1 skipped; 1717 tests passed, 57 skipped |
| Fix-reverted run: `git diff 7c22176^ 7c22176 -- src` reverse-applied in the copy, new tests kept, rc4-connect suites run | **16 tests failed** (listed below), 92 passed; the fix was then re-applied |
| Probes (scratch test, deleted) | 4 probes, results below |
| Survivor check: the stored-late mutant applied in the copy and the rc4-connect suites run | 108/108 pass, so the mutant survives; it is not equivalent (below) |

### Each finding against its test (all fail with the fix reverted)

| Finding | Status | Test that fails without the fix |
|---|---|---|
| M-1: regression lost when the newer version arrives first | **Fixed.** `findOrderConflict` compares in provider order, whichever event arrived first | status › "M-1: the regression is raised when the newer, lower-ranked version arrives FIRST"; delivery › every-permutation `regress_substatus` and `regress_to_routing` |
| M-2: Cobalt Wren paid → failed depends on order | **Fixed.** Every order ends `failed` + `EV_PROVIDER_SUCCESS_REVERSED` + `PV_FAILED_BENEFICIARY_REJECTED` | status › "M-2: …failure arriving first…", "paid → failed…"; delivery › CW `return` permutation, "…the one outcome in every order…" |
| M-3: hold never releasable | **Fixed.** `review_cleared` and `RELEASED` map to `payout.hold_released`; release still needs both the partner and the reviewer | review-fixes › the three M-3 tests |
| M-4: receipt can say "ingested" for a rejected delivery | **Fixed.** Only declared headers are bundled, and the receipt is taken from the engine's outcome | review-fixes › "a correctly signed delivery with many ordinary request headers…". The "invalid → rejected_recorded" test passes on old code too, so it is not a regression test |
| L-1: reconciler skip ignored the hold redelivery rule | **Fixed** | review-fixes › L-1 `list_since` test |
| L-2: Saltglass equal-rank completion claims | **Fixed** (`EV_PROVIDER_CLAIMS_DIFFER`, both orders) | status › "L-2: …" |
| L-3: audit text for unverified schemes | **Fixed** | review-fixes › L-3 |
| L-4: survivors M15 and M16 | **Fixed**; the owner reports both now killed | review-fixes › L-4 (the `headers-v2:` case kills the prefix mutant) |
| L-5: BR5 wording | **Fixed** (spec §8). The research file is now on the branch | n/a |

### False positives of the new conflict rule on legitimate forward flows

I found none when events arrive in provider order:
- I ran every arrival order of two non-shipped Cobalt Wren scripts: a late sub-status regression, and a mid-flow delivered → routing → delivered. Each gave **one** outcome across all 24 orders.
- The shipped success and presumed-only flows raise nothing. Their completion claims are the same (`provider_claims_paid`), and their ranks rise.
- completed → returned is correctly not treated as a conflict.
- `hold_release` delivered in order raises nothing (the owner's test). The resume at a lower routing rank is shielded by the hold boundary.
- With bank evidence (probe C), a paid → failed reversal ends `failed` / settlement `contradicted` / reconciliation `exception`, with `RC_DEBIT_FOR_FAILED_PAYOUT` raised as well. F1 and N1 still fire after the bypass of the state machine.

**RR-1 (Low): a false positive after a hold when events arrive out of order. It is not covered by the documented residual list.**
- **Where:** `connect/normalize.ts` `findOrderConflict`. The boundaries are only the side-state events accepted so far.
- **Scenario:** Cobalt Wren `hold_release`, delivered in the order v2 (`routing/at_bank`, rank 25), then v5 (`routing/awaiting_bank`, rank 20, the resume after release), then v3 (`paused_for_review`).
  - When v5 arrives, no hold boundary is known yet, so `EV_PROVIDER_STATUS_REGRESSED` is raised.
  - v3 then puts the payout on hold, and the false regression stays open next to the hold (probe B).
- **Why it matters:** this fails safe (an extra owned exception for a person to dismiss). But spec §4 lists only "leaving a terminal state" and "late pre-hold events during a hold" as residual cases. This case is the opposite one: a post-hold event arriving before the hold.
- **Fix (in words):** add it to spec §4/§15 as a third known case. Or, when a hold or release version is accepted, have the exception text of any open `EV_PROVIDER_STATUS_REGRESSED` whose pair it now separates say that the pair spans a hold. The exception still closes only through a person.

### Are the two surviving mutants equivalent? No, neither is.

**RR-2 (Low, test gap): the stored-late mutant.** This mutant removes `stored_late_no_regression` from `ACCEPTED` in `normalize.ts`.
- The owner argues that a stored-late event can never be the only reference for a conflict. That is false.
- **Counter-example:** a Cobalt Wren script `queued`, `routing/awaiting_bank`, `routing/at_bank`, `routing/awaiting_bank`, `delivered/bank_confirmed`. The only regression is v3 at_bank (rank 25) → v4 awaiting_bank (rank 20).
  - In orders where v5 arrives before v3, v3 is `stored_late_no_regression`, and it is the only reference for the pair.
  - With the mutant, **8 of 24** arrival orders lose the regression. With `delivered/handed_to_bank` → `routing/at_bank` → `delivered/bank_confirmed`, **4 of 24** lose it.
  - Without the mutant, all 24 orders agree in both scripts.
- All 108 rc4-connect tests still pass with the mutant applied. The shipped scripts simply never exercise this pattern.
- **Fix (in words):** add a script, or a property over generated scripts, with a regression between two versions that both come before the newest version. Include it in the every-permutation test, and correct the spec §13 claim.

**RR-3 (Low, test gap): the receipt-from-pre-check mutant.**
- The owner argues that the pre-check and the engine verify the same headers at the same instant. They do not always agree.
- **Why:** the multi-signature parser trims spaces around each `v1=` part, but the bundle decoder rejects any header value over 1024 characters.
- **Scenario:** a correctly signed Quillfern delivery whose signatures header has a long run of spaces after the comma.
  - Probe D: pre-check `verified`, engine `rejected_signature`, receipt (fixed code) `rejected_recorded`.
  - With the mutant, the receipt would say `ingested`. That is exactly the M-4 defect.
- **Fix (in words):** add this case to the M-4 tests. Separately, consider rejecting or normalising surrounding whitespace in the same way in both the pre-check and the bundle, so that a genuine delivery is not rejected for padding (Info).

### Is the documented residual order dependence acceptable?

**Yes, for a sandbox.**
- **Leaving a terminal state.** The conflict code raised is the same in both orders, and a person owns it. Only the shown execution differs, and no shipped script does this.
- **Late pre-hold events during a hold.** This is the existing H3 rule (suppressed for a person, with an owned exception) and is unchanged.
- **The undocumented case.** RR-1 should be added to that list.

Before any live provider, the spec should say plainly that hold scripts are outside the permutation guarantee. It currently says this only in §4/§6 and in a comment in the delivery test.

**RR-4 (Low, docs): the conflict path moves execution outside `EXECUTION_TRANSITIONS`.**
- **Where:** `events.ts` (`applyLatest` calls `setExecution` without `canTransitionExecution`).
- **Effect:** `provider_reported_completed → failed` and `provider_reported_completed → in_transit` now happen for Connect payouts. `state.ts:18` still says completed allows only `returned`.
- I checked F1, N1 and reconciliation react correctly (probe C). Anything else that relies on that table should be checked once, including the new accounting bridge's handling of a payout that leaves `provider_reported_completed`.
- **Fix (in words):** state the exception in `state.ts` and in spec §4.

### Re-review summary
- **Verdict:** APPROVE. Approval-only: needs Aashmiin's merge.
- **Fixed:** M-1 to M-4 and L-1 to L-5. tsc is clean, all vitest suites are green, and 16 new or changed tests fail with the fix reverted.
- **No false positives** on in-order or out-of-order forward flows outside holds.
- **Non-blocking follow-ups:**
  - RR-1: a false-positive regression when a post-hold version arrives before the hold. Fails safe; undocumented.
  - RR-2 and RR-3: both "equivalent" survivors are real test gaps, with concrete counter-examples above.
  - RR-4: the state-machine bypass should be documented.
