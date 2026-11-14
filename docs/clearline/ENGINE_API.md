# Clearline sandbox engine — public API (for the console UI)

> **CHANGE 14 (2026-11-14, console final check). STATUS: LANDED.** **The case report no longer says "Resolved" for an acceptance that still awaits a second approval.**
> - **Status.** `SyntheticCaseReport.exceptions[].status` is now the new type `ReportExceptionStatus`. It is the exception's own status, except that a resolved exception whose accepted over-amount still awaits a second, different person's approval is reported as **`accepted_awaiting_second_approval`**, labelled **"Accepted — awaiting second approval"**. The label comes from `HUMAN_LABELS.reportExceptionStatus`, and each row carries it as `statusLabel`. `engineStatus` keeps the exception's own `ExceptionStatus`. The case itself stays blocked (`SECOND_APPROVAL_REQUIRED`), as before.
> - **Acceptance.** When the resolution accepted a bank debit, `acceptance` reports `acceptedBy`, `acceptedAt`, `statementLineId`, `difference`, `lateValueDate?`, `secondApproval` (`not_required` | `pending` | `approved`), `approvedBy?`, `approvedAt?` and a plain `text`. Once approved, the status is `resolved` ("Resolved") and the text names both people: "Accepted by usr_maya (the 500.00 SGD over-amount); approved by usr_sam."
> - **CSV.** The `exception` row's label now ends with `statusLabel` (before: the raw status). A new `exception_acceptance` row follows it, with code `ACCEPTED_AWAITING_SECOND_APPROVAL`, `ACCEPTANCE_APPROVED` or `ACCEPTANCE_NOT_REQUIRED`, the accepted difference, the text, and refs `<exception id> <line id> <accepter> [<approver>]`.
> - **Tests.** Tests in `rc3-case-report.test.ts` cover JSON and CSV for pending, approved, within 1%, after a reopen, and a crafted non-resolved exception. All 11 mutants of the change are killed. `HUMAN_LABELS.reportExceptionStatus` is covered by the label-completeness test.

> **CHANGE 13 (2026-11-14, independent QA/security pass on rc3, L1 and L2). STATUS: LANDED.** The console loads workspaces that visitors craft or paste, so neither a stored status nor a stored decision is trusted.
>
> **L1: a stored status never exceeds its evidence.**
> - New `evidenceCeiling(ws, intent)` (derive.ts, exported) gives the most the recorded evidence can support: verified needs a counted final transfer or bank allocations covering the amount; matched needs a final transfer allocated to the payout, bank allocations covering the amount, or a statement-confirmed return. It is an upper bound of rc3's own derive. `evidencedVerifiedAndMatched(ws, intent)` is true only when the stored status says verified / matched AND the ceiling supports both.
> - **Migration rule E** (`status_exceeds_evidence` / `status_capped`): on every load, a settlement or reconciliation above the ceiling is capped to `recomputeDimensions`' result (never upgraded), audited (`workspace.migrated`) and reported. No exception is raised, as the evidence itself is unchanged. A terminal payout stored as verified is still refused by the integrity check.
> - **`canResolveCase`** uses `evidencedVerifiedAndMatched`, so even a workspace object that was never loaded cannot close a case on its stored status. The `EVIDENCE_OUTSTANDING` reason then adds "the recorded evidence does not support that stored status". *Qualified (fifth check, R5-m1):* this covers a forged STATUS. Forged evidence RECORDS (statement lines, allocations, chain observations) are not re-derived from scratch: they are checked only against the integrity check's shape rules. Since R5-m1 those rules include that a payment allocation from a statement line has a shape every engine version produces: a `bank_statement` debit of kind `payment`, or a return confirmation (`RC_RETURN_CONFIRMS_PROVIDER_RETURN`) from a return or reversal line. In both cases the line is in the payout's source currency and carries its provider payment id as a reference token. So a provider report or a referenceless credit allocated to a payout is refused, but a well-formed forged bank debit with the right reference is still accepted, because it cannot be told apart from a real one without server-side state. All 640 v2 / efabe6a workspaces from the reviewer's random walks (2,036 payment allocations) still load.
> - Rule E is a no-op on rc3 workspaces: the CHANGE 12 property test (60 seeds × 90 steps, migrated v2 starting points) passes unchanged.
>
> **L2: every recorded decision names an existing actor with the role its action requires** (`serialize.ts:crossCheck`, refused as `invalid_field`). The roles are the same in every engine version, v2 included, so no stored workspace from any version breaks this; it is refused, not migrated (all v2 fixtures still load).
>
> | Record | Must be |
> |---|---|
> | `instructions[].makerId` | an existing operator or approver (`choose_route`) |
> | `instructions[].checkerId` | an existing approver, not the maker |
> | `fundingDecisions[].makerId` / `.checkerId` | an existing operator / an existing approver, different people |
> | `holds[].reviewerId` | an existing compliance reviewer |
> | `holds[].decisions[]` | `release`, `reject` or `request_more` with `reviewerId` an existing compliance reviewer |
> | `exceptions[].resolution.actorId` (with `acceptedDifference`) and `secondApproval.approvedBy` | existing staff (operator, approver, compliance), different people |
>
> **Fifth check (R5-m2):** `rc3-qa-status-actors.test.ts` also pins the ceiling on a chain allocation whose observation is not final (not matched) and on a return allocation without statement confirmation (not matched). Both mutants that survived the fifth check are now killed, as are the 6 R5-m1 mutants.
>
> **Tests:** QA's `tests/qa-release-rc3/engine-rc3.test.ts` is copied in unchanged; its DEFECT L1 and L2 pass. `tests/clearline/rc3-qa-status-actors.test.ts` pins the details. Each check was mutated in place (11 mutants), and each mutant fails at least one test.
>
> **Known limit (QA Informational):** a forged second approval naming a real, different staff member cannot be told apart from a real one without server-side state. The sandbox's client-held workspace is trusted for who did what, within these role rules.

