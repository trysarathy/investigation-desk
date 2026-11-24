-- v1 phase 0: bank accounts of an entity. Runs as the schema owner.
-- Until now there was no table of bank accounts (DEPLOYMENT_RUNBOOK_RC7 "Not covered by the CLI"): a statement line
-- named its account only as text from the file. A bank account belongs to one entity, has one currency (which may
-- differ from the entity's functional currency) and is identified by its LAST FOUR characters only: the full account
-- number or IBAN is never stored, encrypted or otherwise.
CREATE TABLE "bank_accounts" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"currency" text NOT NULL,
	"display_name" text NOT NULL,
	"account_last4" text NOT NULL,
	"bank_name" text NOT NULL,
	"bic" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "bank_accounts_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "bank_accounts_cur_chk" CHECK ("bank_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "bank_accounts_last4_chk" CHECK ("bank_accounts"."account_last4" ~ '^[A-Z0-9]{4}$'),
	CONSTRAINT "bank_accounts_name_chk" CHECK (length("bank_accounts"."display_name") between 1 and 120),
	CONSTRAINT "bank_accounts_bank_chk" CHECK (length("bank_accounts"."bank_name") between 1 and 120),
	CONSTRAINT "bank_accounts_bic_chk" CHECK ("bank_accounts"."bic" is null or "bank_accounts"."bic" ~ '^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
	CONSTRAINT "bank_accounts_status_chk" CHECK ("bank_accounts"."status" in ('active','closed') and ("bank_accounts"."status" = 'closed') = ("bank_accounts"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_name_uq" ON "bank_accounts" USING btree ("org_id","entity_id","display_name");
--> statement-breakpoint

-- Statement uploads and their lines name the account (nullable: rows from before this migration, seed lines and rc5
-- CSV-import lines keep NULL; a NEW bank-statement upload must name one, enforced below).
ALTER TABLE "uploads" ADD COLUMN "bank_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_bank_account_fk" FOREIGN KEY ("org_id","bank_account_id") REFERENCES "public"."bank_accounts"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_bank_account_type_chk" CHECK ("uploads"."bank_account_id" is null or "uploads"."file_type" = 'bank_statement');
--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "bank_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_bank_account_fk" FOREIGN KEY ("org_id","bank_account_id") REFERENCES "public"."bank_accounts"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Tenancy like every merchant table: forced RLS, the merchant's members only, provider read under a full grant.
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON bank_accounts USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_full_grant_read ON bank_accounts FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint
-- Configuration, like entities (0038): the app reads it; only the provisioning path (owner) creates or closes one.
GRANT SELECT ON bank_accounts TO clearline_app;
--> statement-breakpoint

-- An account's identity never changes (entity, currency, masked number, creator); it may be renamed and closed once,
-- never reopened; it is never deleted (the merchant-deletion command disables user triggers for its own transaction).
CREATE FUNCTION keep_bank_account() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.org_id <> OLD.org_id OR NEW.id <> OLD.id OR NEW.entity_id <> OLD.entity_id OR NEW.currency <> OLD.currency
     OR NEW.account_last4 <> OLD.account_last4 OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a bank account''s entity, currency and number never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'closed' AND (NEW.status <> 'closed' OR NEW.closed_at IS DISTINCT FROM OLD.closed_at) THEN
    RAISE EXCEPTION 'a closed bank account is never reopened' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bank_accounts_keep BEFORE UPDATE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION keep_bank_account();
--> statement-breakpoint
CREATE TRIGGER bank_accounts_no_delete BEFORE DELETE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- A new bank-statement upload names an ACTIVE account of the same entity; an upload's account never changes.
CREATE FUNCTION check_upload_bank_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id THEN
      RAISE EXCEPTION 'an upload''s bank account never changes' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.file_type = 'bank_statement' AND NEW.bank_account_id IS NULL THEN
    RAISE EXCEPTION 'a bank statement names the bank account it belongs to' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.bank_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bank_accounts a WHERE a.org_id = NEW.org_id AND a.id = NEW.bank_account_id
       AND a.entity_id = NEW.entity_id AND a.status = 'active') THEN
    RAISE EXCEPTION 'a bank statement belongs to an active bank account of its entity' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER uploads_bank_account BEFORE INSERT OR UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION check_upload_bank_account();
--> statement-breakpoint

-- A bank line that names an account is in that account's currency and entity; a line from an uploaded statement
-- belongs to its upload's account. Set-based, once per INSERT statement (as 0030): one bad row rolls back the statement.
-- Named to fire after bank_lines_upload_provenance (triggers fire in name order), so its provenance refusals come first.
CREATE FUNCTION check_bank_line_account_statement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE msg text;
BEGIN
  SELECT c.m INTO msg FROM (SELECT CASE
      WHEN n.source = 'file_import' AND n.bank_account_id IS DISTINCT FROM u.bank_account_id THEN 'an imported statement line belongs to its upload''s bank account'
      WHEN n.bank_account_id IS NULL THEN NULL
      WHEN a.id IS NULL OR n.entity_id IS DISTINCT FROM a.entity_id THEN 'a bank line belongs to a bank account of its entity'
      WHEN n.currency <> a.currency THEN 'statement currency differs from the bank account''s currency'
    END AS m FROM new_rows n
    LEFT JOIN public.bank_accounts a ON a.org_id = n.org_id AND a.id = n.bank_account_id
    LEFT JOIN public.uploads u ON u.org_id = n.org_id AND u.id = n.upload_id) c WHERE c.m IS NOT NULL LIMIT 1;
  IF msg IS NOT NULL THEN RAISE EXCEPTION '%', msg USING ERRCODE = 'check_violation'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER bank_lines_with_bank_account AFTER INSERT ON bank_lines REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION check_bank_line_account_statement();
