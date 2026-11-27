-- v1 phase 2.3: DRAFT journals written to a connected ledger, and the mapping of Clearline's accounts to the ledger's
-- chart of accounts. Runs as the schema owner. No existing control is relaxed.
-- A draft is written only when the organisation's posting rules are signed (postingRulesSigned, src/server/ledger-connect.ts:
-- a signature table that does not exist yet means NOT signed). One row per journal and connection, keyed by a
-- deterministic idempotency key: a retry never writes a second draft. Rows hold ids, hashes and statuses only.
CREATE TABLE "ledger_account_maps" (
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"clearline_account" text NOT NULL,
	"ledger_account_code" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_account_maps_pk" PRIMARY KEY("org_id","connection_id","clearline_account"),
	CONSTRAINT "ledger_account_maps_account_chk" CHECK ("clearline_account" in ('provider_clearing','accounts_receivable','customer_overpayments','payment_shortfall_expense','requote_rate_difference','payment_processing_fees','sales_refunds','bank')),
	CONSTRAINT "ledger_account_maps_code_chk" CHECK ("ledger_account_code" ~ '^[A-Za-z0-9._-]{1,30}$')
);
--> statement-breakpoint
ALTER TABLE "ledger_account_maps" ADD CONSTRAINT "ledger_account_maps_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."ledger_connections"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_account_maps" ADD CONSTRAINT "ledger_account_maps_set_by_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "ledger_journal_drafts" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"ledger_tenant_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_sha256" text NOT NULL,
	"posting_rules_version" text NOT NULL,
	"status" text NOT NULL,
	"external_id" text,
	"failure" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_journal_drafts_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "ledger_journal_drafts_status_chk" CHECK ("status" in ('sending','drafted','failed')),
	CONSTRAINT "ledger_journal_drafts_drafted_chk" CHECK (("status" = 'drafted') = ("external_id" is not null)),
	CONSTRAINT "ledger_journal_drafts_key_chk" CHECK ("idempotency_key" ~ '^cl-jd-[0-9a-f]{40}$' and "request_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ledger_journal_drafts_failure_chk" CHECK ("failure" is null or length("failure") <= 300)
);
--> statement-breakpoint
ALTER TABLE "ledger_journal_drafts" ADD CONSTRAINT "ledger_journal_drafts_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."ledger_connections"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_journal_drafts" ADD CONSTRAINT "ledger_journal_drafts_proposal_fk" FOREIGN KEY ("org_id","proposal_id") REFERENCES "public"."merchant_journal_proposals"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_journal_drafts" ADD CONSTRAINT "ledger_journal_drafts_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_journal_drafts_key_uq" ON "ledger_journal_drafts" USING btree ("org_id","connection_id","idempotency_key");
--> statement-breakpoint
-- A journal goes to one ledger organisation at most once, whichever connection carried it (disconnecting and connecting
-- the same organisation again makes a new connection, never a second draft of the same journal).
CREATE UNIQUE INDEX "ledger_journal_drafts_once_uq" ON "ledger_journal_drafts" USING btree ("org_id","ledger_tenant_id","proposal_id");
--> statement-breakpoint

ALTER TABLE ledger_account_maps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_account_maps FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON ledger_account_maps USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ledger_account_maps TO clearline_app;
--> statement-breakpoint
ALTER TABLE ledger_journal_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_journal_drafts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON ledger_journal_drafts USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ledger_journal_drafts TO clearline_app;
--> statement-breakpoint

-- sending → drafted | failed | sending (a stale send retried, same key); failed → sending (a retry, same key); drafted is
-- final. What was sent never changes.
CREATE FUNCTION keep_ledger_journal_draft() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.org_id <> OLD.org_id OR NEW.id <> OLD.id OR NEW.connection_id <> OLD.connection_id OR NEW.ledger_tenant_id <> OLD.ledger_tenant_id OR NEW.entity_id <> OLD.entity_id
     OR NEW.proposal_id <> OLD.proposal_id OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.request_sha256 <> OLD.request_sha256
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a ledger draft''s journal, ledger and key never change' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((OLD.status = 'sending' AND NEW.status IN ('sending', 'drafted', 'failed')) OR (OLD.status = 'failed' AND NEW.status = 'sending')) THEN
    RAISE EXCEPTION 'ledger draft % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_journal_drafts_keep BEFORE UPDATE ON ledger_journal_drafts FOR EACH ROW EXECUTE FUNCTION keep_ledger_journal_draft();
--> statement-breakpoint
CREATE TRIGGER ledger_journal_drafts_no_delete BEFORE DELETE ON ledger_journal_drafts FOR EACH ROW EXECUTE FUNCTION refuse_change();
