-- v1 phase 0: chain_reads is partitioned by month on the read time ("at"). Runs as the schema owner, in the migrator's
-- transaction. No control is relaxed: the table keeps its columns, checks, foreign keys, append-only trigger, grant
-- and row-level security policies exactly (the policies are rewritten separately in 0037, approval-only).
--
-- Expand / contract:
--   expand (this file): the old table is renamed chain_reads_unpartitioned, a partitioned chain_reads is created with
--     one partition per month from the oldest read (or January 2025, whichever is earlier) to 12 months ahead, every
--     row is copied (same ids, same values), and the app's grant moves to the new table. The old table keeps its
--     append-only trigger and RLS; the app login loses every privilege on it, so nothing reads or writes it any more.
--   contract (later, an owner action after the counts are checked; docs/perf/CHAIN_READS_PARTITIONING.md):
--     DROP TABLE chain_reads_unpartitioned;
-- The copy runs inside this migration (24,376 rows after the 30-day demo); for a much larger table see the doc's
-- zero-copy variant (attach the old table as one historical partition).
--
-- Keys: a partitioned table's primary key must contain the partition column, so (org_id, id) becomes (org_id, id, at).
-- ids stay gen_random_uuid() and nothing references chain_reads by id.
-- Partitions: the app login reaches chain_reads only through the parent. Every partition has RLS enabled and forced
-- with NO policy and no grant, so any direct access to a partition is refused (default deny), whoever asks.
-- A read in a month without a partition is refused by PostgreSQL ("no partition of relation "chain_reads" found for
-- row"): the whole chain-verify transaction fails loudly and writes nothing. There is no default partition on purpose.

ALTER TABLE "chain_reads" RENAME TO "chain_reads_unpartitioned";
--> statement-breakpoint
ALTER TABLE "chain_reads_unpartitioned" RENAME CONSTRAINT "chain_reads_org_id_id_pk" TO "chain_reads_unpartitioned_org_id_id_pk";
--> statement-breakpoint
ALTER INDEX "chain_reads_entity_idx" RENAME TO "chain_reads_unpartitioned_entity_idx";
--> statement-breakpoint
ALTER TABLE "chain_reads_unpartitioned" RENAME CONSTRAINT "chain_reads_target_chk" TO "chain_reads_unpartitioned_target_chk";
--> statement-breakpoint
ALTER TABLE "chain_reads_unpartitioned" RENAME CONSTRAINT "chain_reads_status_chk" TO "chain_reads_unpartitioned_status_chk";
--> statement-breakpoint
ALTER TABLE "chain_reads_unpartitioned" RENAME CONSTRAINT "chain_reads_org_id_organizations_id_fk" TO "chain_reads_unpartitioned_org_fk";
--> statement-breakpoint
ALTER TABLE "chain_reads_unpartitioned" RENAME CONSTRAINT "chain_reads_entity_fk" TO "chain_reads_unpartitioned_entity_fk";
--> statement-breakpoint
REVOKE ALL ON "chain_reads_unpartitioned" FROM clearline_app;
--> statement-breakpoint

CREATE TABLE "chain_reads" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"network" text NOT NULL,
	"address" text,
	"tx_hash" text,
	"status" text NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"host" text,
	"endpoint" text,
	"transfers" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "chain_reads_org_id_id_at_pk" PRIMARY KEY("org_id","id","at"),
	CONSTRAINT "chain_reads_target_chk" CHECK (("address" is null) <> ("tx_hash" is null)),
	CONSTRAINT "chain_reads_status_chk" CHECK ("status" in ('ok','unavailable','not_found','failed_transaction','reorged'))
) PARTITION BY RANGE ("at");
--> statement-breakpoint
ALTER TABLE "chain_reads" ADD CONSTRAINT "chain_reads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chain_reads" ADD CONSTRAINT "chain_reads_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- The loader (merchant-store.ts unavailableReads) reads one entity's reads ordered by (at, id): this index returns
-- them in that order per partition (a merge across partitions, no sort).
CREATE INDEX "chain_reads_entity_idx" ON "chain_reads" USING btree ("org_id","entity_id","at","id");
--> statement-breakpoint
-- The loader's probe ("is any read of this entity unavailable?") finds nothing in the usual case; without this partial
-- index it walks every read of the entity.
CREATE INDEX "chain_reads_unavailable_idx" ON "chain_reads" USING btree ("org_id","entity_id","at") WHERE "status" = 'unavailable';
--> statement-breakpoint
ALTER TABLE chain_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chain_reads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Same policies as 0022 (0037 rewrites them so the organisation check is one indexed predicate).
CREATE POLICY merchant_isolation ON chain_reads USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_full_grant_read ON chain_reads FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint
-- A row trigger on a partitioned table is cloned onto every partition, present and future.
CREATE TRIGGER chain_reads_append_only BEFORE UPDATE OR DELETE ON chain_reads FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
GRANT SELECT, INSERT ON chain_reads TO clearline_app;
--> statement-breakpoint

