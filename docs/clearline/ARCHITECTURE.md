# Clearline unified engine — architecture

**Status (2026-11-13):** sandbox prototype. Everything described as "built" runs on fictional data in the browser or as stateless test-mode API calls. Sections marked **TARGET** are a design for a future real-data pilot. They are not built and need founder approval, a security review and jurisdiction-specific advice first.

Prepared by a general-purpose AI subagent working under the repository role briefs for tech-lead-architect, matching-engine-engineer, accounting-integrations-engineer and crypto-protocol-engineer. It is not a review by those roles and has not been independently reviewed.

## 1. What is built

```
 Console UI (src/components/clearline, src/app/clearline)        Test-mode API (src/app/api/clearline/test/v1)
        │  browser storage holds the Workspace JSON                     │  stateless: workspace in → workspace out
        └──────────────────────────────┬────────────────────────────────┘
                                       ▼
                     src/lib/clearline/index.ts  (public API)
   ┌───────────────────────────────────┼────────────────────────────────────────────┐
   │ actions.ts  applyAction(ws, action, ctx) → Result<{workspace, audit, …}>        │
   │   ├ state.ts          execution transitions, progress ranks                    │
   │   ├ adapters.ts       ProviderAdapter + SandboxAdapter (3 fictional providers)  │
   │   ├ events.ts         webhook ingestion: signature, dedupe, ordering, contradictions, holds │
   │   ├ reconciliation.ts trusted-reference matching, RC_* codes                     │
   │   ├ chain.ts          synthetic Base Sepolia evidence, finality threshold        │
   │   ├ exceptions.ts     exception/case lifecycle, resolution guards                │
   │   ├ funding.ts        Funding Desk projection (not a ledger)                     │
   │   └ liquidity.ts      usable-liquidity policy                                    │
   │ investigation.ts  read model: what was requested / reported / evidenced / unknown │
   │ labels.ts         HUMAN_LABELS, describeCode/Status/Error (CHANGE 5; text only)   │
   │ scenarios.ts      resetScenario / canResetScenario — one guided case (rc3)        │
   │ report.ts         buildCaseReport + JSON/CSV — synthetic case report (rc3)        │
   │ bodylimit.ts      streamed 512 KB body reader for the v1 route (internal, R4)     │
   │ money.ts, sha256.ts, webhooks.ts, tx.ts, sample.ts, serialize.ts, types.ts       │
   └──────────────────────────────────────────────────────────────────────────────────┘
```

- **Pure and deterministic.** Every action takes `(workspace, action, {actorId, at})` and returns a new workspace plus the audit events it appended, or a typed `EngineError` with no change. The engine never reads the wall clock or random numbers. IDs are sequential from `workspace.seq`. The sample is built by replaying the public actions, so the seeded data always follows the rules.
- **One payment identity.** `PaymentIntent.id` links quotes, the instruction (maker/checker), provider events, statement allocations, chain observations, the investigation case, exceptions, and, through `advanceId`, the Funding Desk projection.
- **Separate status dimensions.** `execution`, `settlement` (+ `settlementScope`) and `reconciliation` change for different reasons and are never merged. A provider's "completed" report changes only `execution`.
- **Evidence over claims.** Provider events carry `confidence: provider_claim`. Only bank statement lines and chain observations are `independent: true`. A provider settlement report gives `observed / provider_report`, never `verified`.
- **Nothing resolves itself.** Exceptions are closed only by a person, and only when `canResolveException` allows it. New events append history; they never close an exception. New contradicting evidence reopens a resolved case.
- **Compliance holds** are partner-reported. Release needs both the partner's release report and the assigned compliance reviewer's decision. Neither a timer nor a provider event alone releases a hold.
- **No custody or execution.** Adapters are deterministic simulators: no network, no keys, no payouts. The webhook secrets are public test strings.

- **Human labels live next to the rules (CHANGE 5).** `labels.ts` maps every status value, explanation code and error code to deterministic English. A test reads the type unions and the engine source and fails if any value or emitted code has no label, so a new rule cannot ship with an unlabelled code.

### Legacy prototype

Retired on 2026-11-13 (code review M10). `src/lib/clearline/core.ts` was removed. `/api/clearline/test/[action]` now returns 410 Gone pointing to `/api/clearline/test/v1`. The legacy tests' assertions were moved to `tests/clearline/legacy-migrated.test.ts`.

### Time

Every stored instant is a UTC `…Z` string; actions normalise any offset they receive. Business dates — execution-date expiry, due dates, overdue, the reconciliation window and late statements — are calendar dates in `Organization.timezone` (Asia/Singapore in the sample).

