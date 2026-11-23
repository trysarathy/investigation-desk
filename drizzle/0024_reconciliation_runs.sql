-- rc7 phase 3a: reconciliation runs and rule-change notices. Runs as the schema owner. No existing control is
-- relaxed: these are new tables with the merchant tables' row-level security.

-- One row per reconciliation run of an entity (append-only). Counts and an error CODE only, never file contents.
CREATE TABLE "reconciliation_runs" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"trigger" text NOT NULL,
	"job_id" uuid,
	"started_by" text NOT NULL,
	"rule_set_version" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"input_sha256" text,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"with_difference" integer DEFAULT 0 NOT NULL,
	"review" integer DEFAULT 0 NOT NULL,
	"exceptions" integer DEFAULT 0 NOT NULL,
	"unpaid" integer DEFAULT 0 NOT NULL,
	"kept" integer DEFAULT 0 NOT NULL,
	"notices" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	CONSTRAINT "reconciliation_runs_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "reconciliation_runs_trigger_chk" CHECK ("reconciliation_runs"."trigger" in ('manual','schedule','rule_change')),
	CONSTRAINT "reconciliation_runs_status_chk" CHECK ("reconciliation_runs"."status" in ('changed','no_change','failed')),
	CONSTRAINT "reconciliation_runs_error_chk" CHECK (("reconciliation_runs"."status" = 'failed') = ("reconciliation_runs"."error_code" is not null) and ("reconciliation_runs"."error_code" is null or "reconciliation_runs"."error_code" ~ '^[A-Z0-9_]{2,64}$')),
	CONSTRAINT "reconciliation_runs_hash_chk" CHECK ("reconciliation_runs"."status" = 'failed' or "reconciliation_runs"."input_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_started_by_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "reconciliation_runs_entity_idx" ON "reconciliation_runs" USING btree ("org_id","entity_id","started_at");
--> statement-breakpoint

-- A payment a person closed (approved write-off or approved resolution) is never changed by a later run. When the
-- engine would now decide it differently, the run records this notice for a person instead.
CREATE TABLE "rule_change_notices" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"order_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"rule_set_version" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"stored_decision" text NOT NULL,
	"stored_rule_id" text NOT NULL,
	"new_decision" text NOT NULL,
	"new_rule_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_change_notices_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "rule_change_notices" ADD CONSTRAINT "rule_change_notices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rule_change_notices" ADD CONSTRAINT "rule_change_notices_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "rule_change_notices_once_idx" ON "rule_change_notices" USING btree ("org_id","order_id","fingerprint");
--> statement-breakpoint
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['reconciliation_runs','rule_change_notices']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format($p$CREATE POLICY merchant_isolation ON %I USING (org_id = app_org_id() AND app_is_member(org_id))
                     WITH CHECK (org_id = app_org_id() AND app_is_member(org_id))$p$, tbl);
    EXECUTE format($p$CREATE POLICY provider_full_grant_read ON %I FOR SELECT USING (app_provider_full_access(org_id))$p$, tbl);
  END LOOP;
END $$;
--> statement-breakpoint
-- A run is recorded for the signed-in member who started it (a scheduled run: the member who set the schedule).
CREATE POLICY started_by_self ON reconciliation_runs AS RESTRICTIVE FOR INSERT WITH CHECK (started_by = app_user_id());
--> statement-breakpoint
CREATE TRIGGER reconciliation_runs_append_only BEFORE UPDATE OR DELETE ON reconciliation_runs FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
GRANT SELECT, INSERT ON reconciliation_runs TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON rule_change_notices TO clearline_app;
