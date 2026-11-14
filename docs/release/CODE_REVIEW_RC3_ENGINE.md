# Code review: rc3 financial-backend engine (cf8732e..efabe6a)

**CODE REVIEW: BLOCK efabe6a**

APPROVAL-ONLY: needs Aashmiin's merge. The diff changes how money amounts are computed and reported, and `resetScenario` deletes records.

**In plain English.** Most of the rc3 fixes work, and their tests do fail when the fix is removed. I am still blocking for one reason: the new case report states a wrong amount. For a failed, cancelled or never-sent payment it reports the full requested amount as "Amount reconciled" (for example SGD 10,000.00 reconciled on a payment that failed with no evidence). There are also three major problems:
- The new integrity check throws away a whole saved browser workspace when a v2-era payout carries the old bug state. There is no repair path.
- A case whose bank debit includes a fee can never be closed. This is a regression.
- The fix for revived chain observations (C-1) misses the same-chain case.

Scope reviewed: `git diff cf8732e efabe6a -- src/lib/clearline tests/clearline docs/clearline` (11 engine commits and 1 test-timeout commit). I did not write any of this code.

---

## Checks I ran (frozen tree `scratchpad/cr4` = `git archive efabe6a`; node_modules symlinked)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass (0 errors) |
| `npx vitest run tests/clearline` | 24 files, 314 tests: pass |
| `npx vitest run` (full suite) | 64 files pass, 1 skipped; 1222 tests pass, 57 skipped |
| Mutation testing (separate copy `scratchpad/cr4m`, 25 mutants, `scratchpad/mut.py`) | 18 killed, 7 survived (see "Test strength") |
| Probe tests (copy `scratchpad/cr4p/tests/probe/*.test.ts`) and a base-tree comparison (`scratchpad/cr4base` = `cf8732e`) | findings below |
| Build | not run (not needed, per the brief) |

---

## Findings

### BLOCKER

**B-1. The case report shows the full amount as "reconciled" for failed, cancelled and never-sent payouts.**
`src/lib/clearline/report.ts:114-116`

`matchedMinor` is computed as `intent.amountMinor − (OS_NOT_RECONCILED + OS_PARTIALLY_RECONCILED outstanding)`, and returned payouts are special-cased to 0. `investigate()` emits no `OS_NOT_RECONCILED` for terminal or unsent payouts, so `matched` comes out as the full requested amount.

Reproduced on rc3 (probe E):

| Payout | Status | Report `matched` / `unreconciled` |
|---|---|---|
| created, never sent | reconciliation `not_started` | **10000.00** / 0.00 SGD |
| `payout.failed`, no evidence | `failed / none / pending` | **10000.00** / 0.00 SGD |
| s3 hold rejected | `cancelled / none / pending` | **8839.50** / 0.00 SGD |

These values appear in `threeTruths.reconciliation.matched`, in `amounts.matched`, and in the CSV row `amount,MATCHED`, whose label is "Amount reconciled". A finance user reading the export sees a failed payment as fully reconciled. That is wrong money, so it is a BLOCK under our rules.

Not caught by tests. The only check is s1/s4 at `rc3-case-report.test.ts:87`. Mutant 13 (drop the returned special case) survived.

**Fix (in words):** derive `matched` from the allocations themselves, the same way `investigate()` computes its own `matched`:
- bank-statement allocations in the source currency, excluding return credits;
- or the full amount only while a chain allocation's observation is final.

Never derive it from requested minus outstanding. Add report tests for a failed payout, a cancelled payout and a created payout, each asserting `matched` 0.00.

### MAJOR

**M-1. I-1 throws away workspaces that users saved with v2, with no migration or repair.**
`src/lib/clearline/serialize.ts:215` (via `crossCheck`, run on every `parseWorkspace` and `applyAction`); console at `src/components/clearline/workspace.tsx:53-57`.