-- Creates the monthly partitions covering [from_month, to_month] that do not exist yet (idempotent) and returns how
-- many it created. Owner only (DDL): run by the admin CLI (`control:admin chain-read-partitions`) or a monthly job.
-- Each partition: RLS enabled and forced with no policy, no grant (only the parent is reachable); the parent's
-- indexes, checks, foreign keys and the append-only trigger are inherited by PostgreSQL.
CREATE FUNCTION chain_reads_ensure_partitions(from_month date, to_month date) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  m date := date_trunc('month', from_month)::date;
  last date := date_trunc('month', to_month)::date;
  part text;
  created integer := 0;
BEGIN
  IF from_month IS NULL OR to_month IS NULL OR last < m THEN RAISE EXCEPTION 'chain_reads_ensure_partitions: bad range'; END IF;
  IF last > m + interval '10 years' THEN RAISE EXCEPTION 'chain_reads_ensure_partitions: range longer than 10 years'; END IF;
  WHILE m <= last LOOP
    part := 'chain_reads_p' || to_char(m, 'YYYYMM');
    IF to_regclass('public.' || part) IS NULL THEN
      EXECUTE format('CREATE TABLE public.%I PARTITION OF public.chain_reads FOR VALUES FROM (%L) TO (%L)',
        part, (m::timestamp AT TIME ZONE 'UTC'), ((m + interval '1 month')::timestamp AT TIME ZONE 'UTC'));
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', part);
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, clearline_app', part);
      created := created + 1;
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
  RETURN created;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION chain_reads_ensure_partitions(date, date) FROM PUBLIC;
--> statement-breakpoint

-- The months every existing read needs, at least from January 2025 (the synthetic worlds, tests and the demo use
-- 2025-2026 dates), to 12 months ahead of now.
SELECT chain_reads_ensure_partitions(
  least(date '2025-01-01', (SELECT (min("at") AT TIME ZONE 'UTC')::date FROM chain_reads_unpartitioned)),
  greatest((now() AT TIME ZONE 'UTC')::date + 365, coalesce((SELECT (max("at") AT TIME ZONE 'UTC')::date FROM chain_reads_unpartitioned), date '2025-01-01')));
--> statement-breakpoint
INSERT INTO chain_reads (org_id, id, entity_id, network, address, tx_hash, status, reason, source, host, endpoint, transfers, at)
SELECT org_id, id, entity_id, network, address, tx_hash, status, reason, source, host, endpoint, transfers, at FROM chain_reads_unpartitioned;
--> statement-breakpoint
-- Refuse to continue if any row did not arrive (the migration then rolls back as a whole).
DO $$ BEGIN
  IF (SELECT count(*) FROM chain_reads) <> (SELECT count(*) FROM chain_reads_unpartitioned) THEN
    RAISE EXCEPTION 'chain_reads copy incomplete';
  END IF;
END $$;
--> statement-breakpoint
ANALYZE chain_reads;
