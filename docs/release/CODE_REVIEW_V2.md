# CODE REVIEW: CHANGES REQUESTED c498da6

**APPROVAL-ONLY: needs Aashmiin's merge.** This change touches money amounts, settlement and reconciliation status, and maker/checker-gated actions.

**In plain English:** the money arithmetic is exact, the new tests really do catch the bugs they target, and the console never shows "done" unless the engine recorded it. The redirects are safe and the build passes. Three things still need fixing before this goes out to people trying the product:

1. The new rule "a provider settlement report on a failed payout is a contradiction" only works when the report arrives *after* the failure. If the report comes first and the failure second, the failed payout keeps showing "Settlement observed" and no contradiction is raised.
2. The new "Supplier paid — basis" line on the Funding page can say **"Supplier payout verified by independent evidence"** for a payout the provider has reported as **returned**.
3. After a short bank line is later completed, or a short provider report is resolved, the payment page still lists the old shortfall under **"Financially outstanding"**, with "Find the statement line for the remaining SGD 7,500.00", even when the payment is fully matched and verified.

None of these posts a wrong amount or loses a record, so the verdict is CHANGES REQUESTED, not BLOCK. Each fix is small and local.

| | |
|---|---|
| Reviewer | `code-reviewer` role, played by a general-purpose subagent briefed with `.claude/agents/code-reviewer.md`. I wrote and suggested none of this code. |
| Scope | `13e2a34..c498da6` on `release/clearline-v2-20261113` (commits 0490e40 engine CHANGE 5, 8c57fec WIP, c498da6 console). 83 files, +2,612 / −628. I reviewed the net diff, so the WIP commit's content is covered through c498da6. |
| Frozen copy | `git archive c498da6` into my scratch folder. The live working tree had uncommitted edits (`src/components/clearline/Link.tsx`, `tests/browser/clearline-console.spec.ts`) while I reviewed. **I did not review those edits.** Line numbers below are for c498da6. |
| Date | 2026-11-13 SGT |
| Independence caveat | All three commits carry the same `Claude-Session` (`session_015s4Kk7…`) as the session that asked for this review. I wrote and suggested none of the code, so the role rules do not require me to step aside. But the reviewer and the author share one orchestrating session, so this is not a fully independent review. A second reviewer, or Aashmiin, should read M1–M3 before anyone relies on this verdict. |

## Checks I ran (frozen c498da6)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` (whole repo) | 51 files passed, 1 skipped; **1079 passed**, 57 skipped |
| `npx next build` | exit 0 (all `/clearline/*` pages and the 9 redirect handlers built) |
| Proving the tests fail without the fix (mutations in a second scratch copy) | Disabling the F1 block (`reconciliation.ts:213`) and the F2 block (`:244`) makes **8 of the 44** `change5.test.ts` tests fail. Removing the `!terminal` guard in `derive.ts:20` makes "F1: after a person resolves…" fail. Hard-coding `supplierPaidBasis` makes "m5: …" fail. The new tests are real. |
| Engine probes (scratch `tests/probes/probe*.test.ts`) | P1–P13, cited below |
| Redirect handlers (all 9 `REDIRECTS`) | 308 to a fixed relative path; the query is kept URL-encoded; an injected `//evil…%0d%0a…` stays inside the query. **No open redirect.** Every target page exists. |
| `npm run lint`, Playwright (`tests/browser/*`) | **Not run.** Lint installs packages. There is no Playwright browser in this environment (`~/.cache/ms-playwright` is absent). I report neither as passing. |

## What I verified works