The v2 engine itself produced `failed / verified`. Those are exactly the T-1 and T-2 bugs. I built both states on `cf8732e`, serialised them, and parsed them with rc3 (probe A):
- `v2_t1.json`: `invalid_field intents[5].status.settlement — "Damaged workspace … a failed payout cannot carry verified settlement. Reset to the sample."`
- `v2_t2.json`: the same, at `intents[0]`.

The storage key is unchanged (`clearline.console.workspace.v1`). So a person who hit T-1 or T-2 under v2 opens rc3 and their *entire* workspace is set aside: every case, not only the one bad payout.

The console does not brick: it shows the sample, holds writes, and keeps a backup through `replaceDiscarded`. But the only way forward is to lose the data. The message also calls the data "Damaged" when our own engine wrote it.

The same applies to any workspace saved before CHANGE 6 that has `returned / verified`.

**Fix:** before `crossCheck`, add a normalising migration in `parseWorkspace` that applies the rc3 rules to a terminal payout stored as `verified`:
- `contradicted` with a `CH_TRANSFER_FOR_TERMINAL_PAYOUT` or `RC_DEBIT_FOR_*` exception when the evidence exists;
- otherwise `none`.

Keep refusing only for states the engine could never have produced (maker = checker, double allocation). Add a test that loads a v2-produced fixture.

**M-2. X-1 makes a real success case impossible to close (a regression).**
`src/lib/clearline/exceptions.ts:249-250`

Scenario (probe D, base comparison in `cr4base/tests/probe/x1.test.ts`):
1. A provider-completed SGD 10,000.00 payout.
2. The bank debits 10,000.50 (fee added on top). This raises `RC_OVERPAYMENT`, and the debit is not allocated.
3. The operator assigns, attaches evidence and resolves the exception. The payout is left at `provider_reported_completed / none / pending`.
4. `canResolveCase` now returns `EVIDENCE_OUTSTANDING` permanently.

On `cf8732e` the same flow returns `RESOLVABLE`. No action exists to allocate the line by hand or to accept the difference, so the Resolve button stays disabled for good. The same dead end applies to:
- a batched or ambiguous debit (`RC_AMBIGUOUS_REFERENCE` is never allocated);
- a `RC_NO_STATEMENT_AFTER_COMPLETION` case where the statement line never arrives.

**Fix:** give the person an evidenced way out. Either:
- let a resolved amount-difference exception count as accepted evidence for X-1 (record `EVIDENCE_ACCEPTED_BY_PERSON` with note and evidence, maker ≠ checker if wanted); or
- allocate an over-amount debit up to the payout amount with the difference kept as an amount-difference record.

Add the overpayment case to `rc3-close-contradictions.test.ts`.

**M-3. The C-1 fix is incomplete: a rejected observation's hash still evidences the payout on the same chain.**
`src/lib/clearline/chain.ts:153` and `:211`

The new `otherChain` check only fires when the chain id or network differs. Scenario (probe B), on Base Sepolia (84532):
1. Observation with hash H and a non-allowlisted token: `rejected_unsupported`.
2. The same H reported as allowlisted USDC: outcome `applied`, a second observation `chn_…` `final`, payout settlement **`verified`**.
3. No contradiction is raised.

One transaction is now recorded both as an unsupported-token transfer and as a counted USDC transfer. The old record is no longer "revived", but the effect C-1 was meant to stop (a hash judged unsupported ends up counting) still happens.

**Fix:** treat any earlier observation with the same hash, including a rejected one on the same chain and network, as a contradiction (`CH_TX_HASH_CONFLICT` or reuse `CH_TX_HASH_ON_OTHER_CHAIN` with chain-agnostic wording), and do not count it. Add the same-chain test.

### MINOR

**m-1. No parse-time bound on amounts or totals, and the docs overstate the bound.**
`src/lib/clearline/serialize.ts:19` (`int(..., min)` has no maximum); `docs/clearline/ARCHITECTURE.md:110`.