> **CHANGE 12 (2026-11-14, fourth check R4-m1 on 668e4ca, APPROVE). STATUS: LANDED. Tests and docs only; no engine or API change.**
>
> **R4-m1: the property test (`tests/clearline/rc3-migration-property.test.ts`) now uses the independent reviewer's extended generator** (adopted with attribution in the file header). It runs 60 seeded random sequences of 90 steps (about 25 s). Starting points: the sample, live USDC / SGD payouts, and, every third seed, a migrated workspace saved by the v2 engine (v2_sample, v2_t1, v2_va, v2_gaps, v2_vb). In addition to the CHANGE 11 actions, it issues the payment lifecycle (`create_intent` → `request_quotes` → `choose_route` → `approve_instruction` / `reject_instruction` → `submit_instruction`), `resolve` with and without `acceptDifference` / `acceptLateDate`, `approve_acceptance` (by a different person, and a refused self-approval), `assign_hold_reviewer`, advance repayment by reference, and per-case resets, also at a later clock.
> - A coverage check asserts that the random walk itself (not only the scripted tests) applied each of these successfully: `submit_instruction`, `approve_instruction`, `choose_route`, `request_quotes`, `approve_acceptance`, `assign_hold_reviewer`, `reopen`, `cancel_intent`, `decide_advance`, `request_info`, `resolve` with `acceptDifference`, and `resolve` with `acceptLateDate`.
> - A scripted test runs the full lifecycle (create → quote → route → approve → submit → provider events) from the sample and from a migrated v2 workspace, checking the no-op property after each step.
> - **Scope of the claim:** after every successful action in these sequences, the workspace loads with migrations `[]` and byte-identical JSON. This is strong evidence, not a proof for every possible action sequence.

