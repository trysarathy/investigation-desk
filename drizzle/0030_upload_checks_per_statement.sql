-- rc8: the upload-provenance and upload-target checks run once per INSERT statement instead of once per row.
-- Runs as the schema owner. Founder-approved on one condition: the guarantee is unchanged. Each check is the same
-- rule, row for row, with the same messages, applied set-based to the statement's inserted rows (a transition table)
-- in an AFTER … FOR EACH STATEMENT trigger: if any inserted row breaks the rule, the trigger raises and the whole
-- statement is rolled back, so no row of it is written. The UPDATE triggers (keep_upload_provenance, refuse_change)
-- are unchanged. Every other control is unchanged.

-- 1. Provenance (0021, extended to ledger invoices in 0026). For each inserted row, in the same order as before:
--    an imported statement line names its upload; a transfer claimed by a provider file is unconfirmed and not final;
--    a row naming an upload comes from that upload while it is confirmed, of a file type that produces this table,
--    with the upload's uploader, template and template version (and entity, for ledger invoices); a statement line
--    needs the second person's confirmation; a transfer from a provider file is a provider claim.
CREATE FUNCTION check_upload_provenance_statement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  msg text;
  allowed text[] := CASE TG_TABLE_NAME WHEN 'invoices' THEN ARRAY['orders_invoices', 'provider_export']
    WHEN 'settlement_batches' THEN ARRAY['settlement_report'] WHEN 'settlement_batch_lines' THEN ARRAY['settlement_report']
    WHEN 'bank_lines' THEN ARRAY['bank_statement'] WHEN 'ledger_invoices' THEN ARRAY['ledger_invoices'] ELSE ARRAY['provider_export'] END;
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
  ELSIF TG_TABLE_NAME = 'ledger_invoices' THEN
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
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['invoices','merchant_quotes','payment_links','provider_payment_records','chain_transfers','settlement_batches',
    'settlement_batch_lines','bank_lines','ledger_invoices']
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %I', tbl || '_upload_provenance', tbl);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION check_upload_provenance_statement()',
      tbl || '_upload_provenance', tbl);
  END LOOP;
END $$;
--> statement-breakpoint
DROP FUNCTION check_upload_provenance();
--> statement-breakpoint

-- 2. Upload targets (0021): every inserted target names an upload of its organisation that is confirmed.
CREATE FUNCTION check_upload_targets_statement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM new_rows n WHERE NOT EXISTS (SELECT 1 FROM public.uploads u WHERE u.org_id = n.org_id AND u.id = n.upload_id AND u.status = 'confirmed')) THEN
    RAISE EXCEPTION 'normalised rows are recorded only while a confirmed upload is normalised' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER upload_row_targets_check ON upload_row_targets;
--> statement-breakpoint
CREATE TRIGGER upload_row_targets_check AFTER INSERT ON upload_row_targets REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION check_upload_targets_statement();
--> statement-breakpoint
DROP FUNCTION check_upload_target();