`parseWorkspaceValue` accepts `amountMinor = 2^53−1`, which is above `MAX_AMOUNT_MINOR` (10^15). The architecture doc says stored amounts are "at most `MAX_AMOUNT_MINOR`… each", and that is not true for a parsed or posted workspace.

A parse-accepted crafted workspace (two committed Northline SGD intents of 4503599627370497 and 4503599627370498) gives `computeLiquidity().committedPayoutsMinor = 9007199254740996`. The exact value is …995 (probe `overflow.test.ts`). The API route accepts posted workspaces, so anyone can send one.

**Fix:** bound every `amountMinor`, `principalMinor` and liquidity field at parse to ≤ `MAX_AMOUNT_MINOR`. Either refuse when a per-currency sum the engine computes exceeds `Number.MAX_SAFE_INTEGER`, or do those sums in BigInt. Correct the doc.

**m-2. `resetScenario` moves the clock but does not apply what moving the clock implies.**
`src/lib/clearline/scenarios.ts:224-226`; doc `ENGINE_API.md:23` says the clock stays "byte-identical".

When `ctx.at > asOf`, the reset sets `asOf = ctx.at` but re-derives only the restored advances.

Probe H, reset of s1 at 2026-11-25:
- s5's advance is left `partly_repaid`. The very next action at the same instant shows `overdue` (`syncDerived`).
- Resetting s5 at that clock restores the advance as `overdue` but with no `FD_OUTSTANDING_AFTER_DUE_DATE` exception. `advance_clock` would have opened one.

**Fix:** either do not move `asOf` (and fix the doc), or re-derive every advance as `syncDerived` does and run the overdue rule. Test both at a later `ctx.at`. All current tests use `ctx.at = ws.asOf`.

**m-3. A wrong-chain entry by an operator is a dead end.**
`src/lib/clearline/chain.ts:153`

If the first observation of the real hash is entered with the wrong chain id, every later correct ingest of that hash raises another `CH_TX_HASH_ON_OTHER_CHAIN`. That happens even after the person resolves the exception, which opens new exceptions each time (probe C). Together with X-1, the payout's case can only close through some other observation. It is conservative, but there is no recovery path.

**Fix:** let a person's resolution of `CH_TX_HASH_ON_OTHER_CHAIN` mark the rejected record as superseded (it stays on record), so the correct-chain observation can be evaluated.

**m-4. The reset deletes person-entered records, and the audit trail keeps only a count.**
`src/lib/clearline/scenarios.ts:228-231`

A statement line, note or evidence a person added on the case is removed. The `scenario.reset` audit event records only "N record(s) replaced". This is documented, but after the fact the trail cannot say *what* was deleted.

**Fix:** put `removedIds`, and for statement lines `lineId`/`accountRef`/amount, in the audit event.

**m-5. Test gaps: surviving mutants on stated behaviour.**
- CSV guard, tab/CR (`report.ts:204`): removing `\t\r` from the guard survives. ENGINE_API promises it.
- CSV guard, leading `-`: removing it survives. The test payload only starts with `=`.
- X-1 reconciliation clause (`exceptions.ts:249`): dropping `|| reconciliation !== "matched"` survives.
- `resetScenario`: three mutants survive:
  - removing `ID_CONFLICT`;
  - not moving `asOf`;
  - not re-deriving the restored advance state.
- Report `matched`: see B-1.

### NIT

- **n-1.** `chain.ts:150`: the comment says "rc3 (C-3)" for the other-chain check, but the docs call it C-1.
- **n-2.** `tests/browser/clearline-console.spec.ts:538` still uses `lineId: "DBS-E2E-9001"`. It is outside the D-1 scope, but it is the same real-bank-name issue.
- **n-3.** "Damaged workspace … Reset to the sample" is the wrong wording for a workspace the engine itself wrote (see M-1).

---

## What I verified holds

**Money (M-1).** `applyBpsFloor` is used for the liquidity buffer and the platform fee in both `eligibility` and `quote`. The float mutant was killed (3 tests). The static scan test passes.

