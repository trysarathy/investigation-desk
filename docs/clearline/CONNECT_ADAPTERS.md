# Clearline Connect — provider adapter specification (rc4)

> **Status (2026-11-15): sandbox only. No live provider is connected.** The three providers described here are
> **fictional**. Their "APIs" are deterministic simulators in `src/lib/clearline/connect/`. There are no network calls,
> no real keys, and no payouts. Every signing secret is a public `test_` string that protects nothing.
>
> **Live execution needs separate authorisation and review.** A real integration touches secrets, provider
> credentials, money movement and customer data. All of these are on the approval-only list in
> `company/OPERATING_MODEL.md` §2. Before any live provider is connected, it needs founder approval, an
> independent security review and a provider-specific review of its descriptor, as listed in §11. This document
> is the specification that review starts from. It does not authorise anything.
>
> This was prepared by a general-purpose AI subagent working under the role briefs for tech-lead-architect,
> matching-engine-engineer and crypto-protocol-engineer. No person has reviewed it.

Source labels follow `company/COMPANY_RULES.md` rule 2:

- Research IDs such as [ST4] refer to `PAYMENTS_AND_STABLECOIN.md` (research-agent, 2026-11-15). Each ID stands for
  `[VERIFIED: research-agent 2026-11-15, <url>]`. The URLs are listed in §12.
- The author of this document did not reopen those pages.
- The research itself has not been reviewed by a person.

---

## 1. Why an adapter framework

Vendors' own documentation says that their "done" status is not final settlement:

- **Status regression.** A Stripe payout can show `paid` and later `failed` [ST4][ST7]. A Modern Treasury `completed`
  payment order can still become `returned` or `reversed` [MT1][MT2]. An Airwallex `PAID` transfer can become
  `FAILED` [AW3].
- **Time-based status.** Nium's `DEEMED_PAID` is reached because a return window passed [NI2].
- **Preliminary hash.** Bridge says the hash it reports at submission "may be preliminary" [BR1].
- **Internal transfers.** Zero Hash shows internal transfers as `CONFIRMED` even though nothing happened on-chain [ZH1].
- **Lossy webhooks.** Nium delivers webhooks at most once by default [NI5]. Thunes tells partners to poll once its
  callbacks stop [TH1].
- **Many signature schemes.** At least eight different webhook signing schemes are documented [MT14][ST12][PR6][GR9][BR4][FB6][ZH5][BG1][BV6].

Clearline already keeps execution, settlement evidence and reconciliation separate (ARCHITECTURE.md §1). Connect adds
the per-provider layer: a **declared, reviewable descriptor** that decides how one provider's events are trusted,
mapped, deduplicated, ordered, polled and retried. All of it feeds the engine's **one** event path
(`events.ts:ingestPayload`).

## 2. The contract: `AdapterDescriptor`

The contract is data, not code (`connect/types.ts`). Reviewing a new provider means reviewing its descriptor.

| Field | Declares | Rule |
|---|---|---|
| `statuses: StatusMapping[]` | the provider's raw vocabulary: `raw`, optional `subStatus` (`"*"` = any), mapped to `event` (engine claim), `execution`, `settlementClaim`, `confidence`, `rank`, `reason?`, `txHash?: "final" \| "preliminary"` | `execution` must equal the engine's `EVENT_TARGET[event]`. (`state.ts`; tested) |
| `verification: VerificationScheme[]` | scheme id, header names, `toleranceSeconds` (replay window) | §5 |
| `dedupe: DedupeRule` | `{ declared: "event_id", fallback: "object_version" \| "object_status" }` or `{ declared: "object_version", fallback: "payload_hash" }` | §6 |
| `ordering: OrderingRule` | `object_version` or `state_rank` | Never arrival time (§6) |
| `polling: PollingCapability` | `fetchStatus: true`, `listSince`, `webhookDelivery` (`at_least_once` / `at_most_once` / `unverifiable`) | Every adapter must be pollable (§7) |
| `idempotency: IdempotencySemantics` | `header`, `format` (`printable` / `uuid`), `maxLength`, `ttlHours`, `onRepeat` (`replay_first_response` / `reject_duplicate`), `onBodyMismatch: "reject"` | §8 |
| `shape: PayloadShape` | where `ref`, `version`, `status`, `subStatus`, `addendum`, `amount`, `currency`, `occurredAt`, `txHash`, `reason` sit in the provider's JSON. Also the envelope's `eventIdField` / `objectField` | Webhook envelope or bare object (poll) |
| `settlementReportClass: "provider_report"` | how its settlement reports count | The type allows only `provider_report` (§9) |

### Ranks

- `rank` is the adapter's progress order for raw statuses.
- Terminal outcomes (`failed`, `returned`) must rank above every progress status. This is tested, so a reversal is
  never read as a late event.
- Side states (`on_hold`, `information_requested`, `hold_released`) are not progress. They are left out of rank
  comparisons.

### Exported API (`@/lib/clearline`)

**Types:** `AdapterDescriptor`, `StatusMapping`, `ClaimConfidence`, `SettlementClaim`, `ProviderRawStatus`,
`VerificationScheme`, `VerificationSchemeId`, `SigningKey`, `ConnectVerification`, `DedupeRule`, `OrderingRule`,
`PollingCapability`, `IdempotencySemantics`, `PayloadShape`, `NormalizedClaim`, `ScriptEntry`, `TruthVersion`,
`StatusSnapshot`, `FeedChange`, `IdempotencyRecord`, `IdempotencyOutcome`, `EvidenceSourceClass`,
`EvidenceSourceKind`, `ConnectReceipt`, `PollResult`.

**Descriptors and routes:**
- `COBALT_WREN`, `QUILLFERN`, `SALTGLASS`, `CONNECT_DESCRIPTORS`, `getDescriptor(id)`
- `connectKeyring(id)`, `connectRoutes()`, `CONNECT_SCRIPTS`
- `withConnectRoutes(ws)`
- `CONNECT_PROVIDERS` (from `adapters.ts`)

**Verification:**
- `verifyDelivery(schemes, rawBody, headers, keys, nowUnix) → ConnectVerification`
- `signDelivery(scheme, rawBody, keys, unix)`
- `encodeHeaderBundle(headers)`, `decodeHeaderBundle(s)`
- `assertSandboxKeyring(keys)`, `IMPLEMENTED_SCHEMES`

