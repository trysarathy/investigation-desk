# Clearline sandbox engine — public API (for the console UI)

> **CHANGE 7 (2026-11-13, rc3 Priority A — critical correctness, branch `rc3/wip-engine`). STATUS: LANDED.** Tests: `tests/clearline/rc3-*.test.ts` (9 files). No existing test changed or weakened.
>
> **New exports (all pure; import from `@/lib/clearline`):**
>
> ```ts
> // (a) per-scenario reset — scenarios.ts
> canResetScenario(ws: Workspace, scenario: string): ResetCheck
> resetScenario(ws: Workspace, scenario: string, ctx: { actorId: string; at: string }): Result<ResetScenarioOutput>
> // scenario = "s1_success" | "s2_returned" | "s3_hold" | "s4_chain" | "s5_funding", or that case's sample payment id or case id
> interface ResetCheck { allowed: boolean; code: ResetBlockCode; reason: string; scenario?: SampleScenario; blockers: string[] }
> type ResetBlockCode = "RESETTABLE" | "NOT_A_SAMPLE_SCENARIO" | "SCENARIO_NOT_IN_WORKSPACE" | "ID_CONFLICT" | "REFERENCED_BY_OTHER_RECORDS" | "REFERENCE_IN_USE"
> interface ResetScenarioOutput { workspace: Workspace; scenario: SampleScenario; removedIds: string[]; restoredIds: string[]; audit: AuditEvent[] }
>
> // (b) synthetic case report — report.ts
> buildCaseReport(ws: Workspace, ref: string | { paymentId: string } | { caseId: string }): Result<SyntheticCaseReport>
> caseReportToJson(report: SyntheticCaseReport): string   // sorted keys, 2-space indent, trailing "\n"
> caseReportToCsv(report: SyntheticCaseReport): string    // RFC 4180, CRLF, columns CASE_REPORT_CSV_COLUMNS
> CASE_REPORT_MARKING, CASE_REPORT_CSV_COLUMNS            // constants
> ```
>
> - **resetScenario** restores one guided case's records to the sample and leaves the other four cases, every person-created record and the global data (routes, liquidity, policy, actors, organisation, clock) byte-identical. Ownership is computed: sample intents/advances anchor their case; person-created intents/advances anchor themselves; every other record belongs to the anchors it references by id (transitively) and, for a statement line, by the trusted reference it carries (provider payment id / repayment reference). Records owned **only** by the case — including activity a person added on it (a statement line matched to its payment, a note, attached evidence, a resolution) — are replaced by the sample versions. The audit trail is append-only: nothing is removed and one `scenario.reset` event is appended. The clock is not rewound (advance state is re-derived at the current clock). **Errors:** `invalid_field` (damaged workspace, or `ctx.at` earlier than `ws.asOf`), `unauthorized_actor` (unknown actor; any known actor may reset), `not_found` (`NOT_A_SAMPLE_SCENARIO`), `precondition_failed` for every other refusal — `error.message` starts with the `ResetBlockCode` (`"REFERENCED_BY_OTHER_RECORDS: …"`) and `error.entityId` is the first blocker. Refusals: **REFERENCED_BY_OTHER_RECORDS** (a record links this case and another case or a person-created intent/advance — e.g. a correction intent for the returned payout, an advance on the case's payment, a line whose candidates span two payouts; `blockers` lists the person-created anchors first), **REFERENCE_IN_USE** (a person's active payment uses the internal reference the reset would reactivate), **SCENARIO_NOT_IN_WORKSPACE** / **ID_CONFLICT** (workspace not derived from the sample). `canResetScenario` returns the same decision without changing anything (use it to enable the button and show `reason`). Labels: `HUMAN_LABELS.resetCode`.
> - **buildCaseReport** — pure; the same workspace always gives byte-identical JSON and CSV; `generatedAt` is `ws.asOf`. A string `ref` is tried as a payment id, then a case id. Errors: `not_found`, `invalid_field` (empty ref), `precondition_failed` (a case with no payment). The report carries `marking` (`CASE_REPORT_MARKING`, "FICTIONAL · SANDBOX …"), `fictional: true`, `sandbox: true`, `subject`, `summary` (headline = `describeStatus().summary`, who acts), `threeTruths` (execution with basis `provider_claim`; settlement state + scope + `independent`; reconciliation with `matched` / `unreconciled`), `timeline` (every `evidenceTimelineFor` entry with source, provenance, independence), `findings` (section, code, label, text, refs, amount), `amounts` (requested, matched, unreconciled, differences, funding, returnPosition) and `exceptions`. **Every amount is a `DecimalAmount` `{ value: "24651.37", currency: "SGD" }` exact decimal string** (USDC 6 dp); no amount is a number. CSV: row 1 header, row 2 `marking,FICTIONAL_SANDBOX,FICTIONAL / SANDBOX,…`; text cells that start with `= + - @`, tab or CR are prefixed with `'`; newlines are flattened. `exportCaseReport` is unchanged.
> - **InvestigationView.returnPosition** (new, optional; `ReturnPosition`) — for a returned payout: `debited`, `returnCredited`, `netMovement` (only when both legs are on the statement), `netMovementZero`, **`beneficiaryPaid: false`**, `code` (`RT_NET_ZERO` / `RT_NET_NOT_ZERO` / `RT_RETURN_NOT_ON_STATEMENT` / `RT_DEBIT_NOT_ON_STATEMENT`) and `text`. `explanationCodes` gains the code and `RT_BENEFICIARY_UNPAID`. `HUMAN_LABELS.returnStatus` labels `PaymentIntent.returnStatus` ("Return confirmed on the statement").
>
> **Behaviour changes (each with a test that fails without it):**
>
> | Id | Change | Test |
> |---|---|---|
> | C-1 | A rejected (unsupported) chain observation is never updated into a counted one; the same tx hash already seen on another chain/network raises `CH_TX_HASH_ON_OTHER_CHAIN` and is not counted. Before: a chain-1 observation was revived to `final` and the payout showed `verified`. | `rc3-chain.test.ts` |
> | C-2 | The same transaction in a different block raises `CH_BLOCK_CHANGED` (reorg); settlement `contradicted`. | `rc3-chain.test.ts` |
> | C-3 | A reorg (confirmations down or block changed) sets reconciliation `exception`; a chain allocation counts as a match only while its observation is final (recompute, investigate, `tryAllocateChain`). | `rc3-chain.test.ts` |
> | M-1 | Basis-point amounts (liquidity buffer, platform fee) use BigInt (`applyBpsFloor`). Before: off by one above 2^53. `parseWorkspace` requires an integer `route.platformFeeBps`. | `rc3-money.test.ts` |
> | X-1 | `canResolveCase` / `resolve` on a case: **`EVIDENCE_OUTSTANDING`** for a sent, non-terminal payout unless settlement `verified` and reconciliation `matched`; **`OUTSTANDING_REMAINS`** while the linked advance's obligation has an outstanding amount. Before: a case on a provider-completed payout with no statement could close. | `rc3-close-contradictions.test.ts` |
> | T-1 | An on-chain transfer observed before `payout.failed` (or a reviewer's reject → `cancelled`) raises `CH_TRANSFER_FOR_TERMINAL_PAYOUT` (`contradictory_evidence`), settlement `contradicted`. Before: `failed / verified`. | `rc3-integrity-truths.test.ts` |
> | T-2 | After a person resolves the contradiction on a failed, cancelled or expired payout, the recompute gives settlement `none` (evidence stays on record), never `verified`. | `rc3-integrity-truths.test.ts` |
> | I-1 | `parseWorkspace` (run by every `applyAction`) refuses a workspace where one statement line or chain observation is allocated to two payouts/obligations or above its amount, an allocation is missing from its line, a repayment is counted twice, maker = checker on an instruction or funding decision, a hold is released/rejected without the reviewer's decision, or a failed/cancelled/expired/returned payout carries `verified`. | `rc3-integrity-truths.test.ts` |
> | E-1 | `evidenceTimelineFor` includes provider settlement reports recorded as evidence (no allocation, no exception), `independent: false`. | `rc3-integrity-truths.test.ts` |
> | R-1 | `InvestigationView.returnPosition` (above). | `rc3-returns.test.ts` |
> | D-1 | Sample statement line ids renamed `DBS-SIM-000N` → `SIMBANK-000N` (DBS is a real bank). Amounts, references and outcomes unchanged. | `rc3-data-exposure.test.ts` |
> | S-2 | **Sample s2 is now demonstrative** (follow-up). The statement shows the outgoing debit `SIMBANK-0002` (USD 12,784.90, `NORTHLINE PAYOUT <ppid>`, matched `RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW`) BEFORE the provider's `payout.returned`, and the return credit `SIMBANK-0006` (same amount, `RETURN <ppid> ACCOUNT INVALID`, `RC_RETURN_CONFIRMS_PROVIDER_RETURN`) after it. Result: `execution returned`, `settlement contradicted` (scope `bank_statement`; the return contradicts the earlier debit evidence — M2, never verified), `reconciliation exception`, `returnStatus confirmed_by_statement`, `returnPosition.code RT_NET_ZERO`, `netMovement 0.00`, `beneficiaryPaid false`; the `returned_payout` exception stays open, owned by `usr_maya` (the supplier still has to be paid). v2 had only the return credit (settlement `none`, `RT_DEBIT_NOT_ON_STATEMENT`). The payment keeps `pi_00027`; its later records get new ids, and the id/time range the v2 steps used (seq 45–59) is left unused, so s1, s3, s4 and s5 are byte-identical (pinned fingerprints). | `rc3-sample-stability.test.ts`, `rc3-returns.test.ts`, `rc3-case-report.test.ts` |
>
> New explanation / resolution codes (all labelled): `CH_TX_HASH_ON_OTHER_CHAIN`, `CH_BLOCK_CHANGED`, `CH_TRANSFER_FOR_TERMINAL_PAYOUT`, `EVIDENCE_OUTSTANDING`, `RT_NET_ZERO`, `RT_NET_NOT_ZERO`, `RT_RETURN_NOT_ON_STATEMENT`, `RT_DEBIT_NOT_ON_STATEMENT`, `RT_BENEFICIARY_UNPAID`, the `ResetBlockCode` values and the CSV row codes (`HUMAN_LABELS.reportRowCode`). Console impact: a case's Resolve button may now be disabled with `EVIDENCE_OUTSTANDING` / `OUTSTANDING_REMAINS` (`canResolveCase` already drives it).

> **CHANGE 6 (2026-11-13, code review v2 of c498da6 — `docs/release/CODE_REVIEW_V2.md`). STATUS: LANDED.** Tests: `tests/clearline/review-v2.test.ts` (36 tests: 26 for the review, 7 for re-review N1, 3 for final-check C1/C2). No existing test changed.
>
> - **M1 — F1 is order-independent.** `setExecution` (events.ts) now calls `onExecutionChanged` (reconciliation.ts) on every execution change. When a payout becomes `failed`, `cancelled`, `expired` or `returned` (`TERMINAL_FOR_SETTLEMENT_REPORT`, now defined once in `state.ts`), every provider settlement report already recorded for it (debit payment lines carrying its provider payment id, not ambiguous, not already flagged) raises the same `contradictory_evidence` / `RC_REPORT_ON_TERMINAL_PAYOUT` exception as a report arriving afterwards (the report's existing evidence item is reused; reconciliation becomes `exception`). If settlement rested on a provider report only, it goes back to `none` / `none`, which is the state the report-after order leaves, so both orders end in the same status and the same open exceptions. Through the engine, `cancelled` after submission is reachable only by the compliance reviewer's `reject` on a held payout; `expired` only before submission (no report can link), so for stored workspaces `investigate()` also **derives** the finding: a terminal payout with an agreeing, unflagged provider report shows `RC_REPORT_ON_TERMINAL_PAYOUT` in `contradictions`. Same order-independence for a bank debit matched before `payout.failed`: `RC_DEBIT_FOR_FAILED_PAYOUT` and settlement `contradicted`, as in the debit-after order.
> - **M2 — a returned payout is never "verified".** On `payout.returned`, settlement `observed` / `pending_finality` / `verified` becomes **`contradicted`** (red: the provider says the money came back, so the evidence of a completed payout no longer stands; scope is kept so the console can say what was contradicted). The recompute keeps it `contradicted` while the `returned_payout` exception is open and bank or chain evidence exists; once a person resolves the return it is `none` (N2 unchanged). `fundingProjection().rows[].supplierPaidBasis` (new exported helper `supplierPaidBasis(intent)` in funding.ts) is **always `none`** for a failed, cancelled, expired or returned payout, whatever the settlement field says. The sample's bank-verified `s5_funding` payout after a signed `payout.returned`: `execution: returned, settlement: contradicted`, basis `none`.
> - **N1 (re-review of dd52f88) — a debit matched AFTER a terminal status.** In `reconcileLine`'s outgoing bank-debit branch, a debit for a payout whose execution is already in `TERMINAL_FOR_SETTLEMENT_REPORT` is still **allocated** (the debit happened; reconciliation stays `exception`) but settlement is set to **`contradicted`** (scope `bank_statement`), never `verified`/`observed`. `returned` (the normal real-world order: statement after the webhook): no new exception; the debit's evidence is added to the open `returned_payout` exception. `failed`: `RC_DEBIT_FOR_FAILED_PAYOUT` as before. `cancelled` / `expired`: new exception code **`RC_DEBIT_FOR_TERMINAL_PAYOUT`** (`contradictory_evidence`, labelled). `onExecutionChanged` raises the same code for a debit matched before the payout became cancelled/expired, so every order ends in the same status and open exceptions. **`on_hold` (decision): not terminal** — the bank debit really evidences the payout leaving the account and the hold may still end in a payout, so a debit during a hold is allocated as usual (`verified`/`observed`, scope `bank_statement`), identical in either order; the hold itself is shown separately and is never released by evidence. After a person resolves the return, the recompute gives `none` (N2).
> - **C1 (final check) — held payout with a matched debit.** `supplierPaidBasis` is **`none`** while execution is `on_hold` (no new basis value, so console maps stay exhaustive); settlement may stay `verified` (the debit is real). `FundingProjectionRow.supplierPayout` gains **`onHold: boolean`** and **`hold?: { id, status }`** (the undecided partner hold) so the UI can show the hold beside settlement. `investigate().unknowns` adds **`UK_DEBITED_FUNDS_HELD_BY_PARTNER`** ("Money left the account (bank debit), but the partner holds the payout. The supplier has not been paid.") when a held payout has bank settlement `observed`/`verified`. After the reviewer's release the basis follows the evidence again.
> - **C2 (final check) — late debit after a resolved return.** If no `returned_payout` exception is open when a debit is matched to a returned payout, a `contradictory_evidence` / `RC_DEBIT_FOR_TERMINAL_PAYOUT` exception is opened (reopening the case), so there is always an open item with an owner. Resolving it lets the recompute return settlement to `none`.
> - **M3 — outstanding vs resolved differences.** `InvestigationView.amountDifferences` now holds **only outstanding** differences; new **`InvestigationView.resolvedAmountDifferences`** holds the history. Both are `InvestigationAmountDifference[]` = `AmountDifference & { outstanding: boolean }` (all existing `AmountDifference` fields kept). Rules: `RC_PARTIAL_AMOUNT` is outstanding while the payout's bank-statement allocations are below its amount and it is not failed/cancelled/expired/returned; `RC_UNDER_AMOUNT_REPORT` is outstanding while its exception is not resolved. `explanationCodes` includes only outstanding differences' codes. Line, exception and evidence-timeline `amountDifference` are unchanged (history).
> - **m1** The recompute counts a provider report as settlement evidence only if its line was recorded as agreeing with the payout (`isAgreeingProviderReport`: `RC_PROVIDER_REPORT_ONLY` and none of under-amount, terminal, hold, overpayment, currency, window, duplicate, ambiguity codes). A short report stays non-evidence after its exception is resolved.
> - **m2 (decision)** A provider settlement report on an **`on_hold`** payout is recorded (line + one evidence item) and flagged: new code **`RC_REPORT_ON_HELD_PAYOUT`** (group `contradiction`), category `contradictory_evidence`, outcome `contradictory_exception_raised`. Settlement is unchanged; a provider claim never moves a held payout (QA H3). If the reviewer then declines (→ `cancelled`), M1 also raises `RC_REPORT_ON_TERMINAL_PAYOUT`.
> - **m3** The same short provider report again (same reference, amount, currency and value date) while the first one's `RC_UNDER_AMOUNT_REPORT` exception is open is linked to that exception (history `recurred`, evidence added; line codes `RC_PROVIDER_REPORT_ONLY`, `RC_UNDER_AMOUNT_REPORT`, `RC_DUPLICATE_SUSPECTED`, no `amountDifference` on the repeat line). New `applyAction` outcome **`duplicate_report_linked`** (labelled). A different amount still opens its own exception.
> - **m4** `parseWorkspace` rejects an `amountDifference` whose `statementLineId`, `currency`, `source` or `reportedMinor` disagrees with its own statement line, or on an exception with the exception's `statementLineId` / linked line, and a `code` that does not fit the `source` (field path in `error.field`).
> - **Nits** One terminal list (`TERMINAL_FOR_SETTLEMENT_REPORT` in `state.ts`, re-exported from reconciliation.ts and the package; used by reconcileLine, onExecutionChanged, recomputeDimensions, investigate and the funding basis). F1 doc claim "reconciliation `exception`" now has a test. The console's `diffsOf` cast (`Investigation.tsx`) is console-owned: `amountDifferences` and `resolvedAmountDifferences` are always present, so it can read `view.amountDifferences` / `view.resolvedAmountDifferences` directly.
> - **m8** `openapi.yaml` now has schemas `AmountDifference`, `InvestigationAmountDifference`, `InvestigationView`, `FundingProjectionRow` (with `supplierPaidBasis`), `QuoteEligibilityCode` (with `RATE_UNAVAILABLE`), `ReconciliationCode`, and `/investigations` responses reference `InvestigationView`.
>
> **Review v2 triage:**
>
> | Item | Verdict | Test |
> |---|---|---|
> | M1 F1 order | **Fixed** (failed, returned, cancelled via engine in both orders; all four on stored data, derived) | `review-v2.test.ts` › "M1 …" (12 tests) |
> | M2 returned shown verified | **Fixed** (settlement `contradicted`; basis `none` on every terminal state) | `review-v2.test.ts` › "M2 …" (4 tests) |
> | N1 (re-review) debit after return shows verified | **Fixed** (returned, cancelled, expired → `contradicted`; failed unchanged; on_hold deliberately not terminal) | `review-v2.test.ts` › "N1 …" (7 tests) |
> | C1, C2 (final check) | **Fixed** | `review-v2.test.ts` › "C1: …" (2), "C2: …" |
> | M3 stale differences | **Fixed** in the engine (split + `outstanding`) | `review-v2.test.ts` › "M3 …" (3 tests) |
> | m1, m2, m3, m4 | **Fixed** | `review-v2.test.ts` › "m1 …" (2), "m2 …", "m3 …", "m4 …" |
> | m5 error boundary, m6 raw copy kept, m7 dry-run cost, nit `statusText` unused, nit `moved()` unknown key, nit `diffsOf` cast, nit `supplier_paid` label vs basis | **Console-owned** (`src/components/clearline/**`, `src/app/clearline/**`) | not changed here |
> | m8 OpenAPI schemas | **Fixed** | `docs/clearline/openapi.yaml` |
> | Nit terminal list duplicated; F1 "reconciliation exception" untested | **Fixed** | `review-v2.test.ts` › "nit: one terminal list …", "F1 doc claim …" |
>
> **CHANGE 5 (2026-11-13, branch release/clearline-v2-20261113 — human labels, F1/F2, deferred minors). STATUS: LANDED.** Tests: `tests/clearline/change5.test.ts` (44 tests) plus updated `tests/clearline/money-webhooks.test.ts`.
>
> **Human-readable labels (for the console). Import from `@/lib/clearline` (file `labels.ts`):**
> ```ts
> HUMAN_LABELS: {
>   execution: Record<ExecutionState, string>;            // provider_reported_completed → "Provider reports completed"
>   settlement: Record<SettlementEvidenceState, string>;  // observed → "Settlement observed (not verified)"
>   settlementScope: Record<SettlementScope, string>;     // provider_report → "Provider report only"
>   reconciliation: Record<ReconciliationState, string>;  // exception → "Needs review"
>   exceptionCategory: Record<ExceptionCategory, string>; exceptionBlocker: Record<ExceptionCategory, string>; // "Settlement evidence is still missing."
>   severity; exceptionStatus; caseStatus; holdStatus; holdDecision; advanceState; instructionStatus;
>   eventType: Record<NormalizedEventType, string>;       processingOutcome: Record<ProcessingOutcome, string>;
>   evidenceKind; statementSource; statementLineStatus; chainObservationStatus; providerErrorClass;
>   reconciliationCodeGroup: Record<ReconciliationCodeGroup, string>;
>   timelineKind: Record<EvidenceTimelineKind, string>;   actionOutcome: Record<string, string>; // applyAction outcome strings
>   errorCode: Record<EngineErrorCode, string>;           // maker_checker_violation → "The same person cannot prepare and approve."
>   apiErrorCode: { unauthenticated, unknown_endpoint, invalid_json, invalid_request };  // v1-only codes
>   resolutionCode: Record<string, string>;               // OPEN_EXCEPTIONS, EVIDENCE_REQUIRED, HOLD_UNDECIDED, …
>   eligibilityCode: Record<string, string>;              // quote eligibility codes incl. new RATE_UNAVAILABLE
> }
> CODE_LABELS: Readonly<Record<string, string>>  // every static code: RC_*, EV_*, CH_*, PV_*, FD_*, IE_*, UK_*, PR_*, OS_*, NA_*, WA_*, QT_*, MC_*, CT_*
> describeCode(code): string   // static codes + dynamic families PR_LAST_<EVENT>, PV_FAILED_<CLASS>, PV_RETURNED_<CLASS>, NA_<CATEGORY>,
>                              //   PE_<OUTCOME>, CH_<OBSERVATION_STATUS>, EV_<EVIDENCE_KIND>, HD_<DECISION>; unknown → "Unrecognised code (XYZ)"; never throws
> explainCode(code): string    // long RECONCILIATION_CODE_TEXT where one exists, else describeCode
> isKnownCode(code): boolean
> describeStatus(s: StatusDimensions): { execution; settlement; settlementScope; reconciliation; summary; executionFinal }
>   // summary keeps the dimensions apart: "Provider reports completed · Settlement verified (Bank statement) · Matched";
>   // returned + matched → reconciliation "Returned — net zero (supplier still unpaid)"; executionFinal from EXECUTION_TRANSITIONS.
> describeError(err: { code: string; message: string; field?; entityId? }, ws?: Workspace): HumanError
>   // HumanError = { code; reasonCode?; headline; detail; text }. reasonCode = the "CODE:" prefix of resolve refusals.
>   // Case close refused while a missing_statement exception is open (ws passed):
>   //   "Payment cannot be closed. Settlement evidence is still missing."   (without ws: "… Linked exceptions are still open.")
>   // invalid_field keeps the field: 'Some information is missing or not valid. Check "line.reference": …'
> ```
> Coverage test: every member of every union above (read from `types.ts`), every code string literal in `src/lib/clearline/*.ts`, every dynamic family over its source enum, every code the sample workspace produces, every `applyAction` outcome and every `deny(...)` resolution code has a non-fallback label.
>
> **Engine changes:**
> - **F1** A `provider_settlement_report` line on a payout whose execution is `failed`, `cancelled`, `expired` or `returned` (`TERMINAL_FOR_SETTLEMENT_REPORT`) is not recorded as ordinary evidence: it raises `contradictory_evidence` / **`RC_REPORT_ON_TERMINAL_PAYOUT`** (outcome `contradictory_exception_raised`, line status `exception`, reconciliation `exception`) and leaves settlement and scope unchanged. After a person resolves it, the recompute never counts a provider report as settlement on a failed/cancelled/expired payout. The engine itself never moves a submitted payout to `cancelled`/`expired` (M7), so those two cases are defence in depth for stored workspaces; tests set the state on stored data.
> - **F2** A provider report **below** the payout amount raises `unmatched_reconciliation` / **`RC_UNDER_AMOUNT_REPORT`** (outcome `exception_raised`); settlement is not upgraded. New type **`AmountDifference`** `{ code: "RC_UNDER_AMOUNT_REPORT" | "RC_PARTIAL_AMOUNT"; expectedMinor; reportedMinor; differenceMinor; currency; source; statementLineId; requiredNextAction }` on `StatementLine.amountDifference?`, `ReconciliationException.amountDifference?` (the exception's `requiredAction` is its `requiredNextAction`), `EvidenceTimelineEntry.amountDifference?`, and **`InvestigationView.amountDifferences: AmountDifference[]`** (new, always present). The under-amount report also appears in `investigate().contradictions`. A **bank** line below the remainder is still allocated as partial (`RC_PARTIAL_AMOUNT`, reconciliation `partially_matched`, settlement `observed`) and now carries the same object (`expectedMinor` = the unreconciled remainder before that line). `parseWorkspace` validates the object (`differenceMinor = expectedMinor − reportedMinor`).
> - `ReconciliationCode` gains `RC_UNDER_AMOUNT_REPORT` (group `partial`) and `RC_REPORT_ON_TERMINAL_PAYOUT` (group `contradiction`), so `RECONCILIATION_CODE_TEXT` / `RECONCILIATION_CODE_GROUP` have two more keys.
> - **m11** `convertMinor(amountMinor, from, to, rate)` now returns **`Result<number>`** (exported): a malformed, zero or missing rate is `invalid_field` with `field: "rate"`; a negative/non-integer amount is `invalid_amount`. `SandboxAdapter.quote` turns a failed conversion into an **ineligible** quote (`RATE_UNAVAILABLE`, `estimatedRecipientMinor: 0`), and a non-positive recipient amount into `AMOUNT_BELOW_FEES`; an eligible quote can no longer show 0. No new `EngineErrorCode` was added (the console's error catalogue is exhaustive).
> - **m5** `FundingProjectionRow.supplierPaidBasis: "none" | "provider_reported" | "verified_settlement"` (new, required on the output). The `supplier_paid` state name is **kept** (renaming would break the Funding Desk stage map and the console's exhaustive `AdvanceState` maps); its label is "Supplier paid (provider-reported)".
> - **R4 (QA)** The v1 route streams the body (`src/lib/clearline/bodylimit.ts`, internal) and stops reading at 512 KB, cancelling the stream; a chunked body without Content-Length is no longer buffered in full. Byte (not character) counting is unchanged.
>
> **Re-triage of every open/deferred review item (CODE_REVIEW.md, QA_SECURITY_REVIEW.md §7, RELEASE_MANIFEST limitations):**
>
> | Item | Verdict | Test / reason |
> |---|---|---|
> | F1 report on failed payout | **Fixed** (failed, cancelled, expired, returned), **report-after order only in CHANGE 5; both orders since CHANGE 6 (M1)** | `change5.test.ts` › "F1 failed/returned/cancelled/expired …", "F1: after a person resolves …", "F1: a provider report on a live completed payout …"; `review-v2.test.ts` › "M1 …" |
> | F2 under-amount report | **Fixed** (+ bank partial difference) | `change5.test.ts` › 5 "F2: …" tests |
> | m11 `convertMinor` 0 on bad rate | **Fixed** | `money-webhooks.test.ts` › "CHANGE 5 m11 …"; `change5.test.ts` › "m11: a route with a malformed rate …" |
> | QA R4 chunked bodies read before size check | **Fixed** | `change5.test.ts` › "R4: readBodyLimited …", "R4: the route refuses an endless chunked body …" (the old `req.text()` path exhausted the test worker's memory on the same input), "R4: a multi-byte body …" |
> | m5 `supplier_paid` naming | **Partly fixed** — evidence basis added, name kept; basis is `none` on terminal payouts since CHANGE 6 (M2) | `change5.test.ts` › "m5: every funding row states …". Rename deferred: the value is shared with `src/lib/mentor-demo` stage names and console maps outside this workstream. |
> | Nit: route size limit compared string length | Already fixed (CHANGE 3, bytes); still covered | `change5.test.ts` › "R4: a multi-byte body …" |
> | m1–m4, m6, m9, m10, m12, N1, N2, m-new-1…5, QA R1, R3 | Already resolved (code review final check, 5853620) | existing suites (re-run green) |
> | Nit: preview root `generateMetadata` default title "Not found — Clearline" | **Deferred — not engine-owned** | `src/app/layout.tsx` / `src/app/not-found.tsx` are outside `src/lib/clearline/**` and the console tree; harmless today (every allowed route sets its own title). Owner: integration lead. Fix in words: neutral default title in the layout, 404 title in `not-found.tsx`. |
> | QA R2 `script-src 'unsafe-inline'` | **Deferred — not engine-owned; not a blocker for fictional data** | `next.config.mjs`. Needed before any real-data or logged-in deployment (nonce CSP). |
> | QA L8 / m10 maker-checker not an auth boundary | **Accepted limitation (documented)** | Inherent to the stateless test API; documented in `openapi.yaml`. Needs server-side identity before real data. |
> | m7 reconciliation filter groups, m8 Overview "not allocated" count, Nit `aria-describedby`, Nit silent workspace reset, no `error.tsx` boundary | **Console-owned** | `src/components/clearline/**`, `src/app/clearline/**`. m7: the console now uses `RECONCILIATION_CODE_GROUP` (verified by reading `Reconciliation.tsx`). m8: **fixed by the console in c498da6** (Overview counts `partially_allocated`; Reconciliation links use `status=open`), confirmed by CODE_REVIEW_V2. Labels for all states are now available from `HUMAN_LABELS`. |
> | UI_REQUESTS R7 per-scenario reset | **Deferred** | Scenarios share sequential ids, routes and liquidity; a safe partial reset needs a scenario-scoped replay. Whole-workspace reset remains. Not needed for a fictional-data trial. |
> | B3 change size (> 300 lines) | **Process — unchanged** | Split before merging to `main` (approval-only). |
>
> **CHANGE 4 (2026-11-13, code re-review of cfadef9):**
> - **N1:** a `provider_settlement_report` line is handled as provider-reported evidence **before** the duplicate and remaining-amount checks, in either order relative to the bank line. Arriving after a bank match, it is recorded (`recorded_provider_report`; the line carries only `RC_PROVIDER_REPORT_ONLY`, plus `RC_LATE_STATEMENT` if late) and changes no status. It raises an exception only when it disagrees: a different currency (`RC_CURRENCY_MISMATCH`) or more than the payout (`RC_OVERPAYMENT`). Provider-report lines no longer carry `RC_EXACT_…`. Their status stays `unallocated`; `RECONCILIATION_CODE_GROUP.RC_PROVIDER_REPORT_ONLY` is `"informational"`.
> - **N2:** a returned payout is never shown as settled. After a person resolves an exception, the recompute gives a returned payout settlement `none` (scope `none`); the debit and return evidence stay on record and in `investigate`. Reconciliation is `matched` only when the bank debit and an equal statement-confirmed return are both allocated (net zero, `returnStatus: "confirmed_by_statement"`), and `exception` otherwise. Console label suggestion: "Returned — net zero" when `execution === "returned" && reconciliation === "matched"`.
> - **Provider events during a hold:** each is recorded with `detail.suppressedOnHold = 1` and `processingOutcome: "contradictory_exception_raised"`. `payout.returned` / `payout.failed` use code `EV_TERMINAL_EVENT_WHILE_ON_HOLD`, whose text tells a person what to do. The suppressed event is **not** applied automatically. Once the hold has ended through the reviewer, the provider's redelivery of the same event is processed on its transition alone; during the hold, a redelivery is a duplicate.
> - **`applyAction` (m-new-1):** validates the (cloned) workspace first, so damaged data is an `invalid_field` error with a field path. An unexpected internal error is rethrown when `VITEST=true` or `CLEARLINE_ENGINE_STRICT=1`; otherwise it is returned as `invalid_field` naming the error class and action. The v1 API still never answers 500.
> - **New exports:** `isIsoInstant`, `isIsoDate` (the v1 route uses the engine's check).
> - **Docs:** `docs/CONNECT_TEST_API.md` marks the legacy API retired (422 for invalid input, 410 otherwise).
>
> **CHANGE 3 (2026-11-13, code review docs/release/CODE_REVIEW.md + QA release findings):**
> - **Chain evidence (B1/B2):** `ingest_chain_observation` returns `precondition_failed` unless the payout uses the Base Sepolia stablecoin route, pays out USDC, and is `submitted`, `in_transit` or `provider_reported_completed`. A wrong wallet (`CH_WALLET_NOT_BENEFICIARY`), wrong amount (`CH_AMOUNT_DIFFERS_FROM_QUOTE`), a tx hash already linked to another payout (`CH_TX_ALREADY_LINKED`, both payouts as `candidates`) or a second tx for one payout (`CH_SECOND_TX_FOR_PAYOUT`) raises `contradictory_evidence` and changes no status. Finality sets **settlement** only. Reconciliation becomes `matched` only through an allocation (`evidenceKind: "chain_observation"`) when the provider reported the same tx hash (`tx_hash` in its `payout.completed` payload). New helpers: `ProviderAdapter.expectedWallet?(intent)` and the `beneficiary_wallet` intent metadata override.
> - **`ReconciliationAllocation.evidenceKind: "statement_line" | "chain_observation"`** (new, required). For a chain allocation, `statementLineId` holds the chain observation id.
> - **Provider settlement reports (M1):** never allocated and never set reconciliation `matched`. They set settlement `observed / provider_report` (if nothing better) and add `RC_PROVIDER_REPORT_ONLY` to the line, which stays `unallocated`. Outcome: `recorded_provider_report`. A later bank line allocates and verifies.
> - **Return lines (M2):** checked for currency, duplicates (`RC_DUPLICATE_SUSPECTED`) and over-amount (`RC_OVERPAYMENT`) before allocation.
> - **Contradictions (M3/m3):** a `contradicted` settlement is never overwritten by later evidence; the evidence is stored and noted on the open exception (outcome `recorded_no_state_change`). Resolving `contradictory_evidence`, `unmatched_reconciliation`, `missing_payment_reference`, `beneficiary_mismatch` or `missing_statement` needs user-attached evidence other than `kind: "note"`. After any exception is resolved, the payout's settlement and reconciliation are **recomputed from recorded evidence** (audit action `intent.dimensions_recomputed`).
> - **Time (M4/M5):** all stored instants are UTC `…Z`; comparisons and ordering use parsed instants. **Date-based rules use `Organization.timezone`** (Asia/Singapore in the sample): execution-date expiry, overdue advances, exception due dates, the reconciliation window and late-statement detection.
> - **Malformed input (M6):** a correctly signed but malformed provider payload is refused with `invalid_field` (nothing recorded); a badly signed one is still recorded as `rejected_signature`. `parseWebhook` validates every field type. Chain observations are fully type-checked. The engine returns `invalid_field` instead of throwing on a damaged workspace.
> - **Cancellation (M7):** `cancel_intent` is refused (`invalid_transition`) after submission, including `on_hold` and `awaiting_information`; a held payout ends through the reviewer.
> - **Holds (QA H3):** while a payout is `on_hold`, **no** signed provider event moves it. Any provider event other than `payout.hold_released` is recorded with outcome `contradictory_exception_raised` and opens `contradictory_evidence` / `EV_PROVIDER_EVENT_WHILE_ON_HOLD`. The hold ends only through the reviewer path (partner release report + reviewer `release`, or reviewer `reject`). `request_more` after a partner release keeps `partner_release_reported` (m12).
> - **Corrections (QA M1):** at most one active correction intent per returned/failed payout (`precondition_failed` for a second one).
> - **Cost bounds (QA M3/L4):** `computeLiquidity` is linear (Map lookups). The v1 API caps bodies at **512 KB** (bytes; checked from Content-Length first; 422 `invalid_json`), caps each workspace collection at 1,000 items (audit 10,000; HTTP 400), and rejects workspaces nested deeper than `MAX_WORKSPACE_DEPTH` (32) without recursion. New export: `parseWorkspaceValue(value)` validates an already-parsed object.
> - **Not an authentication boundary (QA L8):** in the stateless test API the caller supplies the workspace (including actors) and chooses the actor. Role and maker ≠ checker checks demonstrate the product rule; they are **not** access control. A real deployment needs server-side identity and stored workspaces.
> - **App-wide (QA L1/L2):** `next.config.mjs` sends a CSP (`frame-ancestors 'none'`, `object-src 'none'`; `script-src` keeps `'unsafe-inline'` for Next's inline bootstrap — a nonce-based CSP is a follow-up), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and no `X-Powered-By`. The middleware matcher anchors its exclusions, so `/favicon.icox` and `/_next/imagex` go through the middleware. The preview allow-list is unchanged, and every allowed preview request gets the console-layout header.
> - **Legacy API (M10/QA L7):** a request that is invalid under the old contract still gets 422; every other request gets 410 Gone pointing to v1.
> - **Liquidity (M8):** an invalid `at` makes every row stale (never fresh). The v1 API answers 400 for an invalid `at`.
> - **`parseWorkspace` (M9)** validates every element's structure and returns `invalid_field` with a field path (e.g. `intents[0].status.execution`). Stored workspaces without `evidenceKind`/`providerName` are migrated.
> - **Legacy retired (M10):** `src/lib/clearline/core.ts` is removed; `/api/clearline/test/[action]` returns 410 pointing to `/api/clearline/test/v1`.
> - **Minor:** idempotency keys such as `constructor`/`__proto__` work (own-property lookup, m1); `verifySandboxWebhook` rejects a non-finite clock (m2); an advance cannot fund a cancelled/expired/failed/returned payout and approval re-checks fresh liquidity (m4); one active intent per internal reference, corrections included (m6); text reports flatten line breaks in user text (QA).
>
> **CHANGE 2 (2026-11-13, console requests R1–R10 in UI_REQUESTS.md):**
> - **R1** Sample ids are sequential and deterministic: `s1_success → pi_00001`, `s2_returned → pi_00027`, `s3_hold → pi_00060`, `s4_chain → pi_00090`, `s5_funding → pi_00119` (advance `adv_00121`). Use `scenarioIntentId(ws, key)` (alias `intentForScenario`) rather than hard-coding them; the ids change if the sample script changes.
> - **R2** `evidenceTimelineFor(ws, intentId) → EvidenceTimelineEntry[]` gives one ordered timeline of intent, quotes, maker/checker, provider events (incl. rejected/duplicate/late/timer), statement lines, matching decisions, chain observations, attached evidence, hold decisions, exceptions and missing-evidence items. Each entry has `at, kind, title, source, provenance, independent, codes, refs`.
> - **R3** `InvestigationView.lastEventAt`, `lastEventType`, `lastIndependentVerificationAt` (+ alias `lastVerifiedAt`), all optional.
> - **R4** `canResolveCase(ws, caseId) → { allowed, code, reason }`. Codes: `NOT_FOUND`, `ALREADY_RESOLVED`, `OWNER_REQUIRED`, `OPEN_EXCEPTIONS`, `OPEN_INFO_REQUESTS`, `HOLD_UNDECIDED`, `RESOLVABLE`. The `resolve` action now uses it, and its error message starts with the code.
> - **R5** Every exception gets a `dueDate`: the explicit date (e.g. the obligation due date for `overdue_advance`), otherwise creation date + `EXCEPTION_DUE_DAYS[severity]` (critical 1, high 1, medium 3, low 5; an illustrative sandbox policy).
> - **R6** Separation of duties is checked **before** the role check: the maker of an instruction, the preparer of an advance, or the person who submitted hold documents now gets `maker_checker_violation`. Approvers may now also `choose_route` (prepare an instruction) and can never approve their own. Non-makers without the role still get `unauthorized_actor`.
> - **R8** `formatMinorPlain(minor, currency) → "12500.00"`. **R9** `RECONCILIATION_CODE_GROUP` (+ type `ReconciliationCodeGroup`: `exact | partial | unmatched | duplicate | ambiguous | currency_mismatch | contradiction | return | informational`).
> - **R10** `providerName` is now a required field on `ProviderEvent` and `LiquidityRow`.
> - **Returns:** new optional `PaymentIntent.returnStatus: "provider_reported" | "confirmed_by_statement"`. When the provider reports a return, `status.reconciliation` becomes `exception` (it used to stay `pending`). A return/reversal statement line with the trusted reference is allocated with `RC_RETURN_CONFIRMS_PROVIDER_RETURN` and sets `returnStatus = "confirmed_by_statement"`. Reconciliation stays `exception` until a person resolves the `returned_payout` exception, because the supplier is still unpaid. No new `ReconciliationState` value was added, so existing label maps keep compiling.
> - **Not done:** R7 `resetScenario` (use whole-workspace reset).
>
> **CHANGE 1 (2026-11-13, after first draft):**
> 1. Sample intent ids are sequential (`pi_00001`, …), not `pi_s1_success`. Find a scenario by `intent.scenario` (`"s1_success" … "s5_funding"`); `SAMPLE_SCENARIOS` (exported) describes each. Ids are deterministic but may shift if the sample changes — do not hard-code them.
> 2. `ProviderRoute.providerFeeMinor: number` became `providerFees: Partial<Record<CurrencyCode, number>>` (per source currency, minor units).
> 3. `ProviderEvent.rawBody?: string` added (sandbox payload, for duplicate replay).
> 4. `SampleScenario` type and `SAMPLE_SCENARIOS` exported. `SAMPLE_ACTORS` is `Actor[]`.

**Status:** sandbox / test mode only. Fictional organisations, providers and amounts. No money movement, custody, keys, lending or compliance decisions.
**Import:** `import { … } from "@/lib/clearline"` (file `src/lib/clearline/index.ts`). Do not import internal modules directly. The legacy prototype `core.ts` has been **removed** (CHANGE 3).
**Stability:** names and signatures below are stable. Any change is announced in a `CHANGE` note at the top of this file.

## Workspace model

The whole sandbox state is one serialisable object, `Workspace` (see `types.ts`). The UI keeps it in browser storage.

| Function | Signature | Notes |
|---|---|---|
| `sampleWorkspace` | `() => Workspace` | Deterministic sample with the five seeded scenarios. Use for "Reset to sample". |
| `resetScenario` | `(ws, scenario, ctx) => Result<ResetScenarioOutput>` | rc3: restore ONE guided case to the sample; other cases and person-created records unchanged. Refuses with `precondition_failed` when a person's record links the case. See CHANGE 7. |
| `canResetScenario` | `(ws, scenario) => ResetCheck` | rc3: same decision with `code`, `reason`, `blockers`, without changing anything. |
| `emptyWorkspace` | `() => Workspace` | Same organisation, actors, routes, policy; no payments. |
| `serializeWorkspace` | `(ws) => string` | JSON string. |
| `parseWorkspace` | `(text) => Result<Workspace>` | Validates `schemaVersion`/`mode`; on error the UI should reset to sample. |
| `SAMPLE_AS_OF` | `string` | ISO instant of the sample clock. |
| `SAMPLE_ACTORS` | `Actor[]` | Fictional users: `usr_maya` (operator), `usr_daniel` (approver), `usr_priya` (compliance), `usr_alex` (viewer), `usr_sam` (second operator). |

## Actions — the only way to change a workspace

```ts
applyAction(ws: Workspace, action: WorkspaceAction, ctx: { actorId: string; at: string }): ActionResult
// ActionResult = { ok: true; value: { workspace, audit, outcome, createdIds } } | { ok: false; error: { code, message, field?, entityId? } }
```

Pure: never mutates `ws`, never reads the wall clock, and **never throws** — business errors and malformed or damaged input both come back as typed errors (CHANGE 3). `ctx.at` is the simulated instant: any ISO-8601 offset is accepted and **stored as a UTC `…Z` instant**; it must not be earlier than `ws.asOf`. Every successful action appends `AuditEvent`s.

| `action.type` | Payload | Who |
|---|---|---|
| `create_intent` | `input: CreateIntentInput` (amountMinor integer, idempotencyKey required) | operator |
| `request_quotes` | `intentId` | operator |
| `choose_route` | `intentId, quoteId` → creates a `PaymentInstruction` (maker = actor) | operator or approver |
| `approve_instruction` / `reject_instruction` | `instructionId` (+`reason`) — checker must differ from maker | approver |
| `submit_instruction` | `instructionId` | operator |
| `cancel_intent` | `intentId, reason` — only while `created`, `quoted` or `approved`; never after submission (incl. `on_hold`) | operator or approver |
| `simulate_provider_event` | `intentId, injection?: "none"\|"timeout"\|"duplicate"\|"out_of_order"\|"contradictory"\|"bad_signature"` | operator |
| `ingest_webhook` | `delivery: { providerId, rawBody, signatureHeader }` | operator |
| `ingest_statement_line` | `line: StatementLineInput` — a `provider_settlement_report` line is recorded as provider-reported evidence only (never allocated or `matched`) | operator |
| `ingest_chain_observation` | `observation: ChainObservationInput` — only for a submitted USDC payout on the Base Sepolia route, to the beneficiary's registered wallet, for the quoted amount (6 decimals) | operator |
| `advance_clock` | `to` (ISO) — runs timeouts, overdue, quote expiry | any non-viewer |
| `assign_owner` / `add_note` / `attach_evidence` / `resolve` / `reopen` | `target: {kind:"case"\|"exception", id}` | non-viewer |
| `request_info` | `caseId, from, request` | non-viewer |
| `submit_hold_documents` | `holdId, documents` (names only) | operator |
| `assign_hold_reviewer` | `holdId, reviewerId` | compliance/approver |
| `record_hold_decision` | `holdId, decision: release\|reject\|request_more, reason` | assigned compliance reviewer |
| `create_advance` | `input: CreateAdvanceInput` | operator |
| `decide_advance` | `advanceId, outcome, reason` — checker ≠ maker | approver |

`outcome` strings include `applied`, `idempotent_replay`, `rejected_signature`, `duplicate_ignored`, `stored_late_no_regression`, `contradictory_exception_raised`, `timeout_exception_raised`, `no_event_pending`, `allocated`, `exception_raised`.

Error codes (`EngineErrorCode`): `invalid_amount, invalid_currency, currency_mismatch, invalid_field, not_found, idempotency_conflict, invalid_transition, unauthorized_actor, maker_checker_violation, quote_expired, quote_ineligible, precondition_failed, resolution_not_permitted, duplicate_statement_line, webhook_signature_invalid, unsupported_token_or_network, hold_requires_human_decision`.

## Status dimensions (render separately — never a single badge)

`intent.status = { execution, settlement, settlementScope, reconciliation }`

- execution: `created → quoted → approved → submitted → in_transit → provider_reported_completed`, plus `awaiting_information, on_hold, failed, returned, cancelled, expired`.
- settlement: `none | observed | pending_finality | verified | contradicted`; `settlementScope` says what was evidenced (`provider_report | bank_statement | onchain_transfer`). An on-chain transfer never proves a bank credit.
- reconciliation: `not_started | pending | matched | partially_matched | exception`.

## Read models

| Function | Signature |
|---|---|
| `evidenceTimelineFor` | `(ws, intentId) => EvidenceTimelineEntry[]` — unified ordered evidence timeline (R2) |
| `canResolveCase` | `(ws, caseId) => { allowed, code, reason }` — rc3: also `EVIDENCE_OUTSTANDING` (sent, non-terminal payout not verified + matched) and `OUTSTANDING_REMAINS` (linked advance still owed) |
| `scenarioIntentId` / `intentForScenario` | `(ws, scenario) => string \| undefined` |
| `investigate` | `(ws, intentId) => Result<InvestigationView>` — requested / provider / provider-reported / independent evidence / unknowns / contradictions / outstanding / who acts / next actions, each with explanation codes |
| `exportCaseReport` | `(ws, caseId) => Result<CaseReport>` → `{ json, text }` |
| `buildCaseReport` | `(ws, paymentIdOrCaseId \| {paymentId} \| {caseId}) => Result<SyntheticCaseReport>` — rc3: deterministic structured report, FICTIONAL / sandbox, three truths, timeline with sources, findings, amounts as exact decimal strings |
| `caseReportToJson` / `caseReportToCsv` | `(report) => string` — rc3: deterministic JSON (sorted keys) / RFC 4180 CSV (CRLF, formula-safe) |
| `timelineFor` | `(ws, intentId) => ProviderEvent[]` (sorted by received time; includes rejected/duplicate/late entries with their `processingOutcome`) |
| `listExceptions` | `(ws, filter?: { status?, category?, intentId? }) => ReconciliationException[]` |
| `getIntent` | `(ws, id) => PaymentIntent \| undefined` |
| `computeLiquidity` | `(ws, at?) => LiquidityView` — usable = eligible − restricted − safeguarded − committed − buffer; stale rows flagged and excluded from `currentUsableByCurrency` |
| `fundingProjection` | `(ws, at?) => FundingProjection` — payment ↔ advance ↔ approval ↔ obligation ↔ allocations ↔ outstanding (a projection, not a shared ledger) |
| `obligationOutstanding` | `(ws, obligationId) => Money` |
| `canResolveException` | `(ws, exceptionId) => { allowed: boolean; code: string; reason: string }` — use to enable/disable a Resolve button |

## Helpers and constants

`formatMoney({amountMinor, currency})`, `formatMinor(minor, currency)`, `parseAmount("50000.00","SGD") → Result<number>`, `currencyDecimals`, `CURRENCIES`, `QUOTE_LABEL`, `CHAIN_LABEL`, `FUNDING_PROJECTION_LABEL`, `ENGINE_DISCLAIMER`, `RECONCILIATION_CODE_TEXT`, `EXCEPTION_REQUIRED_ACTION`, `BASE_SEPOLIA_CHAIN_ID` (84532), `ALLOWLISTED_TOKENS`, `FINALITY_THRESHOLD`, `EXECUTION_TRANSITIONS`, `canTransitionExecution`, `SANDBOX_PROVIDERS`, `sandboxRoutes()`, `getAdapter(providerId)`, `signSandboxWebhook`, `verifySandboxWebhook`, `sandboxWebhookSecret`.

## Seeded sample scenarios

| Scenario | `intent.scenario` | What to show |
|---|---|---|
| 1 Successful payment | `s1_success` (`pi_00001`) | provider-reported completed; bank statement line matched separately |
| 2 Returned payout | `s2_returned` (`pi_00027`) | rc3: bank debit `SIMBANK-0002` matched → provider `payout.returned` (beneficiary rejected) → return credit `SIMBANK-0006` for the same USD 12,784.90. Status `returned / contradicted (bank_statement) / exception`; `returnPosition` `RT_NET_ZERO` (net movement zero) with `beneficiaryPaid: false`; open `returned_payout` exception owned by `usr_maya`; correction workflow |
| 3 Compliance hold | `s3_hold` (`pi_00060`) | partner document request; reviewer; never auto-released |
| 4 Base Sepolia delay | `s4_chain` (`pi_00090`) | observed → pending finality → verified (advance with `simulate_provider_event`) |
| 5 Funding exposure | `s5_funding` (`pi_00119`, advance `adv_00121`) | SGD 50,000.00 advance, SGD 30,000.00 repaid by reference, SGD 20,000.00 outstanding; unreferenced SGD 20,000.00 receipt stays an exception |

## Test-mode HTTP API

`/api/clearline/test/v1/*` exposes the same engine statelessly (send the `workspace` you hold, or omit it to use the sample). See `docs/clearline/openapi.yaml`. The unversioned legacy endpoints `/api/clearline/test/{intents,quotes,transitions,webhooks,payments,health}` now return **410 Gone** with `error.replacement: "/api/clearline/test/v1"`.
