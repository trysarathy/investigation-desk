# Backups and point-in-time recovery (hosting proposal)

Labels: **[VERIFIED]** seen in a recorded run or read in the code; **[ASSUMPTION]** reasoned, not tested; **[GUESS]** an estimate.

Hosting is not chosen yet (founder decision 4). This is what any hosting proposal must provide for the database, and
how to configure it. Nothing here signs up for or calls a paid service. Legal retention periods are
**[ASSUMPTION, lawyer]**.

## Targets

| | Target | Why |
|---|---|---|
| RPO (data that may be lost) | ≤ 5 minutes | WAL is archived continuously; `archive_timeout = 60` bounds a quiet period [ASSUMPTION] |
| RTO (time to service) | ≤ 4 hours | restore + verification + app start; the drill's local timings are in docs/ops/RESTORE_DRILL.md [GUESS at production size] |
| PITR window | 14 days | an operator mistake noticed after a weekend can still be undone [ASSUMPTION] |
| Logical copies | nightly, 14 kept, in a second location | survives a provider-side or account-level loss [ASSUMPTION] |
| Audit and approvals | kept 7 years (founder: [ASSUMPTION]) | backups older than the PITR window are not the system of record for this; the live tables are append-only |
| Uploads | 90 days by default, configurable per merchant (founder decision) | backups must not keep uploads much longer than that; see "Deleted data" |

## Option 1: managed PostgreSQL 16 (recommended)

Any provider must offer, and the proposal must name the setting for each:

1. **Continuous WAL archiving with point-in-time restore** to any second inside the window (14 days), into a NEW
   instance (never in place).
2. **Encryption at rest** with provider-managed keys at minimum; backups encrypted too.
3. **Region** acceptable for the data (Singapore and UAE merchants: [ASSUMPTION, lawyer] on cross-border transfer;
   docs/LEGAL_QUESTIONS.md question 5).
4. **Daily automated snapshots** kept for the window.
5. Restores do NOT need the app's passwords: the four logins (`clearline_owner`, `clearline_runtime`,
   `clearline_jobs`, `clearline_provisioning`) are restored with the database; rotate their passwords after a restore
   that followed a compromise (docs/runbooks/KEY_COMPROMISE.md).

Plus, independent of the provider: `scripts/ops/backup.sh` nightly from a separate host (a second copy, encrypted, in
another account or region), which also feeds the `backup_failure` alert through `CLEARLINE_BACKUP_STATUS_FILE`.

## Option 2: self-managed PostgreSQL 16

The configuration the drill uses, for a self-managed primary [VERIFIED in the drill, locally]:

```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'   # in production: a tool that copies off-host and verifies (pgBackRest, WAL-G) [ASSUMPTION]
archive_timeout = 60
# initdb --data-checksums  (page checksums; set at initdb)
```

- Weekly base backup: `pg_basebackup -D <dir> -X stream -c fast` (or the archiving tool's full backup), kept until the
  next one plus the PITR window.
- Recovery to a time: copy a base backup older than the target into an empty data directory, add
  `restore_command = 'cp /archive/%f %p'`, `recovery_target_time = '<UTC time>'`, `recovery_target_action = 'promote'`,
  create `recovery.signal`, start. The drill does exactly this (step D).
- Monitor: `pg_stat_archiver.failed_count` must not grow; `scripts/ops/backup.sh` covers the logical copy.

## Verification (every backup system)

- **Monthly restore drill** on a non-production instance: `scripts/ops/restore-drill.sh` locally to check the
  procedure, and once per quarter a real provider PITR restore into a throwaway instance, compared with
  `scripts/ops/drill.ts fingerprint` (counts and checksums only) against the source at the same point. Record the
  timing in docs/ops/RESTORE_DRILL.md. Never copy production data to a laptop for a drill.
- `backup_failure` alert (src/server/ops/alerts.ts): fires when the last backup failed, or none succeeded in 26 hours.

## Deleted data

- Deleting a merchant (`control:admin delete-merchant`) or purging expired uploads removes the rows now; they remain
  in backups until those age out (14 days PITR, 14 nightly copies). The privacy notice must say so
  [ASSUMPTION, lawyer].
- After restoring a backup older than a deletion, re-run the deletion (`delete-merchant`, `purge-uploads`) before
  the restored database serves anyone (docs/runbooks/RESTORE.md step 6).
