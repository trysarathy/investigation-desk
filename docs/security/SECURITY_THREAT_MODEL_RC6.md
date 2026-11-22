# Clearline rc6 — security threat model

Test mode · illustrative data.

- **Scope:** this extends `SECURITY_THREAT_MODEL_RC5.md`, which still applies, to merchant reconciliation.
- **No claims:** this is not a certification, audit or legal opinion. No independent assessment has been made, and no compliance or screening decision is made by the software.

| Threat | Control (implemented) | Negative test | Residual risk |
|---|---|---|---|
| Provider reads merchant data without consent | provider sees aggregates only (SECURITY DEFINER function, provider roles, own merchants); rows only with the merchant's explicit `full` grant, read-only, revocable | `merchant-schema.test.ts`, `merchant-security.test.ts`, provider e2e | aggregates reveal volume and counts |
| Provider places a person with authority in a merchant | provider invitations limited to Viewer (service, form and DB CHECK, migration 0014) | `provider-console.test.ts` (admin, approver, finance and payment_ops refused, including by direct insert) | an operator still runs the CLI acceptance |
| Cross-merchant access | forced RLS on every merchant table; composite keys | merchant isolation tests, including a forced foreign context | — |
| Self-approval / stale approval of write-offs and resolutions | rc5 two-person flow; payload hash; DB triggers; a write-off is approved only through an approved request **for that write-off** | service and DB refusal tests; another write-off's approval cannot be reused | the owner (DBA) can alter triggers |
| Forged evidence | chain facts immutable except confirmations/finality; bank lines immutable; differences append-only; provenance columns; imported lines labelled and not verified by default | immutability tests; imported-line tests (flag off and on) | a Finance user and an Approver acting together could confirm a fabricated CSV (rc5 open decision) |
| Auto-matching made more permissive | policy edits are Admin-only (matrix, service and DB); tolerance defaults per spec; amount never decides | policy tests; property "amount-only coincidence never closes" | the Case 3 fixture policy (band 91.83 AED) is a labelled [ASSUMPTION] |
| Wallet addresses as personal data | addresses stored as facts only, never judged; RLS-scoped to the merchant; not in public demos except obviously fictional ones; reconstruction data stays local (`reconstruction-data/` git-ignored, purge command) | reconstruction refusal tests (CI; inside the repo but outside the ignored folder) | retention periods are not yet set (founder or counsel) |
| Provider data handling (sprint) | CLI local-only, no network, no DB, no upload; output never contains absolute paths; runbook `RECONSTRUCTION_DATA_HANDLING.md` | `reconstruct.test.ts` | depends on operator discipline on a laptop |
| Live chain-data mode | `LiveChainClient` only with `CLEARLINE_CHAIN_LIVE=1`; off by default; refuses in tests and CI; never called in tests (spy) | adapter tests | the live mode is a stub; enabling it needs approval (an RPC provider may be a paid service) |
| Malicious exports and CSV | Zod validation; row rejection with reasons; formula escaping in every CSV output; size caps | adapter and conformance tests | — |
| Sign-in rate limiting | per-account limit (rc5) | rc5 tests | without a trusted proxy header there is no per-IP limit |
| Soft 404 on pages | APIs return real 403/404 | tests check both | refused pages show "Not found" with HTTP 200 (inherited streaming boundary) |

## Retention (proposed; not enforced)
- **Match records, differences, approvals and audit:** the life of the merchant relationship.
- **Raw provider exports:** not stored by Clearline (parsed in memory).
- **Reconstruction working copies:** deleted at the end of the sprint, or on request.

All periods need the founder's or counsel's decision; see `LEGAL_QUESTIONS.md`.
