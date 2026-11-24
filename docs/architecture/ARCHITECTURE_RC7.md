# Clearline rc7 — architecture: real files, any provider

Labels: **[VERIFIED]** read in the code or seen in a recorded run; **[ASSUMPTION]** reasoned, not tested; **[GUESS]** an estimate.

- **What exists:** built and tested locally only. Nothing is hosted (founder decision 4 was not given, so it is treated as "no paid hosting"; see `docs/plan/RC7_PLAN.md`).
- **Read-only on money:** no code holds, sends, converts or settles money or tokens. Chain readers allow read methods only.
- **What carries over:** `ARCHITECTURE_RC6.md` and `ARCHITECTURE_RC5.md` still apply. rc7 adds a way to bring a merchant's **own files** in, check them against chain data, run reconciliation on a schedule, and export drafts.
- **Reviews were not independent.** Every rc7 PR was written and reviewed by agents of one session.

## The pipeline

```
 file (CSV, TSV, XLSX, JSON, MT940, camt.053)
   │  upload: encrypted at rest when CLEARLINE_UPLOAD_KEY is set; SHA-256 of the file; same file twice is refused
   ▼
 ingest (pure)  src/lib/clearline/ingest/      sniff → decode → table or bank statement → exact decimals and dates
   ▼
 map (pure)     src/lib/clearline/mapping/     field catalogue → header suggestions (never confirmed) → person confirms
   │                                           → applyMapping (BigInt amounts; token decimals from network + contract)
   ▼
 validate       src/server/uploads.ts          row report: reason codes and hashes only, no cell values
   ▼
 confirm        src/server/uploads.ts          bound to the file's and the report's SHA-256;
   │                                           a bank statement needs an Approver who did not upload it
   ▼
 normalise      src/server/normalise.ts        re-validates; writes rc6 tables with provenance (upload, row, template,
   │                                           version, uploader); idempotent; a conflict writes nothing
   ▼
 chain verify   src/server/chain-verify.ts     reads issued deposit addresses and claimed tx hashes; stores chain facts
   │                                           (source chain_client, with evidence) or an unavailable read (chain_reads)
   ▼
 reconcile      src/lib/clearline/merchant/    PURE ENGINE (unchanged in shape): match → bridge → journals
   ▼
 runs / jobs    src/server/runs.ts, jobs.ts    each run recorded; idempotent; PostgreSQL queue; daily schedule
   ▼
 exports        src/server/exports.ts          draft Xero / QuickBooks journal files and a month-end ZIP; nothing posted
```

### Step notes

- **Upload [VERIFIED].** Files go under `CLEARLINE_UPLOAD_DIR` (default `.data/uploads`, git-ignored), one folder per organisation, with random storage keys. With `CLEARLINE_UPLOAD_KEY` (32 bytes, base64) each file is encrypted with AES-256-GCM. In production (`NODE_ENV=production`) an upload without a key is refused. Limits: 20 MiB, 100,000 rows, 200 columns, 10,000 characters per cell.
- **Ingest [VERIFIED].** The file kind comes from the content, not the name. Encodings: UTF-8 (with or without BOM), UTF-16 with a BOM, or windows-1252 with a warning. Amounts are exact decimals; more decimals than the currency allows is an error, never rounded. Ambiguous date order or decimal separator is asked, never guessed. Total and subtotal rows are left out with a warning. camt.053 with a DOCTYPE or ENTITY is refused (XXE).
- **Map [VERIFIED].** One catalogue per file type: provider export, settlement report (per-payment lines or batch totals), orders/invoices, bank statement (CSV/XLSX only), ledger invoices. MT940 and camt.053 need no mapping. Templates are versioned and immutable, and are tied to the merchant's own provider by a trigger.
- **Confirm [VERIFIED].** Finance or Payment Operations confirm provider, settlement and order files. A bank statement needs the `confirm_import` permission and a different person from the uploader (server check, trigger and CHECK).
- **Normalise [VERIFIED].** Bank lines from files get source `file_import`: imported, not bank-authenticated (founder decision 2). A tx hash in a provider file becomes a `provider_export` claim with 0 confirmations, and a trigger refuses ever finalising it. Quote terms a file lacks are stored as NULL (migration 0023 allows this for uploaded rows only).
- **Chain verify [VERIFIED].** Live organisations only; sample organisations keep their seeded facts. Client choice: real readers with `CLEARLINE_CHAIN_LIVE=1` (refused under tests and CI); a recording with `CLEARLINE_CHAIN_RECORDING`; otherwise every read is unavailable. A fact is stored as final only after a second read returns the same block (and block hash on Ethereum). Only final facts are cached.
- **Reconcile [VERIFIED].** `loadReconcileInput` gives the engine chain facts only, never provider claims. Unavailable reads reach the engine as `chainUnavailable` → rule `M1.chain.unavailable`.
- **Runs and jobs [VERIFIED].** Each run stores trigger, rule-set version (a hash of active rule ids), policy revision, input hash, counts, status and an error **code** only. Same input, rules and policy → `no_change`, nothing written. Approved or closed items are never changed by a re-run; a "rule change would differ" notice is recorded instead. Jobs are claimed with `FOR UPDATE SKIP LOCKED`; a lost job is taken again after 15 minutes. The worker is `npm run jobs:worker`.
- **Exports [VERIFIED].** Finance, an Approver or an Admin only (rc8 founder decision 3; also the rc6 journal file and the evidence pack). Draft journals come only from `pending_sign_off` proposals, each must balance, and every row says DRAFT. See `docs/POSTING_RULES.md`.

