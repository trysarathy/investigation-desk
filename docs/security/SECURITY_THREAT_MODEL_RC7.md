# Clearline rc7 — security threat model: real data

Labels: **[VERIFIED]** read in the code or seen in a test run; **[ASSUMPTION]** reasoned, not tested; **[GUESS]** an estimate.

- **Scope:** this extends `SECURITY_THREAT_MODEL_RC6.md` and `SECURITY_THREAT_MODEL_RC5.md`, which still apply. rc7 is the first release built to hold a merchant's **real** files.
- **No claims:** this is not a certification, audit or legal opinion. No independent assessment was made. Every rc7 review was done by agents of the same session, so **reviews were not independent**.
- **Not hosted:** everything runs locally (decision 4 not given). Hosting would add threats not covered here (see the runbook's Phase 4 proposal).

## Real-data handling

| Topic | Control | Evidence |
|---|---|---|
| Files at rest | Stored under `CLEARLINE_UPLOAD_DIR` (default `.data/uploads`), one folder per organisation, random storage keys. **AES-256-GCM** when `CLEARLINE_UPLOAD_KEY` (32 random bytes, base64) is set. With `NODE_ENV=production` and no key, uploads are refused. A malformed key is an error and is never echoed. | [VERIFIED] `src/server/storage/` |
| Files not in git | `.data/` and `synthetic-data/` are git-ignored; `.env` and `.env.*` are ignored except `.env.example`. | [VERIFIED] `.gitignore` |
| Files not in CI | CI uses generated synthetic files and recorded, fictional chain and ledger responses only. Every chain test fails if real `fetch` is called. | [VERIFIED] PR #146, #149, #154 |
| Files not in logs | Upload rows hold only reason codes and hashes, no cell values. A distinctive marker value is tested never to appear in logs, audit or the upload tables. Runs store an error *code* only (column restricted to a code format). The worker and `safeLog` print ids, statuses, codes and counts only. | [VERIFIED] PR #144, #153 tests |
| Content hashes | SHA-256 of each file (the same file is refused twice) and a stable hash per row (a row repeated across uploads is detected). Confirmation is bound to the file's and the validation report's SHA-256. | [VERIFIED] `src/lib/clearline/ingest/hash.ts`, `src/server/uploads.ts` |
| Malicious files | Kind decided from content; size, row, column and cell limits; camt.053 with DOCTYPE or ENTITY refused (XXE test); JSON read by a strict parser; formula characters neutralised in every CSV Clearline writes. PDFs and old `.xls` are refused. | [VERIFIED] `src/lib/clearline/ingest/` |
| Forged statements | A bank statement is confirmed only by an active Approver who did not upload it (server, trigger and CHECK). Its lines stay "imported, not bank-authenticated" and never verify settlement while the flag is off (decision 2). | [VERIFIED] PR #144, #148 (preparer gets 403) |
| Provider claims | A tx hash in a provider file is a `provider_export` claim with 0 confirmations; a trigger refuses finalising it. Only chain facts reach the engine. | [VERIFIED] PR #145, #151 |

## Retention and deletion

- **Retention (founder decision 6) [VERIFIED].** Default 90 days, set per merchant by an Admin (1 to 3650 days). `npm run control:admin -- purge-uploads` deletes every upload past its `delete_after`: the stored file, its row report, and every row derived **only** from it. A row another kept upload still refers to is kept.
- **How purge lifts immutability [VERIFIED].** `bank_lines` (immutable) and `differences` (append-only) refuse deletes to everyone. Purge runs on the **owner** connection. Inside one transaction it disables exactly those two triggers, deletes, and re-enables them before commit; the transaction holds an exclusive lock on each table. The runtime role cannot do this.
- **What is kept [VERIFIED].** Approvals and audit events are never deleted. They hold ids and amounts of decisions, never file contents. The purge writes an audit event with counts only.
- **Not automatic [VERIFIED].** Purge is a CLI command. The job worker does not run it. An operator must run it on a schedule.
- **Per-merchant deletion [VERIFIED, PR #155].** `npm run control:admin -- delete-merchant <slug>` prints what would be deleted. With `--confirm <slug>` it deletes, in one transaction, every row in every table with an `org_id` or `merchant_org_id` column (list read from `information_schema`), the organisation, and members who belong to no other organisation; then the uploaded files and the storage folder. Provider organisations are refused. A test checks no row mentions the deleted organisation afterwards. **Gap:** the provider's own audit rows that mention the merchant are kept.

## Chain APIs

- **[VERIFIED]** Read-only readers: TronGrid (TRC-20) and Ethereum JSON-RPC (ERC-20; allowed methods: receipt, block, blockNumber, getLogs). No signing method exists.
- **Free tiers [ASSUMPTION].** Rate limits are assumed: TronGrid 10/s, Ethereum RPC 5/s.
- **Keys [VERIFIED].** Read from environment variables `TRONGRID_API_KEY` and `ETHEREUM_RPC_URL` (which may embed a key). They belong in `.env.local` only, set by the founder. They are redacted from every error and evidence record (only the host is kept); this is tested against four leak paths.
- **Gate [VERIFIED].** Live reads need `CLEARLINE_CHAIN_LIVE=1` and are refused under test runners and CI.
- **`npm run chain:smoke` has never been run against mainnet [VERIFIED].** The build container cannot reach those hosts. Only its failure paths were run.

## Residual risks

| Risk | Detail | Status |
|---|---|---|
| `CLEARLINE_CHAIN_RECORDING` honoured under `next start` | An operator who can set server environment variables could feed recorded chain facts into a live organisation. Mitigation: each such fact's evidence says `recording`, and recordings must carry the "Test mode · illustrative data" label. This is operator-level trust. | open (PR #151) |
| Owner connection for queue and scheduler | The job queue and scheduler use the owner database connection and see every organisation. Reconciliation itself runs on the runtime connection under RLS, as the member who set the schedule, re-checked each run. | open (PR #153) |
| exceljs dependency advisory | `npm audit --omit=dev` reports a moderate advisory in exceljs's dependency `uuid` (v3/v5/v6 buffer handling). Development tooling (drizzle-kit/esbuild) has 4 other moderate advisories. | open (PR #141) |
| Orphan files | If the database transaction fails after the file is written, the file can remain in storage. | open (PR #144) |
| Sessions not per organisation | Signing a member out from one organisation's Admin page ends their sessions in every organisation. | open (PR #155) |
| Hand-written migrations | 0022–0028 were written by hand; the journal is updated but the drizzle-kit snapshots were not regenerated. A later `drizzle-kit generate` may produce a confusing diff. | open |
| "Payment link ID" mapping bug | Mapping a reference column as "Payment link ID" when the rows lack payment-link fields makes reconciliation fail with a generic internal error. Nothing is decided, so no wrong match results, but the message does not help the user. | open (blind test, PR #156) |
| Imported statements | A Finance user and an Approver acting together could still confirm a fabricated statement (rc5 open decision). With the flag off it cannot verify settlement. | carried from rc6 |
| Upload limits doc | `UPLOADS_AND_MALWARE_SCANNING.md` describes the rc5 1 MiB CSV path. rc7 uploads allow 20 MiB and more formats, with the controls above. No malware scanning is done; files are parsed, never executed or served back [ASSUMPTION: "never served back" was not re-checked for every rc7 route]. | documentation gap |

## Personal data

- **[VERIFIED]** Wallet addresses, order ids and bank references from real files are stored as facts under forced RLS for that merchant only. Nothing is sent to a third party except the chain reads (addresses and tx hashes go to the chain API host when live mode is on).
- **[ASSUMPTION]** Whether 90 days is the right retention for each jurisdiction is a counsel question (`docs/LEGAL_QUESTIONS.md`, unanswered).