**Normalisation:**
- `parseProviderBody(d, rawBody) → Result<NormalizedClaim>`
- `toEnginePayload(claim)`, `rawDetail(raw)`, `findMapping(d, status, sub)`
- `findOrderConflict(ws, intentId, payload) → OrderConflict | undefined` (types `OrderConflict`, `OrderConflictCode`)

**Simulator (fictional provider side):**
- `providerTruth(d, intent, instr)`, `providerScript`
- `providerWebhook(ws, intentId, version, opts?)`
- `fetchStatusSnapshot(d, intent, instr, at, version?)`
- `listSince(ws, providerId, cursor, at)`
- `snapshotObject`, `webhookBody`, `eventIdFor`
- `syntheticFinalTxHash`, `syntheticPreliminaryTxHash`

**Idempotency:**
- `providerIdempotencyKey(d, clearlineKey, instructionId)`
- `isValidProviderKey(sem, key)`
- `simulateProviderIdempotency(sem, store, req)`
- `retryDecision(sem, firstAttemptAt, now)`

**Evidence:**
- `EVIDENCE_SOURCE_CLASS`
- `classifyEvidenceRecord(rec)`, `classifyStatementSource(src)`
- `providerEventSourceKind(event)`

**Intake and reconciler:**
- `receiveConnectWebhook(ws, { providerId, rawBody, headers }, ctx) → Result<ConnectReceipt>`
- `reconcileConnect(ws, ctx, { mode?: "fetch_status" | "list_since", cursors? }) → { workspace, results, cursors }`
- `unresolvedConnectIntents(ws)`, `declaredHeaders(descriptor)`, `UNRESOLVED_EXECUTION`

**Engine adapter:**
- `ConnectAdapter` (implements `ProviderAdapter`)
- `toWebhookVerification(v)`

**New engine action:** `{ type: "poll_provider"; intentId: string; version?: number }` (operator only).

- The engine fetches the snapshot itself from the adapter's `fetchStatus`. The caller cannot supply its content.
- The snapshot is ingested with provenance `provider_poll` and signature result `not_applicable`.
- Its outcome is the event's `ProcessingOutcome`, or `no_event_pending`.

## 3. Raw status, normalised claim, confidence

Every Connect provider event stores the raw values **verbatim** in `ProviderEvent.detail`, next to the normalised
claim:

- `rawStatus`, `rawSubStatus`, `rawAddendum`, `rawReasonCode`;
- `rawRank`, `claimConfidence`, `settlementClaim`, `objectVersion`;
- `rawTxHashPreliminary`.

`rawBody` keeps the exact bytes. The events of the three original sandbox providers are unchanged and carry none of
these keys.

| `ClaimConfidence` | Meaning | Example (fictional) | Motivated by |
|---|---|---|---|
| `provider_claim` | The provider says so | `delivered/bank_confirmed` | Every vendor's status [ST7][MT2] |
| `provider_time_inferred` | Inferred because time passed with no return | `DONE/PRESUMED_AFTER_WINDOW` | `DEEMED_PAID` [NI2] |
| `provider_ledger_claim` | The provider's internal ledger says so; **never chain evidence** | `book_transfer_done` | Internal `CONFIRMED` [ZH1]; Go Account events [BG2] |
| `provider_preliminary` | The provider says the value may change | `broadcast_unconfirmed` | Preliminary hash [BR1] |

None of these confidences is `verified`, and no mapping can make one `verified` (tested). `ProviderEvent.confidence`
stays `"provider_claim"`.

**Execution never sets settlement.**
- A provider status event changes only `execution`. `settlementClaim` is recorded, never applied.
- A hash on a status the descriptor does not declare `final` goes to `rawTxHashPreliminary`. It never goes to the
  engine's `tx_hash`, so it is never chain evidence and never allocates.

**An unmapped raw status is refused.** The result is `invalid_field` ("unmapped raw status …"), and nothing is recorded
or applied. It is never guessed. The fix is a reviewed change to the mapping table.

## 4. Regression is a contradiction (generic, adapter-level, independent of arrival order)

> **rc4 review fix (M-1, M-2, L-2).** The first version compared an event only with OLDER accepted events, so the
> outcome depended on which webhook arrived first. The rule below compares in provider order, whichever arrived first.

A provider moving backwards is recorded as a contradiction with an owner. It is never an error and never silent, and
the result is the same in every arrival order.

**Rule** (`connect/normalize.ts:findOrderConflict`, applied in `events.ts`):
- The incoming Connect event is compared with every **accepted** event of the same payout. Accepted means `applied`,
  `recorded_no_state_change` or `stored_late_no_regression`. Each pair is put in **provider order** (by `sequence`).
- Side states (hold, information request, partner release) are never compared.
- A hold is an **epoch boundary**: two versions with an accepted hold between them are not compared, so a payout
  that resumes at a lower routing rank after a hold is not a regression.
- The rule raises one of these codes, in priority order:
  1. `EV_PROVIDER_SUCCESS_REVERSED`: the earlier version claims completed and the later one claims failed
     (paid → failed [ST4][AW3]).
  2. `EV_PROVIDER_STATUS_REGRESSED`: the earlier version has a higher declared rank than the later one.
  3. `EV_PROVIDER_CLAIMS_DIFFER`: two completion claims with different settlement claims, at any sequences including
     equal ranks (Saltglass `onchain_final` against `book_transfer_done`, L-2).
- **Execution follows the provider's latest version**, unless the payout is already terminal (the terminal rule
  wins).
  - When the incoming event is the newest, its execution is applied, together with its usual side effects (for
    example the `failed_submission` exception for a failure).
  - When it is older, it is recorded as `contradictory_exception_raised` and state is not changed.
- In both cases one owned `contradictory_evidence` exception names both events. Settlement becomes `contradicted` if it
  was not `none`.