### Funding Desk relationship

`funding.ts` is a **projection**. It aligns a Connect payment with a Funding Desk advance using the Funding Desk's rules (treasury maker ≠ checker, allocation only by explicit reference, outstanding = principal − allocated repayments, overdue by due date). It maps states onto `src/lib/mentor-demo` stage names. It does **not** read or write `src/lib/funding` storage or the mentor demo state, and it is not a shared production ledger.

## 2. Key decisions

| Decision | Why |
|---|---|
| Modular monolith in one TypeScript package | One team, one deploy; modules split by domain, with a single public `index.ts`. |
| Workspace as a serialisable value | Lets the trial run with no database and no customer data on a server; it can be reset to the sample. |
| Synchronous pure-JS SHA-256/HMAC | Signature checks can then run inside pure synchronous actions in both browser and Node. Test mode only. |
| Integer minor units; BigInt for FX conversion and basis points | No floating point anywhere money is multiplied or divided (rc3: `applyBpsFloor`). USDC uses 6 decimals. Amounts are stored as safe integers; see §4 for the bound on sums. |
| Amount-only matches never allocate | Matching-engine rule: only exact identifiers create automatic links, and anything ambiguous goes to a person. |
| Synthetic token contract identity | Crypto-protocol rule: official contracts are never hard-coded from memory. The sandbox uses a clearly synthetic allowlisted identity. |

## 3. TARGET — real-data pilot (not built)

> **TARGET design only.** Nothing below exists. Building it needs written data-handling terms, an independent security review, regulatory advice, and founder approval for anything touching keys, money, customer data or deployment settings.

- **Storage:** Postgres. Every table carries `tenant_id`, enforced with row-level security keyed on a per-request `app.tenant_id` setting. Holds, decisions and audit are append-only. Status dimensions are stored as separate columns, and an `intent_status_history` table records every transition with its cause.
- **Event intake:** a provider webhook endpoint per tenant and provider, with a per-endpoint secret in a KMS (with rotation). The raw body is verified before parsing, then written to an append-only `provider_events_raw` table with a unique `(provider_id, provider_event_id)` constraint for dedupe. A worker normalises events through the same pure `ingestPayload` rules.
- **Idempotency:** an `idempotency_keys(tenant_id, key, fingerprint, response, created_at)` table with a unique key and a 24-hour retention window.
- **Reconciliation:** statement import jobs (bank file / provider report) produce `statement_lines` with a unique `(tenant_id, source, account_ref, line_id)`. The matching functions are the same pure ones, so test fixtures carry over.
- **Chain evidence:** a read-only observer that records confirmations against an allowlist sourced from the issuer's documentation (with source and date, plus an on-chain `symbol()`/`decimals()` check). Finality policy is set per network.
- **AuthN/Z:** SSO, roles mapped to operator, approver, compliance and viewer. Maker ≠ checker is enforced in the database (a check constraint on decisions) as well as in code.
- **Ops:** an outbox for notifications, retry queues for webhooks, and structured audit export.

## 4. Financial invariants (rc3)

This is the result of the rc3 adversarial audit ("Priority A — critical correctness", 2026-11-13). Each row
gives the place the invariant is enforced (`file:function` under `src/lib/clearline/`) and the tests that prove
it (under `tests/clearline/`).

Status values:
- **Already enforced**: it held before rc3; rc3 added or named a proof.
- **Fixed in rc3**: a gap was found and closed; each new test fails with its fix removed (checked by
  restoring the pre-fix file and re-running).
- **Limitation**: what is not enforced, stated plainly.

