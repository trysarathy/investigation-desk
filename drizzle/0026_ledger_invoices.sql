-- rc7 phase 3b: ledger invoices (sales invoices from the merchant's accounting system) through the upload pipeline.
-- Runs as the schema owner. No existing control is relaxed: a new file type, a new table with the merchant tables'
-- row-level security, and the provenance check extended to that table (every other table keeps its rule).
ALTER TABLE "uploads" DROP CONSTRAINT "uploads_type_chk";
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_type_chk" CHECK ("uploads"."file_type" in ('provider_export','settlement_report','orders_invoices','bank_statement','ledger_invoices'));
--> statement-breakpoint
ALTER TABLE "mapping_templates" DROP CONSTRAINT "mapping_templates_type_chk";
--> statement-breakpoint
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_type_chk" CHECK ("mapping_templates"."file_type" in ('provider_export','settlement_report','orders_invoices','bank_statement','ledger_invoices'));
--> statement-breakpoint
ALTER TABLE "upload_row_targets" DROP CONSTRAINT "upload_row_targets_table_chk";
--> statement-breakpoint
ALTER TABLE "upload_row_targets" ADD CONSTRAINT "upload_row_targets_table_chk" CHECK ("upload_row_targets"."target_table" in ('invoices','merchant_quotes','payment_links','provider_payment_records','chain_transfers','settlement_batches','settlement_batch_lines','bank_lines','ledger_invoices'));
--> statement-breakpoint
CREATE TABLE "ledger_invoices" (
	"org_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"order_ref" text,
	"contact" text,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"amount_due_minor" bigint,
	"amount_paid_minor" bigint,
	"status" text NOT NULL,
	"issued_on" date,
	"due_on" date,
	"ledger_id" text,
	"upload_id" uuid NOT NULL,
	"source_row" integer NOT NULL,
	"mapping_template_id" uuid,
	"mapping_template_version" integer,
	"uploaded_by" text NOT NULL,
	CONSTRAINT "ledger_invoices_org_id_entity_id_invoice_number_pk" PRIMARY KEY("org_id","entity_id","invoice_number"),
	CONSTRAINT "ledger_invoices_cur_chk" CHECK ("ledger_invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ledger_invoices_status_chk" CHECK ("ledger_invoices"."status" in ('draft','open','paid','void')),
	CONSTRAINT "ledger_invoices_amount_chk" CHECK ("ledger_invoices"."total_minor" >= 0 and coalesce("ledger_invoices"."amount_due_minor", 0) >= 0 and coalesce("ledger_invoices"."amount_paid_minor", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_invoices" ADD CONSTRAINT "ledger_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_invoices" ADD CONSTRAINT "ledger_invoices_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_invoices" ADD CONSTRAINT "ledger_invoices_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE ledger_invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_invoices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON ledger_invoices USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_full_grant_read ON ledger_invoices FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint
-- Insert only (normalise); rows never change; retention (the owner) deletes them.
GRANT SELECT, INSERT ON ledger_invoices TO clearline_app;
--> statement-breakpoint
CREATE TRIGGER ledger_invoices_no_change BEFORE UPDATE ON ledger_invoices FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
-- The provenance rule of 0021, with ledger invoices coming only from a confirmed ledger_invoices upload.
CREATE OR REPLACE FUNCTION check_upload_provenance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE u record; allowed text[]; r jsonb := to_jsonb(NEW); upload uuid := (to_jsonb(NEW) ->> 'upload_id')::uuid;
BEGIN
  IF TG_TABLE_NAME = 'bank_lines' AND r ->> 'source' = 'file_import' AND upload IS NULL THEN
    RAISE EXCEPTION 'an imported statement line names its upload' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'chain_transfers' AND r ->> 'source' = 'provider_export' AND (upload IS NULL OR (r ->> 'finalised')::boolean OR (r ->> 'confirmations')::int <> 0) THEN
    RAISE EXCEPTION 'a transfer claimed by a provider file is recorded from its upload, unconfirmed and not final' USING ERRCODE = 'check_violation';
  END IF;
  IF upload IS NULL THEN RETURN NEW; END IF;
  allowed := CASE TG_TABLE_NAME WHEN 'invoices' THEN ARRAY['orders_invoices', 'provider_export']
    WHEN 'settlement_batches' THEN ARRAY['settlement_report'] WHEN 'settlement_batch_lines' THEN ARRAY['settlement_report']
    WHEN 'bank_lines' THEN ARRAY['bank_statement'] WHEN 'ledger_invoices' THEN ARRAY['ledger_invoices'] ELSE ARRAY['provider_export'] END;
  SELECT * INTO u FROM public.uploads x WHERE x.org_id = (r ->> 'org_id')::uuid AND x.id = upload;
  IF NOT FOUND OR u.status <> 'confirmed' OR NOT (u.file_type = ANY (allowed)) OR r ->> 'uploaded_by' IS DISTINCT FROM u.uploaded_by
     OR (r ->> 'mapping_template_id')::uuid IS DISTINCT FROM u.template_id OR (r ->> 'mapping_template_version')::int IS DISTINCT FROM u.template_version
     OR (TG_TABLE_NAME = 'ledger_invoices' AND r ->> 'entity_id' IS DISTINCT FROM u.entity_id) THEN
    RAISE EXCEPTION 'a row comes from a confirmed upload of a matching file type, with that upload''s provenance' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'bank_lines' AND (r ->> 'source' <> 'file_import' OR u.confirmed_by IS NULL OR u.confirmed_by = u.uploaded_by) THEN
    RAISE EXCEPTION 'maker-checker: a statement line is written only after a second person confirmed its upload' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'chain_transfers' AND r ->> 'source' <> 'provider_export' THEN
    RAISE EXCEPTION 'a transfer from a provider file is a provider claim (source provider_export)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_invoices_upload_provenance BEFORE INSERT ON ledger_invoices FOR EACH ROW EXECUTE FUNCTION check_upload_provenance();