| Case | Every arrival order ends in |
|---|---|
| paid → failed (`delivered` → `bounced`) | execution `failed`; open `EV_PROVIDER_SUCCESS_REVERSED` + `PV_FAILED_BENEFICIARY_REJECTED`. The earlier "paid" claim stays visible |
| completed → returned (`clawed_back`, `BOUNCED_BACK` [MT1][MT2]) | `returned` with the `returned_payout` exception. This is a return, not a conflict. F1 and N1 are unchanged |
| same-claim regression (`bank_confirmed` → `handed_to_bank`) | `provider_reported_completed`; open `EV_PROVIDER_STATUS_REGRESSED` |
| cross-claim regression (`delivered` → `routing`) | `in_transit` (the latest version); open `EV_PROVIDER_STATUS_REGRESSED` |
| two completion claims (on-chain final against internal ledger) | `provider_reported_completed`; open `EV_PROVIDER_CLAIMS_DIFFER` |
| a lower-ranked older version arriving late | stored late, with no exception |

**Outside the transition table (re-review RR-4).** The conflict path sets execution with `setExecution`. It does not
check `canTransitionExecution`, so `provider_reported_completed → failed` and `provider_reported_completed → in_transit`
happen for Connect payouts even though `EXECUTION_TRANSITIONS` does not list them. This is stated in `state.ts`.

- **Engine.** `setExecution` still runs `onExecutionChanged`, so F1 and N1 apply. A terminal state is never left.
- **Accounting Bridge** (`src/lib/clearline/accounting/`, read only here). It does not use the transition table. It
  derives entries from evidence plus the current execution state (`NOT_DELIVERED` = terminal or on hold), and it
  supersedes or flags any entry whose basis changes. A cross-module test (`rc4-connect-rereview.test.ts` › RR-4)
  shows a reversal after a bank debit:
  - a **proposed** `JR_SUPPLIER_PAYOUT_DEBIT` is superseded (`SP_EVIDENCE_CHANGED`) and rebooked as
    `JR_PAYOUT_DEBIT_NOT_DELIVERED`;
  - a **posted** one is kept, flagged, and reversed (`JR_REVERSAL`), and the rebooking goes to provider clearing;
  - the supplier payable nets to zero, and `ledgerProblem` is clear.
- **completed → in_transit** supersedes nothing and double-counts nothing.
- **Routed to the bridge owner (not changed here).** A live payout that has an open contradiction and a matched bank
  debit still gets `JR_SUPPLIER_PAYOUT_DEBIT` (supplier shown paid). This is true for the original providers'
  `EV_IMPOSSIBLE_TRANSITION` as well as for Connect regressions. It is pre-existing behaviour and not caused by the
  conflict path.

**Post-hold version before the hold (re-review RR-1).** The hold boundary is known only once the hold arrives, so a
resumed version that arrives before the hold raises `EV_PROVIDER_STATUS_REGRESSED`. When the hold or its release is
later accepted and lies between the pair, `noteHoldBoundary` **annotates** the open exception: its explanation and
history (`hold_boundary_noted`) say it most likely spans a hold, and the action is audited
(`exception.context_added`). The exception is **not** resolved automatically, because nothing resolves itself in the
engine (ARCHITECTURE.md §1). A person confirms and closes it.

The rule runs only when the payload carries an adapter-declared rank, so the original providers are unaffected. It runs
after the amount, hold and hold-release rules, so the H3 hold rules keep priority. Every such contradiction has an open
exception, and `investigate().whoActs` is never `WA_NONE` (tested, as C2 requires).

**Known order dependence (not fixed, by design):**
- A provider that **leaves a terminal state**: `failed`, then a newer `delivered`. When the terminal version arrives
  first, the payout stays terminal (the terminal rule), with the conflict raised. When it arrives last, execution
  shows the latest version, again with the conflict raised. Both orders raise the same code. No shipped script does
  this.
- **Late pre-hold events during a hold.** They are suppressed for a person (H3, `EV_PROVIDER_EVENT_WHILE_ON_HOLD`), so
  hold scripts are excluded from the permutation guarantee.

## 5. Webhook verification (pluggable, raw body)

All schemes verify the exact raw body string (`connect/verify.ts`):

| Scheme id | Headers | Signed payload | Motivated by |
|---|---|---|---|
| `clearline_sandbox_v1` (existing) | `x-sandbox-signature: t=<unix>,v1=<hex>` | `t + "." + body` | Original sandbox |
| `hex_hmac_sha256_ts` | `x-<provider>-timestamp`, `x-<provider>-signature: <64 hex>` | `ts + "." + body` | Hex HMAC `X-Signature` [MT14][BV6][BG1] |
| `multi_sig_hmac_sha256_ts` | `x-<provider>-timestamp`, `x-<provider>-signatures: v1=<hex>,v1=<hex>` (≤ 8) | `ts + "." + body` | Multiple signatures with a timestamp [GR9]; rotation header [PR6] |
| `asymmetric_rsa_sha256_ts` | declared, **not implemented** | — | RSA with a timestamp [BR4]; JWS/JWKS [FB6] |
| `none` | — | — | Signing not established for some vendors (research: Nium, Thunes) |

### Rules

- **Several active secrets.** Each `SigningKey` has `activeFrom` / `activeUntil` (unix seconds). Every active key is
  tried. During rotation, the fictional Quillfern signs with both keys. A retired key fails after its window.
- **Replay window.** A delivery fails as `timestamp_outside_tolerance` when |now − signed timestamp| is more than
  `toleranceSeconds` (300 s). This covers both stale and future timestamps. Inside the window, a replayed delivery is
  caught by dedupe (`duplicate_ignored`).
- **Constant-time comparison.** `matchAny` compares every (key, signature) pair with `constantTimeEqual` and never
  exits early.
- **Sandbox keys.** Only `test_` secrets are allowed:
  - `assertSandboxKeyring` and `signDelivery` throw on any other secret;
  - the verifier ignores any other key.
- **Missing or bad headers.** When the descriptor declares an implemented scheme, missing or malformed headers are
  **invalid**. They are recorded as `rejected_signature` and never applied.
