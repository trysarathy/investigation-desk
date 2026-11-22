# Deployment runbook (rc6: merchant reconciliation)

Test mode · illustrative data. This extends `DEPLOYMENT_RUNBOOK_RC5.md`. Every rc5 step, administration command, backup and restore still applies.

## Environments

| Environment | Status |
|---|---|
| **LOCAL** | works (this runbook, verified on a fresh database on 22 Nov 2026; see `docs/release/TEST_RESULTS_RC6.md`) |
| **PUBLIC DEMO** | `/clearline/cases` ships with the existing public demo build: no database, no login, fictional only |
| **PRIVATE STAGING** | **not deployed**. It needs hosted PostgreSQL 16 and an access-controlled host, which is a **founder decision (cost)** |
| **PRODUCTION** | **not enabled** |

No real provider, bank, chain node or ledger is connected. Live chain data is off (`CLEARLINE_CHAIN_LIVE` is unset).

## Local: start to finish (commands run in this session)

```bash
# 1. Database and roles (any local PostgreSQL 16)
export PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres
scripts/db/setup-local.sh clearline_rc6 '<owner-password>' '<runtime-password>'

# 2. Migrations 0000–0014 (as the OWNER)
DATABASE_OWNER_URL=postgres://clearline_owner:<owner-password>@127.0.0.1:54329/clearline_rc6 npx drizzle-kit migrate

# 3. Fictional provider, merchants and users (password from the environment, never an argument)
DATABASE_URL=postgres://clearline_owner:<owner-password>@127.0.0.1:54329/clearline_rc6 \
CLEARLINE_SEED_PASSWORD='<a fictional password, ≥ 12 chars>' npm run control:admin -- seed-merchant-cases
#  → "Test mode · illustrative data: seeded a fictional provider, 2 fictional merchants (ENT-SG-01, ENT-SG-02,
#     ENT-US-02, ENT-AE-03) and 10 fictional users"

# 4. Build and run the pilot (as the RUNTIME login)
export CLEARLINE_CONTROL_PILOT=1 CLEARLINE_ORIGIN=http://127.0.0.1:3000 \
       BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
       DATABASE_URL=postgres://clearline_runtime:<runtime-password>@127.0.0.1:54329/clearline_rc6
npx next build && npx next start -H 127.0.0.1 -p 3000
# open http://127.0.0.1:3000/control/merchant
```

`CLEARLINE_CONTROL_PILOT` is read when the app is built. The database, origin and secret are read when it runs.

## Seeded users (all fictional; the password is the one set in step 3)

| Organisation | Users |
|---|---|
| Northwind Pay (fictional), the provider | `admin@northwind-pay.example` (Provider Admin), `ops@northwind-pay.example` (Provider Ops) |
| straits-demo (merchant; SG entities ENT-SG-01 and ENT-SG-02, US entity ENT-US-02) | `finance@` (Finance), `ops@` (Payment Operations), `approver@` and `approver2@` (Approver), `admin@` (Admin), all `@straits-demo.example` |
| dunehaven-demo (merchant; AE entity ENT-AE-03) | `finance@` (Finance), `ops@` (Payment Operations) and `approver@` (Approver), all `@dunehaven-demo.example` |

## First run: what you should see

1. **Reconcile.** Sign in as `finance@straits-demo.example`, open **Daily report**, and press **Reconcile** for each entity. A rerun with no new input changes nothing.
2. **Check the payments:**
   - **BK-24817:** matched with difference (sender-side fee 1.35, write-off proposed).
   - **BK-24823:** exception (underpayment).
   - **BK-24830:** exception (overpayment).
   - **BK-24836:** suggested for review (re-quote after expiry).
   - **BK-24871:** exception (held by the provider, owner Treasury).
3. **Approve the write-off as a different person.** `approver@straits-demo.example` approves the write-off under **Approvals**. The preparer cannot approve it.
4. **Check the other merchant.** `finance@dunehaven-demo.example` should see BK-25102 as matched with difference, with the 14.16 AED write-off proposed under the Case 3 fixture policy [ASSUMPTION].
5. **Check the provider view.** `admin@northwind-pay.example` should see **aggregates only** under **Provider**. A merchant Admin can grant full read access under **Settings**, and revoke it again.

## Case Reconstruction (local laptop only)

```bash
npm run reconstruct -- --in reconstruction-data/<provider>/in --out reconstruction-data/<provider>/out
npm run reconstruct -- --purge reconstruction-data/<provider> --yes
```

- **The tool stays local:** no network, no database, no upload. It refuses to run in CI.
- **Bundled samples:** `scripts/reconstruct/sample/`.
- **Before receiving any provider data:** read `RECONSTRUCTION_DATA_HANDLING.md`.

## Tests

| Suite | How to run it |
|---|---|
| Engine and unit | `npx vitest run` |
| Database tests | `npm run test:control`, with `CLEARLINE_TEST_OWNER_URL` and `CLEARLINE_TEST_RUNTIME_URL` set |
| Merchant browser tests | Build with the environment shown at the top of `playwright.merchant.config.ts`, then run `npx playwright test -c playwright.merchant.config.ts --retries=0 --trace off` |

## Known limits

- **IP rate limiting.** Without a trusted proxy header, Better Auth logs "Rate limiting could not determine a client IP" and falls back to a shared bucket. The per-account limit still applies. Configure trusted proxies when you host.
- **Posting rules.** Journal proposals are `pending_sign_off`. Exports go to a sandbox or demo company file only, and nothing is posted.
