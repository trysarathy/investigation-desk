# chain_reads: monthly partitions and indexed row-level security

v1 phase 0. Every reconciliation run writes its chain reads to `chain_reads` (append-only). The table had 24,376 rows after
the 30-day demo, and v1 aims at 100,000 payments per merchant per month. This note gives the measurements before and after
two migrations:

- `drizzle/0036_chain_reads_partitioned.sql`: the table is partitioned by month on `at`, with indexes for the loader's two queries.
- `drizzle/0037_chain_reads_rls_indexed.sql` (**APPROVAL-ONLY**, because it changes a security control): the RLS policies are
  rewritten so the organisation check is one indexed predicate. The membership and grant checks run once per statement
  instead of once per row.

Matching behaviour is unchanged. The loader's queries (`src/server/merchant-store.ts` `unavailableReads`) and the writer
(`src/server/chain-verify.ts`) are the same code. Only the table, its indexes and its policies change.

## Machine and data

- **Machine** [VERIFIED]: a shared cloud container with 4 vCPU (Intel Xeon @ 2.10GHz), 15 GiB RAM and a virtio disk, on Linux 6.18.
  The database is PostgreSQL 16.15 with near-default settings: `shared_buffers` 160 MB, `work_mem` 4 MB, `jit` on and
  `max_parallel_workers_per_gather` 2. Other agents shared the host while this ran, so the absolute numbers are noisy. The
  ratios between runs are the useful part.
