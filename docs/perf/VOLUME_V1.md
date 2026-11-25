# Volume v1 (phase 3): 100,000 payments and 5,000 bank lines per merchant per month

Synthetic (fictional) data only. Measured on the shared development machine (4 cores, PostgreSQL 16 on the same
host, other agents' test suites running at the same time: load average 4–14 during the runs). Numbers are medians of
3 repetitions unless said otherwise. [VERIFIED] = seen in the run output below.

## Targets and result

| Target | Median of 3 | Runs (s) | Verdict |
|---|---|---|---|
| Full month reconciliation < 5 min | **167.1 s** | 180.8 · 167.1 · 143.2 | **met** [VERIFIED] |
| Daily incremental run < 60 s | **176.6 s** | 210.2 · 176.6 · 141.2 | **missed** [VERIFIED] |

`npm run bench:volume -- --payments 100000 --bank-lines 5000 --reps 3` (scripts/perf/volume-bench.ts), at commit
707aa8b. Each repetition seeds a fresh live organisation (two entities, SGD 70,004 and USD 29,996 payments; 5,000
bank lines) and times:

- **initial**: the month without its last day, reconciled for the first time — median 164.9 s;
- **daily**: the last day arrives (3,862 payments) and both entities are reconciled — median 176.6 s;
- **full month**: every payment re-decided and re-written under a new rule-set version — median 167.1 s.

Each run includes chain verification (against the recorded synthetic chain data, offline: no RPC latency), loading
the rows, the engine and every write. Ingestion (not a target) took 52.8–74.0 s per repetition through
`writeIngested` in 2,000-row chunks.

Stage times (ms, both entities, repetition 3 — the least loaded):

| Run | chain verify | load | engine | write |
|---|---|---|---|---|
| initial | 23,308 | 22,329 | 26,747 | 62,945 |
| daily | 38,781 | 23,108 | 30,619 | 41,134 |
| full month | 38,358 | 23,137 | 35,696 | 38,875 |

The engine alone (no database, scripts/perf/engine-digest.ts) takes 6.0 s + 2.7 s on the same month when the machine
is quiet; in the runs above it shared the CPU with PostgreSQL and other agents' suites.

## What changed, and proof that results did not

Results must not change to get speed. Two digests prove it on fixed seeds:

1. **Engine** (`npm run bench:engine-digest`, 100,000 payments, seed 20261001): sha-256 of the full engine output per
   entity, before and after the engine change (commit 079a986):
   - ENT-SG-SYN `6f01e9d4671832bed6549f51f9abef4840f1daee71955e52cf8b1279402852a7` before (334,308 ms) and after (5,994 ms)
   - ENT-US-SYN `fde8642825060ce11616f664629e418b24330902375b5cad0907cf15310c50c6` before (65,111 ms) and after (2,706 ms)
2. **Stored results** (`--digest`, scripts/perf/db-digest.ts, 20,000 payments): digests of match records, differences,
   exceptions, write-offs, journal proposals, chain facts and run counts after the initial, daily and full-month runs.
   Equal before the database changes (commit 761e4fe) and after each of them (f41d237 bulk statements; 3d4ec10
   rewrite-only-what-changed). Wall-clock times, random run ids and the benchmark's own org id are left out by design.

Changes:

| Change | Where | Effect |
|---|---|---|
| Step 5 scanned every bridge for every payment; address facts, refund lines and provider records scanned per order | engine (079a986) | engine 334 s → 6 s at 70,004 payments (quadratic → linear) |
| Multi-row VALUES inserts (rows × columns parameters) | `db/bulk.ts` `unnest` per column (f41d237) | one parse per 5,000 rows |
| Id lists sent as one parameter per id (70,000) | `anyOf`: one `text[]` parameter (f41d237) | no giant statements |
| Every run rewrote every record and journal | content fingerprints, 0064 (3d4ec10) | unchanged rows get one narrow update |
| Journal supersede sent kept ids as separate parameters | one array (707aa8b) | **a 100,000-payment run failed before** (68,000 > 65,535 parameters) |
| `writeIngested` scanned quotes per invoice and per link | maps (761e4fe) | ingestion linear |

A subquery form (`order_id in (select … from invoices …)`) was tried and dropped: with freshly ingested, not yet
analysed tables PostgreSQL chose a nested loop and the run hit the 15 s statement timeout.

## Why the daily target is missed, and what would meet it

The daily run is not incremental yet: it verifies the chain for every issued address of the month (~100,000 reads and
~100,000 fact upserts plus ~300,000 read rows), loads the whole month under row-level security, runs the engine over
every payment and writes only what changed. Every stage scales with the month, not with the day. With a real chain
client the chain stage would be slower still (network reads, rate limits). Options, none built:

1. **Chain verification of open payments only** (addresses of payments not yet matched-final, of the last N days, and
   claims not yet final), with a full verification weekly and at month end. **APPROVAL-ONLY**: a late second transfer
   to an old, already matched address would be noticed at the next full verification instead of the next day. That
   delays detection; it does not change any matching rule. Expected saving: most of the 38–55 s chain stage.
2. **An incremental engine** that re-decides only payments affected by new rows (new orders, their batches and bank
   lines, new transfers and provider records), proven equal to the full run by the digests above on many seeds.
   Large: the engine's step 5 and journals are batch-wide, so the affected set has to be closed over batches.
3. **Load**: 23 s is row-level-security evaluation per row (merchant isolation plus the 0053 entity scope subplans).
   A per-run snapshot read is possible but touches security controls (APPROVAL-ONLY); not attempted.

[ASSUMPTION] On a dedicated 4-core database host with no other load the same runs would be faster (repetition 3, at
the lowest load, took 141 s daily); not measured.

## Reproduce

```
DATABASE_URL=<runtime> CLEARLINE_BENCH_OWNER_URL=<owner> npm run bench:volume -- --payments 100000 --bank-lines 5000 --reps 3 [--digest] [--keep]
npm run bench:engine-digest -- --payments 100000
```
