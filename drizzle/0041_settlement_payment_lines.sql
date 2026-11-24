-- v1 Phase 0 (approval-only draft): per-payment settlement files. One row per payment (the provider's payment ID,
-- optionally the order reference, gross, fee, net, batch, currency, settlement date), uploaded beside a totals-only
-- settlement report through the same upload -> mapping -> validation -> confirmation -> normalise flow. Runs as the
-- schema owner. No existing control is relaxed: a new file type; a new table with the merchant tables' row-level
-- security, insert-only, immutable rows and the upload-provenance check (0030), extended to this table with the same
-- rule as ledger invoices (a confirmed upload of this file type, its uploader, template and entity). Every other
-- table keeps its rule unchanged.
ALTER TABLE "uploads" DROP CONSTRAINT "uploads_type_chk";
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_type_chk" CHECK ("uploads"."file_type" in ('provider_export','settlement_report','orders_invoices','bank_statement','ledger_invoices','settlement_payments'));
--> statement-breakpoint
ALTER TABLE "mapping_templates" DROP CONSTRAINT "mapping_templates_type_chk";
--> statement-breakpoint
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_type_chk" CHECK ("mapping_templates"."file_type" in ('provider_export','settlement_report','orders_invoices','bank_statement','ledger_invoices','settlement_payments'));
--> statement-breakpoint
ALTER TABLE "upload_row_targets" DROP CONSTRAINT "upload_row_targets_table_chk";
--> statement-breakpoint
ALTER TABLE "upload_row_targets" ADD CONSTRAINT "upload_row_targets_table_chk" CHECK ("upload_row_targets"."target_table" in ('invoices','merchant_quotes','payment_links','provider_payment_records','chain_transfers','settlement_batches','settlement_batch_lines','bank_lines','ledger_invoices','settlement_payment_lines'));
--> statement-breakpoint
CREATE TABLE "settlement_payment_lines" (
	"org_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"order_id" text,
	"currency" text NOT NULL,
	"gross_minor" bigint NOT NULL,
	"fee_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	"settlement_date" date,
	"upload_id" uuid NOT NULL,
	"source_row" integer NOT NULL,
	"mapping_template_id" uuid,
	"mapping_template_version" integer,
	"uploaded_by" text NOT NULL,
	CONSTRAINT "settlement_payment_lines_org_id_provider_payment_id_pk" PRIMARY KEY("org_id","provider_payment_id"),
	CONSTRAINT "settlement_payment_lines_cur_chk" CHECK ("settlement_payment_lines"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "settlement_payment_lines_arith_chk" CHECK ("settlement_payment_lines"."gross_minor" >= 0 and "settlement_payment_lines"."fee_minor" >= 0 and "settlement_payment_lines"."gross_minor" - "settlement_payment_lines"."fee_minor" = "settlement_payment_lines"."net_minor")
);
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" ADD CONSTRAINT "settlement_payment_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" ADD CONSTRAINT "settlement_payment_lines_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" ADD CONSTRAINT "settlement_payment_lines_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settlement_payment_lines" ADD CONSTRAINT "settlement_payment_lines_batch_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "public"."settlement_batches"("org_id","batch_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE settlement_payment_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE settlement_payment_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON settlement_payment_lines USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_full_grant_read ON settlement_payment_lines FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint
-- Insert only (normalise); rows never change; retention (the owner) deletes them.
GRANT SELECT, INSERT ON settlement_payment_lines TO clearline_app;
--> statement-breakpoint
CREATE TRIGGER settlement_payment_lines_no_change BEFORE UPDATE ON settlement_payment_lines FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
-- The provenance rule of 0030, with one branch added for this table (the ledger-invoice rule, entity included).
CREATE OR REPLACE FUNCTION check_upload_provenance_statement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  msg text;
  allowed text[] := CASE TG_TABLE_NAME WHEN 'invoices' THEN ARRAY['orders_invoices', 'provider_export']
    WHEN 'settlement_batches' THEN ARRAY['settlement_report'] WHEN 'settlement_batch_lines' THEN ARRAY['settlement_report']
    WHEN 'bank_lines' THEN ARRAY['bank_statement'] WHEN 'ledger_invoices' THEN ARRAY['ledger_invoices']
    WHEN 'settlement_payment_lines' THEN ARRAY['settlement_payments'] ELSE ARRAY['provider_export'] END;
  m_line_upload constant text := 'an imported statement line names its upload';
  m_claim constant text := 'a transfer claimed by a provider file is recorded from its upload, unconfirmed and not final';
  m_provenance constant text := 'a row comes from a confirmed upload of a matching file type, with that upload''s provenance';
  m_second constant text := 'maker-checker: a statement line is written only after a second person confirmed its upload';
  m_source constant text := 'a transfer from a provider file is a provider claim (source provider_export)';
BEGIN
  -- One query per table (only the branch for this trigger's table is ever planned, so each names only its own
  -- columns). Each CASE is the rc7 per-row rule in the same order; "upload" is the row's upload in its organisation.
  IF TG_TABLE_NAME = 'bank_lines' THEN
    SELECT c.m INTO msg FROM (SELECT CASE
        WHEN n.source = 'file_import' AND n.upload_id IS NULL THEN m_line_upload
        WHEN n.upload_id IS NULL THEN NULL
        WHEN u.id IS NULL OR u.status <> 'confirmed' OR NOT (u.file_type = ANY (allowed)) OR n.uploaded_by IS DISTINCT FROM u.uploaded_by
          OR n.mapping_template_id IS DISTINCT FROM u.template_id OR n.mapping_template_version IS DISTINCT FROM u.template_version THEN m_provenance
        WHEN n.source <> 'file_import' OR u.confirmed_by IS NULL OR u.confirmed_by = u.uploaded_by THEN m_second
      END AS m FROM new_rows n LEFT JOIN public.uploads u ON u.org_id = n.org_id AND u.id = n.upload_id) c WHERE c.m IS NOT NULL LIMIT 1;
  ELSIF TG_TABLE_NAME = 'chain_transfers' THEN
    SELECT c.m INTO msg FROM (SELECT CASE
        WHEN n.source = 'provider_export' AND (n.upload_id IS NULL OR n.finalised OR n.confirmations <> 0) THEN m_claim
        WHEN n.upload_id IS NULL THEN NULL
        WHEN u.id IS NULL OR u.status <> 'confirmed' OR NOT (u.file_type = ANY (allowed)) OR n.uploaded_by IS DISTINCT FROM u.uploaded_by
          OR n.mapping_template_id IS DISTINCT FROM u.template_id OR n.mapping_template_version IS DISTINCT FROM u.template_version THEN m_provenance
        WHEN n.source <> 'provider_export' THEN m_source
      END AS m FROM new_rows n LEFT JOIN public.uploads u ON u.org_id = n.org_id AND u.id = n.upload_id) c WHERE c.m IS NOT NULL LIMIT 1;
  ELSIF TG_TABLE_NAME = 'ledger_invoices' OR TG_TABLE_NAME = 'settlement_payment_lines' THEN
    SELECT c.m INTO msg FROM (SELECT CASE
        WHEN n.upload_id IS NULL THEN NULL
        WHEN u.id IS NULL OR u.status <> 'confirmed' OR NOT (u.file_type = ANY (allowed)) OR n.uploaded_by IS DISTINCT FROM u.uploaded_by
          OR n.mapping_template_id IS DISTINCT FROM u.template_id OR n.mapping_template_version IS DISTINCT FROM u.template_version
          OR n.entity_id IS DISTINCT FROM u.entity_id THEN m_provenance
      END AS m FROM new_rows n LEFT JOIN public.uploads u ON u.org_id = n.org_id AND u.id = n.upload_id) c WHERE c.m IS NOT NULL LIMIT 1;
  ELSE
    SELECT c.m INTO msg FROM (SELECT CASE
        WHEN n.upload_id IS NULL THEN NULL
        WHEN u.id IS NULL OR u.status <> 'confirmed' OR NOT (u.file_type = ANY (allowed)) OR n.uploaded_by IS DISTINCT FROM u.uploaded_by
          OR n.mapping_template_id IS DISTINCT FROM u.template_id OR n.mapping_template_version IS DISTINCT FROM u.template_version THEN m_provenance
      END AS m FROM new_rows n LEFT JOIN public.uploads u ON u.org_id = n.org_id AND u.id = n.upload_id) c WHERE c.m IS NOT NULL LIMIT 1;
  END IF;
  IF msg IS NOT NULL THEN RAISE EXCEPTION '%', msg USING ERRCODE = 'check_violation'; END IF;
  RETURN NULL;
END $$;

--> statement-breakpoint
CREATE TRIGGER settlement_payment_lines_upload_provenance AFTER INSERT ON settlement_payment_lines REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION check_upload_provenance_statement();
