# Records of processing (ROPA) — Clearline v1

Status: **working record, not legal advice, not a compliance claim.** Each statement is labelled:
[VERIFIED] (checked in this repository at the commit that added this file), [ASSUMPTION] (a decision or expectation
the founder or a lawyer must confirm) or [GUESS] (not checked). Open legal questions are listed in
`docs/legal/*_DRAFT.md` and `docs/LEGAL_QUESTIONS.md`.

## 1. Who is who

| Role | Who | Note |
|---|---|---|
| Controller of merchant data | The merchant (or the payment provider that serves it) | [ASSUMPTION] Clearline acts on the merchant's instructions; to be confirmed in the DPA (`docs/legal/DPA_DRAFT.md`). |
| Processor / data intermediary | Clearline | [ASSUMPTION] For the reconciliation data. Under Singapore's PDPA this is a "data intermediary"; under the UAE PDPL a "processor". |
| Controller of account data | Clearline | [ASSUMPTION] For the sign-in, security and audit records it keeps to run the service. |

## 2. Processing activities

| # | Activity | Purpose | Data subjects | Categories of personal data | Where (tables / storage) |
|---|---|---|---|---|---|
| P1 | User accounts and sign-in | Let a merchant's or provider's staff sign in securely | Merchant and provider staff; invitees | Name, work e-mail, password hash, second-factor secret and recovery codes, passkey public keys, session times, IP address and browser user agent, last sign-in | `users`, `accounts`, `sessions`, `two_factors`, `passkeys`, `auth_tokens`, `verifications`, `org_invitations`, `merchant_invitations` [VERIFIED] |
| P2 | Abuse protection | Limit password guessing and code guessing | Anyone who tries to sign in | SHA-256 of e-mail (sign-in failures); HMAC (server secret) of e-mail, user id or IP bucket (rate limits) — no plain e-mail or IP | `login_failures`, `auth_rate_events` (rows older than a day pruned) [VERIFIED] |
| P3 | Reconciliation | Match each payment across chain, provider record, invoice and bank; show differences and exceptions | The merchant's customers (payers), indirectly | Order and invoice references, ledger contact names, amounts, wallet addresses, transaction hashes, bank statement descriptions (may hold payer names), provider payment ids | `invoices`, `ledger_invoices`, `merchant_quotes`, `payment_links`, `chain_transfers`, `provider_payment_records`, `settlement_*`, `bank_lines`, `match_records`, `differences`, `recon_exceptions`, notes [VERIFIED] |
| P4 | Uploaded files | Keep the merchant's source files while they are reviewed and normalised | As P3 | The whole file (CSV, XLSX, JSON) | Upload storage, encrypted with AES-256-GCM when `CLEARLINE_UPLOAD_KEY` is set (production refuses without it) [VERIFIED]; `uploads`, `upload_rows` (hashes and reason codes only) [VERIFIED] |
| P5 | Chain reads | Confirm on-chain transfers (read only) | Payers | Wallet addresses and transaction hashes sent to the chain data host | `chain_reads` (monthly partitions), `chain_transfers` [VERIFIED] |
| P6 | Approvals and audit | Maker-checker (the preparer never approves) and an audit trail | Staff | User ids, actions, timestamps, summaries (may include e-mail), approval reasons | `approval_requests`, `approval_decisions`, `audit_events` (append-only) [VERIFIED] |
| P7 | Notifications and e-mail | Tell staff about runs, exceptions, approvals; send invitations and verification links | Staff, invitees | E-mail address, message text | `notifications`, `notification_reads`; e-mail: local stand-in only (`email_outbox` table or `CLEARLINE_EMAIL_OUTBOX_DIR`); **no e-mail provider is connected** [VERIFIED] |
| P8 | Exports, deletion, retention | Give the merchant its data; erase it; keep only what retention requires | All of the above | As above | `merchant_deletions`, `retained_records`, `retention_runs` (owner only) [VERIFIED] |

## 3. Recipients, processors and transfers

| Recipient | What it receives | Status |
|---|---|---|
| Chain data hosts (TronGrid; an Ethereum JSON-RPC provider set in `ETHEREUM_RPC_URL`) | Wallet addresses and transaction hashes, only when live chain reads are on | [VERIFIED] code path exists; [ASSUMPTION] vendor, contract and location not decided. Transfers outside Singapore/UAE likely [GUESS]. |
| Hosting provider | Everything | [VERIFIED] not hosted yet (local runs only); [ASSUMPTION] region and vendor to be chosen; transfer assessment required then. |
| E-mail provider | Recipient address and message | [VERIFIED] none: local stand-in only. |
| AI model provider | Nothing from Clearline Control | [VERIFIED] the merchant reconciliation code does not call an AI API. The older investigation-desk explanation feature can call the Anthropic API; company rule: real data never goes into AI prompts. |
| The merchant's payment provider | Aggregates (or full data if the merchant grants it) | [VERIFIED] `provider_grants` scope `aggregates` / `full`, granted by the merchant. |