> **CHANGE 11 (2026-11-14, third re-review of 3e66fa7, BLOCK). STATUS: LANDED.**
>
> **R3-B1: `reopen` reverses what the exception's resolution did.** Before: the workspace no longer loaded after a reopen.
> - An accepted difference and any second approval are withdrawn. They are kept in the exception's history (`acceptance_withdrawn`) and audited (`exception.acceptance_withdrawn`). The payout's case is blocked again until a staff person accepts again (above 1%: a second person approves again).
> - A hash-conflict supersede is withdrawn (`supersede_withdrawn`, audited `chain.supersede_withdrawn`). The rejected observation blocks the hash again, and the payout is recomputed: settlement `contradicted` while the conflict is reopened. Resolving it again supersedes again.
> - Proven by explicit accept → reopen → reload and supersede → reopen → reload tests, and by the property test. Its generator now also issues `reopen` (exceptions and cases), `cancel_intent`, `create_advance` / `decide_advance`, `add_note`, `request_info`, case evidence and new payments. Its scripted families reopen after an acceptance, after a supersede and after a case closes, and a coverage check asserts those states are reached. **After every successful action in those sequences the workspace loads with migrations `[]` and byte-identical JSON.** *Narrowed (CHANGE 12):* this is a property of the tested sequences, not a proof for every possible sequence; CHANGE 12 lists what they cover.
> - With `actions.ts` reverted, 7 tests fail.
>
> **R3-m1: one test per surviving mutant, 7 of 7 killed:**
> - rule A raises its exception;
> - rule B honours a supersede that freed the hash for another payout;
> - rule D leaves a bank-backed match alone;
> - a short (late) debit can never be accepted;
> - late plus over-amount needs `acceptDifference` too;
> - the close-time late-date re-check;
> - `approve_acceptance` re-checks the line.
>
> **Console API:** unchanged. Reopen needs no new parameter: it now withdraws the acceptance or supersede itself, and the case shows `EVIDENCE_OUTSTANDING` again until someone accepts afresh. After reopening an approved >1% acceptance, accepting again shows `SECOND_APPROVAL_REQUIRED` again.

