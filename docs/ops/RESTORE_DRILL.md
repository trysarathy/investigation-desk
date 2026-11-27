# Restore drill

Labels: **[VERIFIED]** seen in a recorded run; **[ASSUMPTION]** reasoned, not tested; **[GUESS]** an estimate.

The drill proves, on a laptop-sized fictional database, that a backup can be turned back into a working Clearline:
the data comes back byte-for-byte (row counts and checksums of every table), the migration journal and row-level
security come back, a point-in-time recovery stops exactly at the target time, and the app and the job worker start
against the result. It never touches a real database and never uses real data.

Run it (needs a local PostgreSQL 16 superuser for the source, root to run `initdb` as `postgres`, and ideally a
production build first so the app step uses `next start`):

```bash
npx next build                                    # optional; without it the app step uses `next dev`
PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/ops/restore-drill.sh
```

What it does (`scripts/ops/restore-drill.sh`, helpers in `scripts/ops/drill.ts`):

1. **Seed** a source database: all migrations, the fictional provider and merchants (`seedMerchantCases`) and one
   reconciliation run per entity.
2. **Logical backup**: `pg_dump -Fc`.
3. **Restore** into a fresh private cluster (`initdb --data-checksums`, port 4454, WAL archiving on): the four
   logins are created by `scripts/db/setup-local.sh` (in a real restore they come from the secrets manager, never
   from the dump), then `pg_restore --exit-on-error`.
4. **Verify**: for every table in the public schema (partitioned tables through their parent) the row count and an
   md5 over the sorted md5 of each row; the migration journal count; every table's RLS enabled/forced flags; the
   number of functions. Any difference fails the drill.
5. **Point-in-time recovery**: `pg_basebackup`, then a marker row, a target time, a second marker row and a WAL
   switch; the cluster is stopped and a copy of the base backup is recovered from the WAL archive to the target time.
   Only the first marker may be present, and the fingerprint must still equal the source.
6. **App check** on the recovered cluster: one job-worker pass with the limited jobs login (writes the heartbeat),
   then `next start` with the runtime login; `/api/health` and `/api/ready` must both answer 200.
7. **Teardown**: the private cluster is stopped and deleted, the source database dropped.

## Results

<!-- drill-results:start -->
**Last run:** 2026-11-25 11:16 UTC on Linux 6.18.44-fc-v880, PostgreSQL 16.15, commit `d976908`. [VERIFIED: produced by `scripts/ops/restore-drill.sh`; fictional data only]

| Step | Time |
|---|---|
| A. seed the source database (migrate + fictional merchants + one run per entity) | 6278 ms |
| B. `pg_dump -Fc` (695143 bytes) | 161 ms |
| C1. `initdb` a fresh private cluster (port 4454, data checksums, WAL archiving) and start it | 895 ms |
| C2. roles (`setup-local.sh`) + `pg_restore` | 4100 ms |
| C3. fingerprint and compare every table | 2347 ms |
| D1. `pg_basebackup` of the restored cluster | 1388 ms |
| D2. stop, recover a copy to the target time from the WAL archive, promote | 3265 ms |
| D3. fingerprint and compare again | 3668 ms |
| E1. one job-worker pass on the recovered cluster (jobs login; writes the heartbeat) | 2292 ms |
| E2. `next start` until `/api/health` answers | 5687 ms |
| **Total (excluding teardown)** | **30081 ms** |

- Logical restore vs source: `{"event":"drill_compare","tables":81,"rows":496,"migrations":52,"differences":[]}`
- Point-in-time recovery vs source: `{"event":"drill_compare","tables":81,"rows":496,"migrations":52,"differences":[]}`; marker rows after recovery: `1` (expected `1`: the row written after the target time is absent)
- `/api/health`: `{"status":"ok","checks":{"database":"ok","worker":"ok"}} 200` · `/api/ready`: `{"status":"ready","checks":{"database":"ok","worker":"ok"}} 200`
- Teardown: private cluster stopped and its directory removed; source database dropped.
<!-- drill-results:end -->

## What the drill does not prove

- [ASSUMPTION] Restore time at production size. The drill database is small; a managed provider's PITR restore time
  depends on database size and the provider. Measure it once on the real hosting before go-live (docs/ops/BACKUPS.md).
- [ASSUMPTION] Uploaded files. They live outside PostgreSQL (`CLEARLINE_UPLOAD_DIR`, AES-256-GCM with
  `CLEARLINE_UPLOAD_KEY`); their backup is the object store's versioning, and a restore needs the same upload key.
  The drill restores the database only.
- A restore of a real customer's data. That is never done for a drill.
