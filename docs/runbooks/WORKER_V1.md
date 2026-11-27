# The job worker (v1 phase 3)

`npm run worker` runs background work outside the web app. No paid service, no external cron.

```
DATABASE_URL=<runtime login> DATABASE_JOBS_URL=<jobs login> npm run worker -- [--once] [--interval-seconds 60]
  optional: DATABASE_RETENTION_URL=<owner login, retention only>   CLEARLINE_PICKUP_DIR=<folder>
  dead-letter: npm run worker -- --requeue <job id>
```

## Jobs

| Kind | Who enqueues | Acts as | What it does |
|---|---|---|---|
| reconcile | daily schedule; rule-set or policy change; a member ("Run in the background", Runs page) | the schedule's member / the member who asked | `runReconciliation`, stage by stage (chain_verify, load, engine, write, done) |
| revaluation | a member (Finance, Approver, Admin) | that member | period-end revaluation proposals (read-only), kept as the job's result |
| pickup | a member (Finance, Payment Ops) | that member | files in `<dir>/<org slug>/<entity>/<file type>/` (bank statements under `bank_statement/<bank account id>/`) become uploads waiting for a person to map, validate and confirm; picked files move to `done/` |
| retention | the worker, daily, per organisation with an upload past its date | the retention login | `purgeExpiredUploads` for that organisation |

Every job re-checks its member's access when it runs (a revoked member's job dies with `ACCESS_40x`).

## Reliability

- Claiming: `FOR UPDATE SKIP LOCKED`; two workers never take the same job.
- Heartbeat every 30 s while a job runs. A running job whose heartbeat is older than the lease (15 min) is taken back
  by another worker and counted (`recoveries`, event `recovered`).
- Retries: 1, 2, 4 … min (max 1 h), up to `max_attempts` (5). Access refusals and refused requests are not retried.
- Dead-letter: status `dead` with its last error code, kept; `--requeue` puts one back (event `requeued`).
- Graceful shutdown: the first SIGTERM/SIGINT stops claiming and lets the job in hand finish; a second exits at once
  (the job is recovered after the lease).
- Progress: `job_events` (append-only: claimed, stage, done, retry, dead, recovered, requeued; ids, stages, codes and
  counts only). The Runs page polls `GET /api/control/merchant/jobs` every 2 s while a job is active.

## Database grants (migrations 0029 and 0079, was 0064)

`clearline_jobs` (NOBYPASSRLS, owns nothing, cannot create): SELECT/INSERT/UPDATE on `jobs`; SELECT/INSERT on
`job_events`; SELECT on `reconciliation_schedules`; EXECUTE on `jobs_due_schedules()`, `jobs_run_principal()`,
`jobs_requester_principal(org, member)` (an active membership only) and `jobs_retention_due(at)` (organisation ids
only). Nothing else; the worker refuses to start with any other login.

`clearline_app` (the web app), new in 0079 (was 0064): INSERT of eight columns of `jobs` (org, entity, kind, trigger, dedupe key,
member, run after, params) under a policy that pins the organisation, `run_as = the signed-in user`, trigger `manual`
and a queued, untouched row; SELECT on `job_events` (own organisation, entity scope applied through the job).
**This widens the runtime role's rights (it could not write to the queue before): flagged for review.**

Retention keeps the owner's rights it always needed (two tables refuse deletes to everyone else); the worker holds
that connection only when `DATABASE_RETENTION_URL` is set, and uses it for the retention handler only.
