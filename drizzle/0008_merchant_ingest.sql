CREATE TABLE "address_facts" (
	"org_id" uuid NOT NULL,
	"network" text NOT NULL,
	"address" text NOT NULL,
	"fact" text NOT NULL,
	CONSTRAINT "address_facts_org_id_network_address_fact_pk" PRIMARY KEY("org_id","network","address","fact"),
	CONSTRAINT "address_facts_fact_chk" CHECK ("address_facts"."fact" in ('registered_wallet','intermediate_wallet','exchange_hot_wallet','unknown'))
);
--> statement-breakpoint
ALTER TABLE "provider_payment_records" DROP CONSTRAINT "provider_payment_records_claim_chk";--> statement-breakpoint
ALTER TABLE "writeoff_proposals" DROP CONSTRAINT "writeoff_proposals_status_chk";--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "provenance" text;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "claimed_symbol" text;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "prior_hops" jsonb;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "merchant_entities" ADD COLUMN "utc_offset_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_policy" ADD COLUMN "sender_fee_bound_base_units" numeric(78, 0) DEFAULT 2000000 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "quote_id" text;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "token_contract" text;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "requested_base_units" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD COLUMN "day_utc_offset_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "address_facts" ADD CONSTRAINT "address_facts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payment_records" ADD CONSTRAINT "provider_payment_records_claim_chk" CHECK ("provider_payment_records"."status_claim" in ('paid','underpaid','overpaid','held_for_review','re_quoted','partially_paid','refunded','pending','failed'));--> statement-breakpoint
ALTER TABLE "writeoff_proposals" ADD CONSTRAINT "writeoff_proposals_status_chk" CHECK ("writeoff_proposals"."status" in ('proposed','awaiting_approval','approved','rejected','superseded'));