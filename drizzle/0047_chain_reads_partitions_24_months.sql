-- v1 (#169): chain_reads keeps monthly partitions 24 months ahead (was 12 in 0036). Runs as the schema owner. Creates
-- only the partitions that are missing (chain_reads_ensure_partitions is idempotent), each with RLS enabled and forced,
-- no policy and no grant, exactly as 0036's. Nothing else changes. 0036 is left as it was (it may already be applied
-- somewhere); this migration widens the window on every database, fresh or migrated.
SELECT chain_reads_ensure_partitions((now() AT TIME ZONE 'UTC')::date, ((now() AT TIME ZONE 'UTC')::date + make_interval(months => 24))::date);
