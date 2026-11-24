-- v1 phase 0: synthetic chain_reads volume for the partitioning benchmark (docs/perf/CHAIN_READS_PARTITIONING.md).
-- FICTIONAL data only: made-up organisations, users, entities, hashes and addresses. Run as the schema owner on a
-- throw-away benchmark database, never on a real one:
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -v scale=1 -f scripts/perf/chain-reads-seed.sql
-- Shape: one provider (fictional) with a 'full' grant on merchant A; merchant A is large (~80k reads/month on entity
-- a-1, which has no unavailable read: the loader's probe then finds nothing, the worst case), entity a-2 has a few
-- unavailable reads; merchants B..F are small (~8k reads/month each). 12 months: 2025-12 .. 2026-11.
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO organizations (id, slug, name, timezone, kind) VALUES
  ('00000000-0000-4000-8000-0000000000f0', 'bench-provider', 'Bench provider (fictional)', 'UTC', 'provider');
INSERT INTO organizations (id, slug, name, timezone, kind, provider_org_id)
SELECT ('00000000-0000-4000-8000-00000000000' || k)::uuid, 'bench-merchant-' || k, 'Bench merchant ' || upper(k) || ' (fictional)', 'UTC', 'merchant',
       '00000000-0000-4000-8000-0000000000f0'::uuid
FROM unnest(ARRAY['a','b','c','d','e','f']) k;
INSERT INTO users (id, name, email) SELECT 'bench-user-' || k, 'Bench user ' || k, 'bench-' || k || '@example.invalid'
FROM unnest(ARRAY['a','b','c','d','e','f','p']) k;
INSERT INTO organization_memberships (org_id, user_id, role)
SELECT ('00000000-0000-4000-8000-00000000000' || k)::uuid, 'bench-user-' || k, 'finance' FROM unnest(ARRAY['a','b','c','d','e','f']) k;
INSERT INTO organization_memberships (org_id, user_id, role) VALUES ('00000000-0000-4000-8000-0000000000f0', 'bench-user-p', 'finance');
INSERT INTO provider_grants (merchant_org_id, provider_org_id, scope, granted_by)
VALUES ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000f0', 'full', 'bench-user-a');
INSERT INTO merchant_entities (org_id, id, name, functional_currency, ledger, timezone)
SELECT ('00000000-0000-4000-8000-00000000000' || k)::uuid, k || '-' || n, 'Entity ' || k || n, 'USD', 'none', 'UTC'
FROM unnest(ARRAY['a','b','c','d','e','f']) k, generate_series(1, 2) n;

-- per (org, entity): reads per month. a-1 = 72k, a-2 = 8k, every other entity 4k.
CREATE TEMP TABLE bench_plan AS
SELECT ('00000000-0000-4000-8000-00000000000' || k)::uuid AS org_id, k || '-' || n AS entity_id,
       (CASE WHEN k = 'a' AND n = 1 THEN 72000 WHEN k = 'a' THEN 8000 ELSE 4000 END * :scale)::int AS per_month,
       (k = 'a' AND n = 2) AS with_outages
FROM unnest(ARRAY['a','b','c','d','e','f']) k, generate_series(1, 2) n;

-- Each run writes its reads with one timestamp (chain-verify.ts: `at: now`); one run per entity per day at 02:00 UTC.
-- 85% transaction reads, 15% address reads; 2% not_found; on a-2, 1 in 2000 reads is unavailable.
INSERT INTO chain_reads (org_id, entity_id, network, address, tx_hash, status, reason, source, host, endpoint, transfers, at)
SELECT p.org_id, p.entity_id,
       CASE WHEN g % 3 = 0 THEN 'ethereum' ELSE 'tron' END,
       CASE WHEN g % 20 < 3 THEN 'Tbench' || substr(md5(p.entity_id || (g % 500)), 1, 28) END,
       CASE WHEN g % 20 >= 3 THEN md5(p.entity_id || 'tx' || (g / 2)) END,
       CASE WHEN p.with_outages AND g % 2000 = 7 THEN 'unavailable' WHEN g % 50 = 1 THEN 'not_found' ELSE 'ok' END,
       CASE WHEN p.with_outages AND g % 2000 = 7 THEN 'recorded outage (HTTP 503)' END,
       'recording', 'rpc.example.invalid', 'eth_getTransactionReceipt', (g % 3),
       timestamptz '2025-12-01 02:00:00+00' + make_interval(days => ((g::bigint * 365) / (p.per_month * 12))::int)
FROM bench_plan p, generate_series(0, p.per_month * 12 - 1) g;
COMMIT;
ANALYZE chain_reads; ANALYZE organizations; ANALYZE organization_memberships; ANALYZE provider_grants; ANALYZE merchant_entities;
SELECT org_id, entity_id, count(*), min(at), max(at), count(*) FILTER (WHERE status = 'unavailable') AS unavailable
FROM chain_reads GROUP BY 1, 2 ORDER BY 1, 2;