No sale of data, no advertising, no profiling. [ASSUMPTION]

## 4. Retention

| Data | Kept for | Mechanism |
|---|---|---|
| Uploaded files, their validation rows, data derived only from them | 90 days by default; each merchant's Admin can set 1–3650 days (applies to new uploads) | `npm run control:admin -- retention` / `npm run jobs:retention` (src/server/privacy/retention.ts) [VERIFIED] |
| Stored files no upload names | 60 minutes | same job (orphan sweep) [VERIFIED] |
| Audit events and approvals | 7 years from the event | same job; approvals still named by a write-off are kept [VERIFIED code] / [ASSUMPTION — period to be confirmed by a lawyer] |
| Sign-in failures, rate-limit counters | about a day | pruned on use [VERIFIED] |
| Sessions | until expiry or sign-out | [VERIFIED] |
| Other reconciliation records not derived from an upload (seeded or chain-observed) | until the merchant is deleted | [ASSUMPTION] no separate period decided |
| A deleted merchant's audit and approvals | 7 years from each event, minimal form only | `retained_records` (below) |

Every retention pass, dry runs included, is recorded in `retention_runs` (counts only), and each organisation's audit
log records its own purge. `--dry-run` counts and changes nothing. [VERIFIED `tests/control/privacy-retention.test.ts`]

## 5. Export (access and portability)

`npm run control:admin -- export-merchant <slug> --out <file>` (owner only) writes every row of every table that holds
the merchant's data (the table list is read from the database, so new tables are included), its members' profiles, its
audit log and approvals, and every uploaded file, as a tar archive encrypted with AES-256-GCM (key from
`CLEARLINE_EXPORT_PASSPHRASE` via scrypt) and signed with Ed25519 (`CLEARLINE_EXPORT_SIGNING_KEY`). Secrets (password
hashes, authenticator secrets, session and token digests) are excluded; `manifest.json` lists what is excluded.
`open-export` verifies against a trusted public key before decrypting. The export is audited. [VERIFIED
`tests/control/privacy-export.test.ts`, `tests/server/privacy-archive.test.ts`]

[ASSUMPTION] The passphrase reaches the merchant by a separate channel; Clearline's public key is published where the
merchant can obtain it independently. Neither channel exists yet.

## 6. Deletion (erasure)

`npm run control:admin -- delete-merchant <slug> --confirm <slug>` (owner only) removes, in one transaction, every row
of every table with the merchant's `org_id` / `merchant_org_id` (partitions through their parent), the organisation, its
members who belong nowhere else (never a platform operator) and everything held about them as people (accounts,
sessions, authenticators, passkeys, tokens, verifications, sign-in and rate-limit counters, outbox mail), any other
organisation's audit event that names it, then its files and outbox-folder messages, and scans every table, the
storage and the outbox folder for residue. [VERIFIED `tests/control/privacy-erasure.test.ts`: a merchant seeded into
every table; afterwards no table holds its id, slug, name, members' ids, e-mails, e-mail hashes, rate-limit HMACs or
names; a table added later fails the test until it is seeded.]

### Retained after deletion (minimal form)

Kept in `retained_records` under a receipt in `merchant_deletions`, for 7 years from each event [ASSUMPTION]:

- audit event: source, action and entity-type codes, time, numbers and yes/no facts of its details (keys without
  digits), entity and actor as keyed digests;
- approval request: subject kind, version, status, payload SHA-256, requester digest, times;
- approval decision: decision, decider digest, payload SHA-256, reason digest, time.

Not kept: names, e-mails, summaries or any free text, order, invoice or wallet references, the organisation id, user ids.
Digests are HMAC-SHA256 keyed with the organisation id, so only someone holding that id (the merchant, from its export)
can find its records; preparer-versus-approver separation stays checkable. The receipt holds
sha256('clearline-org|' + org id) and counts. A database trigger refuses any change, and any deletion before
`retain_until`; no application role can read these tables. [VERIFIED]

## 7. Security measures (summary)

[VERIFIED unless marked] Forced row-level security per organisation on every tenant table; the web app's login owns
nothing and cannot bypass RLS; a separate limited login for the job queue; MFA required for Admins and Approvers;
uploads encrypted at rest when the key is set (production refuses without it); append-only audit, approvals and
evidence tables; logs hold ids, codes and counts only; maker-checker enforced in the database. Not yet in place:
hosting, backups and their encryption, a breach-response runbook, independent penetration test [ASSUMPTION — to do].

## 8. Open items

1. Confirm the 7-year period for audit and approvals per jurisdiction (Singapore, UAE, free zones).
2. Choose hosting region and chain-data vendors; assess cross-border transfers.
3. Decide whether a deleted merchant's receipt should hold the organisation digest at all (it lets a merchant prove its
   deletion, and lets us find its retained records on a lawful request).
4. Decide retention for reconciliation records that do not come from uploads.
5. Backups: deletion does not reach backups; define how long backups live and how deletions are re-applied on restore.