- **No scheme, or one not implemented.** The result is **`unverified`**:
  - `receiveConnectWebhook` does not apply the body. It polls the provider's status API (`poll_provider`) and applies
    the provider's own answer, which is `polled_to_confirm`. A forged "final" body is never recorded.
  - For verified or invalid deliveries, the intake bundles **only the headers the declared schemes read**
    (`declaredHeaders`). The receipt's `action` comes from the engine's recorded outcome: `ingested` unless the engine
    recorded `rejected_signature` (review M-4).
  - If the body names no known payout, nothing changes.
  - Through the raw engine action `ingest_webhook`, an unverified delivery is recorded as `rejected_signature` (not
    applied). `WebhookVerification.reason` is `unverified_scheme`, and the audit says "unverified scheme", not
    "signature invalid" (review L-3).

**Header bundle.** The v1 `WebhookDelivery` has one `signatureHeader` string. For Connect providers, that string
carries the provider's signature headers as `headers-v1:` followed by sorted lower-case JSON
(`encodeHeaderBundle`). This avoids changing `WebhookDelivery`, `actions.ts` or the v1 route. The TARGET intake would
pass the header map itself.

## 6. Dedupe and ordering (independent of arrival)

| Provider | Declared key | Fallback (documented) | Ordering |
|---|---|---|---|
| Cobalt Wren | `evt:<event id>` | `ver:<ref>:<version>` (poll snapshots carry no event id) | object version |
| Quillfern | `ver:<ref>:<version>`, identical for a webhook and a poll of the same version (same bytes) | `hash:<sha256(body)>`. Never reached: a body without a version is refused, because ordering needs it | object version |
| Saltglass | `evt:<event id>` | `st:<ref>:<status>:<sub>` | raw rank (`state_rank`) |

How the declared key and ordering value reach the engine:

- The adapter's key becomes the engine payload `id`, so the engine's existing dedupe (`<providerId>:<id>`) applies
  unchanged:
  - a redelivery with the same bytes is `duplicate_ignored`;
  - the same key with different bytes raises `EV_SAME_ID_DIFFERENT_PAYLOAD`.
- The ordering value becomes the engine `sequence`. Arrival time is never used. Stripe and Airwallex disclaim
  delivery order [ST12][AW6].

**Proved by tests:** for **every** non-hold script of the version-ordered providers (Cobalt Wren and Quillfern),
every arrival order of the webhooks ends in exactly the same statuses, return status and open exception codes. That
covers success, return, clawback, presumed-only, `regress_substatus` and `regress_to_routing` (all permutations). §4
lists the two cases that are not covered.

**Limit of `state_rank`.** A provider with no object version cannot express a non-terminal regression, because a
lower rank is always an older sequence. Two different completion claims are still caught (`EV_PROVIDER_CLAIMS_DIFFER`).
Such adapters rely on polling (§7).

## 7. Polling reconciler (simulated)

Polling is a required capability: webhooks can be lost (at-most-once [NI5]), stop retrying [TH1][PR6], or be blocked
[BG1].

- **`fetchStatus`** is `poll_provider { intentId }`. It returns the provider's latest snapshot at the engine clock.
- **`listSince(cursor)`** returns every version, of every payout at that provider, that took effect in
  `(cursor, at]`. They come in provider order: time, then reference, then version. `poll_provider { intentId, version }`
  feeds each one.
- **`reconcileConnect`**:
  - polls every **unresolved** Connect payout: `submitted`, `in_transit`, `awaiting_information`, `on_hold`, or
    `provider_reported_completed`. Completed payouts are included because they can still regress.
  - with `mode: "list_since"`, it replays each provider's feed instead. Providers without a feed fall back to
    `fetchStatus`.
  - skips a snapshot whose exact bytes are already recorded (`unchanged`).
  - reports an error on one payout without stopping the others.

**Equivalence (tested as a property).** All 13 scripts of the three providers were run with 25 seeds each. Every lost
webhook was replaced by a `fetchStatus` poll made before the provider's next change. Every run ends in the same
outcome as receiving every webhook. "Outcome" here means:

- the three status dimensions;
- `returnStatus`;
- the open exceptions (category and code);
- holds;
- chain observations.

Losing every webhook and then running one `list_since` pass also ends identically.

**Documented limit (tested).** One `fetchStatus` made after several changes sees only the latest one. For
`delivered` → `bounced`, it ends `failed` with no contradiction, which differs from the webhook path. A change feed
(`listSince`), or polling more often than the provider changes, is required for regression-capable providers.

## 8. Outbound idempotency (P2)

`providerIdempotencyKey` derives **one deterministic key per instruction**, valid for the provider's format and length:

- `printable`: `cl_` + SHA-256, truncated to the provider's maximum length;
- `uuid`: an RFC 9562 v8 layout.

Every retry of an instruction therefore carries the same key. Every version of the provider object echoes the key,
and the stored `rawBody` keeps it verbatim.

`simulateProviderIdempotency` models what the provider does with a repeated key:
- **replay** the first response, as Stripe and MT do [ST11][MT3];
- or **reject** the repeat, as BVNK does [BV5].

A different body sent with the same key is rejected in this sandbox model. The research records only that Bridge requires "the body must match" on a retry [BR5]. After the TTL the key is forgotten
[MT3][NI4][GR8].

`retryDecision` returns:
- `poll_status_first` after the TTL, or for any reject-duplicate provider;
- `retry_with_same_key` only inside the TTL, and only with a replaying provider.

A blind retry after the TTL could create a second payout.

| Fictional provider | Header | Format / max | TTL | Repeat |
|---|---|---|---|---|
| Cobalt Wren | `Idempotency-Key` | printable / 200 | 24 h | replay first response |
| Quillfern | `X-Request-Key` | uuid / 36 | 24 h | reject duplicate |
| Saltglass | `Idempotency-Key` | printable / 64 | 24 h | replay; body must match |

## 9. Evidence source classification

| Source | Class | Can verify settlement | Chain evidence |
|---|---|---|---|
| Bank statement line (BAI2 [MT10], CAMT.053) | `independent` | yes | no |
| Clearline's own chain observation | `independent` | yes | yes |
| Provider settlement report (Circle CAMT [CI3], Primer/Gr4vy [PR2][GR3], Stripe [ST2], Thunes [TH1], BVNK [BV1], Zero Hash [ZH4]) | `provider_report` | no: gives `observed / provider_report` at most | no |
| Provider status event | `provider_claim` | no | no |
| Provider-ledger confirmation (internal transfer [ZH1][BG2]) | `provider_claim` | no | **never** |
| Preliminary hash [BR1] | `provider_claim` | no | **never** |