**Chain.**
- C-1, other-chain: the mutant was killed.
- C-2, block moved: the mutant was killed.
- C-3: reconciliation goes to `exception` on a reorg, and a chain allocation counts only while its observation is final, in `derive`, `investigate` and `tryAllocateChain`. Both mutants were killed.

I walked through the other event orders:
- reorg then `payout.failed`: the reorg exception stays open, and the recompute after resolution gives `none`;
- `payout.failed` then observation: refused (B1, documented);
- pending observation then `payout.returned`: M2 gives `contradicted`.

I found no regression in those orders.

**Three truths.** The T-1 and T-2 mutants were killed. The property test over the sample and its injections passes.

**I-1 robustness.** `crossCheck` refuses malformed shapes with a typed error, never a throw. I tried 8 corruptions: missing `decisions`, `allocationIds`, `status`, a null target, and others. The full suite (every action revalidates) passes, so the engine never produces a state `crossCheck` rejects. The only legitimate inputs it rejects are v2 bug states (M-1).

**returnPosition (R-1).**
- Codes and amounts are correct for s2 (`RT_DEBIT_NOT_ON_STATEMENT`).
- `beneficiaryPaid` is always false.
- The inverted-compare mutant was killed.
- A return credit on a completed payout raises a contradiction, not a `returnPosition`.

**resetScenario.**
- Ownership is a two-way fixed point, so no kept record can point at a removed one.
- No sample record is unowned: every pristine record is owned by exactly one scenario.
- Ids come from the global `seq`, so restored ids cannot collide with new ones.
- Idempotency keys follow their intents.
- The audit trail is append-only.
- The input workspace is not mutated.
- Byte-identity is tested per record for all 15 collections and the global objects (the sort mutant was killed). The full-sample round-trip also covers `idempotency`.

**Case report.**
- JSON and CSV are deterministic: two independent samples give identical output for all five cases.
- Keys are sorted; `generatedAt` is `ws.asOf`.
- The FICTIONAL marking is always in the JSON and is CSV row 2. Dropping the row is a killed mutant.
- The CSV guard holds against person-reachable input: references and counterparties with a leading tab, `=`, `+`, `-` or `@`, accountRefs starting with `+`, notes and evidence descriptions. I found no unguarded cell, and every row has 10 columns.
- Embedded CR/LF are flattened, and quoting is correct.
- Leading whitespace before `=` cannot reach a cell (`safeText` blocks it).

**D-1.** No real bank, PSP or issuer names remain in `src/lib/clearline` or the rc3 tests.

**E-1.** The mutant was killed.

**Docs and OpenAPI.**
- `resolution_not_permitted` maps to 409, and posted-workspace errors map to `invalid_field` with a field path, as documented.
- `DecimalAmount` pattern `\d{2,6}` fits every configured currency (all 2 dp, USDC 6).
- "No existing test changed" holds: the diff only adds `rc3-*.test.ts`.

Inaccuracies:
- `ARCHITECTURE.md:110` (per-amount bound, m-1);
- `ENGINE_API.md:23` ("clock byte-identical", m-2);
- ARCHITECTURE §4 marks row 5 as "Fixed" while the same-chain C-1 case is open (M-3).

---

## Summary

The engine fixes C-1 (other chain), C-2, C-3, T-1, T-2, M-1, E-1, R-1, D-1 and most of I-1 and X-1 are correct, and their tests fail without them.

Blocking: the case report states the full requested amount as reconciled for failed, cancelled and unsent payouts (B-1).

Also needed before merge:
- a migration so v2-saved workspaces with the old bug state are not thrown away (M-1);
- a way to close an evidenced case after an over-amount debit (M-2);
- the same-chain C-1 gap (M-3).

Minor: no parse-time amount bound, reset clock side effects, a chain dead end, reset audit detail, and seven surviving mutants.

---

# Re-review: 725c3a1 (fixes for the review above, plus the s2 sample change from 28874db)

