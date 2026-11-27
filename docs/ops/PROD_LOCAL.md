# Production, mirrored locally (prod-local)

Labels: **[VERIFIED]** seen in a recorded run on the authoring machine (2026-11-25); **[ASSUMPTION]** reasoned, not run.

Prod-local runs the same topology as the recommended hosting (docs/ops/HOSTING_PROPOSAL.md) on one machine, with
fictional data only:

| Production (DigitalOcean, proposed) | prod-local |
|---|---|
| App Platform web service: the `Dockerfile.prod` image, `next start` (NODE_ENV=production) | the same plain production `next build`, `next start` on 127.0.0.1:4440, `CLEARLINE_DEPLOY_ENV=local` |
| App Platform worker: `scripts/jobs/worker.ts` on the `clearline_jobs` login | the same worker, a separate process, on the `clearline_jobs` login |
| App Platform pre-deploy job: `drizzle-kit migrate` (owner login) | `drizzle-kit migrate` (owner login) before the app starts |
| Managed PostgreSQL 16, four logins (owner, runtime, jobs, provisioning) | a private PostgreSQL 16 cluster (its own `initdb`, port 4441, scram-sha-256), the same four logins via `scripts/db/setup-local.sh` |
| Spaces (S3 API), uploads sealed with AES-256-GCM by the app | the S3 stand-in `scripts/prodlocal/s3-standin.ts` (checks every SigV4 signature), the same `CLEARLINE_UPLOAD_STORE=s3` code path, the same sealed bytes |
| transactional e-mail provider | the local outbox folder (`CLEARLINE_EMAIL_OUTBOX_DIR`); nothing is sent |
| chain providers (TronGrid, Etherscan / an Ethereum RPC) | none configured: every chain read is unavailable, as on a fresh deployment before the founder adds keys |

## Two ways to run it

### A. Local processes: `scripts/prodlocal/run.sh` (the one that was proved)

Docker is installed on the authoring machine but its daemon is not running, so the compose file below was **not**
run there. `run.sh` runs the same processes directly. It needs PostgreSQL 16 binaries (`/usr/lib/postgresql/16/bin`,
or set `PGBIN`), Node 22 with this repository's `node_modules`, `openssl` and `curl`. As root, the cluster runs as the
`postgres` user (PostgreSQL refuses root).

```bash
scripts/prodlocal/run.sh up          # cluster, roles, migrations, plain build + checks, stand-in, app, worker
scripts/deploy/smoke.sh http://127.0.0.1:4440
npx playwright test -c playwright.prodlocal.config.ts   # the end-to-end proof below (needs a fresh stack)
scripts/prodlocal/run.sh status
scripts/prodlocal/run.sh down        # stop everything, keep .prodlocal/
scripts/prodlocal/run.sh destroy     # stop and delete .prodlocal/ (database, objects, generated secrets)
```

`up` generates local-only secrets once into `.prodlocal/secrets.env` (mode 600, git-ignored, never printed),
builds with `next build` and refuses to start if `scripts/build/check-chain-recording.mjs --expect absent` or
`--marker demo --expect absent` fails. `SKIP_BUILD=1` reuses `.next` (the two checks still run). `run.sh env` prints
the variable **names** the app receives.

### B. Docker: `docker-compose.prod-local.yml` [ASSUMPTION: not run]

```bash
cp .env.prod-local.example .env.prod-local      # fill with fresh local-only random values
docker compose -f docker-compose.prod-local.yml --env-file .env.prod-local up --build
scripts/deploy/smoke.sh http://127.0.0.1:4440
```

Services: `postgres` (postgres:16), `migrate` (one-shot: the four logins, then migrations as the owner), `objects`
(the S3 stand-in from the app image; **no MinIO image was available offline**, so object storage is the stand-in on a
named volume; swap in MinIO by pointing `CLEARLINE_S3_ENDPOINT` at it), `web` and `worker` (the `Dockerfile.prod`
image). Checked on the authoring machine with `docker compose ... config -q` only (the file parses and every variable
resolves); no container was started.

