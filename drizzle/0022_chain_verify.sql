-- rc7 phase 2: chain verification. Runs as the schema owner. No existing control is relaxed: provider claims stay
-- unconfirmed and never final (0021), chain facts stay immutable except confirmations and finality (0007).

-- Founder decision (rc7): USDT on Ethereum is a configured token (public contract, 6 decimals).
INSERT INTO token_config (network, contract, symbol, decimals) VALUES
  ('ethereum', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 6)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A provider file's claim and the chain's fact about the same transfer are separate rows: the source is in the key.
ALTER TABLE "chain_transfers" DROP CONSTRAINT "chain_transfers_org_id_network_tx_hash_log_index_pk";
--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD CONSTRAINT "chain_transfers_org_id_network_tx_hash_log_index_source_pk" PRIMARY KEY ("org_id","network","tx_hash","log_index","source");
--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "evidence_source" text;
--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "evidence_host" text;
--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "evidence_endpoint" text;
--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "fetched_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "block_hash" text;
--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD CONSTRAINT "chain_transfers_evidence_chk" CHECK ("chain_transfers"."source" <> 'chain_client' or ("chain_transfers"."evidence_source" is not null and "chain_transfers"."evidence_host" is not null and "chain_transfers"."evidence_endpoint" is not null and "chain_transfers"."fetched_at" is not null));
--> statement-breakpoint

-- Every chain read the verify step made (append-only). Unavailable reads are shown as "chain data unavailable".
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
	CONSTRAINT "chain_reads_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "chain_reads_target_chk" CHECK (("chain_reads"."address" is null) <> ("chain_reads"."tx_hash" is null)),
	CONSTRAINT "chain_reads_status_chk" CHECK ("chain_reads"."status" in ('ok','unavailable','not_found','failed_transaction','reorged'))
);
--> statement-breakpoint
ALTER TABLE "chain_reads" ADD CONSTRAINT "chain_reads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chain_reads" ADD CONSTRAINT "chain_reads_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "chain_reads_entity_idx" ON "chain_reads" USING btree ("org_id","entity_id","at");
--> statement-breakpoint
ALTER TABLE chain_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chain_reads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON chain_reads USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_full_grant_read ON chain_reads FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint
CREATE TRIGGER chain_reads_append_only BEFORE UPDATE OR DELETE ON chain_reads FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
GRANT SELECT, INSERT ON chain_reads TO clearline_app;