- **Data** [VERIFIED]: `scripts/perf/chain-reads-seed.sql` (fictional data). It creates 6 merchants and 1 provider, which
  holds a `full` grant on merchant A, with 12 entities over 12 months (2025-12 to 2026-11) and one run per entity per day.
  Rows per entity:

  | entity | rows | per month | unavailable reads |
  |---|---:|---:|---:|
  | a-1 | 864,000 | 72,000 | 0 (the loader's probe finds nothing, the worst case) |
  | a-2 | 96,000 | 8,000 | 48 |
  | b-1 … f-2 (10 entities) | 48,000 each | 4,000 | 0 |
  | **total** | **1,440,000** | | |

  85% of the reads are transaction reads and 15% are address reads. 2% are `not_found`.
- **Method** [VERIFIED]: `scripts/perf/chain-reads-bench.mjs`. Each query runs as the runtime login `clearline_runtime`,
  which is NOBYPASSRLS, so RLS applies. It runs inside a transaction that sets `app.user_id` / `app.org_id` exactly as
  `withTenant` does, under `EXPLAIN (ANALYZE, BUFFERS)`. Each query gets one warm-up run, and the table reports the
  **median of 5**. The insert is rolled back. Literal values replace drizzle's `$n` parameters; node-postgres sends
  unnamed statements, so each execution gets a custom plan either way.

## Hot queries

| id | where | query |
|---|---|---|
| Q1 | loader probe | `select id … where org_id = ? and entity_id = ? and status = 'unavailable' limit 1` (entity a-1, none exist) |
| Q2 | loader | `select * … where org_id = ? and entity_id = ? and tx_hash is not null order by at, id` (a-1; the usual path) |
| Q3 | loader probe | same as Q1, for a-2 (one exists) |
| Q4 | loader | `select * … where org_id = ? and entity_id = ? order by at, id` (a-2; the path when a read was unavailable) |
| Q5 | loader | Q2 for a small merchant (b-1) |
| Q6 | chain-verify | insert one 1,000-row chunk |
| Q7 | provider read | Q4 run as the provider's member, under the `full` grant |
| Q8 | isolation tests | `select count(*) from chain_reads` as merchant B (no filter of its own) |
| Q9 | illustrative | a-1's reads for one month (not an app query today; it shows partition pruning) |

## Results (median of 5 runs, execution ms; planning ms in brackets)

| query | rows | before (0022) | partitioned only (0036) | after (0036 + 0037) | before → after |
|---|---:|---:|---:|---:|---:|
| Q1 probe, none unavailable | 0 | 155.57 (0.17) | 0.18 (1.79) | 1.00 (2.10) | 156× |
| Q2 tx reads of a-1 | 734,400 | **43,501.43** (0.14) | 49,527.91 (6.70) | **449.82** (1.85) | 97× |
| Q3 probe, one unavailable | 1 | 3.55 (0.11) | 0.53 (1.89) | 0.57 (1.03) | 6× |
| Q4 every read of a-2 | 96,000 | 5,592.88 (0.18) | 8,045.46 (2.58) | 74.33 (1.39) | 75× |
| Q5 tx reads of b-1 | 40,800 | 831.11 (0.35) | 964.83 (2.55) | 34.44 (1.57) | 24× |
| Q6 insert 1,000 reads | 0 | 50.69 (1.96) | 46.58 (2.71) | 19.35 (1.90) | 2.6× |
| Q7 provider reads a-2 | 96,000 | 6,393.38 (0.29) | 7,558.29 (3.15) | 87.43 (1.57) | 73× |
| Q8 count(*) as merchant B | 1 | **75,382.27** (0.35) | 72,629.57 (2.21) | **41.75** (0.94) | 1,805× |
| Q9 one month of a-1 | 71,013 | 5,534.33 (0.15) | 4,051.29 (0.25) | 31.81 (0.15) | 174× |

Shared buffers touched (median): Q2 2,224,026 → 858,594; Q8 2,497,552 → 4,153; Q4 290,417 → 3,403.

Before, Q2 alone took 43.5 s, against the app's `statement_timeout` of 15 s (`src/server/db/client.ts`). The loader would
fail for merchant A's entity at this volume.

### What made the difference

- **Per-row SECURITY DEFINER calls, not partitions.** Before, every candidate row was filtered by
  `app_provider_full_access(org_id) OR (org_id = app_org_id() AND app_is_member(org_id))`, which made two function calls,
  each with its own query, per row. In the before plan, Q2 shows `Filter: … app_provider_full_access(org_id) OR …` over
  864,000 index rows. The OR across the two policies also meant the organisation check could never be an index
  condition: Q8 walked all 1,440,000 rows ("Rows Removed by Filter: 1344000"). Partitioning alone (the middle column)
  changes almost nothing for these queries and adds about 2 ms of planning for ~35 partitions.
- **After 0037** the only RLS predicate on a read is `org_id = ANY ($0)`, where `$0` is one InitPlan
  (`app_readable_org_ids()`, evaluated once). In the after plans it is an **Index Cond** on every partition
  (`Index Cond: ((org_id = ANY ($0)) AND (org_id = '…'::uuid) AND (entity_id = 'a-1'::text))`), and Q8 becomes an
  index-only scan of the primary key. No `app_is_member(org_id)` or `app_provider_full_access(org_id)` appears in any
  after plan; the before plans contain 8 such per-row filters and the partitioned-only plans 246.
- **Ordered partitions.** Q2 after is a plain `Append` of per-partition index scans on `(org_id, entity_id, at, id)`. Range
  partitions on `at` are already in order, so no sort is needed. Before, Q4/Q7 sorted 96k rows on disk (external merge,
  16 MB).
- **The probe's partial index** `(org_id, entity_id, at) WHERE status = 'unavailable'` makes "is any read unavailable?"
  free when none is (Q1, 155 ms → ~1 ms).
- **Pruning** (Q9) works for time-bounded queries. The loader has no time bound today, so it scans every partition's
  index for the entity. That is cheap for empty partitions, but its cost still grows with history (see the decision
  below).

## The migrations

### 0036: partition (expand / contract)

- **Expand** (the migration, one transaction): `chain_reads` is renamed to `chain_reads_unpartitioned`, and the app
  login's privileges on it are revoked. Its append-only trigger and RLS stay. A partitioned `chain_reads` is created
  with the same columns, checks, foreign keys, append-only trigger (cloned onto every partition, present and future),
  grant (`SELECT, INSERT` to `clearline_app`) and policies. Partitions are created for every month from January 2025, or
  the oldest read if older, to 12 months ahead (widened to 24 by 0047, #169), and every row is copied with the same ids. The migration aborts if the
  counts differ. Copying the 1.44M benchmark rows took 23.5 s inside the migration. The 24k demo-sized table takes well
  under a second.
- **Contract** (later, owner, after checking counts): `DROP TABLE chain_reads_unpartitioned;`. The contract step is not a
  migration, so a rollback window stays open until someone chooses to close it.
- **Zero-copy variant** for a much larger table (not used here): build a unique index on `(org_id, id, at)` concurrently on
  the old table and add `CHECK (at >= … AND at < …)` as NOT VALID, then validate it. Then attach the old table as one
  historical partition covering its whole range (`ATTACH PARTITION` takes only a SHARE UPDATE EXCLUSIVE lock once the
  check is validated). Monthly partitions start from the next month.
- **Key**: the primary key must contain the partition column, so `(org_id, id)` becomes `(org_id, id, at)`. ids are still
  `gen_random_uuid()`, and nothing references `chain_reads` by id. [ASSUMPTION] Uniqueness of `(org_id, id)` alone is no
  longer enforced by the database. No code relies on it.
- **Partitions are default-deny.** Each one has RLS enabled and forced with no policy, and no grant. The app login can
  reach `chain_reads` only through the parent, where the parent's policies apply, as PostgreSQL applies them. Direct
  access to a partition is refused (tested).
- **Merchant deletion** (`src/server/merchant-deletion.ts`) now skips partitions when it lists org-scoped tables. A
  partition's rows are deleted and counted once, through the parent. `ALTER TABLE chain_reads DISABLE TRIGGER USER`
  recurses to the partitions on PostgreSQL 16 (verified on a scratch database).

### Future partitions

- `chain_reads_ensure_partitions(from_month date, to_month date)` creates the missing months (idempotent, at most
  10 years per call, owner only). Neither the runtime login nor the jobs login can execute it (tested).
- Owner command: `DATABASE_URL=$DATABASE_OWNER_URL npm run control:admin -- chain-read-partitions [--months-ahead 24]`.
  **Run it monthly** (docs/runbooks/CHAIN_READ_PARTITIONS.md). v1 #169: the default is 24 months ahead and migration
  0047 widens the initial window to 24 months ahead (0036 itself is unchanged and covered 12), so a missed run leaves
  two years of slack.
- **A month without a partition fails loudly.** There is deliberately no DEFAULT partition. An insert into a missing month
  raises `no partition of relation "chain_reads" found for row`. The whole chain-verify transaction rolls back (reads,
  facts and audit together), so the run fails visibly instead of losing reads silently (tested for 2099 and for 2024).
- Retention is not part of this change. Partitions make it a `DETACH PARTITION` / `DROP TABLE` by an owner, but no
  retention period has been decided for chain reads.

### 0037: indexed RLS — APPROVAL-ONLY

| | before | after |
|---|---|---|
| read | `merchant_isolation` (ALL): `org_id = app_org_id() AND app_is_member(org_id)` **OR** `provider_full_grant_read` (SELECT): `app_provider_full_access(org_id)`, both per row | `chain_reads_read` (SELECT): `org_id = ANY ((SELECT app_readable_org_ids())::uuid[])`, once per statement |
| insert | `org_id = app_org_id() AND app_is_member(org_id)` per row | `chain_reads_insert` (INSERT): `org_id = app_org_id() AND (SELECT app_is_member(app_org_id()))` once |
| update / delete | `merchant_isolation` (ALL) applied, but no privilege and the append-only trigger refused them anyway | no policy (deny), no privilege, append-only trigger: still refused |

Why isolation is unchanged:

- `app_readable_org_ids()` returns `{app_org_id()}` when `app_is_member(app_org_id())`, plus
  `app_provider_full_access_merchants()`. The second function has exactly the joins and conditions of
  `app_provider_full_access(m)` (an unrevoked `full` grant from the merchant to its own provider, the current context
  being that provider, and the user an active member of it), but it returns the set instead of testing one id. Both new
  functions are `STABLE SECURITY DEFINER` with a fixed `search_path`, are executable by `clearline_app` only, and see one
  snapshot per statement.
- Control tests (`tests/control/chain-reads-partitioning.test.ts`, all against PostgreSQL as the runtime login): a member
  sees only their organisation's reads. Another organisation's reads are invisible even when named. A member claiming
  another organisation's context sees nothing, and with no organisation in context nothing is visible. Inserts into
  another organisation, from a non-member context, by a provider, or as a multi-row insert with one foreign row are
  refused. A revoked member loses read and write. A provider sees nothing with no grant or an `aggregates` grant, sees
  exactly the granted merchant under `full`, sees nothing once the grant is revoked, never sees another provider's
  merchants, and gains nothing from a grant to a provider that is not the merchant's own. The policies' text is
  pinned, and `EXPLAIN` shows `Index Cond: (org_id = ANY ($0))` with one InitPlan and no per-row function.
- The other tenant tables still use the 0001/0007 per-row policies. The same rewrite would apply to them, but it is not
  done here: each one is its own approval.

## Decisions needed

1. **Approve 0037** (security control). Without it, 0036 alone does not fix the hot queries (middle column).
2. **The loader reads an entity's whole chain-read history on every run** (Q2: 734k rows, 450 ms and 860k buffers after
   one year at 72k reads per month). That is fine for now, but it grows linearly. Two options, both of which change the
   loader and need a separate review because they touch what the engine sees:
   (a) a small "latest read per target" table maintained on insert, which gives the same result as today's
   latest-per-key fold, or (b) bounding the read window. Option (b) changes behaviour (an old unavailable read could
   stop surfacing) and is **not** recommended without a matching review.
3. **Contract**: when to drop `chain_reads_unpartitioned`. Decided (#169): only after 30 days of verified use, on the go-live checklist (docs/release/GO_LIVE_CHECKLIST.md) with the exact SQL.
4. **Who runs `chain-read-partitions` monthly**: an owner runbook or cron. The jobs login deliberately cannot run it.

## Reproduce

```sh
bash scripts/db/setup-local.sh clearline_bench <owner_pw> <runtime_pw> <jobs_pw>   # fictional DB
# migrate to 0032 (before) and seed:
psql "$OWNER_URL" -v ON_ERROR_STOP=1 -v scale=1 -f scripts/perf/chain-reads-seed.sql
RUNTIME_URL=$RUNTIME_URL node scripts/perf/chain-reads-bench.mjs before plans-before.txt
# migrate 0036, then rerun; migrate 0037, then rerun ("after")
```

The before, partitioned-only and after runs above were made on the same seeded database, in that order (about 18 min,
16 min and 3 min).
