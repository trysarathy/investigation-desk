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
| Integer minor units; BigInt for FX conversion | No floating point anywhere money is calculated. USDC uses 6 decimals. |
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

## 4. What remains out of scope

Licensed routing, real payouts or bank instructions, production keys, custody, credit or lending decisions, compliance decisions, a shared funding/payments ledger, persistent multi-tenant state, and real customer data.
