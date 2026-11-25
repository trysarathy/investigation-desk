# Runbook: deploy a release

Labels: **[VERIFIED]** read in the code, the CI workflow or a recorded run; **[ASSUMPTION]** reasoned, not tested.
No hosting is chosen (founder decision 4), so this is the procedure any host must support; host-specific commands
are left as `<host: …>`. Local and environment details: docs/runbooks/DEPLOYMENT_RUNBOOK_RC7.md and
docs/runbooks/DEPLOY_ENV.md. Deploys are done by one person and watched by a second; never on a Friday afternoon or
before a holiday for the pilot [ASSUMPTION].

## Before

1. The release commit is on `main` and CI is green: `ci` (type-check, `check-log-safety`, unit tests, the production
   build gate with no demo or recorded-chain code) and `control-db` (integration tests on PostgreSQL 16).
   [VERIFIED: .github/workflows/ci.yml]
2. Read the release's migrations (`drizzle/NNNN_*.sql` added since the running release). For each, write down:
   does it only ADD (tables, columns, functions, grants)? does it change or drop anything? A migration that drops or
   rewrites data needs a backup point (step 4) and a rollback plan written BEFORE the deploy
   (docs/runbooks/ROLLBACK.md).
3. Any migration or code marked **approval-only** (it touches matching, a security control or a grant) has the
   founder's written approval in the PR.
4. Note the time (UTC) as the restore point, and check the newest backup succeeded (no `backup_failure` alert;
   the provider's PITR is current). docs/ops/BACKUPS.md.
5. Post a maintenance note on the status page if users may notice (incidents file, impact `none` or `minor`).

## Deploy

1. **Build** the artefact once, plain `next build` with no demo or test switches (the CI gate already proved the
   same commit). Set at run time: `CLEARLINE_DEPLOY_ENV=staging|production` (required; the server refuses to start
   without it [VERIFIED: src/server/deploy-guard.ts]), `NODE_ENV=production`, the database URLs, `BETTER_AUTH_SECRET`,
   `CLEARLINE_UPLOAD_KEY`, `CLEARLINE_ORIGIN`, and the operations settings below.
2. **Migrate** with the OWNER login, from one place only:
   `DATABASE_OWNER_URL=<owner> npm run db:migrate`. Migrations are additive by policy, so the running (old) app keeps
   working against the migrated schema [ASSUMPTION: true for every migration so far; check step "Before" 2].
3. **Roll the web app**: start new instances; the load balancer adds each one only once `GET /api/health` answers
   200; then stop the old instances. `<host: rolling deploy>`.
4. **Restart the job worker(s)** on the new release: `npm run jobs:worker` (with `DATABASE_JOBS_URL` = the limited
   jobs login; it refuses any other [VERIFIED]).
5. **Check**:
   - `GET /api/ready` answers 200 (database + a worker pass within 5 minutes).
   - the logs show `pass` lines from the worker and no `api_unexpected_error` / `request_error` bursts;
     the error tracker file (`CLEARLINE_ERROR_LOG_FILE`) has no new events.
   - sign in as an operator test account and open one fictional entity's runs page.
6. Remove the maintenance note.

## Operations settings (names only; values in the secrets manager or the host's config)

| Variable | Purpose | Default |
|---|---|---|
| `CLEARLINE_LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
| `CLEARLINE_ERROR_TRACKER`, `CLEARLINE_ERROR_LOG_FILE` | `file` + a path: scrubbed error events, one per line | none (log line only) |
| `CLEARLINE_RELEASE` | release tag on error events | unset |
| `CLEARLINE_PUBLIC_STATUS` | `1` serves `/api/health`, `/api/ready`, `/status` past the deployment gates (**approval-only**) | unset: the pilot answers 404 there |
| `CLEARLINE_STATUS_INCIDENTS_FILE` | the incidents shown on `/status` | none |
| `CLEARLINE_WORKER_STALE_SECONDS` | how old the newest worker pass may be for `/api/ready` and the `worker_down` alert | 300 |
| `CLEARLINE_ALERTS` | `0` turns the worker's alert rules off (heartbeat stays) | on |
| `CLEARLINE_ALERT_FILE`, `CLEARLINE_ALERT_EMAIL_TO`, `CLEARLINE_ALERT_STATE_FILE` | alert sinks and the sent-state file | log only, state in memory |
| `CLEARLINE_ALERT_*` thresholds, `CLEARLINE_ALERT_WINDOW_MINUTES`, `CLEARLINE_ALERT_RENOTIFY_MINUTES` | rule tuning (src/server/ops/alerts.ts) | see the file |
| `CLEARLINE_BACKUP_STATUS_FILE` | where `scripts/ops/backup.sh` records the last backup; enables the `backup_failure` rule | unset: backups not monitored by the worker |

## If something is wrong

Within the first 15 minutes and without data written by the new release that the old one cannot read: roll back
(docs/runbooks/ROLLBACK.md). Otherwise treat it as an incident (docs/runbooks/INCIDENT_RESPONSE.md).
