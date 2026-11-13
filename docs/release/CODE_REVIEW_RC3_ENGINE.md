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
