# Runbook: chain_reads monthly partitions

**Who:** an owner (the schema owner login, `DATABASE_OWNER_URL`). The app login and the jobs login cannot run it on
purpose (the function creates tables).
**When:** monthly, for example on the 1st, from the same owner runbook or cron that runs `purge-uploads`.
**Why:** `chain_reads` has one partition per month and no default partition. A chain read whose time falls in a month
without a partition is **refused** (loudly; nothing is stored silently elsewhere). The command keeps 24 months ahead
(v1 #169; migration 0047 created the same window on every database), so one missed month is not an outage, but two
years of missed runs would be.

## The command

```sh
DATABASE_URL="$DATABASE_OWNER_URL" npm run control:admin -- chain-read-partitions
# the same, explicit:
DATABASE_URL="$DATABASE_OWNER_URL" npm run control:admin -- chain-read-partitions --months-ahead 24
```

- Default 24 months ahead of the current month; `--months-ahead N` takes a whole number from 0 to 120.
- Idempotent: it creates only the missing months. A second run the same day prints `"created": 0`.
- It prints one line of JSON, counts only: `{"created": <n>, "lastPartition": "chain_reads_pYYYYMM"}`.
- Each new partition gets row-level security enabled and forced, no policy and no grant (only the parent table is
  reachable), and inherits the parent's indexes, checks, foreign keys and append-only trigger.

## Check it worked

```sql
-- the last month covered must be at least 23 months after the current month
select max(c.relname) as last_partition
from pg_inherits i join pg_class c on c.oid = i.inhrelid
where i.inhparent = 'chain_reads'::regclass;

-- every partition has RLS forced and no grant to the app role
select c.relname, c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('clearline_app', c.oid, 'SELECT') as app_select
from pg_inherits i join pg_class c on c.oid = i.inhrelid
where i.inhparent = 'chain_reads'::regclass and (not c.relrowsecurity or not c.relforcerowsecurity or has_table_privilege('clearline_app', c.oid, 'SELECT'));
-- expected: no rows
```

## If it fails

- `must be owner` / permission denied: you are not using the owner login. Use `DATABASE_OWNER_URL`.
- `range longer than 10 years`: `--months-ahead` above 120 is refused by the command; the function refuses ranges over
  ten years.
- A read was refused for a missing month: run the command, then re-run the reconciliation (`Run reconciliation` on
  the daily report). Nothing was stored for the refused read.

## Not part of this runbook

- Dropping old partitions (retention) is not decided.
- Dropping `chain_reads_unpartitioned` (the 0036 expand/contract leftover) is on the go-live checklist
  (docs/release/GO_LIVE_CHECKLIST.md): only after 30 days of verified use.

References: docs/perf/CHAIN_READS_PARTITIONING.md, drizzle/0036_chain_reads_partitioned.sql,
drizzle/0047_chain_reads_partitions_24_months.sql, `scripts/control/admin.ts` (`chain-read-partitions`).