**CODE REVIEW: BLOCK 725c3a1**

APPROVAL-ONLY: needs Aashmiin's merge. This still changes money amounts, the case-close rules and record deletion (reset).

**In plain English.** Every finding from the first review is fixed. Each fix has a test that fails when the fix is removed. The new s2 sample (debit, then return, then return credit) is correct.

I am still blocking, for one new defect. Take a workspace that a person saved under v2 (or efabe6a), reset the returned-payout case (s2) on it, and then add a few ordinary statement lines. The workspace ends up with duplicate record ids, and the engine then refuses to load it. The console would set the whole workspace aside. This comes from the new s2 sample: its records now use higher ids than older saved workspaces have reached, and the reset does not move the id counter past them.

Two more problems need fixing:
- In one real v2 state, the new load-time migration quietly removes a contradiction.
- The new way to close a case accepts a USD 0.01 line for an SGD 10,000 payment.

Scope: `git diff efabe6a 725c3a1 -- src/lib/clearline tests/clearline docs/clearline`. That is 7 fix commits plus the s2 sample change (28874db, 338861c). I wrote none of it.

## Checks I ran

- **Fresh frozen copy.** I made `scratchpad/cr5` with `git archive 725c3a1` and symlinked node_modules. I first deleted the old cr4, cr4m, cr4base and cr4p copies.
- **Old engine for comparison.** `scratchpad/cr5base` is a minimal archive of cf8732e, used to produce v2 states with the real v2 engine.
- **Typecheck.** `npx tsc --noEmit`: pass.
- **Tests.** `npx vitest run` (full suite, my probes removed): 68 files pass, 1 skipped; 1338 tests pass, 57 skipped.
- **Mutation testing.** I made a separate copy (`scratchpad/cr5m`, script `scratchpad/mut5.py`) and ran 23 mutants. See the table below.
- **Probes.** I reran all earlier probes and added new ones in `scratchpad/probes5/`: `rr.test.ts`, `rr2.test.ts`, `rr3.test.ts`, plus the earlier files.

## Status of the first review's findings

| Id | Status | Evidence |
|---|---|---|
| B-1 report "matched" | **Fixed** | Probe E: created 0.00, failed 0.00, cancelled 0.00; s1 24651.37; s5 50000.00; s4 (pending) 0.00. Mutants killed: requested − outstanding, counting return credits, chain without finality (killed by rc3-chain). |
| M-1 v2 workspaces refused | **Fixed, with a new defect (R-M1)** | Both v2 fixtures and my own v2_t1/v2_t2 now load. The migration is idempotent: parsing a second time gives byte-identical JSON, with no duplicate ids. The next action is accepted. Mutants killed: migration removed, open-contradiction ignored, "resolved" branch never taken / always taken. |
| M-2 unclosable case | **Fixed, with a new defect (R-M2)** | The over-amount debit case closes after a person resolves it (probe D). Mutants killed: path removed, provider report allowed. |
| M-3 same-chain revival | **Fixed** | Probe B: a rejected USDT observation, then the same hash as USDC: not counted, `CH_TX_HASH_CONFLICT`. Removing both identity clauses is killed. Each clause alone survives because the other covers it, which is acceptable. |
| m-1 amount bounds | **Fixed** | Parse refuses amounts above 10^15. Per-currency totals are checked in BigInt; create and ingest refuse a total over the limit. The overflow probe is now refused at parse. |
| m-2 reset clock | **Fixed** | The clock no longer moves. Clock rules are applied only to the restored records (probe H). |
| m-3 wrong-chain dead end | **Fixed** | Resolving the conflict supersedes the rejected record, and the correct observation is then counted (probe C: `applied`, verified). A forged `supersededBy` is refused at parse. The supersede mutant is killed. |
| m-4 reset audit | **Fixed** | The audit summary lists the removed ids and each removed line. |
| m-5 surviving mutants | **Fixed** | All are now killed: CSV tab/CR, CSV `-`, X-1 reconciliation clause, ID_CONFLICT, advance re-derivation. The clock mutant no longer applies. |
| n-1, n-3 | **Fixed** | — |

