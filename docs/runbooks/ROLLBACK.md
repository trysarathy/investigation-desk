# Runbook: roll back a release

Labels: **[VERIFIED]** read in the code; **[ASSUMPTION]** reasoned, not tested. Two people: one acts, one checks.

## Decide

Roll back the **code** when the new release misbehaves and the previous release can run against the current schema.
This is the normal case: migrations are additive (new tables, columns, functions, grants), so the previous code
simply does not use what was added [ASSUMPTION: check the release's migrations as in docs/runbooks/DEPLOY.md
"Before" 2].

Do **not** run "down" migrations: there are none, by design (`drizzle/` holds forward migrations only). Undoing a
schema change is a NEW forward migration, reviewed like any other, and is approval-only if it touches a grant, a
policy or matching.

Restore the **database** (docs/runbooks/RESTORE.md) only when data is wrong or lost, never just to undo a schema
change, because a restore loses every write since the target time.

## Steps (code rollback)

1. Announce it in the incident log and, if users notice, on the status page.
2. Stop the job worker(s) of the new release (a worker of the old release will take over its queue; jobs are
   leased, so a running job is taken again after 15 minutes if its worker vanished [VERIFIED: src/server/jobs.ts
   LEASE_MS]).
3. Deploy the previous release's artefact the same way as a deploy (docs/runbooks/DEPLOY.md "Deploy" 1, 3, 4), **skipping
   the migration step**. `<host: redeploy previous artefact>`.
4. Check `GET /api/health` and `GET /api/ready` (200), worker `pass` lines, no new error events.
5. Reconciliation runs made by the bad release stay in the history (runs are append-only and show their rule-set
   version). If they produced wrong results, run the affected entities again on the old release; never edit results
   in the database. If a "rule change would differ" notice appears, it is expected: the rule-set version changed back.
6. Write down what failed and open an issue before the next deploy attempt.

## When the old release cannot run on the new schema

Rare (a migration renamed or dropped something the old code reads). Options, in order:
1. Fix forward: a small patch release on top of the new one.
2. A forward migration that re-adds what the old code needs (reviewed; approval-only if it touches security).
3. Restore to the restore point noted before the deploy (docs/runbooks/RESTORE.md) and accept losing the writes made
   since; customers are told which window (docs/runbooks/INCIDENT_RESPONSE.md).
