# Clearline unified engine — data model

Source of truth: `src/lib/clearline/types.ts`. All data is fictional sandbox data. Amounts are integer minor units plus a currency code (SGD, USD, PHP and EUR have 2 decimals; USDC has 6). Amounts in different currencies are never added.

## Entities

| Entity | Key fields | Notes |
|---|---|---|
| `Organization` | id, name, `fictional: true`, baseCurrency, timezone | One per workspace. `timezone` (IANA) defines every business calendar date: expiry, due dates, overdue, reconciliation window. Stored instants are UTC. |
| `Actor` | id, name, role (`operator`, `approver`, `compliance`, `viewer`) | Maker = operator; checker = approver. |
| `PaymentIntent` (+ `returnStatus?`: `provider_reported` or `confirmed_by_statement`) | id, orgId, internalReference, amountMinor, sourceCurrency, destinationCurrency, purpose, beneficiaryRef, beneficiaryName, destinationCountry, requestedExecutionDate, railEligibility, idempotencyKey, metadata, sandboxOutcome, **status {execution, settlement, settlementScope, reconciliation}**, quoteIds, selectedQuoteId, instructionId, caseId, advanceId, correctsIntentId | The shared payment identity. |
| `ProviderRoute` | id, providerId, rail, currencies, countries, indicativeRates, providerFees, platformFeeBps, eta, limits, prerequisites, restriction?, network? | 4 routes across 3 fictional providers; one is restricted. |
| `Quote` | provider, routeId, currencies, indicativeRate, providerFeeMinor, platformFeeMinor, estimatedRecipientMinor, expiresAt, etaLabel, prerequisites, eligible + eligibilityReason, source, quotedAt, freshness, `label: "Indicative sandbox quote — not executable"` | |
| `PaymentInstruction` | intentId, quoteId, routeId, providerId, amount, makerId, checkerId, status (`pending_approval`, `approved`, `rejected`, `submitted`), providerPaymentId, submittedAt | providerPaymentId is the trusted reconciliation reference. |
| `ProviderEvent` | providerEventId, intentId, payloadRef, payloadHash, providerTimestamp, receivedAt, sequence, signatureResult, dedupeKey, normalizedType, processingOutcome, provenance, confidence, errorClass | Rejected, duplicate and late events are kept along with their outcome. |
| `EvidenceRecord` | kind, intentId/caseId/advanceId, description, source, **independent**, reference, documentName/sha256 (metadata only), recordedBy | Files are never stored. |
| `StatementLine` | lineId, source (`bank_statement`, `provider_settlement_report`), accountRef, direction, kind (`payment`, `return`, `reversal`), amount, reference, counterparty, valueDate, receivedAt, status, explanationCodes, amountDifference? | Unique by (source, accountRef, lineId). `amountDifference` (CHANGE 5) = `{code: RC_UNDER_AMOUNT_REPORT \| RC_PARTIAL_AMOUNT, expectedMinor, reportedMinor, differenceMinor, currency, source, statementLineId, requiredNextAction}`; `differenceMinor = expectedMinor − reportedMinor`, validated on parse; since CHANGE 6 its `statementLineId`, `currency`, `source` and `reportedMinor` must match the line, and `code` must fit `source`. |
| `ReconciliationAllocation` | statementLineId, **evidenceKind** (`statement_line` or `chain_observation`), target (payment or repayment), amount, `matchedBy: trusted_reference`, codes | Created only from a trusted reference: the provider payment id on a bank line, the repayment reference, or the provider-reported tx hash for a final chain transfer. Provider settlement reports are never allocated. |
| `ReconciliationException` | category, severity, status, explanationCode, explanation, links (intent/advance/obligation/statementLine/case), **candidates** (ambiguity preserved), supporting events/evidence, owner, impact, amountDifference? (CHANGE 5), dueDate, requiredAction, history, resolution | 14 categories. |
| `InvestigationCase` | intentId or advanceId, owner, notes, requestedInfo, evidenceIds, exceptionIds, history, status (`open`, `resolved`, `reopened`) | One per payment. |
| `ComplianceHold` | intentId, providerId, `reportedBy: partner`, reason, requestedDocuments, submittedDocuments, reviewerId, partnerReleaseReportedAt, decisions, status, `autoRelease: false` | |
| `LiquidityPolicy` | label, definedBy, bufferBps, minBufferMinor, maxAgeMinutes | Illustrative and provider-defined; not a regulatory classification. |
| `LiquiditySnapshot` | providerId, accountRef, currency, eligibleMinor, restrictedMinor, safeguardedMinor, source, asOf | |
| `ChainObservation` | (only for a submitted USDC payout on the testnet route, to the beneficiary's registered wallet, for the quoted amount; one tx hash per payout) chainId, network, tokenContract, tokenSymbol, txHash, toAddress, amountMinor, blockNumber, confirmations, finalityThreshold, status (`observed`, `pending_finality`, `final`, `rejected_unsupported`) | Synthetic Base Sepolia (84532). `supersededBy?` (CHANGE 8 m-3): on a rejected observation, the id of the resolved hash-conflict exception that superseded it; it then no longer blocks the same hash. |
| `FundingAdvance` | intentId, customer, supplier, invoiceRef, principal, preparedBy, dueDate, repaymentReference, state, decisionId, obligationId | Projection-side only. |
| `FundingDecision` | advanceId, makerId, checkerId, outcome, reason | maker ≠ checker. |
| `RepaymentObligation` | advanceId, principal, dueDate, reference | Created on approval. |
| `RepaymentAllocation` | obligationId, statementLineId, amount, `matchedBy: trusted_reference`, evidenceId | |
| `AuditEvent` | at, actorId, action, entityType, entityId, summary | Appended by every action, and by `resetScenario` (`action: "scenario.reset"`, `entityType: "scenario"`). Never removed. |
| `ReturnPosition` (rc3, on `InvestigationView.returnPosition`, read model only) | returnStatus, debited, returnCredited, netMovement?, netMovementZero, `beneficiaryPaid: false`, code (`RT_NET_ZERO` / `RT_NET_NOT_ZERO` / `RT_RETURN_NOT_ON_STATEMENT` / `RT_DEBIT_NOT_ON_STATEMENT`), text | Present for a returned payout. Keeps "net movement is zero" separate from "beneficiary unpaid". Not stored. |
| `SyntheticCaseReport` (rc3, `buildCaseReport`, read model only) | reportVersion 1, marking, `fictional: true`, `sandbox: true`, generatedAt (= `ws.asOf`), subject, summary, threeTruths, timeline, findings, amounts, exceptions, disclaimer | Every amount is a `DecimalAmount` `{value: "50000.00", currency}` exact decimal string. Serialised by `caseReportToJson` / `caseReportToCsv`. Not stored. |

## Status dimensions

```
execution:   created → quoted → approved → submitted → in_transit → provider_reported_completed
             submitted/in_transit → awaiting_information | on_hold | failed | returned
             submitted → provider_reported_completed   (provider skipped in_transit; nothing is invented)
             provider_reported_completed → returned
             created/quoted/approved → cancelled | expired ; terminal: failed, returned, cancelled, expired
settlement:  none → observed → pending_finality → verified ; any → contradicted
             scope: provider_report | bank_statement (debit only) | onchain_transfer (never a bank credit)
reconciliation: not_started → pending → partially_matched → matched ; any → exception
```

## Explanation codes

- Reconciliation: `RC_*` (see `RECONCILIATION_CODE_TEXT`), e.g. `RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW`, `RC_AMOUNT_ONLY_CANDIDATES`, `RC_AMBIGUOUS_REFERENCE`, `RC_DUPLICATE_SUSPECTED`, `RC_LATE_STATEMENT`, `RC_CURRENCY_MISMATCH`.
- Provider events: `PV_*`, `EV_*`. Chain: `CH_*`. Funding: `FD_*`.
- Investigation: `PR_*` (provider reported), `IE_*` (independent evidence), `UK_*` (unknown), `CT_*` (contradiction), `OS_*` (outstanding), `WA_*` (who acts), `NA_*` (next action).

## Mandatory funding scenario (seeded as `s5_funding`)

1. Payment `INV-PM-5011`: SGD 50,000.00 to "Pacific Metals (fictional supplier)". Advance prepared by `usr_maya`, approved by `usr_daniel` (a different person). Obligation reference `RPY-SEABRIGHT-0001`, due 2026-11-20.
2. A bank debit referencing the provider payment id (statement line `SIMBANK-0003`; rc3 renamed the sample line ids from `DBS-SIM-000N`) is matched: settlement `verified (bank_statement)`, reconciliation `matched`.
3. A credit of SGD 30,000.00 referencing `RPY-SEABRIGHT-0001` is allocated (`RC_REPAYMENT_BY_REFERENCE`, `RC_PARTIAL_AMOUNT`). SGD 20,000.00 is outstanding.
4. A credit of SGD 20,000.00 with **no reference** is **not** allocated. It raises `missing_payment_reference` / `RC_AMOUNT_ONLY_CANDIDATES` with the obligation listed as a candidate. Outstanding stays at SGD 20,000.00, and resolving the exception does not allocate it.

## Returned-payout sample (seeded as `s2_returned`, rc3)

1. Payment `INV-2026-141` (`pi_00027`): USD 12,784.90 to "Redwood Supplies Ltd (fictional)" via Northline, approved by a different person, submitted, reported in transit.
2. Bank statement line `SIMBANK-0002` (debit, payment, USD 12,784.90, reference `NORTHLINE PAYOUT <provider payment id>`, value 2026-11-12) is matched by the trusted reference: settlement `verified (bank_statement)`, reconciliation `matched` — for now.
3. The provider reports `payout.returned` (beneficiary account invalid). A `returned_payout` exception opens; settlement becomes `contradicted` (the return contradicts the debit evidence; never verified); reconciliation `exception`.
4. Bank statement line `SIMBANK-0006` (credit, return, USD 12,784.90, reference `RETURN <provider payment id> ACCOUNT INVALID`) is allocated (`RC_RETURN_CONFIRMS_PROVIDER_RETURN`); `returnStatus` becomes `confirmed_by_statement`.
5. The case and the exception are owned by `usr_maya`, with a note. The exception stays open: the supplier has still not been paid.

Result: `investigate().returnPosition` = `RT_NET_ZERO` (debited = return credited = USD 12,784.90, `netMovement` 0.00, `netMovementZero: true`) **and** `beneficiaryPaid: false` (`RT_BENEFICIARY_UNPAID`, `OS_RETURN_RECEIVED_SUPPLIER_UNPAID`). Once a person resolves the return (funds-returned confirmation or correction intent), the recompute gives settlement `none` and reconciliation `matched` (net zero), labelled "Returned — net zero (supplier still unpaid)".

## Rules added by the code review (2026-11-13)

- A contradicted settlement stays contradicted until a person resolves the contradiction with evidence other than a plain note. Dimensions are then recomputed from recorded evidence.
- Return lines are checked for currency, duplicates and over-amount.
- A held payout cannot be cancelled. A provider `in_transit` received while on hold is recorded as the partner's release; it does not end the hold.
- `parseWorkspace` validates every element and rejects damaged data with a field path.
- A provider settlement report is provider-reported evidence in either order relative to the bank line. It never duplicates or changes a bank match.
- A returned payout is never "settled". Settlement is `contradicted` while the return is open and earlier settlement evidence exists (CHANGE 6), otherwise and after a person resolves the return `none`; reconciliation is `matched` only net of a statement-confirmed return (`returnStatus: confirmed_by_statement`).
- Provider events received during a hold are kept (`detail.suppressedOnHold`) and raise a human-handled exception. A redelivery after the hold ends is processed.

## Rules added in CHANGE 5 (2026-11-13, release/clearline-v2-20261113)

- A provider settlement report on a `failed`, `cancelled`, `expired` or `returned` payout raises `contradictory_evidence` / `RC_REPORT_ON_TERMINAL_PAYOUT` and changes no settlement. After a person resolves it, the recompute never counts that report as settlement on a failed, cancelled or expired payout.
- A provider settlement report below the payout amount raises `unmatched_reconciliation` / `RC_UNDER_AMOUNT_REPORT` with a structured `amountDifference`, and settlement is not upgraded. A bank line below the remainder is allocated as partial (`RC_PARTIAL_AMOUNT`, reconciliation `partially_matched`, settlement `observed`) with the same structured difference. Both appear in `investigate().amountDifferences` and on the evidence-timeline entries.
- `convertMinor` returns a `Result`; a malformed or zero rate is `invalid_field` (`field: "rate"`). A quote whose rate cannot be used is ineligible (`RATE_UNAVAILABLE`), never "eligible, recipient gets 0".
- `FundingProjectionRow.supplierPaidBasis` says whether `supplier_paid` rests on the provider's claim or on verified settlement.

## Rules added in CHANGE 6 (2026-11-13, code review v2)

- F1 holds in **either order**: when a payout becomes `failed`, `cancelled`, `expired` or `returned` (`TERMINAL_FOR_SETTLEMENT_REPORT`, one list in `state.ts`), every provider settlement report already recorded for it raises `contradictory_evidence` / `RC_REPORT_ON_TERMINAL_PAYOUT` and stops counting as settlement (provider-report-only settlement goes back to `none`). For stored workspaces, `investigate()` derives the same contradiction from an unflagged report on a terminal payout. A bank debit matched before `payout.failed` raises `RC_DEBIT_FOR_FAILED_PAYOUT` and settlement `contradicted`, as in the other order.
- `payout.returned` turns settlement `observed` / `pending_finality` / `verified` into `contradicted`; it stays `contradicted` on recompute while the return exception is open and bank/chain evidence exists, and is `none` once a person resolves the return. `supplierPaidBasis` is always `none` for a failed, cancelled, expired or returned payout.
- A bank debit matched to a payout that is already `failed`, `cancelled`, `expired` or `returned` is allocated but settlement is `contradicted`, never verified: `returned` adds the debit to the open return exception, `failed` raises `RC_DEBIT_FOR_FAILED_PAYOUT`, `cancelled`/`expired` raise `RC_DEBIT_FOR_TERMINAL_PAYOUT` (also when the debit came first). A debit during `on_hold` is the ordinary payout debit (not terminal). The end state is the same in either order. A debit after a person already resolved the return opens `RC_DEBIT_FOR_TERMINAL_PAYOUT`, so a contradiction always has an open item.
- `supplierPaidBasis` is `none` while the payout is `on_hold`; `FundingProjectionRow.supplierPayout` carries `onHold` and the undecided `hold { id, status }`, and the investigation lists `UK_DEBITED_FUNDS_HELD_BY_PARTNER` for a held payout with a matched debit.
- `InvestigationView.amountDifferences` holds only outstanding differences (`outstanding: true`); `resolvedAmountDifferences` holds the history (`outstanding: false`). `RC_PARTIAL_AMOUNT` is outstanding while bank allocations are below the payout amount and the payout is not terminal; `RC_UNDER_AMOUNT_REPORT` while its exception is unresolved.
- Only a provider report recorded as agreeing with the payout counts as provider-reported settlement in the recompute; a report that raised any exception never does, even once resolved.
- A provider settlement report on an `on_hold` payout is recorded and flagged (`contradictory_evidence` / `RC_REPORT_ON_HELD_PAYOUT`); settlement is unchanged.
- The same short provider report again (same reference, amount, currency, value date) while the first one's exception is open is linked to that exception (`RC_DUPLICATE_SUSPECTED` on the repeat line, outcome `duplicate_report_linked`), not opened again.
- `parseWorkspace` rejects an `amountDifference` whose line id, currency, source or reported amount disagrees with its own line (or the exception's linked line), or whose code does not fit its source.

## Rules added in rc3 (2026-11-13, Priority A — critical correctness)

- **Chain.** A rejected (unsupported chain or token) observation is never updated into a counted one. A tx hash already observed on another chain or network is not counted again (`CH_TX_HASH_ON_OTHER_CHAIN`). The same transaction in a different block is a reorg (`CH_BLOCK_CHANGED`). A reorg sets reconciliation to `exception`, and a chain allocation counts as a match only while its observation is `final`. An on-chain transfer observed before the payout failed or was cancelled raises `CH_TRANSFER_FOR_TERMINAL_PAYOUT`.
- **Terminal payouts.** A `failed`, `cancelled`, `expired` or `returned` payout never carries settlement `verified`: it is `contradicted` while a contradiction is open, otherwise `none`. The evidence stays on record. `parseWorkspace` refuses a stored workspace that says otherwise.
- **Integrity (`parseWorkspace`, run by every action).**
  - Allocations: every allocation names an existing line (and is listed in its `allocationIds`, in the same currency) or a chain observation of the same payout. One line or observation is never allocated to two targets, and never above its amount. One line repays at most one obligation, once.
  - Approvals and holds: `checkerId ≠ makerId` on instructions and funding decisions. A hold is `released`/`rejected` only with the matching reviewer decision.
  - Routes: `platformFeeBps` is an integer.
- **Money.** Basis-point amounts are computed with BigInt (`applyBpsFloor`).
- **Cases.** A case on a sent, non-terminal payout closes only when settlement is `verified` and reconciliation is `matched` (`EVIDENCE_OUTSTANDING`). A case whose payment funds an advance closes only when nothing is outstanding (`OUTSTANDING_REMAINS`).
- **Returns.** `InvestigationView.returnPosition` states both facts for a returned payout: whether the debit and the return credit net to zero, and `beneficiaryPaid: false`. `HUMAN_LABELS.returnStatus.confirmed_by_statement` is "Return confirmed on the statement".
- **Evidence timeline.** It includes provider settlement reports recorded as evidence, marked `independent: false`.
- **Per-scenario reset (`resetScenario`).**
  - Ownership: each sample intent or advance belongs to its case. Each person-created intent or advance belongs to the person. Every other record belongs to the owners of the records it references by id, transitively; a statement line also follows the trusted reference it carries.
  - Records owned only by the reset case are replaced by the sample versions. Everything else is unchanged; the audit trail only grows.
  - The reset is refused when a record links the case to anything else.

## Rules added after the rc3 code review (CHANGE 8, 2026-11-14)

- **Loading.** Parsing migrates a failed, cancelled, expired or returned payout stored as `verified` with evidence (a state earlier engine versions wrote) to the rc3 state: `contradicted`, or `none` if a person already resolved the contradiction, adding the owned contradiction exception rc3 would raise. Each migration is audited `workspace.migrated`. Without evidence the state is refused.
- **Bounds.** Every amount ≤ 10^15 minor units; basis points 0–10 000; per-currency totals of intents, statement lines and each liquidity balance field ≤ 10^15, checked at parse and when an action adds an intent or a line.
- **Chain.** A tx hash recorded with another identity or rejected as unsupported (any chain) is never counted (`CH_TX_HASH_CONFLICT` / `CH_TX_HASH_ON_OTHER_CHAIN`) until a person resolves the conflict, which sets `supersededBy` on the rejected record.
- **Cases.** A case may also close when a person accepted (resolved with evidence) an over-amount, wrong-currency or out-of-window bank debit that carries the payout's provider payment id.
- **Returned payouts.** Scope follows settlement: `contradicted` keeps the contradicted evidence's scope (`bank_statement` / `onchain_transfer`), `none` has scope `none`.
- **Reset.** The clock is not moved; the clock's rules apply to the restored records; the audit event lists what was removed.
- **Case report.** `matched` is the amount actually allocated (0.00 for a created, failed or cancelled payout with no evidence).

## Rules added after the re-review (CHANGE 9, 2026-11-14)

- **Reset ids.** `resetScenario` raises `seq` to at least the highest restored id, so a workspace saved by an earlier sample version never generates a restored id again.
- **Migration.** The `none` outcome requires that a person resolved the rc3 terminal rule's own exception for the same evidence. The code and the line or observations must match; an unrelated resolved contradiction never counts. `loadWorkspace` returns each change as a `WorkspaceMigration`.
- **`ReconciliationException.resolution.acceptedDifference?`** `{ statementLineId, differenceMinor, currency }` is set only by `resolve { acceptDifference: true }`. It is allowed only on an `RC_OVERPAYMENT` bank debit that carries the payout's provider payment id, in its currency and matching window, at most 1% over. A case may close on it; a plain resolution never lets a case close.
- **Evidence `source`.** For a statement line it reads "Bank statement <account>" or "Provider settlement report <account>", with "(fictional)" exactly once.

## Rules added after the second re-review (CHANGE 10, 2026-11-14)

- **Load-time migration (`migrate.ts`).** It applies four rules to states earlier engine versions saved:
  - A: a non-allowlisted counted observation is no longer counted;
  - B: a later observation of a hash already recorded as rejected or with another identity gets a conflict exception;
  - C: a terminal payout with evidenced settlement gets the rc3 terminal rule;
  - D: a match on a no-longer-final chain transfer goes back to reconciliation `exception`.

  Settlement never moves up. Each change is a `WorkspaceMigration` (kinds `terminal_payout_verified`, `terminal_payout_evidence`, `chain_observation_not_allowlisted`, `chain_hash_conflict`, `reorg_reconciliation`, and since CHANGE 13 `status_exceeds_evidence`).
- **`resolution.acceptedDifference`** is now `{ statementLineId, differenceMinor ≥ 0, currency, lateValueDate?, secondApproval?: { required: true, approvedBy?, approvedAt?, note? } }`.
  - It is allowed on `RC_OVERPAYMENT` and `RC_OUTSIDE_TIME_WINDOW` bank debits that carry the payout's reference, in its currency.
  - Limits: a late value date up to 60 days after submission; an over-amount up to 1% for one person, or up to 50% with a different staff person's approval (`approve_acceptance`).
  - A currency mismatch is never acceptable.
- **`HUMAN_LABELS.supplierPaidBasis.provider_reported`** is "Provider reports the supplier paid (not verified)".

## Rules added after the third re-review (CHANGE 11, 2026-11-14)

- **Reopening an exception reverses its resolution's effects.**
  - `resolution.acceptedDifference` is removed and recorded in the exception's history as `acceptance_withdrawn`.
  - A hash-conflict resolution's `supersededBy` link is removed (`supersede_withdrawn`), and the payout is recomputed.
  - So `acceptedDifference` and `supersededBy` only ever exist on a resolved exception, and every workspace an action produces loads.

## Rules added after the QA/security pass (CHANGE 13, 2026-11-14)

- **A stored status never exceeds its evidence (L1).** `PaymentIntent.status.settlement` and `.reconciliation` are capped on load to what `derive.ts:evidenceCeiling` allows, using `recomputeDimensions`' result. They are never raised. Each cap is a `WorkspaceMigration` of kind `status_exceeds_evidence` (outcome `status_capped`) with a `workspace.migrated` audit event. `canResolveCase` checks the evidence, not only the stored status.
  - settlement `verified`: a counted `final` chain observation, or bank statement allocations in the source currency covering the amount;
  - `pending_finality`: a counted chain observation;
  - `observed`: any counted observation, any allocation, or a provider settlement report;
  - reconciliation `matched`: a final observation allocated to the payout, bank allocations covering the amount, or a statement-confirmed return;
  - `partially_matched`: any allocation to the payout.
- **Decisions name actors with the required role (L2).** `Instruction.makerId` is an operator or approver and `.checkerId` an approver other than the maker. `FundingDecision.makerId` is an operator and `.checkerId` an approver other than the maker. `Hold.reviewerId` and each `Hold.decisions[].reviewerId` are compliance reviewers, and each decision is `release`, `reject` or `request_more`. An accepted difference's `resolution.actorId` and `secondApproval.approvedBy` are staff. All must exist in `actors`. A workspace that breaks this is refused.
- **Payment allocations have an engine-produced shape (fifth check R5-m1).** An allocation with `evidenceKind: "statement_line"` and `target.kind: "payment"` comes from a line in the payout's source currency that carries the payout's provider payment id as a reference token. The line is either a `bank_statement` debit of kind `payment`, or (with code `RC_RETURN_CONFIRMS_PROVIDER_RETURN`) a `return` or `reversal` line. A workspace that breaks this is refused. Forged evidence records of a valid shape are not detected.
