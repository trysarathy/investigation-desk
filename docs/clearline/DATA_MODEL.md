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
| `ChainObservation` | (only for a submitted USDC payout on the testnet route, to the beneficiary's registered wallet, for the quoted amount; one tx hash per payout) chainId, network, tokenContract, tokenSymbol, txHash, toAddress, amountMinor, blockNumber, confirmations, finalityThreshold, status (`observed`, `pending_finality`, `final`, `rejected_unsupported`) | Synthetic Base Sepolia (84532). |
| `FundingAdvance` | intentId, customer, supplier, invoiceRef, principal, preparedBy, dueDate, repaymentReference, state, decisionId, obligationId | Projection-side only. |
| `FundingDecision` | advanceId, makerId, checkerId, outcome, reason | maker ≠ checker. |
| `RepaymentObligation` | advanceId, principal, dueDate, reference | Created on approval. |
| `RepaymentAllocation` | obligationId, statementLineId, amount, `matchedBy: trusted_reference`, evidenceId | |
| `AuditEvent` | at, actorId, action, entityType, entityId, summary | Appended by every action. |

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
2. A bank debit referencing the provider payment id is matched: settlement `verified (bank_statement)`, reconciliation `matched`.
3. A credit of SGD 30,000.00 referencing `RPY-SEABRIGHT-0001` is allocated (`RC_REPAYMENT_BY_REFERENCE`, `RC_PARTIAL_AMOUNT`). SGD 20,000.00 is outstanding.
4. A credit of SGD 20,000.00 with **no reference** is **not** allocated. It raises `missing_payment_reference` / `RC_AMOUNT_ONLY_CANDIDATES` with the obligation listed as a candidate. Outstanding stays at SGD 20,000.00, and resolving the exception does not allocate it.

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
- `InvestigationView.amountDifferences` holds only outstanding differences (`outstanding: true`); `resolvedAmountDifferences` holds the history (`outstanding: false`). `RC_PARTIAL_AMOUNT` is outstanding while bank allocations are below the payout amount and the payout is not terminal; `RC_UNDER_AMOUNT_REPORT` while its exception is unresolved.
- Only a provider report recorded as agreeing with the payout counts as provider-reported settlement in the recompute; a report that raised any exception never does, even once resolved.
- A provider settlement report on an `on_hold` payout is recorded and flagged (`contradictory_evidence` / `RC_REPORT_ON_HELD_PAYOUT`); settlement is unchanged.
- The same short provider report again (same reference, amount, currency, value date) while the first one's exception is open is linked to that exception (`RC_DUPLICATE_SUSPECTED` on the repeat line, outcome `duplicate_report_linked`), not opened again.
- `parseWorkspace` rejects an `amountDifference` whose line id, currency, source or reported amount disagrees with its own line (or the exception's linked line), or whose code does not fit its source.