On the one changed I-1 test: it now uses an s3 payout stored as cancelled/verified with no evidence. That is justified: s2 now has a debit, so returned/verified on s2 is a state v2 could really produce, and it is migrated. The test was not weakened.

## New findings

### BLOCKER

**R-B1. Resetting s2 on a v2- or efabe6a-saved workspace creates duplicate ids, and the workspace can no longer be loaded.**
`src/lib/clearline/scenarios.ts:228-244` together with `src/lib/clearline/sample.ts` (s2 now runs after s5).

Why it happens:
- The rc3 sample's s2 records now have ids up to seq 180 (the sample ends at seq 185).
- A v2-saved sample ends at seq 164.
- `resetScenario` restores the s2 records (`evd_00166`, `alc_00167`, `pev_00169`, `evd_00170`, `exc_00171`, `case_00172`, `stl_00177`, `evd_00179`, `alc_00180`) but leaves `ws.seq` at 165.
- The `ID_CONFLICT` check only compares ids that exist *now*. It does not look at ids that later actions will generate.

Reproduction (`probes5/rr3.test.ts`):
1. Take the v2 sample, saved by the cf8732e engine.
2. `canResetScenario(s2)` returns RESETTABLE; reset it.
3. Add one note, then 6 ordinary statement lines.
4. The workspace now holds duplicate `stl_00177` and `evd_00179`.
5. The next `applyAction` returns: "This workspace cannot be loaded: allocations[4].id: must be listed in its statement line's allocationIds…"

At that point every action fails, and on reload the console sets the whole workspace aside. These are records lost through an ordinary flow on exactly the workspaces M-1 is meant to rescue. `resetScenario` is not wired into the console or the API yet, so no user can hit this today. It will happen as soon as the documented Reset button is built.

Fix:
- After restoring, set `seq` to at least the highest seq of any restored id.
- Better, refuse or renumber when restored ids lie above the current `seq`.
- Add a test that resets s2 on the committed v2 fixture and then runs several more actions, asserting all ids are unique.

### MAJOR

**R-M1. The migration hides a contradiction when an unrelated one was already resolved.**
`src/lib/clearline/serialize.ts:194` (`resolvedByPerson` matches *any* resolved `contradictory_evidence` or `returned_payout` exception on the payout).

A real v2 state, produced with the cf8732e engine (`cr5base/tests/probe/v2.test.ts` → `v2_va.json`):
1. A USDC payout gets a `contradictory` provider event (`EV_AMOUNT_DIFFERS_FROM_INSTRUCTION`), which a person resolves.
2. The chain transfer is final, so settlement is `verified`.
3. Then `payout.failed` arrives. v2 stores `failed / verified`.

rc3 migrates this to `failed / none` with **no exception**. The audit says "a person already resolved the contradiction", but the resolved contradiction was about something else.

For the same facts, the rc3 engine gives `failed / contradicted` with an **open `CH_TRANSFER_FOR_TERMINAL_PAYOUT`** (same probe, run on rc3). So the migration does not upgrade evidence, but it does remove a contradiction rc3 would show. Mutant 7 ("any resolved exception counts") survives, so the tests do not pin this.

Fix: take the `none` branch only when the resolved exception is the specific one the terminal rule raises: `RC_DEBIT_FOR_FAILED_PAYOUT` / `RC_DEBIT_FOR_TERMINAL_PAYOUT` / `CH_TRANSFER_FOR_TERMINAL_PAYOUT`, or the `returned_payout` exception for a returned payout. Otherwise open the T-1 exception. Add the v2_va fixture as a test.

**R-M2. The "accepted bank line" close path accepts any amount, any currency and any date, and treats any resolution as acceptance.**
`src/lib/clearline/exceptions.ts:278-288`.

