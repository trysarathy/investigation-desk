# Runbook: incident response

Labels: **[VERIFIED]** read in the code; **[ASSUMPTION]** reasoned, not tested; **[ASSUMPTION, lawyer]** a legal
point a lawyer must confirm before go-live. Nothing here is legal advice and nothing here is a compliance claim.

Clearline is read-only on money: it never holds, sends, converts or settles funds, so an incident is about
**availability, correctness of what we show, or confidentiality of customer data** (wallet addresses, customer
references, uploaded statements, user accounts).

## Severity

| Sev | Examples | Response |
|---|---|---|
| 1 | Customer data seen by someone who should not see it (cross-tenant read, leaked export, stolen credentials used); wrong "matched" shown on payments | page the on-call now; founder informed within 1 hour |
| 2 | Service down or every run failing; backups failing with no PITR; chain data unavailable for a network > 2 h | on-call within 30 min |
| 3 | Degraded: worker stale, job backlog, one merchant's run failing, failed-login spike without a known compromise | next working hour |

## Roles

- **Incident lead** (on-call, or the founder until there is a rota): decides, keeps the timeline.
- **Second person**: checks every change made under pressure (two people for restores, key rotation and data fixes).
- **Communications**: the founder approves every customer message.

## Signals

Alerts (src/server/ops/alerts.ts) arrive as a log line (`alert_firing` / `alert_resolved`), in
`CLEARLINE_ALERT_FILE` and by e-mail to `CLEARLINE_ALERT_EMAIL_TO` through the configured e-mail sender. Each names
its runbook:

| Alert | First look | Runbook |
|---|---|---|
| `failed_runs` | the run's `error_code` and the job's `last_error_code` (codes only) | this one |
| `worker_down` | is the worker process running? its last `pass` log line | this one ("Worker down") |
| `job_backlog` | worker running but slow, or crashing per job? `job_retry` / `job_dead` lines | this one |
| `failed_login_spike` | which scope (password or second factor); is it one account or many? | docs/runbooks/KEY_COMPROMISE.md |
| `chain_provider_outage:<network>` | the provider's status page; `chain_reads.reason` | docs/runbooks/CHAIN_PROVIDER_OUTAGE.md |
| `backup_failure` | the backup job's output | docs/runbooks/RESTORE.md ("Backup failing") |

Uptime: `GET /api/health` (load balancer; fails only when the database is unreachable) and `GET /api/ready` (uptime
monitor; also fails when no worker pass in `CLEARLINE_WORKER_STALE_SECONDS`, default 300). Both say ok/fail only.

## The first 30 minutes

1. **Acknowledge** the alert; open an incident log (time-stamped, UTC; ids and counts only, never customer data).
2. **Assess** severity with the table above. If customer data may be exposed: severity 1, go to "Data exposure".
3. **Status page**: add the incident to the incidents file (below) with status `investigating`.
4. **Contain**: the smallest action that stops harm. Examples: scale the app to zero (exposure through the app);
   revoke sessions (`control:admin revoke-sessions <email>`); revoke a membership (`control:admin revoke`); stop the
   worker (runs producing wrong results); disable the chain readers (unset `TRONGRID_API_KEY` / `ETHERSCAN_API_KEY`
   so reads report "unavailable" instead of being wrong).
5. **Never** "fix" accounting results by hand in the database. Wrong results are corrected by fixing the cause and
   re-running; a person's approval is never recreated by an operator.

## Worker down / job backlog / failed runs

1. `worker_down`: restart the worker (`npm run jobs:worker`). If it exits at once, its `worker_failed` line has a code;
   `JOBS_LOGIN_REFUSED` means `DATABASE_JOBS_URL` is not the limited jobs login.
2. `job_backlog` with a running worker: look for `job_retry` with the same code repeating (a dependency down; see the
   chain runbook) or a slow database (`/api/health` slow). Add a second worker only if jobs are healthy but many;
   two workers never take the same job.
3. `failed_runs`: the run's `error_code`. `PG_*` = database refused a write (often a missing chain-read partition:
   `control:admin chain-read-partitions`; docs/runbooks/CHAIN_READ_PARTITIONS.md). `ACCESS_*` = the schedule's
   member lost access; the merchant's admin must set the schedule again.

## Data exposure (severity 1)

1. Contain first (above). Preserve evidence: do not delete logs, sessions or the database; snapshot it.
2. Establish **what** (which tables or files: wallet addresses, customer references, statements, user e-mails),
   **whose** (which organisations; use ids), **when** (first and last time), **how** (the access path).
   The audit log (`audit_events`) records exports with format, hash and count.
3. Rotate what could be abused (docs/runbooks/KEY_COMPROMISE.md).
4. Notify as below.

## Who to notify, what, and when

All deadlines are **[ASSUMPTION, lawyer]**: they must be confirmed by a lawyer for each market before go-live
(docs/LEGAL_QUESTIONS.md). Until then, use the shortest one that may apply. Customer contracts may set shorter ones.

| Who | When | What | Source to confirm |
|---|---|---|---|
| Affected customers (the provider and each affected merchant's admins) | as soon as the exposure is confirmed, target within 24 hours [ASSUMPTION, lawyer] | what happened, which of their data, what we did, what they should do, a contact | the customer contract (DPA) [ASSUMPTION, lawyer] |
| Singapore PDPC (if Singapore personal data and the breach is notifiable) | within 3 calendar days of assessing that it is notifiable [ASSUMPTION, lawyer] | the PDPC's form | PDPA Part 6A [ASSUMPTION, lawyer] |
| Affected individuals in Singapore | as soon as practicable after notifying the PDPC, if significant harm is likely [ASSUMPTION, lawyer] | plain-language notice via the customer, who owns the relationship | PDPA Part 6A [ASSUMPTION, lawyer] |
| UAE regulator (if UAE personal data; which law depends on free zone vs mainland: PDPL, DIFC or ADGM) | "without delay" / within 72 hours depending on the regime [ASSUMPTION, lawyer] | per the regime | [ASSUMPTION, lawyer] |
| Our own processors (hosting, e-mail) | when the incident involves them | the facts they need | their DPA |
| Status page | within 30 minutes of an incident that affects availability | component, status, plain update; never customer names, addresses or amounts | — |

Customer messages are drafted by the incident lead and approved by the founder. They name no other customer and
contain no wallet address, reference or amount.

## Status page and incidents file

`/status` (served past the deployment gates only with `CLEARLINE_PUBLIC_STATUS=1`) shows web / database / jobs from
the uptime checks plus the incidents in `CLEARLINE_STATUS_INCIDENTS_FILE`:

```json
{ "incidents": [ {
  "id": "2026-11-25-chain-tron", "title": "TRON payments are confirmed late", "status": "identified",
  "impact": "minor", "components": ["chain_data"], "startedAt": "2026-11-25T09:00:00Z",
  "updates": [ { "at": "2026-11-25T09:20:00Z", "status": "identified", "text": "Our chain data provider is degraded. Payments are not lost; they will be matched once it recovers." } ]
} ] }
```

Statuses: `investigating`, `identified`, `monitoring`, `resolved` (add `resolvedAt`). Impact: `none`, `minor`,
`major`. Components: `web`, `database`, `jobs`, `chain_data`, `email`. Text may not contain `<` or `>`; an invalid
file shows "Incident notes are unavailable" rather than half of it. Resolved incidents stay for 14 days.

## Close

1. Status page `resolved`; alerts resolved.
2. Post-incident review within 5 working days: timeline, cause, what detected it, what we change (an issue each).
   Blameless; ids and counts only.
