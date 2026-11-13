# Clearline sandbox engine — public API (for the console UI)

> **CHANGE 3 (2026-11-13, code review docs/release/CODE_REVIEW.md + QA release findings):**
> - **Chain evidence (B1/B2):** `ingest_chain_observation` returns `precondition_failed` unless the payout uses the Base Sepolia stablecoin route, pays out USDC, and is `submitted`, `in_transit` or `provider_reported_completed`. A wrong wallet (`CH_WALLET_NOT_BENEFICIARY`), wrong amount (`CH_AMOUNT_DIFFERS_FROM_QUOTE`), a tx hash already linked to another payout (`CH_TX_ALREADY_LINKED`, both payouts as `candidates`) or a second tx for one payout (`CH_SECOND_TX_FOR_PAYOUT`) raises `contradictory_evidence` and changes no status. Finality sets **settlement** only. Reconciliation becomes `matched` only through an allocation (`evidenceKind: "chain_observation"`) when the provider reported the same tx hash (`tx_hash` in its `payout.completed` payload). New helpers: `ProviderAdapter.expectedWallet?(intent)` and the `beneficiary_wallet` intent metadata override.
> - **`ReconciliationAllocation.evidenceKind: "statement_line" | "chain_observation"`** (new, required). For a chain allocation, `statementLineId` holds the chain observation id.
> - **Provider settlement reports (M1):** never allocated and never set reconciliation `matched`. They set settlement `observed / provider_report` (if nothing better) and add `RC_PROVIDER_REPORT_ONLY` to the line, which stays `unallocated`. Outcome: `recorded_provider_report`. A later bank line allocates and verifies.
> - **Return lines (M2):** checked for currency, duplicates (`RC_DUPLICATE_SUSPECTED`) and over-amount (`RC_OVERPAYMENT`) before allocation.
> - **Contradictions (M3/m3):** a `contradicted` settlement is never overwritten by later evidence; the evidence is stored and noted on the open exception (outcome `recorded_no_state_change`). Resolving `contradictory_evidence`, `unmatched_reconciliation`, `missing_payment_reference`, `beneficiary_mismatch` or `missing_statement` needs user-attached evidence other than `kind: "note"`. After any exception is resolved, the payout's settlement and reconciliation are **recomputed from recorded evidence** (audit action `intent.dimensions_recomputed`).
> - **Time (M4/M5):** all stored instants are UTC `…Z`; comparisons and ordering use parsed instants. **Date-based rules use `Organization.timezone`** (Asia/Singapore in the sample): execution-date expiry, overdue advances, exception due dates, the reconciliation window and late-statement detection.
> - **Malformed input (M6):** a correctly signed but malformed provider payload is refused with `invalid_field` (nothing recorded); a badly signed one is still recorded as `rejected_signature`. `parseWebhook` validates every field type. Chain observations are fully type-checked. The engine returns `invalid_field` instead of throwing on a damaged workspace.
> - **Cancellation (M7):** `cancel_intent` is refused (`invalid_transition`) after submission, including `on_hold` and `awaiting_information`; a held payout ends through the reviewer.
> - **Holds:** a provider `payout.in_transit` received while `on_hold` is recorded as the partner's release (hold `partner_release_reported`) and never leaves `on_hold` without the reviewer's release (QA finding). `request_more` after a partner release keeps `partner_release_reported` (m12).
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
| `canResolveCase` | `(ws, caseId) => { allowed, code, reason }` |
| `scenarioIntentId` / `intentForScenario` | `(ws, scenario) => string \| undefined` |
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
| 1 Successful payment | `s1_success` (`pi_00001`) | provider-reported completed; bank statement line matched separately |
| 2 Returned payout | `s2_returned` (`pi_00027`) | beneficiary rejected → return event + return statement line; case with owner; correction workflow |
| 3 Compliance hold | `s3_hold` (`pi_00060`) | partner document request; reviewer; never auto-released |
| 4 Base Sepolia delay | `s4_chain` (`pi_00090`) | observed → pending finality → verified (advance with `simulate_provider_event`) |
| 5 Funding exposure | `s5_funding` (`pi_00119`, advance `adv_00121`) | SGD 50,000.00 advance, SGD 30,000.00 repaid by reference, SGD 20,000.00 outstanding; unreferenced SGD 20,000.00 receipt stays an exception |

## Test-mode HTTP API

`/api/clearline/test/v1/*` exposes the same engine statelessly (send the `workspace` you hold, or omit it to use the sample). See `docs/clearline/openapi.yaml`. The unversioned legacy endpoints `/api/clearline/test/{intents,quotes,transitions,webhooks,payments,health}` now return **410 Gone** with `error.replacement: "/api/clearline/test/v1"`.
