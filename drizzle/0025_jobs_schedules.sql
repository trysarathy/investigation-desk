-- rc7 phase 3a: a job queue in PostgreSQL and a daily schedule per entity. Runs as the schema owner. No existing
-- control is relaxed: new tables; members read their own jobs only, and only the owner connection (the worker and
-- the scheduler) writes them.

-- Daily schedule per entity: local time in the entity's merchant day (its UTC offset), run as the member who set it.
CREATE TABLE "reconciliation_schedules" (
	"org_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"local_time" text DEFAULT '02:00' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"run_as" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_schedules_org_id_entity_id_pk" PRIMARY KEY("org_id","entity_id"),
	CONSTRAINT "reconciliation_schedules_time_chk" CHECK ("reconciliation_schedules"."local_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "reconciliation_schedules" ADD CONSTRAINT "reconciliation_schedules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reconciliation_schedules" ADD CONSTRAINT "reconciliation_schedules_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reconciliation_schedules" ADD CONSTRAINT "reconciliation_schedules_run_as_fk" FOREIGN KEY ("run_as") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- The job queue. Written by the worker and scheduler (owner connection); members may only read their own jobs.
-- (org, entity, dedupe_key) is unique: the same entity's day, or the same rule version, is enqueued once.
CREATE TABLE "jobs" (
	"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text DEFAULT 'reconcile' NOT NULL,
	"trigger" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"run_as" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error_code" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_kind_chk" CHECK ("jobs"."kind" = 'reconcile'),
	CONSTRAINT "jobs_trigger_chk" CHECK ("jobs"."trigger" in ('schedule','rule_change')),
	CONSTRAINT "jobs_status_chk" CHECK ("jobs"."status" in ('queued','running','done','dead','cancelled')),
	CONSTRAINT "jobs_attempts_chk" CHECK ("jobs"."attempts" >= 0 and "jobs"."max_attempts" between 1 and 20 and "jobs"."attempts" <= "jobs"."max_attempts"),
	CONSTRAINT "jobs_error_chk" CHECK ("jobs"."last_error_code" is null or "jobs"."last_error_code" ~ '^[A-Z0-9_]{2,64}$')
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_run_as_fk" FOREIGN KEY ("run_as") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("org_id","entity_id","dedupe_key");
--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_after");
--> statement-breakpoint
ALTER TABLE reconciliation_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reconciliation_schedules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON reconciliation_schedules USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id) AND run_as = app_user_id());
--> statement-breakpoint
CREATE POLICY member_read ON jobs FOR SELECT USING (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON reconciliation_schedules TO clearline_app;
--> statement-breakpoint
GRANT SELECT ON jobs TO clearline_app;