How this is enforced:

- `ConnectAdapter.ingestStatementRow` always emits a `provider_settlement_report` line. A provider can never produce
  a bank statement line.
- `classifyEvidenceRecord` agrees with every stored `EvidenceRecord.independent` across all Connect flows (tested).
- Person-attached records are `supporting`.
- Clearline's observation of a **preliminary** hash is contradicted once the provider reports a different final hash
  (`CH_TX_DIFFERS_FROM_PROVIDER`, existing rule).

## 10. The three fictional sandbox providers

These do not name or imply any real company. Their status names are generic and invented, and a test checks that
none equals a real vendor's documented status word. The real-world patterns that motivated them:

| Fictional provider | Semantics | Motivated by |
|---|---|---|
| **Cobalt Wren Payouts** (`prv_cx_cobaltwren`, fiat local) | Payouts that regress: `delivered` → `bounced`, `delivered` → `clawed_back`; hold `paused_for_review` and partner release `review_cleared`; sub-statuses `handed_to_bank` < `bank_confirmed`; hex HMAC with timestamp; at-least-once delivery with event ids; object version; change feed | `paid` → `failed` [ST4][ST7]; `completed` → `returned`/`reversed` [MT1][MT2]; `PAID` → `FAILED` [AW3]; hex HMAC [MT14]; no ordering guarantee [ST12][AW6] |
| **Quillfern Remit** (`prv_cx_quillfern`, correspondent) | **At-most-once** webhooks (poll required); `DONE/PRESUMED_AFTER_WINDOW` = time-inferred; `IN_FLIGHT/CLEARING_HANDOFF` with a limited-visibility addendum; hold `HALTED` and partner release `RELEASED`; multi-signature with key rotation; dedupe by object version; change feed; reject-duplicate idempotency | At-most-once by default [NI5]; `DEEMED_PAID` and `PROCESSED_BY_CLEARING` [NI2]; poll after callbacks stop [TH1]; multiple signatures [GR9]; rotation [PR6]; 400 on repeat [BV5] |
| **Saltglass Digital** (`prv_cx_saltglass`, Base Sepolia testnet USDC) | `broadcast_unconfirmed` with a **preliminary hash**; `onchain_final` with the final hash; `book_transfer_done` = internal ledger, no chain activity; RSA-style signature not implemented here, so webhooks are always unverified and confirmed by polling; no object version (raw-rank ordering); `claims_conflict` script (both completion claims) | Preliminary hash [BR1]; internal `CONFIRMED` [ZH1]; off-chain Go Account events [BG2]; RSA with timestamp [BR4]; "independent check before crediting" [FB3] |

The provider's truth is a script of versions, each effective a set number of minutes after submission
(`CONNECT_SCRIPTS`). The script is chosen by `intent.metadata.connect_script`, else by `sandboxOutcome`, else
`success`.

Connect routes are **not** in the sample workspace. Add them with `withConnectRoutes(ws)`.

**Holds (review M-3).** A partner-release status maps to `payout.hold_released`. As for every provider:
- the hold ends only when **both** the partner's release and the assigned compliance reviewer's `release` decision
  are recorded, in either order;
- neither alone releases it.

After the release, the provider's later versions apply as usual. Events suppressed during the hold are re-applied
when they are redelivered or re-polled (review L-1: the reconciler no longer counts a suppressed copy as
"unchanged").

## 11. Before any real integration (TARGET; approval-only)

1. **Approval.** Founder approval and an independent security review. Secrets, provider credentials, money and
   customer data are approval-only (`company/OPERATING_MODEL.md` §2).
2. **Descriptor review against the provider's current primary documentation.** Check every raw status and
   sub-status, its rank, its confidence, and whether its hash is final. Record the URL and date for each row. Never
   write a descriptor from memory.
3. **Secrets.** Per-endpoint secrets in a KMS with rotation windows, never in code. The `test_` rule stays for the
   sandbox.
4. **Raw intake.** Verify the raw body before parsing. Write it to an append-only `provider_events_raw` table with a
   unique `(provider_id, dedupe_key)` (ARCHITECTURE.md §3).
5. **Polling.** A scheduled `fetchStatus` / `listSince` worker for every unresolved intent. Its interval must be
   shorter than the provider's fastest status change, or the provider must have a change feed (§7 limit).
6. **Idempotency.** Store the provider key next to Clearline's own key in `idempotency_keys`. Never retry after the
   TTL without polling first.
7. **Asymmetric schemes.** Implement RSA and JWS/JWKS verification only with a reviewed library. Until then, such
   providers stay "unverified → poll".

## 12. Source register (copied from the research; each `[VERIFIED: research-agent 2026-11-15, <url>]`)

- **Stripe**
  - ST2 https://docs.stripe.com/reports/payout-reconciliation.md
  - ST4 https://docs.stripe.com/payouts.md
  - ST7 https://docs.stripe.com/api/payouts/object.md
  - ST11 https://docs.stripe.com/api/idempotent_requests.md
  - ST12 https://docs.stripe.com/webhooks.md
- **Modern Treasury**
  - MT1 https://docs.moderntreasury.com/platform/reference/payment-order-object.md
  - MT2 https://docs.moderntreasury.com/platform/reference/payment-orders.md
  - MT3 https://docs.moderntreasury.com/platform/reference/idempotent-requests.md
  - MT10 https://docs.moderntreasury.com/payments/docs/import-transactions-via-bai2-files.md
  - MT14 https://docs.moderntreasury.com/platform/docs/verifying-webhooks.md
- **Nium**
  - NI2 https://docs.nium.com/docs/payouts/transfer-money/remittance-lifecycle.md
  - NI4 https://docs.nium.com/docs/developers/nium-api/idempotency.md
  - NI5 https://docs.nium.com/docs/developers/notifications-and-webhooks.md
- **Thunes**
  - TH1 https://docs.thunes.com/money-transfer/v2/
- **Airwallex**
  - AW3 https://www.airwallex.com/docs/payouts/transfers/create-a-transfer/transfer-statuses.md
  - AW6 https://www.airwallex.com/docs/developer-tools/webhooks/webhooks-overview.md