## The end-to-end proof [VERIFIED]

`tests/prodlocal/` (Playwright, Chromium, desktop) against the running stack. Its global setup is the operator's first
run from `docs/runbooks/DEPLOYMENT_RUNBOOK_RC7.md`, through the admin CLI on the owner login: `create-provider`,
`create-merchant` (live, "Your data"), `add-entity ENT-SG-SYN` (SGD, Asia/Singapore), `add-bank-account` (last four
only), `link-provider`, `add-member` for an Admin, an Approver, Finance and Payment Operations (password from
`CLEARLINE_SEED_PASSWORD`). Then, **test-only**, the Admin's and Approver's authenticator is the suite's fictional TOTP
secret, stored the way Better Auth stores one (as `tests/e2e-control/db.ts` does).

| # | Test | What it shows |
|---|---|---|
| 1 | MFA | The Admin's password alone leads to the second step; the API refuses without it; a wrong 6-digit code is refused; the right code (RFC 6238 from the fixture secret) signs in |
| 2 | Upload, reconcile, month-end | Finance uploads the synthetic provider export (small preset, quote columns) and the settlement totals through the browser, maps, validates, confirms, brings both in. Exactly two new objects appear in the object store, each starting `CLU1` (AES-256-GCM) with no order id in the bytes. Payment Operations runs reconciliation for ENT-SG-SYN; the payments page lists the payments and **none is Matched** (no chain keys). Finance opens the month-end page and downloads the month-end pack (HTTP 200) |
| 3 | Worker | The separate worker process is alive, logged `"event":"pass"` passes and no `JOBS_LOGIN_REFUSED` |

### Recorded runs (2026-11-25, authoring machine)

1. First `run.sh up` from nothing: initdb, roles, migrations, a full plain `next build`, both build checks, app, worker,
   stand-in: **5 min 23 s**. `smoke.sh`: **11/11 checks passed**. Playwright: **3 passed** (53 s) after two
   test-locator fixes in the spec itself (no product change). Database afterwards: 2 uploads `normalised`;
   28 match records, all `exception` with rule `M1.chain.unavailable` and bank evidence `none`; 2 objects in the store.
2. Clean repeat: `run.sh destroy`, then `SKIP_BUILD=1 run.sh up` (**14 s**), `smoke.sh` **11/11**, Playwright:
   **3 passed** (50 s).

3. After a container restart, under a machine load of about 11 (other agents' suites running): `destroy`, `SKIP_BUILD=1 up`,
   `smoke.sh` **11/11**. Playwright: **1 passed, 1 failed, 1 did not run** (the serial suite stops after a failure).
   The upload/reconcile/month-end test failed. Its error output was cut off and was not kept. The database showed the
   reconciliation had run (28 records, `M1.chain.unavailable`, `exception`). Cause not established [GUESS: a 20 s
   step timeout under load].
4. Immediately after, fresh again (`destroy`, `SKIP_BUILD=1 up`): Playwright **3 passed** (54 s).

What the result means: on a production build with no chain keys, the pipeline stores, maps, validates, confirms and
reconciles, and abstains on every payment (exception, chain unavailable). It never matches on amounts alone. A matched
result needs live chain reads (`CLEARLINE_CHAIN_LIVE=1` and the founder's keys), which prod-local deliberately does not
have.

## Limits

- Prod-local is not a load test, and the S3 stand-in is not Spaces: real Spaces behaviour (consistency, errors,
  latency) is [ASSUMPTION] until the founder's staging run. The signing code is checked against the S3 documentation's
  published examples (`tests/server/s3-storage.test.ts`).
- TLS, HSTS, the http-to-https redirect and the trusted client address come from the host, so they are only checked
  on staging (`smoke.sh <origin> --expect-https`).
- The spec needs a fresh stack (`run.sh destroy && run.sh up`): uploading the same file twice is refused by design.