## Where the pure engine boundary is

| Pure (no database, disk, network, clock or randomness) | Has side effects |
|---|---|
| `src/lib/clearline/ingest/` (parsers, decimals, dates, hashes) | `src/server/uploads.ts`, `normalise.ts` (database, storage) |
| `src/lib/clearline/mapping/` (catalogue, suggest, apply) | `src/server/mapping-templates.ts` |
| `src/lib/clearline/merchant/` `match.ts`, `bridge.ts`, `reconcile.ts`, `journal.ts`, `claims.ts`, `indexes.ts` | `src/lib/clearline/merchant/chain/` (readers; network through an injected transport) and `src/server/chain-verify.ts` |
| `src/lib/clearline/synthetic/` (seeded PRNG, no `Math.random`, no clock) | `src/server/runs.ts`, `jobs.ts`, `exports.ts`, `ledger.ts` |
| `src/lib/clearline/exports/journal-drafts.ts` | `scripts/` (CLI entry points) |

- **[VERIFIED]** The engine still takes one `ReconcileInput` and returns decisions and journal proposals. rc7 added rules to it (below) and made lookups use maps built once per run (#150: 10,000 payments 16.0 s → 1.3 s locally, byte-identical output, 35.8 MB compared).
- **[VERIFIED]** Nothing in the code keys on the three case fixtures (`docs/plan/RC7_PLAN.md`); they remain acceptance tests.
- **rc7 engine rules:** `M1.chain.unavailable`, `M3.quote.terms_unknown`, `M3.provider.transfer_ambiguous`, `J.settlement.refund_netted` (plus `J.writeoff.on_approval` reworked for Document A). `src/lib/clearline/merchant/rules.ts` now lists 46 rule ids [VERIFIED by count]. See `docs/MATCHING_RULES.md`.

## Tables per migration (0015–0028)

| Migration | Adds or changes | Notes |
|---|---|---|
| 0015 | `merchant_policy.tolerance_combine` | `larger` (rc7 default) or `smaller`; only policies still on the rc6 default were moved, one revision up |
| 0016 | `organizations.data_mode`; `mapping_templates` | `sample` or `live`; live shows "Your data" |
| 0017 | template triggers | versions immutable; forced RLS; only the merchant's own provider |
| 0018 | `uploads`, `upload_rows`, `merchant_data_settings` | `retention_days` default 90, between 1 and 3650; `uploads.delete_after` |
| 0019 | upload triggers | status changes step by step; no delete; second person for bank statements |
| 0020 | provenance columns on `bank_lines`, `chain_transfers`, `invoices`, `merchant_quotes`, `payment_links` | `upload_id`, `source_row`, `mapping_template_id`/`_version`, `uploaded_by`; sources `file_import` and `provider_export` |
| 0021 | normalise triggers | provenance kept; upload targets checked (`check_upload_target`, per row) |
| 0022 | USDT on Ethereum in `token_config`; `source` in the `chain_transfers` key; evidence columns; `chain_reads` | evidence required for `chain_client` rows; `chain_reads` append-only with RLS |
| 0023 | quote terms nullable | only for uploaded rows (CHECK) |
| 0024 | `reconciliation_runs`, `rule_change_notices` | runs append-only |
| 0025 | `jobs`, `reconciliation_schedules` | (org, entity, dedupe key) unique |
| 0026 | `ledger_invoices` | reference data for month-end; never an engine input |
| 0027 | `notifications`, `notification_reads`, `rule_change_acks` | raised only by triggers; app login cannot insert, change or delete one |
| 0028 | `uploads.json_list` | which list of a multi-list JSON file holds the records; its own immutability trigger |

**[VERIFIED]** Migrations 0022–0028 were written by hand. The journal was updated, but the drizzle-kit snapshots were not regenerated (see the threat model's residual risks).

## Connections

- **Runtime login** (`DATABASE_URL`): the app and reconciliation, under forced row-level security.
- **Owner login** (`DATABASE_OWNER_URL`): migrations, the admin CLI, retention purge, the job queue and scheduler. Reconciliation started by a job still runs on the runtime login as the member who set the schedule [VERIFIED in `src/server/jobs.ts`].