> **CHANGE 10 (2026-11-14, second re-review of 7e521f5, CHANGES REQUESTED). STATUS: LANDED.** Each fix has a test that fails without it (file reverted or line mutated in place). *Correction (CHANGE 11):* the third re-review then found 7 mutants that still survived — rule A's exception, rule B's supersede link, rule D's bank-match guard, the close-time late-date re-check, the short-debit refusal, `approve_acceptance`'s line re-check, and `resolve` requiring `acceptDifference`. Tests for all 7 were added in CHANGE 11.
>
> **R2-M1: the load-time migration re-validates stored evidence against rc3's rules** (new `migrate.ts`, run by every parse/load/action). It corrects only states no rc3 action sequence can reach, never upgrades evidence, raises the exception rc3 raises (with an owner), audits and reports each change, and is idempotent. A property test over 16 seeded random rc3 action sequences and 5 scripted families shows it is a no-op on rc3 workspaces (migrations `[]`, byte-identical). *Correction (CHANGE 11):* that test did not issue `reopen` and other actions, and the claim that every rc3 workspace loads was false. A reopen after an accepted difference or a supersede left a workspace that could not load (R3-B1). This is fixed in CHANGE 11, and the property now covers those actions.
>
> | Rule | Stored state (earlier engine) | Becomes | `WorkspaceMigration.kind` / `outcome` |
> |---|---|---|---|
> | A | A counted chain observation not on the allowlist (v2 C-1 revival) | `rejected_unsupported`; `CH_UNSUPPORTED_TOKEN_OR_NETWORK` ensured; settlement recomputed (never up) | `chain_observation_not_allowlisted` / `observation_not_counted` |
> | B | A counted observation whose hash was recorded earlier as rejected or with another identity (v2 M-3) | `CH_TX_HASH_CONFLICT` / `CH_TX_HASH_ON_OTHER_CHAIN` raised; settlement contradicted | `chain_hash_conflict` / `contradiction_raised` |
> | C | A failed, cancelled, expired or returned payout with bank or chain evidence still `observed`, `pending_finality` or `verified` (v2 T-1 incl. before finality, T-2, pre-CHANGE 6 returned) | the rc3 terminal rule (see CHANGE 8 M-1 row) | `terminal_payout_verified` or `terminal_payout_evidence` / `contradiction_raised`, `contradicted_open`, `resolved_by_person` |
> | D | Reconciliation `matched` on a chain allocation whose observation is no longer final (v2 C-3 reorg) | reconciliation `exception` | `reorg_reconciliation` / `reconciliation_reopened` |
> | E (CHANGE 13) | Settlement or reconciliation above what the recorded evidence supports (a crafted workspace) | capped to rc3's derive, never up | `status_exceeds_evidence` / `status_capped` |
>
> `WorkspaceMigration` gains `observationId?`. **Not detectable:** a v2 C-2 block change that v2 applied silently (the earlier block number is not kept).
>
> **R2-M2: legitimate success cases can close** (`exceptions.ts` `acceptableDifference` / `acceptedBankLine`; constants `ACCEPTED_OVERAGE_BPS` = 100, `MAX_APPROVED_OVERAGE_BPS` = 5 000, `MAX_LATE_ACCEPTANCE_DAYS` = 60). It applies to a bank-statement **debit** of kind payment that carries the payout's provider payment id, in the payout's source currency, with exception `RC_OVERPAYMENT` or `RC_OUTSIDE_TIME_WINDOW`:
>
> | Case | Action | Who | Case closes when |
> |---|---|---|---|
> | (a) exact amount, value date after the window (≤ 60 days after submission) | `resolve { acceptLateDate: true }` | one staff person | at once |
> | (b) over-amount ≤ 1% | `resolve { acceptDifference: true }` (+ `acceptLateDate` if late) | one staff person | at once |
> | (c) over-amount > 1% and ≤ 50% | `resolve { acceptDifference: true }` (+ `acceptLateDate` if late), then **`approve_acceptance { exceptionId, note }`** | a second, **different** staff person approves | after the approval; until then `canResolveCase` → **`SECOND_APPROVAL_REQUIRED`** ("needs a second person's approval") |
> | (d) currency mismatch | never acceptable | — | never on that line; `EVIDENCE_OUTSTANDING` says the sandbox has no FX evidence, that an FX confirmation with the rate and both amounts (or the line in the payout's currency) is needed |
>
> - **Errors:** a line outside the policy, or a flag that does not match the facts → `precondition_failed` `"DIFFERENCE_NOT_ACCEPTABLE: <reason>"`; `approve_acceptance` by the acceptor → `maker_checker_violation`; by a viewer → `unauthorized_actor`; when nothing is pending or it is already approved → `invalid_transition`.
> - **Stored record:** `resolution.acceptedDifference = { statementLineId, differenceMinor (≥ 0), currency, lateValueDate?, secondApproval?: { required: true, approvedBy?, approvedAt?, note? } }`.
> - **Re-checked** at close (line rules, recorded values, approval present, approver a staff member other than the acceptor) and at load (the difference equals line − payout, `lateValueDate` equals the line's date, approver ≠ acceptor).
> - **Close reason:** it names what was accepted and by whom, e.g. "usr_maya accepted the SGD 15.00 over-amount, and usr_sam approved the acceptance" or "accepted the late value date (2026-11-30); amount and currency match the payment exactly".
> - **Labels:** `SECOND_APPROVAL_REQUIRED`; `DIFFERENCE_NOT_ACCEPTABLE` reworded.
>
> **Minors:** the `EVIDENCE_OUTSTANDING` text describes the explicit acceptance rule (R2-m1). `HUMAN_LABELS.supplierPaidBasis.provider_reported` = "Provider reports the supplier paid (not verified)" (R2-m4). Tests kill the bank-statement-only, close re-check, parse forgery and migration other-open mutants (R2-m2). R2-m3 (the person who ingested the line may accept a ≤1% fee): kept as one person by product decision (b).
>
> **Console wiring:** `resolve` gains `acceptLateDate?: boolean` alongside `acceptDifference?: boolean`. New action `{ type: "approve_acceptance", exceptionId, note }`. Show `canResolveCase(...).reason` for `SECOND_APPROVAL_REQUIRED`. `loadWorkspace(...).migrations[].text` covers all four rule kinds. The v1 HTTP route passes neither flag nor the new action (not engine-owned).

> **CHANGE 9 (2026-11-14, re-review of 725c3a1 — `docs/release/CODE_REVIEW_RC3_ENGINE.md` "Re-review", BLOCK). STATUS: LANDED.** Each fix has a test that fails without it (file reverted or line mutated in place).
>
> | Id | Change | Test |
> |---|---|---|
> | **R-B1** | `resetScenario` raises `seq` to at least the highest restored id. Before: on a v2-saved workspace (seq 164) a reset of s2 restored ids up to 180 and later actions regenerated `stl_00177` / `evd_00179`; the workspace then no longer loaded. | `rc3-reset-fixtures.test.ts` (the reviewer's repro; every case on every fixture followed by more work and a reload; the console's own call path) |
> | **R-M1** | Migration: `none` only when the rc3 rule's own exception for this evidence was resolved (see the corrected CHANGE 8 M-1 row). Before: any resolved contradiction counted, so `v2_va.json` migrated to `failed / none` while rc3 gives `contradicted` with `CH_TRANSFER_FOR_TERMINAL_PAYOUT` open. | `rc3-migration.test.ts` › "re-review R-M1 …" |
> | **R-M2** | Accepting a disagreeing bank debit (`acceptableDifference` / `acceptedBankLine`, exceptions.ts). **All** must hold: the exception is `RC_OVERPAYMENT`; the line is a bank-statement **debit** of kind payment carrying the payout's provider payment id; in the payout's source currency; value date inside the matching window (`inMatchingWindow`, tx.ts); it exceeds the payout by more than 0 and at most **`ACCEPTED_OVERAGE_BPS` = 100 (1%)** of the payout (BigInt); the person resolves with **`acceptDifference: true`** (new optional field on the `resolve` action; refused with `precondition_failed` `"DIFFERENCE_NOT_ACCEPTABLE: <reason>"` when the line does not qualify; recorded as `resolution.acceptedDifference { statementLineId, differenceMinor, currency }`, validated on parse); the resolver is a staff actor (never `system`). The case check re-validates the line as it stands. Before: USD 0.01, SGD 9,999,999.00 or a 2025 line closed the case after any resolution. | `rc3-close-contradictions.test.ts` › "re-review R-M2 …" |
> | **R-m1** | New public **`loadWorkspace(text)`** / **`loadWorkspaceValue(value)`** → `Result<WorkspaceLoad>` = `{ workspace, migrations: WorkspaceMigration[] }`. `WorkspaceMigration` = `{ kind: "terminal_payout_verified", intentId, internalReference, from: StatusDimensions, to: StatusDimensions, outcome: "contradiction_raised" \| "contradicted_open" \| "resolved_by_person", exceptionId?, exceptionCode?, ownerId?, caseId?, auditId, text }`; `text` is a sentence for the person ("Payment INV-… (pi_…) was saved by an earlier version as failed with settlement verified. It now shows settlement contradicted, with a new exception exc_… (CH_TRANSFER_FOR_TERMINAL_PAYOUT) for usr_maya to review."). `migrations` is empty for an rc3 workspace. `parseWorkspace` / `parseWorkspaceValue` are unchanged. `applyAction` includes the migration audit events in `ActionResult.audit`. | `rc3-migration.test.ts` › "re-review R-m1 …" |
> | Console | `HUMAN_LABELS.supplierPaidBasis` (none / provider_reported / verified_settlement). Evidence sources carry "(fictional)" once (`evidenceSourceLabel`): "Bank statement BANK-SGD-OPS (fictional)", not "… (fictional) (fictional)". Only the 6 s1/s5 bank-line evidence sources change in the sample. | `rc3-data-exposure.test.ts`, `rc3-sample-stability.test.ts` |
>
> **Console wiring:** `workspace.tsx` loads with `parseWorkspace`; switch to `loadWorkspace` to show `migrations[].text` ("Your saved workspace was updated: …"). To accept a fee on a bank debit, dispatch `{ type: "resolve", target: { kind: "exception", id }, note, acceptDifference: true }` and show `describeError` for `DIFFERENCE_NOT_ACCEPTABLE`. The v1 HTTP API does not pass `acceptDifference` (its route is not engine-owned).

> **CHANGE 8 (2026-11-14, code review of efabe6a — `docs/release/CODE_REVIEW_RC3_ENGINE.md`, BLOCK). STATUS: LANDED.** Each fix has a test that fails without it (shown by reverting the file or mutating the line). No existing assertion was weakened; one I-1 test was repointed (below).
>
> | Id | Change | Test |
> |---|---|---|
> | **B-1** | `buildCaseReport`: `threeTruths.reconciliation.matched` / `amounts.matched` / CSV `amount,MATCHED` come from the allocations (internal helper `matchedMinorFor(ws, intent)` in investigation.ts, also used by `investigate`; not in the public index): the full amount while a chain allocation's observation is final, else outgoing bank allocations in the source currency excluding return credits. A created, failed-without-evidence or cancelled payout reports **0.00** (before: the full requested amount). `unreconciled` is what a sent, live payout still lacks. CSV label MATCHED: "Amount matched to statement debits or a final chain transfer". | `rc3-case-report.test.ts` › "review B-1 …" (JSON + CSV) |
> | **M-1** | **Migration on load** (corrected by CHANGE 9 R-M1 / R-m1). `parseWorkspace` / `parseWorkspaceValue` / `loadWorkspace` (and so every `applyAction`) repair a failed/cancelled/expired/returned payout stored as `verified` **with evidence** — states earlier engine versions wrote (v2 T-1/T-2; returned before CHANGE 6) — to what rc3 gives for the same facts — for the terminal-payout rule; CHANGE 10 (R2-M1) adds the chain-identity, hash-conflict and reorg rules and widens this one to observed / pending evidence. rc3's terminal rule raises ONE exception for that evidence (`CH_TRANSFER_FOR_TERMINAL_PAYOUT` about those observations; `RC_DEBIT_FOR_FAILED_PAYOUT` / `RC_DEBIT_FOR_TERMINAL_PAYOUT` about that debit line; the `returned_payout` exception for a returned payout): if it does not exist it is raised (critical, owner = case owner or the payment's creator) → `contradicted`; if it or any other contradiction is open → `contradicted`; only if a person resolved **that** exception and nothing else contradicts → `none`. A resolved unrelated contradiction never counts. Audited as `workspace.migrated` (actor `system`), returned as `WorkspaceMigration[]` by `loadWorkspace`, and included in `ActionResult.audit`; idempotent. Parsing may change the passed object in place; `resetScenario` / `canResetScenario` parse a copy. A terminal `verified` payout **without** evidence is still refused. Refusal text: `"This workspace cannot be loaded: <what>. No version of the engine produces this, …"`. | `rc3-migration.test.ts` (v2-built fixtures `v2_t1`, `v2_t2`, `v2_va`) |
> | **M-2** | `canResolveCase` (rule tightened by CHANGE 9 R-M2): besides settlement `verified` AND reconciliation `matched`, a sent live payout's case may close only when a staff person **explicitly accepted** (`resolve { acceptDifference: true }`) a small over-amount on a bank debit that otherwise matches the payout — see CHANGE 9 R-M2 for the exact rule. A plain resolution never counts; provider reports, credits, currency mismatches, out-of-window, amount-only and ambiguous lines never count. The `RESOLVABLE` reason names the line, the person and the accepted amount; it does not say "evidenced". | `rc3-close-contradictions.test.ts` › "review M-2 …", "re-review R-M2 …" |
> | **Scope** | Returned payout: `derive.ts` recompute now keeps `settlementScope` on the contradicted evidence (`bank_statement`, else `onchain_transfer`) while settlement is `contradicted`, and `none` when settlement is `none` — the same as `onExecutionChanged` (before: scope `none` with `contradicted`). | `rc3-returns.test.ts` › "returned payout: settlement scope is pinned …" |
> | **M-3** | Chain: any earlier observation of the same tx hash with a different identity (chain, network, token contract or symbol) **or rejected as unsupported** — same chain included, any payout — blocks counting it. New code **`CH_TX_HASH_CONFLICT`** (same chain); `CH_TX_HASH_ON_OTHER_CHAIN` (other chain). | `rc3-chain.test.ts` › "review M-3 …" |
> | **m-3** | A person resolving `CH_TX_HASH_ON_OTHER_CHAIN` / `CH_TX_HASH_CONFLICT` sets **`ChainObservation.supersededBy`** (the exception id) on the rejected observation it names (kept on record, audited `chain.observation_superseded`); it then no longer blocks the correct observation. Counted observations are never superseded; `parseWorkspace` refuses a forged `supersededBy`. | `rc3-chain.test.ts` › "review m-3 …" |
> | **m-1** | Every stored amount ≤ `MAX_AMOUNT_MINOR` (10^15) at parse; bps 0–10 000; per-currency totals of intents, statement lines and each liquidity balance field ≤ 10^15 (BigInt check); `create_intent` / `ingest_statement_line` refuse (`invalid_amount`) an amount that would exceed the total; chain input amount ≤ 10^15. | `rc3-money.test.ts` › "review m-1 …" |
> | **m-2 / m-4** | `resetScenario`: clock not moved; clock rules applied to the restored records; audit lists removed ids and lines (see the resetScenario paragraph). | `rc3-reset-scenario.test.ts` › "review m-2 …", "review m-4 …" |
> | **m-5** | Tests that kill the 7 surviving mutants (CSV guard tab, CSV guard `-`, X-1 reconciliation clause, reset ID_CONFLICT / clock / advance re-derivation, report matched). | as above |
> | Test value change | `rc3-integrity-truths.test.ts` I-1 "terminal verified" now uses an evidence-free payout (s3 cancelled / verified): s2 has a debit since the S-2 follow-up, so `returned / verified` on s2 is a v2-producible state and is migrated. | — |

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
> - **resetScenario** restores one guided case's records to the sample and leaves the other four cases, every person-created record and the global data (routes, liquidity, policy, actors, organisation, clock) byte-identical. Ownership is computed: sample intents/advances anchor their case; person-created intents/advances anchor themselves; every other record belongs to the anchors it references by id (transitively) and, for a statement line, by the trusted reference it carries (provider payment id / repayment reference). Records owned **only** by the case — including activity a person added on it (a statement line matched to its payment, a note, attached evidence, a resolution) — are replaced by the sample versions. **Ids (CHANGE 9 R-B1):** the restored records keep their sample ids, and the workspace's id counter (`seq`) is raised to at least the highest restored id, so later actions never generate an id again — on a workspace saved by an earlier sample version (v2: counter 164; rc3's s2 ids reach 180) as well as on an rc3 one (where it is already higher). A restored id already used by another record is refused (`ID_CONFLICT`). The audit trail is append-only: nothing is removed and one `scenario.reset` event is appended, listing every removed id and each removed statement line's line id, account, direction and amount (CHANGE 8 m-4). **Clock (CHANGE 8 m-2):** the clock is neither rewound nor moved; `ctx.at` must be ≥ `ws.asOf` and the event is stamped at `ws.asOf`; the restored records are brought to the current clock with `advance_clock`'s rules, scoped to them (so a case restored after its due date is `overdue` with its `FD_OUTSTANDING_AFTER_DUE_DATE` exception); `audit` in the output includes those events. **Errors:** `invalid_field` (a workspace that cannot be loaded, or `ctx.at` earlier than `ws.asOf`), `unauthorized_actor` (unknown actor; any known actor may reset), `not_found` (`NOT_A_SAMPLE_SCENARIO`), `precondition_failed` for every other refusal — `error.message` starts with the `ResetBlockCode` (`"REFERENCED_BY_OTHER_RECORDS: …"`) and `error.entityId` is the first blocker. Refusals: **REFERENCED_BY_OTHER_RECORDS** (a record links this case and another case or a person-created intent/advance — e.g. a correction intent for the returned payout, an advance on the case's payment, a line whose candidates span two payouts; `blockers` lists the person-created anchors first), **REFERENCE_IN_USE** (a person's active payment uses the internal reference the reset would reactivate), **SCENARIO_NOT_IN_WORKSPACE** / **ID_CONFLICT** (workspace not derived from the sample). `canResetScenario` returns the same decision without changing anything (use it to enable the button and show `reason`). Labels: `HUMAN_LABELS.resetCode`.
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
| `assign_owner` / `add_note` / `attach_evidence` / `resolve` / `reopen` | `target: {kind:"case"\|"exception", id}`; `resolve` also takes `acceptDifference?: boolean` and `acceptLateDate?: boolean` (exception only; see CHANGE 10) | non-viewer |
| `approve_acceptance` | `exceptionId, note` — a second, different staff person approves an accepted over-amount above 1% (CHANGE 10) | non-viewer, ≠ the person who accepted |
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
