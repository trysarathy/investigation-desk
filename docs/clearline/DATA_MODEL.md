# Clearline unified engine — data model

Source of truth: `src/lib/clearline/types.ts`. All data is fictional sandbox data. Amounts are integer minor units plus a currency code (SGD, USD, PHP and EUR have 2 decimals; USDC has 6). Amounts in different currencies are never added.

## Entities

| Entity | Key fields | Notes |
|---|---|---|
| `Organization` | id, name, `fictional: true`, baseCurrency, timezone | One per workspace. |
| `Actor` | id, name, role (`operator`, `approver`, `compliance`, `viewer`) | Maker = operator; checker = approver. |
| `PaymentIntent` | id, orgId, internalReference, amountMinor, sourceCurrency, destinationCurrency, purpose, beneficiaryRef, beneficiaryName, destinationCountry, requestedExecutionDate, railEligibility, idempotencyKey, metadata, sandboxOutcome, **status {execution, settlement, settlementScope, reconciliation}**, quoteIds, selectedQuoteId, instructionId, caseId, advanceId, correctsIntentId | The shared payment identity. |
| `ProviderRoute` | id, providerId, rail, currencies, countries, indicativeRates, providerFees, platformFeeBps, eta, limits, prerequisites, restriction?, network? | 4 routes across 3 fictional providers; one is restricted. |
| `Quote` | provider, routeId, currencies, indicativeRate, providerFeeMinor, platformFeeMinor, estimatedRecipientMinor, expiresAt, etaLabel, prerequisites, eligible + eligibilityReason, source, quotedAt, freshness, `label: "Indicative sandbox quote — not executable"` | |
| `PaymentInstruction` | intentId, quoteId, routeId, providerId, amount, makerId, checkerId, status (`pending_approval`, `approved`, `rejected`, `submitted`), providerPaymentId, submittedAt | providerPaymentId is the trusted reconciliation reference. |
| `ProviderEvent` | providerEventId, intentId, payloadRef, payloadHash, providerTimestamp, receivedAt, sequence, signatureResult, dedupeKey, normalizedType, processingOutcome, provenance, confidence, errorClass | Rejected, duplicate and late events are kept along with their outcome. |
| `EvidenceRecord` | kind, intentId/caseId/advanceId, description, source, **independent**, reference, documentName/sha256 (metadata only), recordedBy | Files are never stored. |
| `StatementLine` | lineId, source (`bank_statement`, `provider_settlement_report`), accountRef, direction, kind (`payment`, `return`, `reversal`), amount, reference, counterparty, valueDate, receivedAt, status, explanationCodes | Unique by (source, accountRef, lineId). |
| `ReconciliationAllocation` | statementLineId, target (payment or repayment), amount, `matchedBy: trusted_reference`, codes | Created only from a trusted reference. |
| `ReconciliationException` | category, severity, status, explanationCode, explanation, links (intent/advance/obligation/statementLine/case), **candidates** (ambiguity preserved), supporting events/evidence, owner, impact, dueDate, requiredAction, history, resolution | 14 categories. |
| `InvestigationCase` | intentId or advanceId, owner, notes, requestedInfo, evidenceIds, exceptionIds, history, status (`open`, `resolved`, `reopened`) | One per payment. |
| `ComplianceHold` | intentId, providerId, `reportedBy: partner`, reason, requestedDocuments, submittedDocuments, reviewerId, partnerReleaseReportedAt, decisions, status, `autoRelease: false` | |
| `LiquidityPolicy` | label, definedBy, bufferBps, minBufferMinor, maxAgeMinutes | Illustrative and provider-defined; not a regulatory classification. |
| `LiquiditySnapshot` | providerId, accountRef, currency, eligibleMinor, restrictedMinor, safeguardedMinor, source, asOf | |
| `ChainObservation` | chainId, network, tokenContract, tokenSymbol, txHash, toAddress, amountMinor, blockNumber, confirmations, finalityThreshold, status (`observed`, `pending_finality`, `final`, `rejected_unsupported`) | Synthetic Base Sepolia (84532). |
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
