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
# v1 #165: required at start; `staging` or `production` on a real deployment (docs/runbooks/DEPLOY_ENV.md)
export CLEARLINE_DEPLOY_ENV=local
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
| `CLEARLINE_CHAIN_RECORDING` | path to a recorded chain file (tests and demos only). rc8: honoured only by a test build; any other build refuses to start with it set | unset |
| `CLEARLINE_TEST_BUILD` | rc8, **build time only**: `1` at `next build` makes a test build (browser suites, blind test). Never set it for a deployment build; `node scripts/build/check-chain-recording.mjs --expect absent` checks a build | unset |
| `CLEARLINE_LEDGER_PULL` | `1` turns on the read-only Xero demo / QuickBooks sandbox pull | unset (off) |
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | Xero app for the demo-company connection (`docs/ACCOUNTING_SYNC.md`) | — |
| `QBO_REALM_ID`, `QBO_ACCESS_TOKEN`, `QBO_ENV` | QuickBooks sandbox; `QBO_ENV` must be `sandbox` | `QBO_ENV=sandbox` |
| `CLEARLINE_LEDGER_ENV` | v1: `standin` or `sandbox` turns on per-organisation ledger connections (`docs/LEDGER_CONNECT.md`); no production value exists | unset (off) |
| `CLEARLINE_LEDGER_TOKEN_KEY` | v1: 32 random bytes, base64; seals ledger OAuth tokens at rest. Without it nothing connects | — |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `XERO_SCOPES`, `QBO_SCOPES` | v1: QuickBooks app and scope overrides for ledger connections | — |

**Chain keys** go in `.env.local` only, set by the founder. Without `CLEARLINE_CHAIN_LIVE=1` and keys (or a recording), every chain read is unavailable and every order becomes an `M1.chain.unavailable` exception. Nothing is matched.

## Operator commands

| Task | Command [VERIFIED in `package.json` and `scripts/`] |
|---|---|
| Retention purge (run daily; **not** run by the worker) | `DATABASE_URL=$DATABASE_OWNER_URL npm run control:admin -- purge-uploads` (prints counts only; rc8: also removes stored files no upload row names that are older than 60 minutes, `orphanFiles` in the output) |
| Delete one merchant: preview | `DATABASE_URL=$DATABASE_OWNER_URL npm run control:admin -- delete-merchant <slug>` |
| Delete one merchant: do it | `DATABASE_URL=$DATABASE_OWNER_URL npm run control:admin -- delete-merchant <slug> --confirm <slug>` |
| Create a live (empty, "Your data") organisation | `DATABASE_URL=$DATABASE_OWNER_URL npm run control:admin -- create-org <slug> "<name>" live`; rc8: a whole merchant with `create-merchant`, `add-entity`, `link-provider`, `add-member` (see "First run" below) |
| Create a user and grant a role | `CLEARLINE_NEW_PASSWORD=… npm run control:admin -- create-user <email> "<name>"`, then `… grant <slug> <email> <admin\|payment_ops\|finance\|approver\|viewer>` |
| End-to-end benchmark | `DATABASE_URL=<runtime login> CLEARLINE_BENCH_OWNER_URL=<owner login> npm run bench:e2e` (options: `-- --months 8 --per-month 1250 --keep`) |
| Synthetic files | `npm run synthetic -- --out synthetic-data` (options: `--preset month\|small`, `--seed N`, `--month YYYY-MM`) |
| Chain smoke test (manual; **never run against mainnet so far**) | `TRONGRID_API_KEY=… ETHEREUM_RPC_URL=… npm run chain:smoke` |
| Blind test | `npm run e2e:blind` (desktop; needs the merchant e2e build, see `playwright.merchant.config.ts`) |

## First run with your own file (from a blank account)