- **Exact money.** `convertMinor` is BigInt, rounds down, rejects `1e3`, `" 1"`, `0`, `0.000`, negative and fractional amounts, and caps at `MAX_AMOUNT_MINOR`. USDC keeps 6 dp: 10,000.00 SGD × 0.741234 = 7,412,340,000 USDC minor units (exact). The only caller (`adapters.ts:236`) turns a failure into an ineligible quote. An eligible quote can no longer show 0 (`AMOUNT_BELOW_FEES` / `RATE_UNAVAILABLE`).
- **Difference arithmetic.** `differenceMinor = expectedMinor − reportedMinor`, always > 0. For a provider report, expected is the payout amount. For a bank line, expected is the remainder before that line. `parseWorkspace` rejects a tampered or fractional difference (P7).
- **F1 in the order it handles** (report after failed/cancelled/expired/returned): it raises `contradictory_evidence`, nothing is allocated and settlement is unchanged. After resolution the recompute does not count the report (verified by mutation).
- **F2.** A short provider report raises `RC_UNDER_AMOUNT_REPORT` and never upgrades settlement. This holds even after a full bank match (difference 1 minor unit). Two short reports that add up to the payout (600k + 400k) stay two exceptions: they are never summed into "settled" (P3b). N1 still holds: a full provider report after a bank match changes nothing.
- **Provider completion never proves settlement.** `supplier_paid` still needs only `provider_reported_completed` for the *state*. The new basis field separates "provider-reported" from "verified". The labels avoid "paid" for a provider-only claim.
- **The UI does not decide actions or compute money.** `Action.tsx` runs every action through `applyAction` (a dry run on a clone via `preview`) before enabling a button. `useRun` shows "recorded by the engine" only when `r.ok`. Maker ≠ checker, hold decisions and case resolution are refused by the engine and shown with its reason. There is still no hold release button. The only console arithmetic is counting and filtering on engine fields (Overview m8 now counts `partially_allocated`).
- **Labels** (`labels.ts`) cover every union member, every static code, the dynamic families and every outcome (the coverage tests pass). Provider claims are neutral in tone. "Returned — net zero (supplier still unpaid)" is kept. I found no label mapped to the wrong state.
- **Body limit** (`bodylimit.ts`): stops at 512 KB and cancels the stream. It counts bytes, not characters.
- **Error boundary** (`app/clearline/error.tsx`): it never resets on its own. The reset is a separate button that says what it discards.

---

## Blockers

None.

## Major

**M1. F1 only works in one order. A report that arrives before the failure leaves a failed payout "settlement observed", with no contradiction.**
- Where: `src/lib/clearline/reconciliation.ts:213` (the rule checks the execution state only at the moment the report line is ingested). `src/lib/clearline/events.ts:240-262` (a later `payout.failed` / `payout.returned` neither re-checks recorded settlement reports nor resets settlement). `derive.ts:19-20` only helps after a person resolves some exception.
- Evidence (P1): submitted → `payout.in_transit` → full provider settlement report (`settlement: observed / provider_report`) → signed `payout.failed`. Result: `{"execution":"failed","settlement":"observed","settlementScope":"provider_report"}`, `investigate().contradictions = []`, no `RC_REPORT_ON_TERMINAL_PAYOUT`. The console summary reads "Provider reports failed · Settlement observed (not verified) (Provider report only) · Awaiting statement". The same happens for returned (P1b: `returned` + `observed/provider_report`, no contradiction). ENGINE_API CHANGE 5 and `openapi.yaml:70-72` describe F1 as covering every terminal state without this order caveat. The F1 tests only cover the report-after-terminal order (`change5.test.ts:55-86`).
- Fix (in words): when a provider event moves a payout to failed or returned, check whether a provider settlement report is already recorded for it. If one is, raise the same `contradictory_evidence` / `RC_REPORT_ON_TERMINAL_PAYOUT` exception and stop counting that report as settlement (settlement goes back to `none` unless independent evidence exists). Add the reverse-order tests for failed and returned, and say in ENGINE_API that both orders are covered.

**M2. New `supplierPaidBasis` reports "verified_settlement" for a returned payout. The Funding page then says "Supplier payout verified by independent evidence".**
- Where: `src/lib/clearline/funding.ts:84` (the basis looks at `settlement === "verified"` only, not at execution). `src/components/clearline/pages/Funding.tsx:11,43` (label "Supplier payout verified by independent evidence"). It is made worse by `components/clearline/labels.tsx:33`, where `verified` changed from blue "info" to a green "ok" chip.
- Evidence (P9/P10): the sample `s5_funding` payout is bank-verified. After a signed `payout.returned`, the status is `{"execution":"returned","settlement":"verified","settlementScope":"bank_statement","reconciliation":"exception"}`. The funding row reads `state: partly_repaid, supplierPaidBasis: verified_settlement, supplierPayout.execution: returned`. The underlying "returned keeps `verified` until a person resolves" is pre-existing (first review P5b; N2 fixed only the recompute). This diff adds a new, explicit claim that the supplier payout is verified on a payout whose money came back. That breaks the "returned payout never shown delivered" rule. The m5 test (`change5.test.ts:418-433`) only checks the sample's current state and encodes the same formula, so it cannot catch this.
- Fix (in words): the basis must be `none` (or a separate "returned/failed" value with its own label) whenever execution is returned or failed, whatever the settlement field says. Better still, a provider return should immediately take settlement off `verified` for the payout leg, as the recompute already does. Add a test: a bank-verified payout followed by `payout.returned` must never yield `verified_settlement` or a green "Verified" chip.

