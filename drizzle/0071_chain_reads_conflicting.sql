-- v1 phase 2.4: a chain read may be "conflicting" (a primary and a fallback chain data provider disagree on a fact).
-- Runs as the schema owner. No control is relaxed: the table stays append-only with the same RLS, grant and keys; the
-- only change is one more allowed status. A conflicting read is never matched (engine rule M1.chain.conflicting).
-- The constraint is dropped and re-added on the partitioned parent, which applies it to every partition.
ALTER TABLE "chain_reads" DROP CONSTRAINT "chain_reads_status_chk";
--> statement-breakpoint
ALTER TABLE "chain_reads" ADD CONSTRAINT "chain_reads_status_chk" CHECK ("status" in ('ok','unavailable','not_found','failed_transaction','reorged','conflicting'));
-- No new index: the partition checks pin each partition's index set (tests/control/chain-reads-partitioning.test.ts).
-- The loader's probe for unavailable-or-conflicting reads uses the existing partial index for its 'unavailable' arm.
