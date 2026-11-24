# Deployment runbook (rc7: real files)

Labels: **[VERIFIED]** read in the code or `package.json`, or seen in a recorded run; **[ASSUMPTION]** reasoned, not tested; **[GUESS]** an estimate.

This extends `DEPLOYMENT_RUNBOOK_RC6.md` and `DEPLOYMENT_RUNBOOK_RC5.md`; their steps still apply. **This runbook was not re-run end to end for rc7.** Each command below was checked against `package.json` and the scripts it calls, and the steps follow the rc6 runbook, which was run on a fresh database. Reviews were not independent.

## Environments

| Environment | Status |
|---|---|
| **LOCAL** | works (this runbook) |
| **PUBLIC DEMO** | unchanged from rc6 (`/clearline/cases`, no database) |
| **PRIVATE STAGING / PRODUCTION** | **not deployed.** Hosting is founder decision 4, which was not given; rc7 treats it as (a) no paid hosting. See "Phase 4 proposal" below. |

## Local from scratch

```bash
# 1. Database and roles (any local PostgreSQL 16)
export PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres
scripts/db/setup-local.sh clearline_rc7 '<owner-password>' '<runtime-password>' '<jobs-password>'
#   (rc8: the jobs password may come from CLEARLINE_JOBS_PASSWORD instead; it is required and never printed)

# 2. Migrations 0000–0029 and later (as the OWNER; drizzle.config.ts reads DATABASE_OWNER_URL)
export DATABASE_OWNER_URL=postgres://clearline_owner:<owner-password>@127.0.0.1:54329/clearline_rc7
npm run db:migrate

# 3. Optional: the rc6 fictional provider and merchants (password from the environment, never an argument)
DATABASE_URL=$DATABASE_OWNER_URL CLEARLINE_SEED_PASSWORD='<fictional, ≥ 12 chars>' \
  npm run control:admin -- seed-merchant-cases

# 4. Build and run the pilot (as the RUNTIME login)
export CLEARLINE_CONTROL_PILOT=1 CLEARLINE_ORIGIN=http://127.0.0.1:3000 \
       BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
       DATABASE_URL=postgres://clearline_runtime:<runtime-password>@127.0.0.1:54329/clearline_rc7 \
       CLEARLINE_UPLOAD_DIR=.data/uploads \
       CLEARLINE_UPLOAD_KEY="$(openssl rand -base64 32)"
npx next build && npx next start -H 127.0.0.1 -p 3000
# open http://127.0.0.1:3000/control/merchant/uploads

# 5. The job worker (daily schedules and rule-change re-runs), in a second terminal
DATABASE_URL=<runtime login> DATABASE_JOBS_URL=postgres://clearline_jobs:<jobs-password>@127.0.0.1:54329/clearline_rc7 \
  npm run jobs:worker -- --interval-seconds 60
#   --once runs one pass and exits. rc8: the worker refuses to start unless DATABASE_JOBS_URL is the limited
#   clearline_jobs login (never the owner or the runtime login); it prints JOBS_LOGIN_REFUSED with reason codes.
```

- **Keep the upload key.** Files encrypted with one key cannot be read with another. Store it outside the repository (for example in `.env.local`, which is git-ignored). Generating a new key on each start, as the one-liner above does, makes earlier files unreadable; use it for a throwaway try only.
- `CLEARLINE_CONTROL_PILOT` is read at build time; the rest at run time (as in rc6).