**M3. Old amount differences are shown under "Financially outstanding" after the gap is closed or resolved.**
- Where: `src/lib/clearline/investigation.ts:123-128` builds `amountDifferences` from every linked line that ever carried one, and adds their codes to `explanationCodes`. `src/components/clearline/pages/Investigation.tsx:234-237` renders all of them inside "Financially outstanding" (and hides "Nothing outstanding" while any exist). The bank partial difference is written once (`reconciliation.ts:288`) and never cleared.
- Evidence (P4): a bank line of SGD 2,500 then SGD 7,500 against a SGD 10,000 payout gives `settlement: verified, reconciliation: matched`, `outstanding: []`. But `amountDifferences` still holds `{RC_PARTIAL_AMOUNT, difference 750000, requiredNextAction: "Find the statement line for the remaining SGD 7,500.00. The remainder stays outstanding…"}`, and `explanationCodes` includes `RC_PARTIAL_AMOUNT` ("Partial amount — remainder outstanding"). The page therefore tells a person SGD 7,500.00 is outstanding on a fully matched, verified payment. P3 shows the same after a person resolves the `RC_UNDER_AMOUNT_REPORT` exception: no contradiction remains, but the shortfall block is still shown as outstanding. The F2 test at `change5.test.ts:146-163` asserts the difference after the first line but not what `investigate` shows after the remainder arrives.
- Fix (in words): `investigate` should return as current only the differences that still apply. A bank partial applies while the payout is not fully reconciled. A provider under-amount report applies while its exception is open. It should keep the others as history, or omit them. The console should show history outside "Financially outstanding". Add a test that a matched payout has no current difference and no `RC_PARTIAL_AMOUNT` in its explanation codes.

## Minor

- **m1. A short (or otherwise disagreeing) provider report becomes settlement evidence once its exception is resolved.** `exceptionFor` records a `provider_settlement_report` evidence item for every report line (`reconciliation.ts:119`). The recompute counts any such item (`derive.ts:20`). P3: after a person resolves the SGD 4,000-of-10,000 under-amount exception, settlement becomes `observed / provider_report` and "Who acts" reads "Nothing outstanding". Fix: the recompute should count only provider reports that agreed with the payout (the ones recorded as `recorded_provider_report`), not those that raised an exception.
- **m2. A provider settlement report on an `on_hold` payout is recorded as `observed`** (P13, sample `s3_hold`). This is outside F1's terminal list and pre-existing. But QA H3 says a provider claim never moves a held payout, and here it changes a settlement dimension during a partner hold. Decide on purpose whether a report during a hold is a contradiction, and record the decision in ENGINE_API.
- **m3. Repeated identical short provider reports open one new exception each** (P3b: the same SGD 4,000 report under another line id gave a third open `RC_UNDER_AMOUNT_REPORT`). This is conservative, but it creates noise for the person working the queue. Consider the same duplicate test bank lines get (same reference, amount and value date → `RC_DUPLICATE_SUSPECTED`).
- **m4. `parseWorkspace` accepts an `amountDifference` whose `currency`, `source` or `statementLineId` disagrees with its own line** (P7: `statementLineId: "nope"`, currency PHP on an SGD line → accepted). Fix: on a statement line, require these to equal the line's own id, currency and source. On an exception, require them to equal the linked line's.
- **m5. `app/clearline/error.tsx` does not catch errors thrown in the layout** (`WorkspaceProvider`, `AppShell`, including the new `DiscardedNotice`). Next.js renders a segment's error boundary inside its layout, and there is no root `app/error.tsx` or `global-error.tsx`. A crash there shows the framework default, not the honest page. Fix: add a parent boundary that does not depend on the workspace context.
- **m6. The unreadable stored workspace is overwritten at once** (`components/clearline/workspace.tsx:84`). The notice is honest ("Nothing from it was kept"), but the raw copy is gone before anyone can look at why it failed. Consider keeping it under a backup key until the person dismisses the notice.
- **m7. Every render runs a full dry run of every gated action.** `preview` calls `applyAction`, which validates and clones the whole workspace. That is 6 per `TargetActions`, one per quote on Connect, and 3 per hold card, recomputed on every keystroke. The Exceptions page renders `TargetActions` per exception. This is fine for the sample's size, but it grows with workspace size × number of buttons. Consider memoising per workspace version, or computing gates only for the expanded item.
- **m8. `openapi.yaml` describes CHANGE 5 only in prose** (`:69-78`). There is no schema for `AmountDifference`, `InvestigationView.amountDifferences`, `FundingProjectionRow.supplierPaidBasis` or the new `RATE_UNAVAILABLE` eligibility code. Clients generated from the spec will not see these fields.