- **Primer**
  - PR2 https://primer.io/docs/reconciliation/unified-settlement-report.md
  - PR6 https://primer.io/docs/api-reference/get-started/configure-webhooks.md
- **Gr4vy**
  - GR3 https://docs.gr4vy.com/guides/dashboard/reports/settlement/settlement-records.md
  - GR8 https://docs.gr4vy.com/guides/api/idempotent-requests.md
  - GR9 https://docs.gr4vy.com/guides/features/webhooks/signatures.md
- **Circle**
  - CI3 https://developers.circle.com/circle-mint/references/camt053-statements.md
- **BVNK**
  - BV1 https://docs.bvnk.com/bvnk/reconciliation/reconcile-transactions.md
  - BV5 https://docs.bvnk.com/bvnk/api-explorer/api-overview/idempotency.md
  - BV6 https://docs.bvnk.com/bvnk/get-started/create-webhook-listener.md
- **Bridge**
  - BR1 https://apidocs.bridge.xyz/platform/orchestration/transfers/transfer-states.md
  - BR4 https://apidocs.bridge.xyz/platform/additional-information/webhooks/signature.md
  - BR5 https://apidocs.bridge.xyz/api-reference/introduction/idempotence.md
- **Fireblocks**
  - FB3 https://developers.fireblocks.com/docs/validate-balances.md
  - FB6 https://developers.fireblocks.com/reference/validating-webhooks.md
- **BitGo**
  - BG1 https://developers.bitgo.com/docs/webhooks-overview.md
  - BG2 https://developers.bitgo.com/docs/webhooks-wallet.md
- **Zero Hash**
  - ZH1 https://docs.zerohash.com/docs/withdrawal-api-response-field-interpretation.md
  - ZH4 https://docs.zerohash.com/docs/reporting-suite.md
  - ZH5 https://docs.zerohash.com/reference/webhook-security.md

## 13. Invariant → test

Every row was mutation-checked. The mutant was applied in place, the rc4 suites were run, and the file was restored
from git. After the re-review follow-ups (RR-1 to RR-4): **51 of 52 mutants were killed**. Mutants added in that round: the RR-1 annotation turned off, an auto-resolve in place of the annotation, annotating non-spanning pairs, and canonicalisation turned off in the intake and in the verifier. The one survivor (the receipt taken from the pre-check) is now equivalent by construction, as explained at the end of this note. The earlier history: after the first review fixes, 45 of 47 were killed. The first-review survivors M15 (the newest-version gate) and M16 (the bundle prefix) are both killed. The re-review showed that my claim that the remaining two were equivalent was wrong:
- **Counting stored-late events as accepted.** A stored-late event can be the only reference for a regression, for example at_bank → awaiting_bank between two versions that both come before the newest. The new scripts `regress_mid` and `regress_and_recover` exercise exactly this (RR-2), and the mutant is now killed.
- **Taking the receipt from the pre-check.** The pre-check trimmed whitespace inside the signature list, but the bundle decoder rejected a padded value over 1024 characters, so the two could disagree. Both now use `canonicalHeaderValue` (RR-3). By construction, a valid canonical value always fits the decoder's limits, so the pre-check and the engine can no longer disagree. The receipt is still taken from the engine as defence in depth, and the padded case is tested.