## Environment variables (names only; never commit values)

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | runtime login (app, reconciliation under RLS) | — |
| `DATABASE_OWNER_URL` | owner login (migrations, admin CLI, retention purge) | — |
| `DATABASE_JOBS_URL` | rc8: the worker's queue login `clearline_jobs` (migration 0029: read/write `jobs`, read `reconciliation_schedules`, two narrow functions; no merchant tables, no BYPASSRLS, no DDL). Reconciliation still runs on `DATABASE_URL` under RLS | — |
| `CLEARLINE_CONTROL_PILOT`, `CLEARLINE_ORIGIN`, `BETTER_AUTH_SECRET` | as rc5/rc6 | — |
| `CLEARLINE_UPLOAD_DIR` | where uploaded files are stored | `.data/uploads` (git-ignored) |
| `CLEARLINE_UPLOAD_KEY` | 32 random bytes, base64; turns on AES-256-GCM. Required when `NODE_ENV=production` | unset (files stored unencrypted, local only) |
| `CLEARLINE_CHAIN_LIVE` | `1` turns on live read-only chain reads; refused under tests and CI | unset (off) |
| `TRONGRID_API_KEY` | TronGrid key (free tier) | — |
| `ETHEREUM_RPC_URL` | Ethereum JSON-RPC URL; may embed a key | — |
| `CLEARLINE_CHAIN_RECORDING` | path to a recorded chain file (tests and demos only; see the threat model's residual risks) | unset |
| `CLEARLINE_LEDGER_PULL` | `1` turns on the read-only Xero demo / QuickBooks sandbox pull | unset (off) |
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | Xero app for the demo-company connection (`docs/ACCOUNTING_SYNC.md`) | — |
| `QBO_REALM_ID`, `QBO_ACCESS_TOKEN`, `QBO_ENV` | QuickBooks sandbox; `QBO_ENV` must be `sandbox` | `QBO_ENV=sandbox` |

**Chain keys** go in `.env.local` only, set by the founder. Without `CLEARLINE_CHAIN_LIVE=1` and keys (or a recording), every chain read is unavailable and every order becomes an `M1.chain.unavailable` exception. Nothing is matched.

## Operator commands

| Task | Command [VERIFIED in `package.json` and `scripts/`] |
|---|---|
| Retention purge (run daily; **not** run by the worker) | `DATABASE_URL=$DATABASE_OWNER_URL npm run control:admin -- purge-uploads` (prints counts only; rc8: also removes stored files no upload row names that are older than 60 minutes, `orphanFiles` in the output) |
| Delete one merchant: preview | `DATABASE_URL=$DATABASE_OWNER_URL npm run control:admin -- delete-merchant <slug>` |
| Delete one merchant: do it | `DATABASE_URL=$DATABASE_OWNER_URL npm run control:admin -- delete-merchant <slug> --confirm <slug>` |
| Create a live (empty, "Your data") organisation | `DATABASE_URL=$DATABASE_OWNER_URL npm run control:admin -- create-org <slug> "<name>" live` |
| Create a user and grant a role | `CLEARLINE_NEW_PASSWORD=… npm run control:admin -- create-user <email> "<name>"`, then `… grant <slug> <email> <admin\|payment_ops\|finance\|approver\|viewer>` |
| End-to-end benchmark | `DATABASE_URL=<runtime login> CLEARLINE_BENCH_OWNER_URL=<owner login> npm run bench:e2e` (options: `-- --months 8 --per-month 1250 --keep`) |
| Synthetic files | `npm run synthetic -- --out synthetic-data` (options: `--preset month\|small`, `--seed N`, `--month YYYY-MM`) |
| Chain smoke test (manual; **never run against mainnet so far**) | `TRONGRID_API_KEY=… ETHEREUM_RPC_URL=… npm run chain:smoke` |
| Blind test | `npm run e2e:blind` (desktop; needs the merchant e2e build, see `playwright.merchant.config.ts`) |

## First run with your own file (from a blank account)

**Honest gap [VERIFIED, #155].** The setup wizard is **not built**. There is no screen or CLI command that creates a merchant's entities, matching policy or provider link. The blind test did this with owner-connection code (`tests/e2e-merchant/blind-seed.ts`). Until a wizard exists, an operator must do steps 2–3 with owner access.

1. **Organisation and people.** `create-org <slug> "<name>" live`; create users; grant at least Finance, an Approver (not the same person) and an Admin.
2. **Provider link (operator).** A merchant's provider files can be mapped only when the organisation has a provider (`organizations.provider_org_id`); otherwise template saving is refused with `NO_PROVIDER` [VERIFIED].
3. **Entities and policy (operator).** One `merchant_entities` row per legal entity (functional currency SGD, USD or AED; ledger; time zone and UTC offset) and one `merchant_policy` row each (defaults: larger of 0.5% or SGD 5 / USD 5 / AED 20; imported-bank-line flag **off**). FX rates for cross-currency orders were also seeded in the blind test [ASSUMPTION: needed only when invoice and settlement currencies differ].
4. **Chain access.** Set `CLEARLINE_CHAIN_LIVE=1`, `TRONGRID_API_KEY` and `ETHEREUM_RPC_URL` (see above).
5. **Upload your order list first** (Finance, `/control/merchant/uploads`). Map Order ID, Invoice amount and Currency. Without it, provider rows fail as "in conflict".
6. **Upload the provider export.** For a JSON file with several lists, choose the list. Check every suggestion against values you know (your own deposit addresses). Map every status word; words outside the 20-row preview must be added by hand with "Add word". Save the mapping as a template.
7. **Upload the settlement report** (per-payment lines if you have them; totals otherwise) and the **bank statement** (MT940 and camt.053 need no mapping).
8. **Validate and confirm.** Read the validation report. Confirm; the confirmation is bound to the file's hash. A bank statement waits for an Approver who did not upload it.
9. **Bring into reconciliation, then Reconcile now.** Expect mostly "suggested for review" if your export has no quote rate or window (`docs/product/SUPPORTED_FORMATS.md`, section D).
10. **Optional:** set a daily schedule on `/control/merchant/runs`; export draft journals or the month-end pack (Finance or an Approver); an Admin can change the retention days in Settings.

**Time [GUESS, from the blind test].** 30–60 minutes the first time; 5–10 minutes a month with saved templates.

## Tests

| Suite | How to run it [VERIFIED in `package.json`] |
|---|---|
| Type check | `npm run typecheck` |
| Unit | `npx vitest run` (or `npm test`) |
| Database | `npm run test:control`, with `CLEARLINE_TEST_OWNER_URL`, `CLEARLINE_TEST_RUNTIME_URL` and (rc8) `CLEARLINE_TEST_JOBS_URL` |
| Merchant browser | build as shown at the top of `playwright.merchant.config.ts`, then `npx playwright test -c playwright.merchant.config.ts --retries=0 --trace off` (also the `merchant-e2e` CI job, not required) |
| Lint | `npm run lint` installs packages with `--no-save` before running eslint; it changes `node_modules`, so do not run it in a shared checkout |

## Phase 4 proposal: what hosting would need (not built; costs for the founder)

Nothing below is deployed or priced. All items are [ASSUMPTION] until the founder decides decision 4.

- **Managed PostgreSQL 16**, with three logins (owner, runtime and, from rc8, the jobs queue login) as today, encrypted at rest, and point-in-time recovery.
- **Encrypted object storage** for uploads in place of the local folder, with the upload key held in a secrets manager, never in the repository or CI.
- **An access-controlled host** for `next start` (pilot only, behind sign-in), with TLS and a trusted proxy header configured so per-IP sign-in rate limiting works.
- **A worker process** for `npm run jobs:worker`, plus a daily `purge-uploads` run.
- **Backups and restore drills**, and a decision on how long backups keep deleted merchants' data.
- **Costs:** to be decided by the founder. The chain readers assume free tiers.