## Nits

- `components/clearline/labels.tsx:139` `statusText` (and its `LOCAL` table) is new and unused.
- `Investigation.tsx:22-23` `WithDiff` / `diffsOf` cast to an optional `amountDifferences`, but `InvestigationView.amountDifferences` is now required and always set. This is dead defensive code. The comment ("older workspaces") does not apply, because the view is computed and never stored.
- `components/clearline/redirect.ts:8` `moved()` with a key missing from `REDIRECTS` answers 308 with `Location: undefined` (probe). Fail at module load instead.
- `derive.ts:19` repeats the terminal list by hand (without `returned`, which the branch below handles). Using `TERMINAL_FOR_SETTLEMENT_REPORT` with a comment would keep the two in step. `TERMINAL_FOR_SETTLEMENT_REPORT`, `explainCode` and `isKnownCode` are exported, but nothing in the console uses them.
- The `advanceState.supplier_paid` label is always "Supplier paid (provider-reported)", even when `supplierPaidBasis` is `verified_settlement`. That understates, which is safe, but the two lines on the Funding card can read inconsistently.
- ENGINE_API CHANGE 5 says F1 sets "reconciliation `exception`". True, through `openException` (`exceptions.ts:156-158`, because the line id is passed), but nothing in the F1 tests asserts it.

## Docs vs behaviour

- ENGINE_API CHANGE 5 matches the code for F2, m11, m5 and R4, and the claim of "44 tests" is correct. F1's description overstates coverage (see M1). `openapi.yaml` matches in prose (see m8).
- The re-triage table says m8 is "console-owned". c498da6 fixed it (`Overview.tsx:16`, `Reconciliation.tsx` `status=open`). ENGINE_API still describes it as open. Update the row.

## What I did NOT review

- The uncommitted working-tree edits made after c498da6 (`Link.tsx`, `clearline-console.spec.ts`).
- Visual design, contrast and responsiveness (`tokens.css`, `ui.module.css`, the screenshots). I did not run Playwright, so neither browser suite has been run by me.
- Lint.
- `docs/clearline/DATA_MODEL.md` and `ARCHITECTURE.md` changes (only skimmed). Docs outside `docs/clearline` and `docs/release`.
- Code outside the diff, except where a finding needed it (`events.ts`, `funding.ts` state derivation, `exceptions.ts`, `middleware.ts` allow-list).
- Chain-evidence rules (network/token/destination/amount/finality, one transaction for one payout): unchanged in this diff. I relied on the existing suites, which pass. I did not re-probe them.

## Verdict

**CHANGES REQUESTED c498da6** for a public, fictional-data trial PR. Fix M1–M3, each with a test that fails without the fix. The Minors can follow in a later change, and m1 and m4 are each a few lines. Merging stays approval-only: `APPROVAL-ONLY: needs Aashmiin's merge`. **Independence caveat:** the same orchestrating session produced this code and requested this review. A second reviewer, or Aashmiin, should read M1–M3.

— code-reviewer (general-purpose subagent in the code-reviewer role) · https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j · 2026-11-13 SGT
