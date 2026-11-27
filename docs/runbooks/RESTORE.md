# Runbook: restore the database

Labels: **[VERIFIED]** seen in a recorded run; **[ASSUMPTION]** reasoned, not tested. Background: docs/ops/BACKUPS.md.
The procedure below was rehearsed locally on fictional data by `scripts/ops/restore-drill.sh` (results:
docs/ops/RESTORE_DRILL.md). It has not been run on real hosting (none is chosen).

**Two people.** One restores, the second checks each step and signs the incident log. A restore is never done alone.

## When

- Data loss or corruption (an operator mistake, a bad migration, a storage failure).
- A security incident where the database may have been changed (restore to just before the change; keep the
  damaged instance for investigation).
- Alert `backup_failure` does NOT need a restore: fix the backup job (step "Backup failing" below).

## Steps

1. **Declare an incident** (docs/runbooks/INCIDENT_RESPONSE.md). Put the status page to "identified" for Database.
2. **Stop writes**: scale the web app to zero (or turn on the maintenance page) and stop the job worker. Nothing may
   write to the old database while you decide the target time.
3. **Pick the target time** (UTC): the last moment the data was good. Use the audit log (`audit_events.created_at`)
   and the app logs (event names and ids only) to find it. Write it in the incident log.
4. **Restore into a NEW instance**, never in place:
   - managed: the provider's point-in-time restore to the target time;
   - self-managed: base backup + WAL to `recovery_target_time` (docs/ops/BACKUPS.md, "Option 2").
   - only a logical dump is available: `pg_restore --exit-on-error -d <new db> <dump>` after
     `scripts/db/setup-local.sh` created the logins.
5. **Verify** before anything connects:
   - `DATABASE_OWNER_URL=<new> npx tsx --conditions=react-server scripts/ops/drill.ts fingerprint > new.json` and
     compare table row counts with what you expect at the target time (the old instance's fingerprint at that time
     if it is still readable: `drill.ts compare old.json new.json`). The output is counts and checksums only.
   - `select count(*) from drizzle.__drizzle_migrations` equals the number of entries in `drizzle/meta/_journal.json`
     for the release that was running at the target time. If not, deploy that release (docs/runbooks/ROLLBACK.md).
   - row-level security is enabled and forced on every tenant table (the fingerprint lists the flags).
6. **Re-apply deletions** made after the target time: any `delete-merchant` and the uploads purge
   (`control:admin purge-uploads`). The audit log of the OLD instance says which. Personal data a customer asked to
   delete must not come back with a restore.
7. **Rotate the database passwords** if the restore follows a compromise (docs/runbooks/KEY_COMPROMISE.md).
8. **Point the app and worker at the new instance** (`DATABASE_URL`, `DATABASE_JOBS_URL`, `DATABASE_OWNER_URL`,
   `DATABASE_PROVISIONING_URL` in the secrets manager), start one worker pass (`npm run jobs:worker -- --once`), then
   the app. Check `GET /api/health` and `GET /api/ready` answer 200.
9. **Check the books**: sign in as an operator and open one entity's runs: the newest run must be at or before the
   target time. Payments received after the target time are re-read from the chain and the provider files on the
   next run; nothing is re-approved automatically (approvals after the target time are gone and must be redone by
   people: the preparer never approves).
10. **Tell customers** what was lost (time window) per docs/runbooks/INCIDENT_RESPONSE.md, and close the incident.
11. Keep the old instance (stopped, access restricted) until the post-incident review is done, then delete it.

## Backup failing (alert `backup_failure`)

1. Read the backup job's output (`event` `backup_failed`, file, ms) and the provider's backup status.
2. Most common: credentials rotated, disk full, network to the backup location. Fix and re-run
   `scripts/ops/backup.sh`; the alert resolves on the worker's next pass.
3. If the provider's own PITR is also failing, open a ticket with the provider at once and treat it as an incident
   (severity 2): there is no recovery point until it is fixed.