Provider reports and amount-only lines are correctly excluded (the probes show `EVIDENCE_OUTSTANDING` and no case). But for an SGD 10,000.00 payout, each of these bank debits carries the provider payment id, and each lets the case close once its exception is resolved. In my probe the person's resolution note was "This line is not ours; recall requested":
- **USD 0.01** (`RC_CURRENCY_MISMATCH`);
- **SGD 9,999,999.00** (`RC_OVERPAYMENT`);
- a line dated **2025-01-01** (`RC_OUTSIDE_TIME_WINDOW`).

The `RESOLVABLE` reason then says "The payment is evidenced by bank line …". Settlement stays `none`, so this does not upgrade evidence. But "nothing closes a case without matching evidence" (invariant 8a) is no longer true, and the close message is wrong.

Four mutants survive:
- the reference check dropped;
- system resolutions allowed;
- credit lines allowed;
- (mutant 7, listed under R-M1).

Fix:
- Count only a line whose amount covers the payout in the source currency, up to a bounded overage.
- Do not count a currency mismatch at all, unless the case also records the converted amount.
- Require an explicit "accept difference" outcome (or a checker other than the person who resolved), not any resolution.
- Add tests that kill the three line-shape mutants.

### MINOR

**R-m1. Migration side effects are recorded but not returned.**
The migration writes `workspace.migrated` audit events, and possibly a new case and exception, inside `parseWorkspaceValue`. They are not part of `ActionResult.audit`, and nothing tells the person that loading their workspace changed it. This is documented, but the console should say so.

## What I checked on the s2 sample change (28874db)

- **Status.** s2 is `returned / contradicted (bank_statement) / exception`, `returnStatus: confirmed_by_statement`.
- **Return position.** `returnPosition` is `RT_NET_ZERO` with `netMovement 0.00` and `beneficiaryPaid: false`. The `returned_payout` exception is in review and owned by `usr_maya`, so the case cannot close (OPEN_EXCEPTIONS).
- **Report.** `matched` is 12784.90, which is the debit, and matches the new label "matched to statement debits".
- **Other cases.** s1, s3, s4 and s5 ids are pinned by `rc3-sample-stability.test.ts`.
- **Docs.** ENGINE_API and DATA_MODEL describe the new flow correctly.

The one defect it introduces is R-B1.

## Mutation summary (re-review)

**Killed (18):**
- B-1: requested − outstanding, counting return credits, chain without finality.
- M-1: migration removed, open contradiction ignored, "resolved" never taken, "resolved" always taken.
- M-2: path removed, provider report allowed.
- M-3: both identity clauses dropped.
- m-3: supersede ignored.
- m-5 recheck: CSV tab/CR, CSV `-`, ID_CONFLICT, advance re-derivation, X-1 reconciliation clause.

**Survived (6):**
- M-1: "any resolved exception" (this is R-M1).
- M-2: reference check, system resolution, credit line.
- M-3: each single identity clause on its own (acceptable: each is redundant with the other).

## Docs

- **CHANGE 8 M-1 row.** It describes the `none` branch as "a person already resolved one". That is the R-M1 behaviour; correct it with the fix.
- **CHANGE 8 M-2 row.** It is accurate about what is excluded, but it implies the accepted line is matching evidence, which it may not be (R-M2).
- **resetScenario paragraph.** It claims no dangling or contradictory references, but says nothing about future id collisions (R-B1).
- **OpenAPI.** I checked the M-2 and m-1 additions against the code and they match.

## Summary

Every finding from the first review is fixed and pinned by a test that fails without it. Verdict: **BLOCK 725c3a1**. Resetting s2 on a workspace saved under v2 or efabe6a creates duplicate ids, after which the workspace cannot be loaded (R-B1). It is latent until the Reset button is wired. Before merge, also fix:
- the migration's "already resolved" branch, which hides a terminal-payout contradiction (R-M1);
- the accepted-line close path, which treats any resolution of any wrong-amount, wrong-currency or wrong-date debit as matching evidence (R-M2).