| # | Invariant | Enforced in | Proved by (`tests/clearline/`) |
|---|---|---|---|
| 1a | Each mapping's execution equals the engine's `EVENT_TARGET`; (raw, sub) pairs are unique | `connect/descriptors.ts`, `normalize.ts:findMapping` | `rc4-connect-contract.test.ts` › "maps every raw status…", "raw (status, sub-status) pairs are unique…" |
| 1b | Terminal outcomes rank above progress | descriptors | contract › "terminal outcomes rank above…" |
| 1c | Every descriptor declares verification, dedupe, ordering, polling and idempotency | `connect/types.ts` | contract › "declares verification, dedupe…" |
| 1d | The idempotency key fits format and length and is stable; replay vs reject; TTL; no blind retry | `connect/idempotency.ts` | contract › "rc4 Connect P2…" (5 tests) |
| 2a | Raw status, sub-status, addendum, reason, version, rank, confidence and settlement claim kept verbatim | `normalize.ts:parseProviderBody/rawDetail`, `events.ts` detail spread | `rc4-connect-status.test.ts` › "every Connect event carries…" |
| 2b | A time-based inference has a distinct confidence and is never verified | descriptors (`provider_time_inferred`) | status › "a time-inferred status…" |
| 2c | An unmapped status is refused, never guessed | `normalize.ts` | status › "an unmapped raw status is refused…" |
| 2d | The original providers' events are unchanged | `events.ts` (only when `p.raw`) | status › "events of the original sandbox providers are unchanged" |
| 3a | paid → failed: execution is the latest version (`failed`); owned `EV_PROVIDER_SUCCESS_REVERSED` in every order | `normalize.ts:findOrderConflict`, `events.ts` | status › "paid → failed…", "M-2: …"; delivery › "Cobalt Wren paid → failed: the one outcome…" |
| 3b | completed → returned: owned `returned_payout` | existing | status › "completed → returned…" |
| 3c | A raw regression is never silent, in either arrival order (`EV_PROVIDER_STATUS_REGRESSED`); execution follows the latest version | `events.ts` rule, `normalize.ts:findOrderConflict` | status › "a raw regression inside the same execution claim…", "…across claims…", "M-1: …", "…learned by polling…" |
| 3c' | Two different completion claims are a contradiction, equal ranks included (`EV_PROVIDER_CLAIMS_DIFFER`) | `findOrderConflict` | status › "L-2: …" |
| 3f | Hold release needs both the partner release and the reviewer; resuming after a hold is not a regression; the reconciler re-applies suppressed statuses | descriptors (`review_cleared`, `RELEASED`), `findOrderConflict` (hold boundary), `reconciler.ts:alreadyRecorded` | `rc4-connect-review-fixes.test.ts` › M-3 (4 tests), L-1 |
| 4f | The intake receipt follows the engine; only declared headers are bundled, in canonical form; unverified scheme audited as such | `reconciler.ts:receiveConnectWebhook`, `verify.ts:canonicalHeaderValue`, `events.ts` (`signatureReason`) | review-fixes › M-4 (2 tests), L-3, L-4; `rc4-connect-rereview.test.ts` › RR-3 (3 tests) |
| 3g | A regression whose higher side was stored late is found in every arrival order | `findOrderConflict` (`ACCEPTED` includes stored-late) | rereview › RR-2 (2 × 24 orders); delivery › 5b permutations |
| 3h | A post-hold version before the hold: the regression is annotated, never auto-resolved | `normalize.ts:noteHoldBoundary`, `events.ts:record` | rereview › RR-1 (2 tests) |
| 3i | A conflict-driven execution change keeps the Accounting Bridge consistent: proposed → superseded, posted → reversed, no double count, supplier not shown paid after a reversal | bridge (unchanged), `events.ts` conflict path | rereview › RR-4 (3 tests) |
| 3d | A late older version is not a regression; side states are not progress | `findOrderConflict` (provider order, `SIDE_STATES`) | status › "an OLDER version arriving late…", "side states are not progress…" |
| 3e | Regression with evidence contradicts settlement; F1, N1 and the terminal rule unchanged; execution never sets settlement | `events.ts`, `reconciliation.ts` (existing) | status › "…bank evidence…", "F1 stays…", "N1 stays…", "execution never sets settlement…", "a terminal payout stays terminal…" |
| 4a | Hex HMAC with timestamp on the raw body; case-insensitive headers; replay window | `verify.ts` | `rc4-connect-verify.test.ts` › 4a (3 tests) |
| 4b | Multi-signature with rotation; retired and not-yet-active keys refused | `verify.ts` | verify › 4b (3 tests) |
| 4c | The existing scheme is pluggable | `verify.ts` → `webhooks.ts:verifySandboxWebhook` | verify › 4c |
| 4d | No, unknown or unimplemented scheme → unverified → poll; never applied | `verify.ts`, `adapter.ts:toWebhookVerification`, `reconciler.ts:receiveConnectWebhook` | verify › 4d (4 tests) |
| 4e | Replay is a duplicate inside the window and rejected outside it; tampering rejected; `test_` keys only; constant-time | `verify.ts`, engine dedupe | verify › 4e (6 tests) |
| 5a | Dedupe by the declared key, with the documented fallbacks; cross-path dedupe | `normalize.ts` (dedupe), engine dedupe | `rc4-connect-delivery.test.ts` › 5a (5 tests) |
| 5b | Ordering by version or rank, never by arrival: every permutation of every non-hold script ends identically | `normalize.ts` (sequence), `findOrderConflict` | delivery › 5b (12 tests) |
| 6a | Lost webhook + poll = same final state (property: 13 scripts × 25 seeds) | `actions.ts:pollProvider`, `simulator.ts`, `reconciler.ts` | delivery › "property: …" |
| 6b | Lost everything + one `list_since` pass = same final state; cursor advances | `simulator.ts:listSince`, `reconcileConnect` | delivery › "every webhook lost…", "Saltglass has no change feed…" |
| 6c | Single-poll limit documented; completed payouts stay polled | `UNRESOLVED_EXECUTION` | delivery › "documented limit…", "the reconciler polls only unresolved…" |
| 6d | `poll_provider`: engine-fetched, `provider_poll`, role-checked | `actions.ts` | delivery › "poll_provider: …" |
| 7a | Provider report is `observed / provider_report`, never verified or independent | `adapter.ts:ingestStatementRow`, `reconciliation.ts` (existing) | `rc4-connect-evidence.test.ts` › "a Connect provider's settlement report…" |
| 7b | A ledger claim and a preliminary hash are never chain evidence; only Clearline's observation verifies | `normalize.ts`, `evidence.ts` | evidence › "a provider-ledger 'done'…", "a preliminary hash…", "Clearline's observation of the PRELIMINARY hash…" |
| 7c | `independent` ⇔ classified independent, for every stored record | `evidence.ts:classifyEvidenceRecord` | evidence › "for every Connect flow…" |
| 8 | Fictional names and statuses, `test_` keys, no network; sample and `SANDBOX_PROVIDERS` unchanged | descriptors | contract › item 8 (4 tests) |
| I | rc3 sample loads with `migrations: []`; Connect workspaces round-trip with `migrations: []`; v1 API works | `serialize.ts` (unchanged) | evidence › "rc4 Connect integration" (3 tests); existing `rc3-migration-property.test.ts` unchanged |

## 14. Changes to shared engine files (all additive)

| File | Change |
|---|---|
| `types.ts` | `SandboxWebhookPayload.raw?: import("./connect/types").ProviderRawStatus` (1 field). `WorkspaceAction` member `{ type: "poll_provider"; intentId: string; version?: number }`, inserted after `ingest_webhook` |
| `actions.ts` | `dispatch` case `poll_provider`, and the new function `pollProvider` (13 lines plus a 5-line comment), placed after `ingestWebhook`; `ingestWebhookRaw` passes `signatureReason` (one line, review L-3) |
| `state.ts` | Comment only: the Connect conflict path is an exception to the transition table (RR-4) |
| `events.ts` | One line in `record()` calls `noteHoldBoundary` for Connect events (RR-1). Import of `findOrderConflict`, `noteHoldBoundary`, `rawDetail` (and `isTerminalExecution` added to the existing `state` import); one detail spread `...(p?.raw ? rawDetail(p.raw) : {})`; the conflict block (17 lines) before the `target === current` check; optional `IngestInput.signatureReason` and the audit-text choice for `unverified_scheme` (review L-3); 3 header-comment lines |
| `labels.ts` | Own block `CONNECT_CODE` (`EV_PROVIDER_STATUS_REGRESSED`, `EV_PROVIDER_SUCCESS_REVERSED`, `EV_PROVIDER_CLAIMS_DIFFER`) plus one spread line in `CODE_LABELS` |
| `index.ts` | `CONNECT_PROVIDERS` export; `export * from "./connect"` |
| `serialize.ts`, `derive.ts` | **Unchanged** |

Changes to owned files:
- **`adapters.ts`:**
  - `SubmitAck.payload` and `acknowledge` are widened to allow a provider's own body;
  - optional `ProviderAdapter.fetchStatus`;
  - Connect adapters registered in `getAdapter`;
  - `CONNECT_PROVIDERS` added.
