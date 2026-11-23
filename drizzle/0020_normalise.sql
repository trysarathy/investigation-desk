CREATE TABLE "upload_row_targets" (
	"org_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"target_table" text NOT NULL,
	"target_key" text NOT NULL,
	CONSTRAINT "upload_row_targets_org_id_upload_id_row_number_target_table_target_key_pk" PRIMARY KEY("org_id","upload_id","row_number","target_table","target_key"),
	CONSTRAINT "upload_row_targets_table_chk" CHECK ("upload_row_targets"."target_table" in ('invoices','merchant_quotes','payment_links','provider_payment_records','chain_transfers','settlement_batches','settlement_batch_lines','bank_lines'))
);
--> statement-breakpoint
ALTER TABLE "bank_lines" DROP CONSTRAINT "bank_lines_source_chk";--> statement-breakpoint
ALTER TABLE "chain_transfers" DROP CONSTRAINT "chain_transfers_source_chk";--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "mapping_template_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "mapping_template_version" integer;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "mapping_template_id" uuid;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "mapping_template_version" integer;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "mapping_template_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "mapping_template_version" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "merchant_quotes" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_quotes" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "merchant_quotes" ADD COLUMN "mapping_template_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_quotes" ADD COLUMN "mapping_template_version" integer;--> statement-breakpoint
ALTER TABLE "merchant_quotes" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "mapping_template_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "mapping_template_version" integer;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "provider_payment_records" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_payment_records" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "provider_payment_records" ADD COLUMN "mapping_template_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_payment_records" ADD COLUMN "mapping_template_version" integer;--> statement-breakpoint
ALTER TABLE "provider_payment_records" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" ADD COLUMN "mapping_template_id" uuid;--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" ADD COLUMN "mapping_template_version" integer;--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD COLUMN "mapping_template_id" uuid;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD COLUMN "mapping_template_version" integer;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "upload_rows" ADD COLUMN "normalise_outcome" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "normalised_counts" jsonb;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "normalised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "upload_row_targets" ADD CONSTRAINT "upload_row_targets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_row_targets" ADD CONSTRAINT "upload_row_targets_row_fk" FOREIGN KEY ("org_id","upload_id","row_number") REFERENCES "public"."upload_rows"("org_id","upload_id","row_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_row_targets_target_idx" ON "upload_row_targets" USING btree ("org_id","target_table","target_key");--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD CONSTRAINT "chain_transfers_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_quotes" ADD CONSTRAINT "merchant_quotes_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payment_records" ADD CONSTRAINT "provider_payment_records_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batch_lines" ADD CONSTRAINT "settlement_batch_lines_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_upload_chk" CHECK ("bank_lines"."source" <> 'file_import' or "bank_lines"."upload_id" is not null);--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_source_chk" CHECK ("bank_lines"."source" in ('bank_feed','csv_import','seed_fictional','file_import'));--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD CONSTRAINT "chain_transfers_source_chk" CHECK ("chain_transfers"."source" in ('recorded_fixture','chain_client','seed_fictional','provider_export'));--> statement-breakpoint
ALTER TABLE "upload_rows" ADD CONSTRAINT "upload_rows_outcome_chk" CHECK ("upload_rows"."normalise_outcome" is null or "upload_rows"."normalise_outcome" in ('created','existing','conflict','skipped'));