**rc8 (founder decision 4) [VERIFIED, `tests/control/merchant-setup.test.ts`].** There is still no wizard; an operator sets the merchant up with the admin CLI instead of hand SQL. The setup commands read **`DATABASE_OWNER_URL` only** (the owner login; they refuse without it or with the runtime login), print ids, roles and counts only, and can be re-run: the same values change nothing. Anything that would overwrite (a policy change, a different provider, a member's new role) is a dry run (exit 2) until `--confirm <org-slug>` repeats the slug. The runtime app's grants and row-level security are unchanged.

```bash
export DATABASE_OWNER_URL=postgres://clearline_owner:<owner-password>@127.0.0.1:54329/clearline_rc7
A="npm run -s control:admin --"
# the provider that sends you its files (skip if it exists already)
$A create-provider acme-pay --name "Acme Pay" --timezone UTC
# 1. the organisation: live (empty, "Your data"), in its own time zone
$A create-merchant acme-trading --name "Acme Trading" --timezone Asia/Singapore
# 2. one entity per legal entity; it gets the default policy (larger of 0.5% or SGD 5 / USD 5 / AED 20; imported-bank-line flag off)
$A add-entity acme-trading ENT-SG-01 --name "Acme Trading Pte Ltd" --currency SGD --timezone Asia/Singapore --utc-offset +08:00 --ledger xero
# 2b. (v1) each bank account of the entity: name, currency, LAST FOUR characters of the number only (a full number is
#     refused, never stored), bank name, optional BIC. A bank statement upload names one of these accounts.
$A add-bank-account acme-trading ENT-SG-01 --name "SGD operating" --currency SGD --last4 4321 --bank "<bank name>" --bic <BIC>
# 3. the provider link (needed to save mapping templates; otherwise NO_PROVIDER). The provider sees aggregates only and can invite only Viewers
$A link-provider acme-trading acme-pay
# 4. people: at least Finance, an Approver (a different person) and an Admin. A new person's password comes only from
#    CLEARLINE_SEED_PASSWORD (read it from your secrets store; never an argument, never printed)
read -rs CLEARLINE_SEED_PASSWORD && export CLEARLINE_SEED_PASSWORD
$A add-member acme-trading finance@acme.example finance --name "<name>"
$A add-member acme-trading approver@acme.example approver --name "<name>"
$A add-member acme-trading admin@acme.example admin --name "<name>"
unset CLEARLINE_SEED_PASSWORD
# optional: change the policy (validated exactly as the Settings page does); shows the change, then apply it
$A set-policy acme-trading ENT-SG-01 --writeoff-threshold-minor 300
$A set-policy acme-trading ENT-SG-01 --writeoff-threshold-minor 300 --confirm acme-trading
# check: ids and counts
$A setup-summary acme-trading
```

v1 [VERIFIED, tests/control/bank-accounts.test.ts]: **bank accounts** are a table (migration 0039) set up with `add-bank-account` (and `close-bank-account <org> <account-id> --confirm <org>`); a new bank statement must name an active account of its entity, and its lines must be in that account's currency (an MT940 / camt.053 file in another currency is refused before it is stored; table rows in another currency are rejected). An account's currency may differ from the entity's: v1 founder decision 9 [VERIFIED, tests/control/fx-accounts.test.ts] reconciles its statement credits, and the settlement batches in its currency, in that ACCOUNT's currency (never converted; a currency mismatch is an exception). Record the rates that show those amounts in the entity's currency with `$A record-rate <org> USD/SGD 1.3500 --as-of 2026-11-14T02:00:00Z --source "<rate source>"` (migration 0044, append-only, no rate API is called; without a rate recorded at or before the value date, at most 24 h older, the page says "needs a rate"). Duplicates: a statement row's fingerprint now includes its bank account; rows of uploads with no account (before 0039) keep the old fingerprint, and re-uploading such a line to any account is still a duplicate. The account text a settlement report names still comes from the file. v1 (migration 0038): the web app can no longer insert entities or policies at all; `add-entity` is the only way to create them.

Not covered by the CLI [VERIFIED]: **FX rates** for cross-currency orders (seeded by owner code in the blind test; [ASSUMPTION] needed only when invoice and settlement currencies differ). The merchant's Admin can also change the policy later in Settings.

Then, in the app:

1. **Chain access.** Set `CLEARLINE_CHAIN_LIVE=1`, `TRONGRID_API_KEY` and `ETHEREUM_RPC_URL` (see above).
2. **Upload your order list first** (Finance, `/control/merchant/uploads`). Map Order ID, Invoice amount and Currency. Without it, provider rows fail as "in conflict".
3. **Upload the provider export.** For a JSON file with several lists, choose the list. Check every suggestion against values you know (your own deposit addresses). Map every status word; words outside the 20-row preview must be added by hand with "Add word". Save the mapping as a template.
4. **Upload the settlement report** (per-payment lines if you have them; totals otherwise) and the **bank statement** (MT940 and camt.053 need no mapping).
5. **Validate and confirm.** Read the validation report. Confirm; the confirmation is bound to the file's hash. A bank statement waits for an Approver who did not upload it.
6. **Bring into reconciliation, then Reconcile now.** Expect mostly "suggested for review" if your export has no quote rate or window (`docs/product/SUPPORTED_FORMATS.md`, section D).
7. **Optional:** set a daily schedule on `/control/merchant/runs`; export the evidence pack, the journal files, the draft journals or the month-end pack (rc8 founder decision 3: **Finance, an Approver or an Admin** only; the links are hidden for other roles and the routes answer 403); an Admin can change the retention days in Settings.

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
