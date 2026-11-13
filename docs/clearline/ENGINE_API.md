# Clearline sandbox engine — public API (for the console UI)

> **CHANGE (2026-11-13, after first draft):**
> 1. Sample intent ids are sequential (`pi_00001`, …), not `pi_s1_success`. Find a scenario by `intent.scenario` (`"s1_success" … "s5_funding"`); `SAMPLE_SCENARIOS` (exported) describes each. Ids are deterministic but may shift if the sample changes — do not hard-code them.
> 2. `ProviderRoute.providerFeeMinor: number` became `providerFees: Partial<Record<CurrencyCode, number>>` (per source currency, minor units).
> 3. `ProviderEvent.rawBody?: string` added (sandbox payload, for duplicate replay).
> 4. `SampleScenario` type and `SAMPLE_SCENARIOS` exported. `SAMPLE_ACTORS` is `Actor[]`.

**Status:** sandbox / test mode only. Fictional organisations, providers and amounts. No money movement, custody, keys, lending or compliance decisions.
**Import:** `import { … } from "@/lib/clearline"` (file `src/lib/clearline/index.ts`). Do not import internal modules directly. The legacy prototype `src/lib/clearline/core.ts` stays for the existing console; it is not part of this API.
**Stability:** names and signatures below are stable. Any change is announced in a `CHANGE` note at the top of this file.

## Workspace model

The whole sandbox state is one serialisable object, `Workspace` (see `types.ts`). The UI keeps it in browser storage.

| Function | Signature | Notes |
|---|---|---|
| `sampleWorkspace` | `() => Workspace` | Deterministic sample with the five seeded scenarios. Use for "Reset to sample". |
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

Pure: never mutates `ws`, never reads the wall clock (`ctx.at` is the simulated instant — pass `ws.asOf` or later), never throws for business errors. Every successful action appends `AuditEvent`s.

| `action.type` | Payload | Who |
|---|---|---|
| `create_intent` | `input: CreateIntentInput` (amountMinor integer, idempotencyKey required) | operator |
| `request_quotes` | `intentId` | operator |
| `choose_route` | `intentId, quoteId` → creates a `PaymentInstruction` (maker = actor) | operator |
| `approve_instruction` / `reject_instruction` | `instructionId` (+`reason`) — checker must differ from maker | approver |
| `submit_instruction` | `instructionId` | operator |
| `cancel_intent` | `intentId, reason` | operator |
| `simulate_provider_event` | `intentId, injection?: "none"\|"timeout"\|"duplicate"\|"out_of_order"\|"contradictory"\|"bad_signature"` | operator |
| `ingest_webhook` | `delivery: { providerId, rawBody, signatureHeader }` | operator |
| `ingest_statement_line` | `line: StatementLineInput` | operator |
| `ingest_chain_observation` | `observation: ChainObservationInput` | operator |
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
| `investigate` | `(ws, intentId) => Result<InvestigationView>` — requested / provider / provider-reported / independent evidence / unknowns / contradictions / outstanding / who acts / next actions, each with explanation codes |
| `exportCaseReport` | `(ws, caseId) => Result<CaseReport>` → `{ json, text }` |
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
| 1 Successful payment | `s1_success` | provider-reported completed; bank statement line matched separately |
| 2 Returned payout | `s2_returned` | beneficiary rejected → return event + return statement line; case with owner; correction workflow |
| 3 Compliance hold | `s3_hold` | partner document request; reviewer; never auto-released |
| 4 Base Sepolia delay | `s4_chain` | observed → pending finality → verified (advance with `simulate_provider_event`) |
| 5 Funding exposure | `s5_funding` (+ `intent.advanceId`) | SGD 50,000.00 advance, SGD 30,000.00 repaid by reference, SGD 20,000.00 outstanding; unreferenced SGD 20,000.00 receipt stays an exception |

## Test-mode HTTP API

`/api/clearline/test/v1/*` exposes the same engine statelessly (send the `workspace` you hold, or omit it to use the sample). See `docs/clearline/openapi.yaml`. Legacy `/api/clearline/test/{intents,quotes,transitions,webhooks,payments,health}` is unchanged.