| # | Invariant | Status | Enforced in | Proved by |
|---|---|---|---|---|
| 1 | **Exact money.** Integer minor units, with no floats in balances, allocations or conversions. | **Fixed in rc3** (M-1: the liquidity buffer and platform fee used a float `amount × bps` product, which is off by one above 2^53). **Limitation:** see below the table. **Fixed after review (m-1):** per-amount and per-currency total bounds at parse and at creation (`serialize.ts:crossCheck`, `money.ts:withinTotal`; `rc3-money.test.ts` › "review m-1"). | `money.ts:parseAmount`, `money.ts:convertMinor` (BigInt, rounds down), `money.ts:applyBpsFloor` (BigInt, rc3), `money.ts:validateAmountMinor`, `liquidity.ts:computeLiquidity`, `adapters.ts:SandboxAdapter.eligibility/quote`, `serialize.ts` (safe integers) | `money-webhooks.test.ts` (money); `rc3-money.test.ts` (M-1 plus a static scan: no `parseFloat`/`toFixed`, no float bps or rate products, `Number()` only on bounds-checked BigInt results) |
| 2 | **Three truths.** Execution, settlement evidence and reconciliation stay separate. A provider completion alone never sets settlement to verified. | **Already enforced** for completion. **Fixed in rc3:** T-1 (a chain-final payout followed by `payout.failed` stayed `verified`) and T-2 (the recompute after resolution set `verified` on a failed payout). | `events.ts:applySideEffects` (completion changes only execution), `reconciliation.ts:reconcileLine`, `reconciliation.ts:onExecutionChanged` (T-1), `derive.ts:recomputeDimensions` (T-2), `serialize.ts:crossCheck` (terminal ⇒ never verified) | `events.test.ts` › "happy path: provider-reported completion never sets verified or reconciled"; `legacy-migrated.test.ts` › "a provider's completion is never presented…"; `rc3-integrity-truths.test.ts` › T-1, T-2, "three truths stay separate (property…)" |
| 3a | A returned payout never appears delivered to the supplier. | **Already enforced** (CHANGE 6, M2/N1/C2) | `reconciliation.ts:onExecutionChanged`, `reconciliation.ts:reconcileLine` (debit after return), `derive.ts:recomputeDimensions`, `funding.ts:supplierPaidBasis` | `review-v2.test.ts` › "M2 …", "N1 returned …", "C2 …"; `rc3-returns.test.ts` › "a returned payout never appears delivered" |
| 3b | A statement-confirmed return is labelled accordingly. | **Already enforced**: `returnStatus` and the `RC_RETURN_CONFIRMS_PROVIDER_RETURN` label. **Fixed in rc3**: `HUMAN_LABELS.returnStatus` added. | `reconciliation.ts:reconcileLine` (return branch), `labels.ts:HUMAN_LABELS.returnStatus` | `reconciliation.test.ts` › "a return line confirms a provider-reported return"; `rc3-returns.test.ts` › "labels: …" |
| 3c | "Net financial movement is zero" is kept distinct from "beneficiary unpaid". | **Fixed in rc3** (R-1). Before, the view stated only "supplier unpaid"; net zero showed only implicitly through reconciliation `matched`. | `investigation.ts:investigate` → `returnPosition` (`netMovementZero`, `beneficiaryPaid: false`, `RT_*`); `sample.ts:sampleWorkspace` s2 now shows debit → return → return credit (net zero, beneficiary unpaid, settlement contradicted, open owned exception) | `rc3-returns.test.ts` › "R-1 …" (5 tests); `rc3-sample-stability.test.ts` |
| 4a | Reconciliation never allocates by amount alone. | **Already enforced** | `reconciliation.ts:reconcileLine`, `reconciliation.ts:reconcileIncoming` (amount-only → `RC_AMOUNT_ONLY_CANDIDATES`), `chain.ts:tryAllocateChain` (needs the provider-reported tx hash) | `reconciliation.test.ts` › "an amount-only match never allocates"; `funding.test.ts` › "a SGD 20,000.00 receipt WITHOUT the reference…"; `rc3-invariants-proof.test.ts` › invariant 4 |
| 4b | Ambiguity is preserved: two candidates means no allocation. | **Already enforced** | `reconciliation.ts:reconcileLine` / `reconcileIncoming` (`RC_AMBIGUOUS_REFERENCE`, `candidates` kept) | `reconciliation.test.ts` › "ambiguous references are preserved…"; `rc3-invariants-proof.test.ts` › "two payouts with the same amount…", "an incoming credit quoting two obligations' references…" |
| 4c | No statement line is allocated twice, or to two payouts or obligations. | **Already enforced** by construction (one allocation per ingest; duplicate line id refused; look-alike → `RC_DUPLICATE_SUSPECTED`). **Fixed in rc3** (I-1): a stored or posted workspace that breaks this is refused. **After review (M-1):** v2-produced terminal-verified states are migrated on load (`serialize.ts:migrateTerminalVerified`), not refused; `rc3-migration.test.ts`. | `actions.ts:ingestStatement`, `reconciliation.ts:reconcileLine` (dupe and remainder checks), `serialize.ts:crossCheck` | `reconciliation.test.ts` › "rejects a re-ingested statement line id…"; `rc3-integrity-truths.test.ts` › I-1 (4 tests) |
| 5 | **Stablecoin evidence.** Chain id, network, token and contract, beneficiary wallet, one payout per hash (including the same hash on another chain), exact amount at 6 dp, finality threshold, reorg or confirmations decrease, and never on a fiat payout. | **Already enforced** for identity, wallet, amount, finality, decrease, one payout per hash and fiat. **Fixed in rc3:** C-1 (a rejected observation was revived by the same hash), C-2 (a block change was silent), C-3 (a reorg after finality left reconciliation `matched`), T-1. **Fixed after review:** M-3 (an unsupported-token rejection on the SAME chain followed by the same hash as USDC was counted; now `CH_TX_HASH_CONFLICT`), m-3 (a person's resolution supersedes the rejected record). `rc3-chain.test.ts` › "review M-3", "review m-3". | `chain.ts:tokenAllowed`, `chain.ts:assertChainApplicable`, `chain.ts:expectedBeneficiaryWallet`, `chain.ts:ingestChainObservation`, `chain.ts:tryAllocateChain`, `derive.ts:recomputeDimensions`, `reconciliation.ts:onExecutionChanged` | `chain.test.ts`; `review-fixes.test.ts` › "B1 …", "B2 …"; `rc3-chain.test.ts` (C-1–C-3); `rc3-invariants-proof.test.ts` › invariant 5 (each field, ±1 minor unit, 11 vs 12 confirmations, fiat) |
| 6 | **Funding.** 50,000 advanced / 30,000 repaid by reference / 20,000 outstanding. An unrelated 20,000 receipt never closes it. Over-repayment, wrong currency and partial repayment are flagged. Maker ≠ checker. | **Already enforced** | `reconciliation.ts:reconcileIncoming`, `funding.ts:obligationOutstanding`, `funding.ts:deriveAdvanceState`, `actions.ts:decideAdvance`, `exceptions.ts:canResolveException` (overdue only when nothing is outstanding) | `funding.test.ts`; `rc3-invariants-proof.test.ts` › invariant 6 (including after the due date and after resolving the receipt's exception) |
| 7 | **Human decisions.** Maker ≠ checker on every approval. Holds are never released by a timer or a provider event. | **Already enforced.** **Fixed in rc3** (I-1): stored maker = checker records and a released hold with no decision are refused. **CHANGE 13 (QA L2):** every stored decision must name an existing actor with the required role (instruction and funding makers and checkers, hold reviewer and decisions, accepted differences and second approvals); otherwise the workspace is refused. | `actions.ts:decideInstruction`, `actions.ts:decideAdvance`, `actions.ts:holdDecision` (reviewer ≠ document submitter, assigned reviewer only), `events.ts:ingestPayload` (hold branch), `actions.ts:advanceClock` (no hold logic), `serialize.ts:crossCheck` | `intents.test.ts` › "refuses approval by the maker…"; `funding.test.ts` › "treasury approval must come from a different person…"; `holds.test.ts`; `rc3-invariants-proof.test.ts` › invariant 7; `rc3-integrity-truths.test.ts` › I-1 |
| 8a | Nothing closes an obligation or case without matching evidence. | Obligations: **already enforced** (they close only through allocations by reference). Cases: **fixed in rc3** (X-1). **Fixed after review (M-2):** a person may accept a disagreeing bank debit that names the payout (`exceptions.ts:acceptedBankLine`); `rc3-close-contradictions.test.ts` › "review M-2". **Tightened after re-review (R-M2):** only an explicit acceptance of a ≤1% over-amount on a matching bank debit (`exceptions.ts:acceptableDifference`); `rc3-close-contradictions.test.ts` › "re-review R-M2". | `funding.ts:obligationOutstanding`, `exceptions.ts:canResolveException`, `exceptions.ts:canResolveCase` (`EVIDENCE_OUTSTANDING`, `OUTSTANDING_REMAINS`) | `cases-sample.test.ts`; `rc3-close-contradictions.test.ts` › X-1 (2 tests) |
| 8b | Every contradiction has an open owner (final check C2). | **Already enforced** (C2). rc3 adds a property proof over adversarial flows. | `reconciliation.ts:reconcileLine` (late debit → `RC_DEBIT_FOR_TERMINAL_PAYOUT`), `reconciliation.ts:onExecutionChanged`, `derive.ts:recomputeDimensions`, `investigation.ts:investigate` (`whoActs`) | `review-v2.test.ts` › "C2 …"; `rc3-close-contradictions.test.ts` › X-2 (2 property tests) |
| 9 | **Data exposure.** Sample data is fictional: no real names, IBANs or real wallets. | **Fixed in rc3** (D-1): sample line ids used "DBS", a real bank, and were renamed `SIMBANK-000N`. | `sample.ts:sampleWorkspace`, `chain.ts` (synthetic token identity and wallets) | `rc3-data-exposure.test.ts` |
| — | The evidence timeline lists every source. | **Fixed in rc3** (E-1): a recorded provider settlement report was missing from the timeline. | `investigation.ts:evidenceTimelineFor` | `rc3-integrity-truths.test.ts` › E-1 |

**Limitations (stated plainly):**
- **Number storage.** Amounts are stored as JS safe integers (`number`), not BigInt, so the workspace stays plain
  JSON. Each amount is at most `MAX_AMOUNT_MINOR` = 10^15 minor units. This is enforced when an action creates
  it (`validateAmountMinor`, chain input) and, since review m-1, again when a workspace is parsed
  (`serialize.ts` `amt`), so a stored or posted workspace cannot carry a larger one.
- **What is exact.**
  - Every product or ratio on money uses BigInt: conversion and basis points.
  - Sums use `number` addition: allocations per payout, committed payouts, repaid / outstanding, and the
    per-currency totals in `fundingProjection` and `computeLiquidity`.
  - Those sums are exact because (review m-1) the per-currency total of payment intents, statement lines and
    each liquidity balance field is also at most 10^15 minor units. `parseWorkspace` checks this in BigInt
    (`serialize.ts` `crossCheck`), and `create_intent` / `ingest_statement_line` refuse an amount that would
    exceed it (`money.ts` `withinTotal`). Every engine sum draws on at most a handful of these totals, so it
    stays far below 2^53 ≈ 9.007 × 10^15.
  - The cost: a sandbox workspace holds at most 10^15 minor units per currency in each of those collections.
- **Chain evidence after a terminal state.** Chain evidence that arrives after a payout is already terminal is
  refused (`precondition_failed`, B1). It is not recorded as a contradiction.
- **Integrity cross-check scope.** The cross-check covers the invariants listed in row 4c, row 7 and the
  terminal ⇒ never-verified rule. It is not a full consistency proof of a client-held workspace (QA v2
  informational note).
- **Per-scenario reset.** It refuses rather than merges when a record links the case to another case or to a
  person-created record. It never moves the clock (CHANGE 8 m-2): the clock's rules are applied to the restored
  records at the current clock.
- **Closing a case on a disagreeing line (CHANGE 8 M-2; rule from CHANGE 10 R2-M2).** A staff person may explicitly
  accept a bank debit that names the payout, in its currency:
  - a late value date, up to 60 days after submission (`acceptLateDate`);
  - an over-amount up to 1% (`acceptDifference`);
  - an over-amount up to 50%, which also needs a second, different staff person (`approve_acceptance`).

  These stay open:
  - a currency mismatch: there is no FX evidence in the sandbox, and the case message says what would be needed;
  - a short debit;
  - a batched or ambiguous debit;
  - a statement line that never arrives (there is no manual allocation action yet).

  The person who ingested a line may accept a fee of at most 1% on it (product decision).
- **Migration of older workspaces (CHANGE 8 M-1, CHANGE 9 R-M1 / R-m1, CHANGE 10 R2-M1).** On load, stored evidence is
  re-validated against rc3's rules: chain allowlist and identity, earlier hash conflicts, the terminal-payout rule
  for any evidenced settlement, and the reorg rule. States rc3 cannot produce are corrected, never upgraded, and each
  correction is reported by `loadWorkspace`. A property test shows this is a no-op on rc3 workspaces. Since CHANGE 11
  the tested sequences include reopen, cancel, advances, notes and info requests (a reopen withdraws the resolution's
  acceptance or supersede); since CHANGE 12 they also include the payment lifecycle through `submit_instruction`,
  `approve_acceptance`, hold reviewer assignment, advance repayment, migrated v2 starting points and resets at a later
  clock. Every workspace those sequences produce loads unchanged; this is tested, not proven for every sequence.
  Since CHANGE 13 (QA L1), load also caps any stored settlement or reconciliation above what the recorded evidence
  supports (`derive.ts:evidenceCeiling`, rule E `status_exceeds_evidence`), and `canResolveCase` checks the evidence
  rather than the stored status, so a crafted "verified / matched" never closes a case. A v2 C-2
  block change cannot be detected from stored data. Any other state the integrity check refuses is refused, not
  repaired.
- **Reset on older workspaces (CHANGE 9 R-B1).** The reset raises the id counter past the restored ids, so the
  counter can skip numbers. Ids stay unique.

## 5. What remains out of scope

Licensed routing, real payouts or bank instructions, production keys, custody, credit or lending decisions, compliance decisions, a shared funding/payments ledger, persistent multi-tenant state, and real customer data.