- **`webhooks.ts`:** `WebhookVerification.reason` gains `unverified_scheme`.
- **Workspace data:** none added. Connect routes are opt-in.

## 15. Limitations

- **Sandbox only.** The fictional providers, scripts and keys protect nothing.
- **Asymmetric signatures.** RSA and JWS verification are not implemented. Those providers are always unverified and
  confirmed by polling.
- **Unverified webhooks through the raw action.** An unverified delivery sent through the raw `ingest_webhook` action
  is recorded with `signatureResult: "invalid"` (`rejected_signature`). The audit text says "unverified scheme". The
  engine has no separate "unverified" outcome. Use `receiveConnectWebhook` for the precise receipt.
- **Order dependence that remains** (§4):
  - a provider leaving a terminal state;
  - late pre-hold events during a hold;
  - a post-hold version arriving before the hold. This one raises a regression that is then annotated, not
    retracted (RR-1).
- **Hold scripts are outside the permutation guarantee** (§4, §6).
- **The conflict path moves execution outside `EXECUTION_TRANSITIONS`** (§4, RR-4).
- **`state_rank` providers** cannot express non-terminal regressions (§6).
- **A single late poll** can miss a transient status (§7).
- **Engine simulation.** `simulate_provider_event` does not drive Connect providers. Use their webhooks or
  `poll_provider`.
- **v1 verify endpoint.** `/api/clearline/test/v1` `webhooks/verify` still checks only the original scheme.

## 16. Conformance suite (rc5)

`tests/clearline/connect-conformance.test.ts` is one parameterised suite run against **every** descriptor in
`CONNECT_DESCRIPTORS` (the registry; it also checks that `CONNECT_PROVIDERS` and `getAdapter` agree). A new adapter is
acceptable only when it passes every case. Nothing in the engine is changed by the suite.

How it drives an adapter:

- **Channel.** An adapter whose declared scheme is in `IMPLEMENTED_SCHEMES` is fed signed webhooks (`ingest_webhook`).
  An adapter whose scheme is unverified (Saltglass) never has a webhook applied; it is fed by `poll_provider`, the
  documented alternative (§5, §7).
- **Scenarios.** Scripts are derived from the adapter's own mapping table (accepted → in transit → completed, then
  failed, returned, a regression back to in transit, or an unlisted status). They are registered in `CONNECT_SCRIPTS`
  for that test file only and removed afterwards. Intent inputs are derived from the adapter's route.
- **Not applicable.** Where a case cannot apply, the documented alternative is asserted explicitly. There is no
  `test.skip`.

| # | Case | Asserted (alternative where it cannot apply) |
|---|---|---|
| 1 | Duplicate deliveries | Second copy is `duplicate_ignored`, recorded once, state unchanged; same through `receiveConnectWebhook`; the reconciler reports `unchanged` |
| 2 | Out-of-order delivery | Every arrival order of the derived scripts ends as in-order delivery (`outcomeOf`). Regression scripts only for `object_version` adapters; `state_rank` adapters assert the latest version is never overtaken |
| 3 | Replay | Valid signature outside the tolerance (stale or future) → `rejected_signature`, not applied; at the edge it applies. Unverified: never applied, the intake polls |
| 4 | Invalid signature | One changed byte, whitespace or key-order re-serialisation of the same JSON → rejected (raw bytes); another scheme, another provider's keys, or a non-bundle header → rejected. Unverified: a forged "completed" body is never applied or recorded; the poll's own answer is applied |
| 5 | Contradictions | completed → failed raises an owned `EV_PROVIDER_SUCCESS_REVERSED`; with independent evidence first, settlement goes `verified` → `contradicted`. completed → returned raises `returned_payout`. No return status: asserted absent |
| 6 | Timeouts | `simulate_provider_event` timeout and a no-answer `fetchStatus` change no payout state; the payout stays in `unresolvedConnectIntents` and a later poll applies; bad poll versions are typed errors |
| 7 | Idempotency collisions | One deterministic provider key per instruction, echoed by every version; same key + different request → `rejected_body_mismatch` (and the engine's `idempotency_conflict`); same request → replay, or for reject-duplicate providers `rejected_duplicate` + `poll_status_first`; a second `submit_instruction` is refused |
| 8 | Malformed payloads | Invalid JSON, wrong types, missing ids, unknown currency, bad hash, bodies over 16 KB, non-string bodies and non-string headers: typed error or recorded non-application, never an escaping throw |
| 9 | Status regressions | completed → in_transit raises an owned `EV_PROVIDER_STATUS_REGRESSED` naming the regressing event, in every order. `state_rank`: execution never moves back (§6 limit) |
| 10 | Unknown statuses | An unlisted status (and, where the payload has one, an unlisted sub-status) is refused with the raw value verbatim in the typed error, never mapped, nothing applied; the reconciler reports `error`. Mapped statuses are kept verbatim in `detail.rawStatus` |
| 11 | Partial failures | A tampered, a malformed and an unlisted event in the middle of a sequence leave the outcome equal to the clean sequence; a reconciler batch with one bad payout still applies the others |
| 12 | Provider confidence | Provider events alone never set settlement off `none`; every event is `provider_claim`; no record is independent. A preliminary hash (or a hash on any non-final status) never reaches `tx_hash`, a chain observation or an allocation |

**Defect found and fixed (rc5).**
- **Defect.** `reconcileConnect` called `adapter.fetchStatus` outside any per-payout error boundary (`reconciler.ts` `pollOne`). A provider timeout raised as a thrown error therefore aborted the whole pass, contrary to §7.
- **Fix.** `pollOne` now catches the throw and reports outcome `error` (`precondition_failed`, "provider unavailable") for that payout. The payout's state is unchanged, and the other payouts are still polled.
- **Regression test.** The case "a poll that THROWS (provider timeout) for one payout…" failed before the fix (recorded as `it.fails` in `2c35478`) and passes after it, for each adapter.

Run it:

```
npx vitest run tests/clearline/connect-conformance.test.ts
npx eslint -c .github/lint/eslint.config.mjs tests/clearline/connect-conformance.test.ts
```
