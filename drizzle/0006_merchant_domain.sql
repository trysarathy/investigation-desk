CREATE TABLE "bank_lines" (
	"org_id" uuid NOT NULL,
	"line_id" text NOT NULL,
	"account" text NOT NULL,
	"currency" text NOT NULL,
	"value_date" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"import_id" uuid,
	CONSTRAINT "bank_lines_org_id_line_id_pk" PRIMARY KEY("org_id","line_id"),
	CONSTRAINT "bank_lines_source_chk" CHECK ("bank_lines"."source" in ('bank_feed','csv_import','seed_fictional')),
	CONSTRAINT "bank_lines_import_chk" CHECK ("bank_lines"."source" <> 'csv_import' or "bank_lines"."import_id" is not null),
	CONSTRAINT "bank_lines_date_chk" CHECK ("bank_lines"."value_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "chain_transfers" (
	"org_id" uuid NOT NULL,
	"network" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"token_contract" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"amount_base_units" numeric(78, 0) NOT NULL,
	"decimals" integer NOT NULL,
	"block" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"confirmations" integer NOT NULL,
	"finalised" boolean NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_transfers_org_id_network_tx_hash_log_index_pk" PRIMARY KEY("org_id","network","tx_hash","log_index"),
	CONSTRAINT "chain_transfers_amount_chk" CHECK ("chain_transfers"."amount_base_units" > 0),
	CONSTRAINT "chain_transfers_source_chk" CHECK ("chain_transfers"."source" in ('recorded_fixture','chain_client','seed_fictional'))
);
--> statement-breakpoint
CREATE TABLE "differences" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"rule_id" text NOT NULL,
	CONSTRAINT "differences_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "differences_type_chk" CHECK (type in ('sender_side_fee','underpayment','overpayment','requote_after_expiry','rate_difference','provider_fee','refund_netted','timing_prior_batch','timing_next_batch','held_by_provider','partial_payment_open','unexplained')),
	CONSTRAINT "differences_reason_chk" CHECK (length("differences"."reason") between 3 and 1000)
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"org_id" uuid NOT NULL,
	"pair" text NOT NULL,
	"rate" numeric(24, 10) NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_rates_org_id_pair_source_observed_at_pk" PRIMARY KEY("org_id","pair","source","observed_at"),
	CONSTRAINT "fx_rates_pair_chk" CHECK ("fx_rates"."pair" ~ '^[A-Z]{3,4}/[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"org_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invoices_org_id_order_id_pk" PRIMARY KEY("org_id","order_id"),
	CONSTRAINT "invoices_amount_chk" CHECK ("invoices"."amount_minor" > 0),
	CONSTRAINT "invoices_cur_chk" CHECK ("invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoices_status_chk" CHECK ("invoices"."status" in ('open','part_paid','paid','closed_with_difference','overpaid','void'))
);
--> statement-breakpoint
CREATE TABLE "match_records" (
	"org_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"decision" text NOT NULL,
	"deciding_step" integer NOT NULL,
	"rule_id" text NOT NULL,
	"chain" jsonb NOT NULL,
	"provider" jsonb NOT NULL,
	"bank" jsonb NOT NULL,
	"ledger" jsonb NOT NULL,
	"explanation" jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"input_sha256" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_records_org_id_order_id_pk" PRIMARY KEY("org_id","order_id"),
	CONSTRAINT "match_records_decision_chk" CHECK ("match_records"."decision" in ('matched','matched_with_difference','suggested_for_review','exception')),
	CONSTRAINT "match_records_step_chk" CHECK ("match_records"."deciding_step" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "match_reviews" (
	"org_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"verdict" text NOT NULL,
	"note" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_reviews_org_id_order_id_reviewer_user_id_pk" PRIMARY KEY("org_id","order_id","reviewer_user_id"),
	CONSTRAINT "match_reviews_verdict_chk" CHECK ("match_reviews"."verdict" in ('correct','wrong'))
);
--> statement-breakpoint
CREATE TABLE "merchant_entities" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"functional_currency" text NOT NULL,
	"ledger" text NOT NULL,
	"timezone" text NOT NULL,
	CONSTRAINT "merchant_entities_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "merchant_entities_cur_chk" CHECK ("merchant_entities"."functional_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "merchant_entities_ledger_chk" CHECK ("merchant_entities"."ledger" in ('xero','quickbooks','none'))
);
--> statement-breakpoint
CREATE TABLE "merchant_journal_proposals" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"entity_id" text NOT NULL,
	"pattern" text NOT NULL,
	"lines" jsonb NOT NULL,
	"currency" text NOT NULL,
	"evidence_refs" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"posting_rule_status" text DEFAULT 'pending_sign_off' NOT NULL,
	CONSTRAINT "merchant_journal_proposals_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "merchant_journal_status_chk" CHECK ("merchant_journal_proposals"."status" in ('proposed','approved','exported','rejected','superseded')),
	CONSTRAINT "merchant_journal_rule_chk" CHECK ("merchant_journal_proposals"."posting_rule_status" = 'pending_sign_off')
);
--> statement-breakpoint
CREATE TABLE "merchant_policy" (
	"org_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"tolerance_bps" integer DEFAULT 50 NOT NULL,
	"tolerance_abs_minor" bigint DEFAULT 500 NOT NULL,
	"writeoff_threshold_minor" bigint DEFAULT 500 NOT NULL,
	"approver_roles" jsonb DEFAULT '["approver"]'::jsonb NOT NULL,
	"allow_imported_bank_lines_as_verified" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_policy_org_id_entity_id_pk" PRIMARY KEY("org_id","entity_id"),
	CONSTRAINT "merchant_policy_bps_chk" CHECK ("merchant_policy"."tolerance_bps" between 0 and 1000),
	CONSTRAINT "merchant_policy_abs_chk" CHECK ("merchant_policy"."tolerance_abs_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "merchant_quotes" (
	"org_id" uuid NOT NULL,
	"quote_id" text NOT NULL,
	"order_id" text NOT NULL,
	"network" text NOT NULL,
	"token_contract" text NOT NULL,
	"quoted_base_units" numeric(78, 0) NOT NULL,
	"rate" numeric(24, 10) NOT NULL,
	"rate_source" text NOT NULL,
	"rate_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deposit_address" text NOT NULL,
	CONSTRAINT "merchant_quotes_org_id_quote_id_pk" PRIMARY KEY("org_id","quote_id"),
	CONSTRAINT "merchant_quotes_window_chk" CHECK ("merchant_quotes"."expires_at" > "merchant_quotes"."created_at")
);
--> statement-breakpoint
CREATE TABLE "network_config" (
	"network" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"confirmations_required" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "network_config_conf_chk" CHECK ("network_config"."confirmations_required" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"org_id" uuid NOT NULL,
	"link_id" text NOT NULL,
	"order_id" text NOT NULL,
	"kind" text NOT NULL,
	"network" text NOT NULL,
	"deposit_address" text NOT NULL,
	"requested_minor" bigint NOT NULL,
	CONSTRAINT "payment_links_org_id_link_id_pk" PRIMARY KEY("org_id","link_id"),
	CONSTRAINT "payment_links_kind_chk" CHECK ("payment_links"."kind" in ('full','balance'))
);
--> statement-breakpoint
CREATE TABLE "pilot_time_log" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	CONSTRAINT "pilot_time_log_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "pilot_time_log_min_chk" CHECK ("pilot_time_log"."minutes" between 0 and 1440)
);
--> statement-breakpoint
CREATE TABLE "provider_grants" (
	"merchant_org_id" uuid NOT NULL,
	"provider_org_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "provider_grants_merchant_org_id_provider_org_id_pk" PRIMARY KEY("merchant_org_id","provider_org_id"),
	CONSTRAINT "provider_grants_scope_chk" CHECK ("provider_grants"."scope" in ('aggregates','full'))
);
--> statement-breakpoint
CREATE TABLE "provider_payment_records" (
	"org_id" uuid NOT NULL,
	"provider_payment_id" text NOT NULL,
	"quote_id" text,
	"link_id" text,
	"status_claim" text NOT NULL,
	"received_base_units" numeric(78, 0),
	"credited_minor" bigint,
	"credited_currency" text,
	"executed_rate" numeric(24, 10),
	"fee_minor" bigint,
	"batch_id" text,
	"import_id" uuid,
	"record" jsonb NOT NULL,
	CONSTRAINT "provider_payment_records_org_id_provider_payment_id_pk" PRIMARY KEY("org_id","provider_payment_id"),
	CONSTRAINT "provider_payment_records_claim_chk" CHECK ("provider_payment_records"."status_claim" in ('paid','underpaid','overpaid','held_for_review','re_quoted','refunded','pending','failed')),
	CONSTRAINT "provider_payment_records_ref_chk" CHECK ("provider_payment_records"."quote_id" is not null or "provider_payment_records"."link_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "recon_exceptions" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"order_id" text,
	"owner_role" text NOT NULL,
	"owner_user_id" text,
	"reason" text NOT NULL,
	"next_step" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "recon_exceptions_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "recon_exceptions_status_chk" CHECK ("recon_exceptions"."status" in ('open','in_review','resolved')),
	CONSTRAINT "recon_exceptions_text_chk" CHECK (length("recon_exceptions"."reason") >= 3 and length("recon_exceptions"."next_step") >= 3 and length("recon_exceptions"."owner_role") >= 3)
);
--> statement-breakpoint
CREATE TABLE "settlement_batch_lines" (
	"org_id" uuid NOT NULL,
	"batch_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "settlement_batch_lines_org_id_batch_id_line_no_pk" PRIMARY KEY("org_id","batch_id","line_no"),
	CONSTRAINT "settlement_batch_lines_kind_chk" CHECK ("settlement_batch_lines"."kind" in ('payment','refund'))
);
--> statement-breakpoint
CREATE TABLE "settlement_batches" (
	"org_id" uuid NOT NULL,
	"batch_id" text NOT NULL,
	"day_start" timestamp with time zone NOT NULL,
	"day_end" timestamp with time zone NOT NULL,
	"day_timezone" text NOT NULL,
	"currency" text NOT NULL,
	"target_bank_account" text NOT NULL,
	"gross_minor" bigint NOT NULL,
	"fees_minor" bigint NOT NULL,
	"refunds_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	CONSTRAINT "settlement_batches_org_id_batch_id_pk" PRIMARY KEY("org_id","batch_id"),
	CONSTRAINT "settlement_batches_arith_chk" CHECK ("settlement_batches"."gross_minor" - "settlement_batches"."fees_minor" - "settlement_batches"."refunds_minor" = "settlement_batches"."net_minor"),
	CONSTRAINT "settlement_batches_cur_chk" CHECK ("settlement_batches"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "token_config" (
	"network" text NOT NULL,
	"contract" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" integer NOT NULL,
	CONSTRAINT "token_config_network_contract_pk" PRIMARY KEY("network","contract"),
	CONSTRAINT "token_config_dec_chk" CHECK ("token_config"."decimals" between 0 and 36)
);
--> statement-breakpoint
CREATE TABLE "writeoff_proposals" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"order_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"difference_ids" jsonb NOT NULL,
	"prepared_by" text,
	"approval_request_id" uuid,
	"status" text DEFAULT 'proposed' NOT NULL,
	CONSTRAINT "writeoff_proposals_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "writeoff_proposals_amount_chk" CHECK ("writeoff_proposals"."amount_minor" > 0),
	CONSTRAINT "writeoff_proposals_status_chk" CHECK ("writeoff_proposals"."status" in ('proposed','awaiting_approval','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_kind_chk";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "kind" text DEFAULT 'merchant' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "provider_org_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "theme" jsonb;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD CONSTRAINT "chain_transfers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "differences" ADD CONSTRAINT "differences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "differences" ADD CONSTRAINT "differences_invoice_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."invoices"("org_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_invoice_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."invoices"("org_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reviews" ADD CONSTRAINT "match_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reviews" ADD CONSTRAINT "match_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_entities" ADD CONSTRAINT "merchant_entities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_journal_proposals" ADD CONSTRAINT "merchant_journal_proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_policy" ADD CONSTRAINT "merchant_policy_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_policy" ADD CONSTRAINT "merchant_policy_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_quotes" ADD CONSTRAINT "merchant_quotes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_quotes" ADD CONSTRAINT "merchant_quotes_invoice_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."invoices"("org_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_quotes" ADD CONSTRAINT "merchant_quotes_token_fk" FOREIGN KEY ("network","token_contract") REFERENCES "public"."token_config"("network","contract") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_invoice_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."invoices"("org_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_time_log" ADD CONSTRAINT "pilot_time_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_time_log" ADD CONSTRAINT "pilot_time_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_grants" ADD CONSTRAINT "provider_grants_merchant_org_id_organizations_id_fk" FOREIGN KEY ("merchant_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_grants" ADD CONSTRAINT "provider_grants_provider_org_id_organizations_id_fk" FOREIGN KEY ("provider_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_grants" ADD CONSTRAINT "provider_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payment_records" ADD CONSTRAINT "provider_payment_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_exceptions" ADD CONSTRAINT "recon_exceptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_exceptions" ADD CONSTRAINT "recon_exceptions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" ADD CONSTRAINT "settlement_batch_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" ADD CONSTRAINT "settlement_batch_lines_batch_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "public"."settlement_batches"("org_id","batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_config" ADD CONSTRAINT "token_config_network_network_config_network_fk" FOREIGN KEY ("network") REFERENCES "public"."network_config"("network") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writeoff_proposals" ADD CONSTRAINT "writeoff_proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writeoff_proposals" ADD CONSTRAINT "writeoff_proposals_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writeoff_proposals" ADD CONSTRAINT "writeoff_proposals_invoice_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."invoices"("org_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chain_transfers_to_idx" ON "chain_transfers" USING btree ("org_id","network","to_address");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_quotes_deposit_uq" ON "merchant_quotes" USING btree ("org_id","network","deposit_address");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_deposit_uq" ON "payment_links" USING btree ("org_id","network","deposit_address");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_provider_fk" FOREIGN KEY ("provider_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_kind_chk" CHECK ("approval_requests"."subject_kind" in ('investigation_resolution','merchant_writeoff','merchant_resolution'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_kind_chk" CHECK ("organizations"."kind" in ('merchant','provider'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_provider_chk" CHECK ("organizations"."kind" = 'merchant' or "organizations"."provider_org_id" is null);